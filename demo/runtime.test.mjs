import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { strFromU8, unzipSync } from 'fflate';
import { bundleDemo } from './build.mjs';
import { tariffs } from '../backend/modules/forms/preview/rules.mjs';

test('免登录运行：拒绝缺项、生成 Word、刷新后下载、上传及启停、浏览器间隔离，且无业务网络请求', async () => {
  const bundle = await bundleDemo('demo/runtime.mjs');
  const source = 'data:text/javascript;base64,' + Buffer.from(bundle).toString('base64');
  globalThis.location = new URL('https://demo.example.invalid');
  globalThis.indexedDB = new IDBFactory();
  let queue = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { value: { request: (_, fn) => {
    const result = queue.then(fn); queue = result.catch(() => {}); return result;
  } } });
  globalThis.fetch = async () => assert.fail('演示资料不应经网络传输');
  let { localFetch } = await import(source);
  const call = (path, method = 'GET', data) => localFetch('/api/v1/forms' + path, { method,
    headers: data ? { 'Content-Type': 'application/json' } : {}, body: data && JSON.stringify(data) });
  const result = async (response, status = 200) => {
    const r = await response, json = await r.json();
    assert.equal(r.status, status, JSON.stringify(json));
    return json.data;
  };
  const { id, name, ...metadata } = tariffs[0];
  const selection = { ...metadata, tariff_id: id };
  const sampleId = id + '-sample';
  assert.equal((await result(call('/workspace'))).actor.role, 'admin');
  const customer = { company_name: '虚构浏览器样例', install_address: '虚构安装地址', billing_address: '虚构账单地址',
    contact_name: '测试甲乙', phone: '10000000000', id_number: '000000000000000000', email: 'fixture@example.invalid',
    payment_method: 'collection', bank_account: '00000000654321' };
  const match = () => result(call('/match', 'POST', { selection }));
  const first = await match();
  assert.equal(first.status, 'unique');
  const input = { selection, customer, template_id: sampleId, match_token: first.match_token, request_id: crypto.randomUUID() };
  assert.equal((await call('/generate', 'POST', input)).status, 422);
  customer.bank_name = '虚构测试银行';
  const generated = await result(call('/generate', 'POST', input));
  assert.equal((await result(call('/generate', 'POST', input))).id, generated.id);
  ({ localFetch } = await import(source + '#reloaded'));
  assert.deepEqual((await result(call('/records'))).map(row => row.id), [generated.id]);
  const file = await call('/records/' + generated.id + '/file');
  assert.equal(file.status, 200);
  const xml = strFromU8(unzipSync(new Uint8Array(await file.arrayBuffer()))['word/document.xml']);
  assert.match(xml, /虚构浏览器样例/);
  assert.match(xml, /虚构测试银行/);
  assert.doesNotMatch(xml, /\{\{/);
  const templates = await result(call('/templates'));
  const templateFile = await call('/templates/' + sampleId + '/file');
  assert.equal(templateFile.status, 200);
  const added = await result(call('/templates', 'POST', { name: name + '本机样表', revision: 'test-2', tariff_id: id,
    mapping: templates.find(t => t.id === sampleId).mapping, file: Buffer.from(await templateFile.arrayBuffer()).toString('base64') }), 201);
  assert.equal(added.active, false);
  assert.ok((await result(call('/templates'))).find(t => t.id === added.id).custom);
  assert.equal((await call('/templates/' + sampleId, 'DELETE')).status, 403);
  await result(call('/templates/' + added.id, 'PATCH', { active: true }));
  const ambiguous = await match();
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal((await call('/generate', 'POST', { ...input, request_id: crypto.randomUUID() })).status, 409);
  const customRecord = await result(call('/generate', 'POST', {
    ...input, template_id: added.id, match_token: ambiguous.match_token, request_id: crypto.randomUUID()
  }));
  await result(call('/templates/' + added.id, 'PATCH', { active: false }));
  assert.equal((await match()).status, 'unique');
  await result(call('/templates/' + added.id, 'PATCH', { active: true }));
  await result(call('/templates/' + added.id, 'DELETE'));
  ({ localFetch } = await import(source + '#deleted'));
  assert.equal((await match()).status, 'unique');
  assert.equal((await result(call('/templates'))).some(t => t.id === added.id), false);
  assert.equal((await call('/templates/' + added.id + '/file')).status, 404);
  assert.equal((await call('/records/' + customRecord.id + '/file')).status, 200);
  assert.ok((await result(call('/workspace'))).tariffs.some(t => t.id === id));
  globalThis.indexedDB = new IDBFactory();
  assert.deepEqual(await result(call('/records')), []);
  assert.equal((await result(call('/templates'))).some(t => t.id === added.id), false);
});
