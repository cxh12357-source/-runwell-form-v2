import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkTariffMapping, sampleMapping, sampleLabels, FormError, insist, match, tariffs, validateCustomer, validateMapping } from './rules.mjs';

const script = fileURLToPath(new URL('word.py', import.meta.url));
let workers = 0;
export async function wordFile(input) {
  insist(workers < 4, '正在处理其他 Word 文件，请稍后重试。', 503);
  workers++;
  try {
    const result = await new Promise((resolve, reject) => {
      const python = process.env.FORMS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
      const child = spawn(python, ['-I', script], { stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000 });
      const chunks = [];
      let bytes = 0;
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2000000) child.kill();
        else chunks.push(chunk);
      });
      child.on('error', () => reject(new Error('无法运行 Python 3，请配置 FORMS_PYTHON。')));
      child.stdin.on('error', () => {});
      child.on('close', code => {
        if (code !== 0) return reject(new Error('Word 引擎运行失败。'));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify(input));
    });
    if (result.error) throw new FormError(result.error);
    return Buffer.from(result.file, 'base64');
  } finally { workers--; }
}

export async function openStore(filename) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(`
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY, tariff_id TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL,
        active INTEGER NOT NULL CHECK(active IN (0,1)), mapping TEXT NOT NULL, file BLOB NOT NULL,
        UNIQUE(tariff_id, name, revision)
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
        snapshot TEXT NOT NULL, file BLOB NOT NULL, UNIQUE(owner, request_id)
      );
      CREATE INDEX IF NOT EXISTS records_by_owner ON records(owner);
    `);
    const insert = db.prepare('INSERT OR IGNORE INTO templates VALUES(?,?,?,?,?,?,?)');
    for (const tariff of tariffs) {
      const mapping = sampleMapping(tariff);
      const file = await wordFile({ labels: sampleLabels(tariff), mapping });
      insert.run(tariff.id + '-sample', tariff.id, tariff.name + ' 新装样表', 'demo-1', 1, JSON.stringify(mapping), file);
    }
    return new Store(db);
  } catch (error) { db.close(); throw error; }
}

class Store {
  constructor(db) { this.db = db; }
  close() { this.db.close(); }

  templates() {
    return this.db.prepare('SELECT id,tariff_id,name,revision,active,mapping FROM templates ORDER BY name,revision,id')
      .all().map(t => ({ ...t, active: Boolean(t.active), mapping: JSON.parse(t.mapping) }));
  }

  match(selection) {
    insist(isObject(selection), '请选择套餐并核对分类。');
    const templates = this.templates();
    const result = match(selection, templates);
    for (const candidate of result.candidates) {
      const template = templates.find(t => t.id === candidate.id);
      candidate.extra_fields = [...new Set(Object.values(template.mapping).filter(k => k.startsWith('extra_')))];
    }
    result.match_token = createHash('sha256').update(JSON.stringify(result.candidates)).digest('hex');
    return result;
  }

  async upload(data) {
    const { name, revision, tariff_id, file } = data;
    insist(tariffs.some(t => t.id === tariff_id), '请选择目录中的虚构套餐。');
    for (const value of [name, revision]) insist(typeof value === 'string' && value.trim() && value.length <= 80 &&
      !/[\x00-\x1f]/.test(value), '请填写模板名称和版本（最多 80 字）。');
    const mapping = validateMapping(data.mapping);
    checkTariffMapping(mapping, tariffs.find(t => t.id === tariff_id));
    insist(typeof file === 'string' && file.length > 0 && file.length <= 699052, '请上传 512 KiB 以内的 DOCX。');
    const cleanFile = await wordFile({ file, mapping });
    const id = randomUUID();
    const saved = this.db.prepare('INSERT INTO templates VALUES(?,?,?,?,0,?,?) ON CONFLICT(tariff_id,name,revision) DO NOTHING')
      .run(id, tariff_id, name.trim(), revision.trim(), JSON.stringify(mapping), cleanFile);
    insist(saved.changes, '该套餐下已存在同名同版本模板，请使用新版本号。', 409);
    return { id, active: false };
  }

  setActive(id, active) {
    insist(typeof active === 'boolean', '启停值应为布尔值。');
    const saved = this.db.prepare('UPDATE templates SET active=? WHERE id=?').run(Number(active), id);
    insist(saved.changes, '找不到模板。', 404);
    return { id, active };
  }

  templateFile(id) {
    const row = this.db.prepare('SELECT file FROM templates WHERE id=?').get(id);
    insist(row, '找不到模板。', 404);
    return row.file;
  }

  history(owner) {
    return this.db.prepare('SELECT snapshot FROM records WHERE owner=? ORDER BY rowid DESC').all(owner).map(r => JSON.parse(r.snapshot));
  }

  recordFile(id, owner) {
    const row = this.db.prepare('SELECT file FROM records WHERE id=? AND owner=?').get(id, owner);
    insist(row, '找不到生成记录。', 404);
    return row.file;
  }

  async generate(owner, data) {
    const { request_id, customer, selection, template_id } = data;
    insist(typeof request_id === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(request_id), '缺少有效的请求编号。');
    insist(isObject(customer) && isObject(selection), '请补全客户和套餐信息。');
    const digest = createHash('sha256').update(JSON.stringify([Object.entries(selection).sort(), template_id, Object.entries(customer).sort()])).digest('hex');
    const existing = () => this.db.prepare('SELECT digest,snapshot FROM records WHERE owner=? AND request_id=?').get(owner, request_id);
    const replay = row => {
      insist(row.digest === digest, '请求编号已用于其他内容，请重新核对。', 409);
      return JSON.parse(row.snapshot);
    };
    const previous = existing();
    if (previous) return replay(previous);
    const verify = () => {
      const result = this.match(selection);
      insist(data.match_token === result.match_token, '候选模板已变化，请重新匹配并确认。', 409);
      insist(result.candidates.some(t => t.id === template_id), '请重新匹配并确认有效模板。', 409);
    };
    verify();
    const template = this.db.prepare('SELECT * FROM templates WHERE id=?').get(template_id);
    const tariff = tariffs.find(t => t.id === selection.tariff_id);
    const mapping = JSON.parse(template.mapping);
    const values = validateCustomer(customer, mapping, tariff);
    const file = await wordFile({ file: Buffer.from(template.file).toString('base64'), mapping, values });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const other = existing();
      let snapshot;
      if (other) snapshot = replay(other);
      else {
        verify();
        snapshot = { id: randomUUID(), created_by: owner, created_at: new Date().toISOString(), status: 'generated',
          business_id: tariff.business_id, business_version_id: tariff.business_version_id, business_attribute: tariff.business_attribute,
          tariff: { ...tariff }, template: { id: template.id, name: template.name, revision: template.revision } };
        this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)')
          .run(snapshot.id, owner, request_id, digest, JSON.stringify(snapshot), file);
      }
      this.db.exec('COMMIT');
      return snapshot;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

export function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
