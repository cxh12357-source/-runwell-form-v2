import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../backend/app.mjs';
import { openStore } from '../backend/modules/forms/preview/store.mjs';
import { previewRoutes } from '../backend/modules/forms/preview/http.mjs';
import { tariffs, version, defaultMapping } from '../backend/modules/forms/preview/rules.mjs';

let dir, filename, server, store, base;
const actors = new Map(['员工A', '员工B', '管理员'].map((id, index) =>
  ['Bearer test-' + index, { id, role: index === 2 ? 'admin' : 'staff' }]));
const staff = 'test-0', other = 'test-1', admin = 'test-2';
const customer = {
  company_name: '虚构测试企业', contact_name: '测试甲乙', install_address: '虚构安装地址一号',
  billing_address: '虚构账单地址二号', phone: '10000000000', id_number: '000000000000000000',
  email: 'fixture@example.invalid', payment_method: 'collection', bank_name: '虚构测试银行', bank_account: '00000000654321'
};
function select(i = 0) {
  const { id, name, ...metadata } = tariffs[i];
  return { ...metadata, tariff_id: id };
}
async function call(path, token = staff, method = 'GET', data) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (data) headers['Content-Type'] = 'application/json';
  return fetch(base + path, { method, headers, body: data && JSON.stringify(data) });
}
async function result(response, expected = 200) {
  const r = await response;
  const body = await r.json();
  assert.equal(r.status, expected, JSON.stringify(body));
  return body.data;
}
const match = selection => result(call('/match', staff, 'POST', { selection }));
async function payload(user = customer) {
  const selection = select();
  const matched = await match(selection);
  return { request_id: randomUUID(), selection, customer: user, template_id: 'demo-a-sample', match_token: matched.match_token };
}
const generate = (data, token = staff) => call('/generate', token, 'POST', data);
const python = process.env.FORMS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
function manipulate(file, code) {
  const prelude = 'import sys,io,zipfile,xml.etree.ElementTree as ET\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\n';
  const proc = spawnSync(python, ['-I', '-c', prelude + code], { input: file, maxBuffer: 2000000 });
  assert.equal(proc.status, 0, proc.stderr.toString());
  return proc.stdout;
}
function documentText(bytes) {
  return JSON.parse(manipulate(bytes, 'import json\nr=ET.fromstring(z.read("word/document.xml"))\nprint(json.dumps(["".join(p.itertext()) for p in r.findall(".//{*}p")]))'));
}
const getBytes = async r => {
  const response = await r;
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
};
const upload = data => call('/templates', admin, 'POST', data);
const active = (id, value) => result(call('/templates/' + id, admin, 'PATCH', { active: value }));
async function sample() { return getBytes(call('/templates/demo-a-sample/file', admin)); }
function rewrite(bytes, substitution) {
  return manipulate(bytes, `out=io.BytesIO()
with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as dest:
 for name in z.namelist():
  data=z.read(name).decode("utf-8")
  ${substitution}
  dest.writestr(name,data)
sys.stdout.buffer.write(out.getvalue())`);
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forms-preview-test-'));
  filename = join(dir, 'forms.sqlite');
  store = await openStore(filename);
  server = createApp({ version, route: previewRoutes(store, actors) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/api/v1/forms';
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  store?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('联调模式、目录与会话由后台提供；匿名、伪造身份和跨域 Host 被拒', async () => {
  assert.equal((await result(call('/mode', null))).preview, true);
  assert.equal((await call('/workspace', null)).status, 401);
  assert.equal((await call('/workspace', 'admin')).status, 401);
  assert.equal((await result(call('/workspace'))).actor.id, '员工A');
  assert.equal((await call('/templates')).status, 403);
  assert.equal((await call('/templates/demo-a-sample/file')).status, 403);
  assert.equal((await call('/templates', other, 'POST', {})).status, 403);
  assert.equal((await call('/templates/demo-a-sample', other, 'PATCH', { active: false })).status, 403);
  const { request } = await import('node:http');
  const hostStatus = await new Promise((resolve, reject) => request(base + '/mode', { headers: { Host: 'foreign.invalid' } }, r => {
    r.resume(); resolve(r.statusCode);
  }).on('error', reject).end());
  assert.equal(hostStatus, 403);
});
test('同价不同带宽唯一匹配；资料缺失、属性冲突、未知套餐分别处理', async () => {
  for (const i of [0, 1]) {
    const matched = await match(select(i));
    assert.equal(matched.status, 'unique');
    assert.equal(matched.candidates[0].id, tariffs[i].id + '-sample');
    assert.ok(matched.basis.includes(tariffs[i].bandwidth));
  }
  assert.deepEqual((await match({ ...select(), bandwidth: '' })).missing_fields, ['bandwidth']);
  const conflict = await match({ ...select(), bandwidth: '200M', voice_required: true });
  assert.equal(conflict.status, 'conflict');
  assert.deepEqual(conflict.conflicts.sort(), ['bandwidth','voice_required']);
  assert.equal((await match({ ...select(), tariff_id: 'missing' })).status, 'not_found');
  const broken = await payload();
  broken.selection.amount = '1.00';
  assert.equal((await generate(broken)).status, 409);
});
test('两项银行必填、姓名、电话、身份证、邮箱均后台校验', async () => {
  for (const [key, value] of [['bank_name',''], ['bank_account',''], ['contact_name',''], ['phone','0'], ['id_number','1'], ['email','invalid']]) {
    assert.equal((await generate(await payload({ ...customer, [key]: value }))).status, 422, key);
  }
});
test('托收与现金输出到对应 Word 标签和勾选，无残留占位符', async () => {
  for (const payment_method of ['collection','cash']) {
    const row = await result(generate(await payload({ ...customer, payment_method })));
    const lines = documentText(await getBytes(call('/records/' + row.id + '/file')));
    assert.ok(lines.includes('经办人完整姓名　' + customer.contact_name));
    assert.ok(lines.includes('安装地址　' + customer.install_address));
    assert.ok(lines.includes('账单地址　' + customer.billing_address));
    const bank = payment_method === 'collection';
    assert.ok(lines.includes('开户银行　' + (bank ? customer.bank_name : '')));
    assert.ok(lines.includes('银行账号　' + (bank ? customer.bank_account : '')));
    assert.ok(lines.includes(bank ? '付款方式　☐ 现金　　 ☑ 托收' : '付款方式　☑ 现金　　 ☐ 托收'));
    assert.ok(!lines.join('').includes('{{'));
    if (!bank) assert.ok(!lines.join('').includes(customer.bank_account));
    assert.equal((await call('/records/' + row.id + '/file', other)).status, 404);
    assert.equal((await call('/records/' + row.id + '/file', admin)).status, 404);
  }
  assert.deepEqual(await result(call('/records', other)), []);
});
test('上传新版本、额外必填、跨 run 映射、歧义、候选变化、停用及历史快照', async () => {
  const data = await payload();
  const bytes = rewrite(await sample(), 'if name=="word/document.xml": data=data.replace("{{contact_name}}","{{con</w:t></w:r><w:r><w:t>tact_name}} / {{industry}}")');
  const template = { name: '虚构行业版', revision: 'test-2', tariff_id: 'demo-a', mapping: { ...defaultMapping, industry: 'extra_industry' }, file: bytes.toString('base64') };
  const item = await result(upload(template), 201);
  assert.equal(item.active, false);
  assert.equal((await upload(template)).status, 409);
  await active(item.id, true);
  const options = await match(select());
  assert.equal(options.status, 'ambiguous');
  assert.equal((await generate(data)).status, 409, '旧唯一匹配已失效');
  data.match_token = options.match_token;
  assert.equal((await generate({ ...data, template_id: '' })).status, 409);
  data.template_id = item.id;
  assert.equal((await generate(data)).status, 422);
  data.customer = { ...customer, extra_industry: '测试行业' };
  const row = await result(generate(data));
  await active(item.id, false);
  assert.equal((await generate({ ...data, request_id: randomUUID() })).status, 409);
  assert.ok(documentText(await getBytes(call('/records/' + row.id + '/file'))).includes('经办人完整姓名　测试甲乙 / 测试行业'));
  assert.deepEqual(row.template, { id: item.id, name: template.name, revision: template.revision });
  await active('demo-a-sample', false);
  assert.equal((await match(select())).status, 'not_found');
  await active('demo-a-sample', true);
});
test('上传拒绝伪造 DOCX、额外隐藏部件、外链和不完整映射', async () => {
  const bytes = await sample();
  const meta = { name: '不合格模板', revision: 'x', tariff_id: 'demo-a', mapping: defaultMapping };
  const outside = rewrite(bytes, 'if name=="_rels/.rels": data=data.replace("word/document.xml","https://example.invalid/remote")');
  const macro = manipulate(bytes, 'out=io.BytesIO()\nwith zipfile.ZipFile(out,"w") as dest:\n for name in z.namelist(): dest.writestr(name,z.read(name))\n dest.writestr("word/vbaProject.bin",b"fake")\nsys.stdout.buffer.write(out.getvalue())');
  for (const file of [Buffer.from('not a zip'), outside, macro]) assert.equal((await upload({ ...meta, file: file.toString('base64') })).status, 422);
  assert.equal((await upload({ ...meta, mapping: { anything: 'company_name' }, file: bytes.toString('base64') })).status, 422);
  assert.equal((await upload({ ...meta, mapping: { ...defaultMapping, missing: 'extra_zip' }, file: bytes.toString('base64') })).status, 422);
});
test('并发重试只写一次；重开独立数据库仍可按所属账号读取原文件', async () => {
  const data = await payload();
  const items = await Promise.all([result(generate(data, other)), result(generate(data, other))]);
  assert.equal(items[0].id, items[1].id);
  const id = items[0].id;
  assert.equal((await result(call('/records', other))).length, 1);
  assert.equal((await generate({ ...data, customer: { ...customer, billing_address: '另一地址' } }, other)).status, 409);
  const persisted = await openStore(filename);
  try {
    assert.equal(persisted.history('员工B')[0].id, id);
    assert.ok(persisted.recordFile(id, '员工B').length > 0);
    assert.throws(() => persisted.recordFile(id, '员工A'), /找不到/);
  } finally { persisted.close(); }
});

test('页面入口根据账号展示填写、本人历史、模板管理与切换入口', async () => {
  const { renderForms } = await import('../frontend/modules/forms.js');
  const { setToken } = await import('../frontend/modules/forms/shared.js');
  const sourceFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => sourceFetch(new URL(url, base), options);
  try {
    assert.match(await renderForms('/forms/generate'), /id="forms-login"/);
    setToken(staff);
    const generatePage = await renderForms('/forms/generate');
    for (const key of ['company_name','billing_address','contact_name','bank_account','bank_name']) {
      assert.ok(generatePage.includes('name="' + key + '"'));
    }
    assert.ok(generatePage.includes('确认生成 Word'));
    assert.match(await renderForms('/forms/history'), /下载 Word/);
    assert.doesNotMatch(await renderForms('/forms/templates'), /id="template-form"/);
    setToken(admin);
    assert.match(await renderForms('/forms/templates'), /id="template-form"/);
    assert.match(await renderForms('/forms/history'), /还没有生成记录/);
    setToken('expired');
    assert.match(await renderForms('/forms/generate'), /id="forms-login"/);
  } finally { globalThis.fetch = sourceFetch; setToken(''); }
});
