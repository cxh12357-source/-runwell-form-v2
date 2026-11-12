import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { bundleDemo } from './build.mjs';
import { strFromU8, unzipSync } from 'fflate';

test('all eight reviewed DOCX files are available in a new browser without sample templates', async () => {
  const bundle=await bundleDemo('demo/runtime.mjs');
  globalThis.location=new URL('https://demo.example.invalid');
  globalThis.indexedDB=new IDBFactory();
  Object.defineProperty(navigator,'locks',{value:{request:(_,fn)=>fn()},configurable:true});
  const {localFetch}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
  const call=(path,method='GET')=>localFetch('/api/v1/forms'+path,{method});
  async function templates(){
    const r=await call('/templates');
    const data=await r.json();
    assert.equal(r.status,200,JSON.stringify(data));
    return data.data;
  }
  const rows=await templates();
  assert.equal(rows.length,8);
  assert.ok(rows.every(row=>row.active && row.id.startsWith('reviewed-')));
  for(const row of rows){
    const file=await call('/templates/'+row.id+'/file');
    assert.equal(file.status,200);
    assert.equal(new Uint8Array(await file.arrayBuffer()).slice(0,2).join(','),'80,75');
  }
  assert.equal((await call('/templates/'+rows[0].id,'DELETE')).status,200);
  assert.equal((await templates()).length,7);
  globalThis.indexedDB=new IDBFactory();
  assert.equal((await templates()).length,8);
});

test('浏览器演示的默认套餐生成文件会写入实际账单地址', async () => {
  const bundle=await bundleDemo('demo/runtime.mjs');
  globalThis.location=new URL('https://demo.example.invalid');
  globalThis.indexedDB=new IDBFactory();
  Object.defineProperty(navigator,'locks',{value:{request:(_,fn)=>fn()},configurable:true});
  const {localFetch}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
  const call=(path,method='GET',data)=>localFetch('/api/v1/forms'+path,{method,
    headers:data?{'Content-Type':'application/json'}:{},body:data&&JSON.stringify(data)});
  async function result(response){const r=await response,body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.data;}
  const workspace=await result(call('/workspace'));
  const tariff=workspace.tariffs.find(t=>t.reviewed_id==='business-100m-no-voice' && t.cycle==='年');
  assert.ok(tariff);
  const selection={tariff_id:tariff.id,business_id:tariff.business_id,business_version_id:tariff.business_version_id,
    business_attribute:tariff.business_attribute,voice_required:tariff.voice_required,bandwidth:tariff.bandwidth,
    cycle:tariff.cycle,amount:tariff.amount,discount_mode:'no'};
  const match=await result(call('/match','POST',{selection}));
  assert.equal(match.status,'unique');
  const customer={company_name:'虚构测试企业',extra_credit_code:'000000000000000000',extra_industry:'软件',
    install_address:'虚构安装路',billing_address:'虚构安装路',contact_name:'测试甲',phone:'10000000000',
    id_number:'000000000000000000',email:'a@b.invalid',payment_method:'cash',choice_billing:'1',
    extra_company_size:'10人以下',extra_computer_count:'5台及以下',install_zip:'200001',billing_zip:'200001',
    job_title:'主管',security_name:'测试甲',security_role:'主管',security_phone:'10000000000',
    service_use:'公办',application_date:'2026-11-10'};
  const row=await result(call('/generate','POST',{selection,customer,match_token:match.match_token,
    template_id:match.candidates[0].id,request_id:crypto.randomUUID()}));
  assert.ok(!row.review.includes('billing_address'));
  const file=await call('/records/'+row.id+'/file');
  assert.equal(file.status,200);
  const xml=strFromU8(unzipSync(new Uint8Array(await file.arrayBuffer()))['word/document.xml']);
  assert.ok((xml.match(/虚构安装路/g)||[]).length>=2);
  assert.match(xml,/2026年11月10日/);
});
