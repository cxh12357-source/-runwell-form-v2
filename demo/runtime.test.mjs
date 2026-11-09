import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { strFromU8, unzipSync } from 'fflate';
import { bundleDemo } from './build.mjs';
import { tariffs } from '../backend/modules/forms/preview/rules.mjs';
import { loadReviewedFixtures } from './reviewed-fixtures.mjs';

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
  const sessionData=new Map();
  globalThis.sessionStorage={getItem:key=>sessionData.get(key),setItem:(key,value)=>sessionData.set(key,value)};
  let { localFetch, switchDemoAccount } = await import(source);
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
  const imported = (await result(call('/templates'))).find(t => t.id === added.id);
  assert.ok(imported.custom);
  assert.equal(new Date(imported.imported_at).toISOString(), imported.imported_at);
  await result(call('/templates/' + added.id, 'PATCH', { active: true }));
  assert.equal((await result(call('/templates'))).find(t => t.id === added.id).imported_at, imported.imported_at);
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
  await result(call('/templates/'+sampleId,'PATCH',{active:false}));
  await result(call('/templates/'+sampleId,'DELETE'));
  assert.equal((await call('/templates/'+sampleId+'/file')).status,404);
  assert.ok(!(await result(call('/workspace'))).tariffs.some(t=>t.id===id));
  assert.ok((await result(call('/templates'))).some(t=>!t.custom));
  const now=Date.now;
  try {
    Date.now=()=>now()+9*60*60*1000;
    assert.ok(!(await result(call('/templates'))).some(t=>t.id===sampleId));
    assert.equal((await call('/records/'+generated.id+'/file')).status,200);
  } finally { Date.now=now; }
  await result(call('/templates/samples', 'DELETE'));
  ({ localFetch } = await import(source + '#samples-cleared'));
  assert.deepEqual(await result(call('/templates')), []);
  assert.deepEqual((await result(call('/workspace'))).tariffs, []);
  assert.equal((await call('/records/' + customRecord.id + '/file')).status, 200);
  if(process.env.RUNWELL_REVIEWED_FIXTURES){
    const fixtures=await loadReviewedFixtures(process.env.RUNWELL_REVIEWED_FIXTURES);
    for(const reviewedId of ['business-200m-no-voice','business-ai-v2-voice','business-guarantee']){
      const bytes=fixtures.get(reviewedId);
      assert.ok(bytes);
      const sourceFile={file:bytes.toString('base64'),filename:'没有版式信息.docx'};
      const inspected=await result(call('/templates/inspect','POST',sourceFile));
      assert.ok(inspected.reviewed);
      const added=await result(call('/templates/import','POST',sourceFile),201);
      assert.equal((await result(call('/templates/import','POST',sourceFile))).duplicate,true);
      assert.equal((await result(call('/templates'))).filter(t=>t.id===added.id).length,1);
      const planRates=(await result(call('/workspace'))).tariffs.filter(t=>t.template_id===added.id);
      assert.equal(planRates.length,reviewedId.includes('200m')?3:1);
      const rate=planRates.find(r=>r.reviewed_cycle==='year')||planRates[0];
      const chosen={...rate,tariff_id:rate.id};
      const matchReviewed=()=>result(call('/match','POST',{selection:chosen}));
      assert.equal((await matchReviewed()).status,'not_found');
      await result(call('/templates/'+added.id,'PATCH',{active:true}));
      const matched=await matchReviewed();
      assert.equal(matched.status,'unique');
      const blank=reviewedId==='business-guarantee';
      assert.equal(Boolean(matched.candidates[0].reviewed_controls.blank),blank);
      const common={company_name:'虚构测试企业',extra_credit_code:'000000000000000000'};
      const fields=blank?{guarantee_company:common.company_name,guarantee_credit:common.extra_credit_code,guarantor_name:'虚构担保人',
        guarantee_email:'a@b.invalid',guarantor_id:'000000000000000000',guarantor_address:'虚构路一号',guarantor_phone:'10000000000'}:
        {...customer,...common,email:'a@b.invalid',extra_industry:'物流',extra_company_size:'31-80人',extra_computer_count:'16-40台',
          install_zip:'200001',billing_zip:'200002',application_date:'2026-11-09',security_name:'测试安全员',security_role:'主管',security_phone:'10000000000',service_use:'办公测试',choice_billing:'0',service_type_choice:'1'};
      const payload={selection:chosen,template_id:added.id,match_token:matched.match_token,request_id:crypto.randomUUID(),customer:fields};
      const record=await result(call('/generate','POST',payload));
      assert.ok(record.review.includes(blank?'guarantee_signature':'bank_name'));
      assert.ok((await result(call('/records'))).some(r=>r.id===record.id));
      const output=await call('/records/'+record.id+'/file');
      const word=strFromU8(unzipSync(new Uint8Array(await output.arrayBuffer()))['word/document.xml']);
      assert.match(word,blank?/虚构担保人/:/2026年11月9日/);
      await result(call('/templates/'+added.id,'DELETE'));
      assert.equal((await matchReviewed()).status,'not_found');
      assert.equal((await call('/records/'+record.id+'/file')).status,200);
    }
  }
  globalThis.indexedDB = new IDBFactory();
  const dashboard=()=>result(call('/dashboard'));
  const boardFile=id=>call('/dashboard/records/'+id+'/file');
  assert.equal((await dashboard()).scope,'team');
  switchDemoAccount('a');
  const make=async ()=>{
    const matched=await match();
    return result(call('/generate','POST',{...input,match_token:matched.match_token,request_id:crypto.randomUUID()}));
  };
  const staffA=await make();
  assert.equal((await dashboard()).scope,'self');
  assert.deepEqual((await dashboard()).records.map(r=>r.id),[staffA.id]);
  switchDemoAccount('b');
  assert.deepEqual((await dashboard()).records,[]);
  assert.equal((await boardFile(staffA.id)).status,404);
  const staffB=await make();
  switchDemoAccount('admin');
  assert.deepEqual((await dashboard()).records.map(r=>r.id),[staffB.id,staffA.id]);
  assert.equal((await result(call('/dashboard?period=all'))).records.length,2);
  assert.deepEqual((await result(call('/dashboard?period=week&offset=1'))).records,[]);
  assert.equal((await boardFile(staffA.id)).status,200);
  assert.equal((await boardFile(staffB.id)).status,200);
  globalThis.indexedDB = new IDBFactory();
  assert.deepEqual(await result(call('/records')), []);
  assert.equal((await result(call('/templates'))).some(t => t.id === added.id), false);
});
