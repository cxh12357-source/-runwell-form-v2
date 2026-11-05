import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from '../vendor/qa-fflate/browser.js';
import {defaultMapping,tariffs} from '../forms/rules.mjs';

const require=createRequire(import.meta.url);
const workerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=workerRequire('miniflare');
const {build}=workerRequire('esbuild');
let mf;
const customer={company_name:'虚构测试企业',install_address:'虚构安装路一号',billing_address:'虚构账单路二号',
 contact_name:'测试甲乙',phone:'10000000000',id_number:'000000000000000000',email:'fixture@example.invalid',
 payment_method:'collection',bank_name:'虚构测试银行',bank_account:'00000000654321'};
const selection={...tariffs[0],tariff_id:tariffs[0].id};
before(async()=>{
 const {outputFiles}=await build({stdin:{contents:"import {handleForms} from './forms/service.mjs';export default {fetch:handleForms}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',external:['stream','node:stream'],write:false});
 mf=new Miniflare({modules:true,script:outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET']});
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()){
   for(const stmt of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint')) await db.prepare(stmt.trim()).run();
 }
});
after(async()=>{await mf?.dispose();});
const api=(path,{actor,visitor='qa-user',method='GET',data,origin='https://qa.example',rawBody}={})=>{
 const headers={'content-type':'application/json',origin};
 if(visitor)headers['oai-authenticated-user-id']=visitor;
 if(actor)headers.Authorization='Bearer '+actor;
 return mf.dispatchFetch('https://qa.example/api/v1'+path,{method,headers,body:rawBody??(data&&JSON.stringify(data))});
};
async function value(p,status=200){const r=await p;const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b.data;}
async function account(key,visitor){return (await value(api('/forms/test-session',{visitor,method:'POST',data:{account:key}}))).token;}
async function pair(){const actor=await account('a');const m=await value(api('/forms/match',{actor,method:'POST',data:{selection}}));return {actor,data:{selection,customer,template_id:m.candidates[0].id,match_token:m.match_token,request_id:crypto.randomUUID()}};}
const send=(actor,data)=>api('/forms/generate',{actor,method:'POST',data});

test('平台登录、跨站请求、身份和权限都在服务端校验',async()=>{
 assert.equal((await api('/forms/mode',{visitor:null})).status,401);
 assert.equal((await api('/forms/test-session',{method:'POST',origin:'https://untrusted.example',data:{account:'admin'}})).status,403);
 assert.equal((await api('/forms/test-session',{method:'POST',data:{account:'owner'}})).status,422);
 const actor=await account('a');
 assert.equal((await api('/forms/templates',{actor})).status,403);
 assert.equal((await api('/forms/workspace',{actor,visitor:'someone-else'})).status,401);
 assert.equal((await value(api('/catalog'))).versions[0].id,selection.business_version_id);
});
test('两种付款、银行条件必填及幂等、历史再下载和员工隔离',async()=>{
 const {actor,data}=await pair();
 for(const key of ['bank_name','bank_account']) assert.equal((await send(actor,{...data,customer:{...customer,[key]:''}})).status,422);
 const other=await account('b');
 for(const method of ['cash','collection']){
   const request={...data,request_id:crypto.randomUUID(),customer:{...customer,payment_method:method}};
   const [row,replay]=await Promise.all([value(send(actor,request)),value(send(actor,request))]);assert.equal(row.id,replay.id);
   const file=await api('/forms/records/'+row.id+'/file',{actor});assert.equal(file.status,200);
   const bytes=new Uint8Array(await file.arrayBuffer()), xml=strFromU8(unzipSync(bytes)['word/document.xml']);
   for(const key of ['contact_name','install_address','billing_address'])assert.ok(xml.includes(customer[key]));
   assert.equal(xml.includes(customer.bank_account),method==='collection');assert.equal(xml.includes(customer.bank_name),method==='collection');
   assert.ok(xml.includes(method==='cash'?'☑ 现金':'☑ 托收'));assert.ok(!xml.includes('{{'));
   const again=await api('/forms/records/'+row.id+'/file',{actor});assert.deepEqual(new Uint8Array(await again.arrayBuffer()),bytes);
   assert.equal((await api('/forms/records/'+row.id+'/file',{actor:other})).status,404);
 }
 const renewed=await account('a');
 assert.equal((await value(api('/forms/records',{actor:renewed}))).length,2);
 assert.deepEqual(await value(api('/forms/records',{actor:other})),[]);
});
test('匹配同价不同带宽、模板版本、启停、冲突和额外映射',async()=>{
 const {actor,data}=await pair(),admin=await account('admin');
 const match=s=>value(api('/forms/match',{actor,method:'POST',data:{selection:s}}));
 assert.equal((await match({...tariffs[1],tariff_id:tariffs[1].id})).candidates[0].id,'demo-b-sample');
 assert.equal((await match({...selection,amount:'1.00'})).status,'conflict');assert.equal((await match({...selection,tariff_id:'unknown'})).status,'not_found');
 const bytes=new Uint8Array(await (await api('/forms/templates/demo-a-sample/file',{actor:admin})).arrayBuffer());
 const entries=unzipSync(bytes), original=strFromU8(entries['word/document.xml']);
 entries['word/document.xml']=strToU8(original.replace('{{contact_name}}','{{cont</w:t></w:r><w:r><w:t>act_name}} / {{industry}}'));
 const file=Buffer.from(zipSync(entries)).toString('base64');
 const tpl={name:'虚构行业版',revision:'v2',tariff_id:selection.tariff_id,mapping:{...defaultMapping,industry:'extra_industry'},file};
 const upload=t=>api('/forms/templates',{method:'POST',actor:admin,data:t});
 const created=await value(upload(tpl),201);assert.equal(created.active,false);
 assert.equal((await upload(tpl)).status,409);
 const toggle=(id,active)=>value(api('/forms/templates/'+id,{method:'PATCH',actor:admin,data:{active}}));
 await toggle(created.id,true);const matched=await match(selection);assert.equal(matched.status,'ambiguous');
 assert.equal((await send(actor,data)).status,409);
 const d={...data,template_id:created.id,match_token:matched.match_token};
 assert.equal((await send(actor,d)).status,422);
 const rec=await value(send(actor,{...d,customer:{...customer,extra_industry:'虚构行业'}}));
 await toggle(created.id,false);
 assert.equal(rec.template.revision,'v2');
 const output=await (await api('/forms/records/'+rec.id+'/file',{actor})).arrayBuffer();
 assert.ok(strFromU8(unzipSync(new Uint8Array(output))['word/document.xml']).includes('虚构行业'));
 const dangerous={...entries,'word/vbaProject.bin':new Uint8Array([42])};
 assert.equal((await upload({...tpl,file:Buffer.from(zipSync(dangerous)).toString('base64')})).status,422);
 await toggle('demo-a-sample',false);assert.equal((await match(selection)).status,'not_found');
 const elsewhere=await account('a','another-workspace');
 const isolated=await value(api('/forms/match',{visitor:'another-workspace',actor:elsewhere,method:'POST',data:{selection}}));
 assert.equal(isolated.status,'unique');
});

test('直接下载使用私有会话 Cookie 并复核身份和模板权限',async()=>{
 const response=await api('/forms/test-session',{method:'POST',data:{account:'admin'}});
 const cookie=response.headers.get('Set-Cookie').split(';')[0];
 const get=(path,visitor)=>mf.dispatchFetch('https://qa.example/api/v1/forms/'+path,{headers:{'oai-authenticated-user-id':visitor,Cookie:cookie}});
 const ok=await get('templates/demo-a-sample/file','qa-user');
 assert.equal(ok.status,200);assert.match(ok.headers.get('Content-Disposition'),/attachment/);
 assert.ok(unzipSync(new Uint8Array(await ok.arrayBuffer()))['word/document.xml']);
 assert.equal((await get('templates/demo-a-sample/file','other')).status,401);
 assert.equal((await get('records','qa-user')).status,401);
});

test('客户回复补齐后生成有工商栏的 Word；带语音缺实名字段时拒绝',async()=>{
 const visitor='intake-acceptance',actor=await account('a',visitor);
 const {parseReply,lookupFixture,staffEstimates,matchReplyTariff}=await import('../public/modules/forms/intake-rules.js');
 const labeled='企业全称：虚构测试企业，安装地址：虚构甲路，账单地址：虚构乙路，套餐：测试套餐 C，经办人：测试甲，手机：10000000000，身份证号：000000000000000000，邮箱：qa@example.invalid，付款方式：托收，银行账号：0000000654321';
 const values=Object.fromEntries(Object.entries(parseReply(labeled)).map(([key,items])=>[key,items[0]]));
 assert.equal(matchReplyTariff(values.tariff,tariffs),'demo-c');
 const company=lookupFixture(values.company_name);
 const profile={...company,...staffEstimates(company.insured)};
 const request=(path,method,data)=>api(path,{visitor,actor,method,data});
 async function submission(t,client) {
   const selection={...t,tariff_id:t.id};
   const matched=await value(request('/forms/match','POST',{selection}));
   return {selection,customer:client,template_id:matched.candidates[0].id,match_token:matched.match_token,request_id:crypto.randomUUID()};
 }
 const c=await submission(tariffs.find(t=>t.id==='demo-c'),{...values,...profile});
 assert.equal((await request('/forms/generate','POST',c)).status,422);
 c.customer.bank_name=parseReply('开户行：虚构测试银行').bank_name[0];
 const readWord=async row=>{
   const r=await request('/forms/records/'+row.id+'/file','GET');assert.equal(r.status,200);
   return strFromU8(unzipSync(new Uint8Array(await r.arrayBuffer()))['word/document.xml']);
 };
 const xml=await readWord(await value(request('/forms/generate','POST',c)));
 for(const token of [company.extra_credit_code,company.extra_industry,'10人以下','16-40台','虚构测试银行','☑ 托收'])assert.ok(xml.includes(token),token);
 const v=await submission(tariffs.find(t=>t.voice_required),{...values,payment_method:'cash'});
 assert.equal((await request('/forms/generate','POST',v)).status,422);
 const more=parseReply('法定代表人：虚构法人，法定代表人身份证号码：000000000000000001，使用人（实名制）：虚构使用人，使用人（实名制）身份证号码：000000000000000002');
 for(const [key,[val]] of Object.entries(more))v.customer[key]=val;
 const voiceXML=await readWord(await value(request('/forms/generate','POST',v)));
 for(const val of Object.values(more))assert.ok(voiceXML.includes(val[0]));
 assert.ok(voiceXML.includes('☑ 现金'));assert.ok(!voiceXML.includes(values.bank_account));
});
