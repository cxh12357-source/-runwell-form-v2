import documents from './default-docx.json' with {type:'json'};
import { identifyReviewed, reviewedInfo } from './reviewed-integration.mjs';

const migration = 'reviewed-catalog-2026-11-v1';

export async function installDefaultCatalog(db, files, visitor) {
  db.prepare('CREATE TABLE IF NOT EXISTS demo_catalog_migrations (id TEXT PRIMARY KEY)').run();
  if (db.prepare('SELECT id FROM demo_catalog_migrations WHERE id=?').bind(migration).first()) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(visitor));
  const tenant = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  const templates = [];
  for (const encoded of documents) {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const plan = await identifyReviewed(bytes);
    if (!plan) throw new Error('默认模板必须与已核验原表一致。');
    templates.push({...reviewedInfo(plan), bytes});
  }
  if (templates.length !== 8 || new Set(templates.map(t => t.id)).size !== 8) throw new Error('默认模板目录不完整。');
  const writes = [];
  const objects = [];
  for (const {id,name,revision,rates,bytes} of templates) {
    if (db.prepare('SELECT id FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,id).first()) continue;
    const key = 'templates/'+tenant+'/'+id;
    writes.push(...rates.map(rate => db.prepare('INSERT INTO demo_tariffs(tenant,id,data) VALUES(?,?,?)')
      .bind(tenant,rate.id,JSON.stringify(rate))));
    writes.push(db.prepare('INSERT INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping,object_key,imported_at) VALUES(?,?,?,?,?,1,?,?,?)')
      .bind(tenant,id,id,name,revision,'{}',key,new Date().toISOString()));
    objects.push([key,bytes]);
  }
  db.batch([
    ...writes,
    db.prepare('INSERT OR REPLACE INTO demo_settings(tenant,hide_samples) VALUES(?,1)').bind(tenant),
    db.prepare('DELETE FROM qa_templates WHERE tenant=? AND object_key IS NULL').bind(tenant),
    db.prepare('INSERT INTO demo_catalog_migrations(id) VALUES(?)').bind(migration)
  ]);
  for (const [key,bytes] of objects) files.set(key,bytes);
  return true;
}
