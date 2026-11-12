import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from '../vendor/qa-fflate/browser.js';
import { DOMParser } from '../vendor/qa-xmldom/lib/index.js';
import { makeCarrierFixture } from './carrier-fixture.mjs';

const require = createRequire(import.meta.url);
const fromWrangler = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare } = fromWrangler('miniflare');
const { build } = fromWrangler('esbuild');
const origin = 'https://word-test.invalid';
const customer = {
  company_name:'虚构新装企业', contact_name:'测试甲', install_address:'虚构一路', billing_address:'虚构二路',
  phone:'10000000001', id_number:'000000000000000002', email:'fixture@example.invalid',
  bank_name:'虚构银行', bank_account:'00000001', extra_credit_code:'TEST1', extra_industry:'软件',
  install_zip:'000001', billing_zip:'000002', security_name:'测试乙', security_role:'安全员',
  security_phone:'10000000002', service_use:'上网', choice_size:'1', choice_computers:'0',
  choice_line:'0', choice_billing:'1'
};

test('管理员确认原表并共享启用后，另一账号可生成现金和托收 Word，下载和管理权限独立', async t => {
  const {outputFiles} = await build({
    stdin:{contents:`import {handleForms} from './forms/service.mjs';
      import {privateCarrier} from './forms/word-dom.mjs';
      export default {fetch:(req,env)=>handleForms(req,{...env,WORD_IMPORT:privateCarrier})}`,
      resolveDir:process.cwd()}, bundle:true, format:'esm', platform:'browser', write:false,
    external:['stream','node:stream']
  });
  const mf = new Miniflare({
    modules:true, script:outputFiles[0].text, compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'], r2Buckets:['BUCKET'], bindings:{QCC_ALLOWED_EMAILS:'owner@example.invalid'}
  });
  t.after(()=>mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint')) {
      if(statement.trim()) await db.prepare(statement.trim()).run();
    }
  }
  function call(user, path, data, method=data?'POST':'GET') {
    const headers = {origin, 'content-type':'application/json','oai-authenticated-user-id':user.id,
      'oai-authenticated-user-email':user.id+'@example.invalid'};
    if (user.token) headers.authorization='Bearer '+user.token;
    return mf.dispatchFetch(origin+'/api/v1/forms'+path,{method,headers,body:data?JSON.stringify(data):undefined});
  }
  async function result(request, status=200) {
    const response = await request, payload = await response.json();
    assert.equal(response.status,status,JSON.stringify(payload));
    return payload.data;
  }
  async function login(id,account) {
    const {token} = await result(call({id},'/test-session',{account}));
    return {id,token};
  }
  const owner = await login('owner','admin');
  const staff = await login('visitor','a');
  const selfSelectedAdmin = await login('visitor','admin');
  const original = makeCarrierFixture();
  const payload = {filename:'100M智云上海专线基础版不带语音.docx', file:Buffer.from(original).toString('base64')};
  const inspected = await result(call(owner,'/templates/inspect',payload));
  assert.equal(inspected.convertible,true);
  assert.deepEqual(inspected.rates.map(r=>[Number(r.amount),r.cycle]),[[688,'月'],[6880,'年'],[11880,'2年']]);
  assert.equal((await call(staff,'/templates/inspect',payload)).status,403);
  assert.equal((await call(selfSelectedAdmin,'/templates/import',payload)).status,403);
  const bad = structuredClone(inspected.rates);
  bad[0].amount='689.00';
  assert.equal((await call(owner,'/templates/import',{...payload,confirmed_rates:bad})).status,422);
  const confirmed = {...payload, confirmed_rates:inspected.rates};
  const attempts = await Promise.all([call(owner,'/templates/import',confirmed),call(owner,'/templates/import',confirmed)]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,201]);
  const [a,b] = await Promise.all(attempts.map(async r=>(await r.json()).data));
  assert.equal(a.id,b.id);
  const templateId = a.id;
  const stored = await call(owner,'/templates/'+templateId+'/file');
  assert.equal(stored.status,200);
  const clean = new Uint8Array(await stored.arrayBuffer());
  assert.ok(!strFromU8(unzipSync(clean)['word/document.xml']).includes('虚构样例企业'));
  assert.ok((await result(call(owner,'/templates/import',{...confirmed,file:Buffer.from(clean).toString('base64')}))).duplicate);
  const changed = Buffer.from(makeCarrierFixture({legalNote:'已修改的测试条款'})).toString('base64');
  assert.equal((await call(owner,'/templates/import',{...confirmed,file:changed})).status,409);
  assert.equal((await call(selfSelectedAdmin,'/templates/'+templateId+'/file')).status,403);
  const plansFor = async user => (await result(call(user,'/workspace'))).tariffs.filter(row=>row.template_id===templateId);
  assert.equal((await plansFor(owner)).length,3);
  assert.equal((await plansFor(staff)).length,0);
  await result(call(owner,'/templates/'+templateId,{active:true},'PATCH'));
  const visible = await plansFor(staff);
  assert.equal(visible.length,3);
  for (const payment of ['cash','collection']) {
    const plan = visible.find(t=>t.cycle===(payment==='cash'?'月':'2年'));
    const selection = {...plan,tariff_id:plan.id};
    const match = await result(call(staff,'/match',{selection}));
    assert.equal(match.candidates[0].id,templateId);
    const record = await result(call(staff,'/generate',{selection,match_token:match.match_token,
      template_id:templateId,customer:{...customer,payment_method:payment},request_id:crypto.randomUUID()}));
    const path = '/records/'+record.id+'/file';
    const out = await call(staff,path);
    assert.equal(out.status,200);
    const files = unzipSync(new Uint8Array(await out.arrayBuffer()));
    const xml = strFromU8(files['word/document.xml']);
    const parsed = new DOMParser().parseFromString(xml,'application/xml');
    const paragraphs = Array.from(parsed.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','p'),p=>p.textContent);
    assert.equal(paragraphs[34].includes('■'),payment==='collection');
    assert.equal(paragraphs[35].includes('■'),payment==='cash');
    assert.equal(paragraphs[34].includes(customer.bank_account),payment==='collection');
    assert.equal(paragraphs[40].includes('■'),payment==='collection');
    assert.ok(xml.includes(customer.billing_address) && xml.includes(customer.contact_name) && !xml.includes('{{'));
    assert.ok(strFromU8(files['word/header1.xml']).includes(customer.company_name));
    assert.deepEqual(files['word/media/image1.png'],unzipSync(original)['word/media/image1.png']);
    assert.ok(files['word/footer1.xml'] && files['word/numbering.xml']);
    assert.equal((await call(owner,path)).status,404);
    assert.equal((await call(selfSelectedAdmin,path)).status,404);
  }
});
