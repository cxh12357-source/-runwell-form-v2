import { catalog } from './data.mjs';
import { checkTariffMapping, sampleMapping, voiceVersion, FormError, insist, labels, match, tariffs, validateCustomer, validateMapping, version } from './rules.mjs';
import { mime, renderWord } from './word.mjs';
import sample from './sample.json' with {type:'json'};

const accounts = {a:{id:'员工 A',role:'staff'}, b:{id:'员工 B',role:'staff'}, admin:{id:'模板管理员',role:'admin'}};
const sampleFiles = new Map(Object.entries(sample).map(([id, file]) => [id, Uint8Array.from(atob(file), c => c.charCodeAt(0))]));
const safeHeaders = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json = (data,status=200) => Response.json({data},{status,headers:safeHeaders});
const list = data => Response.json({data,meta:{total:data.length}},{headers:safeHeaders});
const documentFile = bytes => new Response(bytes,{headers:{...safeHeaders,'Content-Type':mime,'Content-Disposition':'attachment; filename="runwell.docx"'}});
const uuid = s => typeof s==='string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(s);
const isObject = v => v!==null && typeof v==='object' && !Array.isArray(v);
const signature = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
const resultChanges = r => r.meta.changes;
// These identity headers must be supplied by the hosting platform, never by a public proxy.
function listedForBusiness(req,env) {
  const email=req.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const addresses=typeof env.QCC_ALLOWED_EMAILS==='string'
    ? env.QCC_ALLOWED_EMAILS.split(/[,\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean) : [];
  const emailPattern=/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
  return email && addresses.includes(email) && addresses.every(s=>s.length<=254 && emailPattern.test(s));
}
async function body(req) {
  insist(req.headers.get('content-type')?.split(';')[0]==='application/json','请提交 JSON 数据。',415);
  const reader=req.body?.getReader();insist(reader,'缺少请求内容。',400);
  let size=0;const chunks=[];
  for(;;) {const {done,value}=await reader.read();if(done)break;
    size+=value.length;if(size>750000){await reader.cancel();throw new FormError('上传内容过大。',413);}chunks.push(value);}
  let data;
  try{data=JSON.parse(await new Blob(chunks).text());}catch{throw new FormError('JSON 内容无效。',400);}
  insist(isObject(data),'请求内容格式错误。',400);return data;
}
function unpack(t){return {...t,active:Boolean(t.active),mapping:JSON.parse(t.mapping)};}
const sharedCatalog='published-word-templates';
const catalogOwner=(tenant,plugin)=>plugin?.sharedCatalog ? sharedCatalog : tenant;
async function templates(db,tenant,showDelete=false,scope=tenant) {
  const fields=showDelete?', (object_key IS NOT NULL) AS custom, imported_at':'';
  const rows=await db.prepare('SELECT tenant,id,tariff_id,name,revision,active,mapping,object_key'+fields+
    ' FROM qa_templates WHERE tenant IN (?,?) ORDER BY id').bind(tenant,scope).all();
  return rows.results.map(unpack);
}
async function directory(db,tenant,plugin,includeInactive=false){
  if(!plugin)return tariffs;
  if(plugin.sharedCatalog){
    const rows=await db.prepare(`SELECT d.data FROM demo_tariffs d JOIN qa_templates t
      ON t.tenant=d.tenant AND t.id=json_extract(d.data,'$.template_id')
      WHERE d.tenant=? AND (?=1 OR t.active=1) ORDER BY d.id`).bind(sharedCatalog,Number(includeInactive)).all();
    return [...tariffs,...rows.results.map(row=>JSON.parse(row.data))];
  }
  const rows=await db.prepare('SELECT data FROM demo_tariffs WHERE tenant=? ORDER BY id').bind(tenant).all();
  const hidden=await db.prepare('SELECT hide_samples FROM demo_settings WHERE tenant=?').bind(tenant).first();
  const custom=hidden && await db.prepare('SELECT DISTINCT tariff_id FROM qa_templates WHERE tenant=? AND object_key IS NOT NULL').bind(tenant).all();
  return [...tariffs.filter(t=>!hidden || custom.results.some(r=>r.tariff_id===t.id)),...rows.results.map(row=>JSON.parse(row.data))];
}
async function candidates(selection,db,tenant,plugin){
  insist(isObject(selection),'请选择业务和套餐。');
  const plans=await directory(db,tenant,plugin);
  const rows=await templates(db,tenant,Boolean(plugin),catalogOwner(tenant,plugin));
  const chosen=plans.find(t=>t.id===selection.tariff_id);
  const matching=chosen?.template_id ? rows.map(t=>t.id===chosen.template_id?{...t,tariff_id:chosen.id}:t) : rows;
  const res=match(selection,matching,plans);
  for(const c of res.candidates){
    c.extra_fields=[...new Set(Object.values(rows.find(t=>t.id===c.id).mapping).filter(k=>k.startsWith('extra_')))];
    const profile=plans.find(t=>t.id===selection.tariff_id)?.carrier_profile;
    if(profile && c.id.startsWith('carrier-')){
      c.carrier_controls=plugin.controls(profile);
      c.extra_fields=[...c.carrier_controls.inputs.map(x=>x[0]),...c.carrier_controls.groups.map(x=>x.key)];
    }
  }
  const matched=rows.filter(t=>res.candidates.some(c=>c.id===t.id));
  res.match_token=await signature(JSON.stringify([chosen,res.candidates,matched.map(t=>t.object_key)]));
  return {result:res,tariff:chosen,matched};
}
async function bytesFor(bucket,key,tariffId){
  if(key===null && sampleFiles.has(tariffId)) return sampleFiles.get(tariffId);
  const obj=await bucket.get(key);if(!obj)throw new Error('Missing document object');
  return new Uint8Array(await obj.arrayBuffer());
}
async function startSession(req,db,tenant,plugin) {
  const {account}=await body(req);
  insist(typeof account==='string' && Object.hasOwn(accounts,account),'请选择有效验收身份。');
  const token=crypto.randomUUID()+crypto.randomUUID();
  const now=Date.now(), statements=[
    db.prepare('DELETE FROM qa_sessions WHERE tenant=? AND expires<=?').bind(tenant,now),
    db.prepare('INSERT INTO qa_sessions(hash,tenant,actor,expires) VALUES(?,?,?,?)').bind(await signature(token),tenant,account,now+8*60*60*1000)
  ];
  const hidden=plugin && !plugin.sharedCatalog && await db.prepare('SELECT hide_samples FROM demo_settings WHERE tenant=?').bind(tenant).first();
  for(const t of hidden?[]:tariffs){
    statements.push(db.prepare('INSERT OR IGNORE INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping) VALUES(?,?,?,?,?,1,?)')
      .bind(tenant,t.id+'-sample',t.id,t.name+' 新装样表','demo-1',JSON.stringify(sampleMapping(t))));
  }
  await db.batch(statements);
  const response=json({token,actor:accounts[account]});
  response.headers.set('Set-Cookie','__Secure-rw-download='+token+'; Path=/api/v1/forms/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800');
  return response;
}
async function upload(data,db,bucket,tenant,plugin) {
  const {name,revision,tariff_id,file}=data, id=crypto.randomUUID();
  insist(tariffs.some(t=>t.id===tariff_id),'请选择可用套餐。');
  for(const v of [name,revision])insist(typeof v==='string' && v.trim() && v.length<=80 && !/[\x00-\x1f]/.test(v),'请填写模板名称和版本号。');
  insist(typeof file==='string' && file.length>0 && file.length<=699052,'请上传 512 KiB 以内的 DOCX。');
  const mapping=validateMapping(data.mapping);
  checkTariffMapping(mapping,tariffs.find(t => t.id === tariff_id));
  let bytes;try {bytes=Uint8Array.from(atob(file),c=>c.charCodeAt(0));}catch{throw new FormError('文件编码无效。');}
  const cleaned=renderWord(bytes,mapping);
  const key='templates/'+tenant+'/'+id;
  await bucket.put(key,cleaned);
  const result=await db.prepare('INSERT INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping,object_key'+(plugin?',imported_at':'')+
    ') VALUES(?,?,?,?,?,0,?,?'+(plugin?',?':'')+') ON CONFLICT DO NOTHING')
    .bind(tenant,id,tariff_id,name.trim(),revision.trim(),JSON.stringify(mapping),key,...(plugin?[new Date().toISOString()]:[])).run();
  if(!resultChanges(result)){await bucket.delete(key);throw new FormError('相同套餐下已有此模板版本。',409);}
  return json({id,active:false},201);
}
async function generate(data,db,bucket,tenant,actor,plugin) {
  const {selection,customer,request_id,template_id}=data;
  insist(uuid(request_id) && isObject(selection) && isObject(customer),'请完整填写资料并重新核对。');
  const digest=await signature(JSON.stringify([Object.entries(selection).sort(),template_id,Object.entries(customer).sort()]));
  const existing=()=>db.prepare('SELECT digest,snapshot FROM qa_records WHERE tenant=? AND actor=? AND request_id=?').bind(tenant,actor,request_id).first();
  function replay(r){insist(r.digest===digest,'请求已用于其他资料，请重新核对。',409);return json(JSON.parse(r.snapshot));}
  const previous=await existing();if(previous)return replay(previous);
  const {result:matches,tariff,matched}=await candidates(selection,db,tenant,plugin);
  const t=matched.find(row=>row.id===template_id);
  insist(matches.match_token===data.match_token && t,'候选模板已变化，请重新匹配并确认。',409);
  const mapping=t.mapping;
  const bytes=await bytesFor(bucket,t.object_key,t.tariff_id);
  let file;
  if(tariff.carrier_profile && template_id.startsWith('carrier-')){
    validateCustomer(customer,{},tariff);
    try { file=plugin.renderCarrier(bytes,customer,tariff); }
    catch(error) { throw new FormError(error.message); }
  } else file=renderWord(bytes,mapping,validateCustomer(customer,mapping,tariff));
  const id=crypto.randomUUID(), key='records/'+tenant+'/'+id;
  const snapshot={id,created_by:accounts[actor].id,created_at:new Date().toISOString(),status:'generated',
    business_id:tariff.business_id,business_version_id:tariff.business_version_id,business_attribute:tariff.business_attribute,
    tariff,template:{id:t.id,name:t.name,revision:t.revision}};
  await bucket.put(key,file);
  // Compare the active set inside the same statement that inserts the record.
  const activeIds=matches.candidates.map(c=>c.id).sort();
  const inserted=await db.prepare(`INSERT INTO qa_records(id,tenant,actor,request_id,digest,snapshot,object_key)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM qa_templates WHERE tenant=? AND id=? AND active=1 AND object_key IS ?
    ) AND (SELECT json_group_array(id) FROM
      (SELECT id FROM qa_templates WHERE tenant=? AND tariff_id=? AND active=1 ORDER BY id))=?
    ON CONFLICT(tenant,actor,request_id) DO NOTHING`)
    .bind(id,tenant,actor,request_id,digest,JSON.stringify(snapshot),key,t.tenant,t.id,t.object_key,t.tenant,t.tariff_id,JSON.stringify(activeIds)).run();
  if(resultChanges(inserted))return json(snapshot);
  await bucket.delete(key);
  const row=await existing();if(row)return replay(row);
  throw new FormError('候选模板已变化，请重新匹配。',409);
}

async function carrierRates(db,tenant,info,templateId){
  const {profile,name,rates}=info;
  return Promise.all(rates.map(async rate=>{
    const id='carrier-'+(await signature(JSON.stringify([profile,rate.bandwidth,rate.amount,rate.cycle]))).slice(0,24);
    const tariff={id,name,bandwidth:rate.bandwidth,amount:rate.amount,cycle:rate.cycle,business_id:version.business_id,
      business_version_id:version.id,business_attribute:'new',voice_required:false,carrier_profile:profile,carrier_rate:rate.key,template_id:templateId};
    return db.prepare('INSERT OR REPLACE INTO demo_tariffs(tenant,id,data) VALUES(?,?,?)').bind(tenant,id,JSON.stringify(tariff));
  }));
}

async function consolidateCarrier(db,bucket,tenant,plugin){
  const legacy=(await db.prepare("SELECT data FROM demo_tariffs WHERE tenant=? AND json_extract(data,'$.template_id') IS NULL").bind(tenant).all()).results;
  for(const profile of new Set(legacy.map(r=>JSON.parse(r.data).carrier_profile))){
    const plans=legacy.map(r=>JSON.parse(r.data)).filter(t=>t.carrier_profile===profile);
    const rows=(await Promise.all(plans.map(t=>db.prepare('SELECT * FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,t.id).first()))).filter(Boolean);
    if(!rows.length)continue;
    const keep=rows.find(t=>t.active)||rows[0];
    const info=plugin.analyzeCarrier(await bytesFor(bucket,keep.object_key,keep.tariff_id));
    await db.batch([
      ...await carrierRates(db,tenant,info,keep.id),
      ...rows.filter(t=>t.id!==keep.id).map(t=>db.prepare('DELETE FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,t.id))
    ]);
    for(const t of rows)if(t.id!==keep.id)await bucket.delete(t.object_key);
    plugin.markMigrated();
  }
}

async function importCarrier(data,db,bucket,tenant,plugin,save,privateImport) {
  insist(typeof data.file==='string' && data.file.length>0 && data.file.length<=699052,'请选择 512 KiB 以内的 DOCX。');
  let info, metadata;
  try {
    const bytes=Uint8Array.from(atob(data.file),c=>c.charCodeAt(0));
    metadata=plugin.describeCarrier(bytes,typeof data.filename==='string'?data.filename.slice(0,240):'');
    if(metadata.conflicts?.length)throw new Error(metadata.conflicts.join('；'));
    if(metadata.voice==='带语音')throw new Error('带语音版的填写字段和方框位置尚未核对。');
    if(metadata.bandwidth && metadata.bandwidth!=='100M')throw new Error('此网速对应的 Word 填写版式尚未核对。');
    info=plugin.analyzeCarrier(bytes,data.variant);
  } catch(error) {
    if(!save && metadata)return json({metadata, convertible:false, conversionMessage:error.message});
    throw new FormError(error.message);
  }
  const {profile,name,revision,rates,tags,file}=info;
  if(!save){
    const {inputs,groups}=plugin.controls(profile);
    const field_labels={...labels,...Object.fromEntries(inputs.map(([key,label])=>[key,label])),
      ...Object.fromEntries(groups.map(({key,label})=>[key,label]))};
    return json({name:'100M 智云上海专线基础版（'+revision+'）',metadata,convertible:true,rates,tags,field_labels,
      variantRequired:info.variantRequired,discountNote:info.discountNote});
  }
  insist(!info.variantRequired || ['discount','standard'].includes(data.variant),'请确认此模板属于打折还是不打折。');
  const sameTerms=(a,b)=>a.bandwidth===b.bandwidth && a.amount===b.amount && a.cycle===b.cycle;
  if(privateImport && rates.length>1){
    const confirmed=data.confirmed_rates;
    insist(Array.isArray(confirmed) && confirmed.length===rates.length && rates.every(rate=>
      confirmed.some(row=>isObject(row) && row.key===rate.key && sameTerms(row,rate))),
      '请先核对并确认原表识别出的全部资费。');
  }
  const id='carrier-'+profile;
  async function existingImport() {
    const saved=(await directory(db,tenant,plugin,true)).filter(t=>t.carrier_profile===profile && t.template_id);
    if(!saved.length) return null;
    const templateId=saved[0].template_id;
    const sameRates=saved.length===rates.length && rates.every(rate=>saved.some(t=>
      t.template_id===templateId && t.carrier_rate===rate.key && sameTerms(t,rate)));
    insist(sameRates,'同版式已录入不同资费，请核对原表或使用正确的版本。',409);
    const row=await db.prepare('SELECT object_key FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,templateId).first();
    insist(row,'模板状态已变化，请刷新后重新导入。',409);
    const existingFile=await bytesFor(bucket,row.object_key);
    insist(plugin.sameCarrierTemplate(existingFile,file),
      '该版本已有不同的 Word 版式或文档内容，请管理员核对版本后再导入。',409);
    return json({id:templateId,duplicate:true});
  }
  const existing=await existingImport();
  if(existing)return existing;
  // Independent attempts must never overwrite or delete another import's Word file.
  const key='templates/'+tenant+'/'+crypto.randomUUID();
  await bucket.put(key,file);
  try {
    await db.batch([
      ...await carrierRates(db,tenant,info,id),
      db.prepare('INSERT INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping,object_key,imported_at) VALUES(?,?,?,?,?,0,?,?,?)')
        .bind(tenant,id,id,name+' 申请登记表',revision,JSON.stringify(Object.fromEntries(tags.map(tag=>[tag,tag]))),key,new Date().toISOString())
    ]);
  } catch(error){
    const winner=await db.prepare('SELECT object_key FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,id).first();
    if(winner?.object_key===key) return json({id,duplicate:false},201);
    await bucket.delete(key);
    if(winner){
      const duplicate=await existingImport();
      if(duplicate)return duplicate;
    }
    throw error;
  }
  return json({id,duplicate:false},201);
}

export async function handleForms(req,env) {
  try {
    const url=new URL(req.url), path=url.pathname.replace(/^\/api\/v1/,''), method=req.method;
    const visitor=req.headers.get('oai-authenticated-user-id');
    insist(visitor?.trim(),'请先登录此私有验收站。',401);
    const tenant=await signature(visitor);
    if(!['GET','HEAD'].includes(method)){
      const origin=req.headers.get('origin');
      insist(!origin || origin===url.origin,'此操作必须从验收站内发起。',403);
    }
    if(path==='/forms/mode' && method==='GET')return json({preview:true,hosted:true});
    if(path==='/health' && method==='GET')return json({status:'ok',mode:'hosted-acceptance'});
    if(path==='/catalog' && method==='GET')return json({...catalog,versions:[...catalog.versions,version,voiceVersion]});
    insist(env.DB && env.BUCKET,'验收存储尚未就绪。',503);
    const db=env.DB, bucket=env.BUCKET;
    const plugin=env.WORD_IMPORT ? {...env.WORD_IMPORT,sharedCatalog:true} : env.DEMO_IMPORT;
    if(path==='/forms/test-session' && method==='POST')return await startSession(req,db,tenant,plugin);
    let auth=req.headers.get('Authorization')||'';
    if (!auth && method==='GET' && /^\/forms\/(records|templates)\/[\w-]+\/file$/.test(path)) {
      const cookie=(req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('__Secure-rw-download='));
      if(cookie) auth='Bearer '+cookie.slice('__Secure-rw-download='.length);
    }
    insist(/^Bearer [a-f\d-]{72}$/.test(auth),'请选择验收身份。',401);
    const entry=await db.prepare('SELECT actor FROM qa_sessions WHERE hash=? AND tenant=? AND expires>?')
      .bind(await signature(auth.slice(7)),tenant,Date.now()).first();
    insist(entry,'验收身份已过期，请重新进入。',401);
    const actor=entry.actor;
    if(env.DEMO_IMPORT)await consolidateCarrier(db,bucket,tenant,plugin);
    const smartAdmin=Boolean(plugin) && accounts[actor].role==='admin' && (!plugin.sharedCatalog || Boolean(listedForBusiness(req,env)));
    if(path==='/forms/workspace' && method==='GET')return json({actor:accounts[actor],tariffs:await directory(db,tenant,plugin,smartAdmin),labels,smart_import:smartAdmin});
    if(path==='/forms/match' && method==='POST')return json((await candidates((await body(req)).selection,db,tenant,plugin)).result);
    if(path==='/forms/generate' && method==='POST')return await generate(await body(req),db,bucket,tenant,actor,plugin);
    if(path==='/forms/records' && method==='GET'){
      const rows=await db.prepare('SELECT snapshot FROM qa_records WHERE tenant=? AND actor=? ORDER BY rowid DESC').bind(tenant,actor).all();
      return list(rows.results.map(r=>JSON.parse(r.snapshot)));
    }
    const record=/^\/forms\/records\/([\w-]+)\/file$/.exec(path);
    if(record && method==='GET'){
      const row=await db.prepare('SELECT object_key FROM qa_records WHERE tenant=? AND actor=? AND id=?').bind(tenant,actor,record[1]).first();
      insist(row,'找不到生成记录。',404);return documentFile(await bytesFor(bucket,row.object_key));
    }
    if(path==='/forms/templates'||path.startsWith('/forms/templates/')){
      insist(accounts[actor].role==='admin','仅模板管理员可执行此操作。',403);
      if(env.WORD_IMPORT && /^\/forms\/templates\/(?:inspect$|import$|carrier-)/.test(path)){
        insist(smartAdmin && (method==='GET' || req.headers.get('origin')===url.origin),'当前账号无权操作此业务模板。',403);
      }
      if(env.DEMO_IMPORT && path==='/forms/templates/samples' && method==='DELETE'){
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO demo_settings(tenant,hide_samples) VALUES(?,1)').bind(tenant),
          db.prepare('DELETE FROM qa_templates WHERE tenant=? AND object_key IS NULL').bind(tenant)
        ]);
        return json({removed:true});
      }
      if(plugin && method==='POST' && ['/forms/templates/inspect','/forms/templates/import'].includes(path))
        return await importCarrier(await body(req),db,bucket,catalogOwner(tenant,plugin),plugin,path.endsWith('/import'),Boolean(env.WORD_IMPORT));
      if(path==='/forms/templates' && method==='GET'){
        const rows=await templates(db,tenant,Boolean(plugin),smartAdmin ? catalogOwner(tenant,plugin) : tenant);
        return list(rows.map(({tenant,object_key,...item})=>item));
      }
      if(path==='/forms/templates' && method==='POST')return await upload(await body(req),db,bucket,tenant,plugin);
      const item=/^\/forms\/templates\/([\w-]+)(\/file)?$/.exec(path);
      const owner=item?.[1].startsWith('carrier-') ? catalogOwner(tenant,plugin) : tenant;
      if(plugin && item && !item[2] && method==='DELETE'){
        const id=item[1];
        const t=await db.prepare('SELECT object_key,tariff_id FROM qa_templates WHERE tenant=? AND id=?').bind(owner,id).first();
        insist(t,'找不到模板。',404);
        insist(t.object_key,'内置样表不能删除。',403);
        const [,deleted]=await db.batch([
          db.prepare("DELETE FROM demo_tariffs WHERE tenant=? AND json_extract(data,'$.template_id')=? AND EXISTS (SELECT 1 FROM qa_templates WHERE tenant=? AND id=? AND object_key=?)")
            .bind(owner,id,owner,id,t.object_key),
          db.prepare('DELETE FROM qa_templates WHERE tenant=? AND id=? AND object_key=?').bind(owner,id,t.object_key)
        ]);
        insist(resultChanges(deleted),'模板状态已变化，请刷新后再试。',409);
        await bucket.delete(t.object_key);
        return json({id});
      }
      if(item?.[2] && method==='GET'){
        const t=await db.prepare('SELECT object_key,tariff_id FROM qa_templates WHERE tenant=? AND id=?').bind(owner,item[1]).first();
        insist(t,'找不到模板。',404);return documentFile(await bytesFor(bucket,t.object_key,t.tariff_id));
      }
      if(item && !item[2] && method==='PATCH'){
        const {active}=await body(req);insist(typeof active==='boolean','请明确启用或停用。');
        const r=await db.prepare('UPDATE qa_templates SET active=? WHERE tenant=? AND id=?').bind(Number(active),owner,item[1]).run();
        insist(resultChanges(r),'找不到模板。',404);return json({id:item[1],active});
      }
    }
    throw new FormError('接口不存在。',404);
  }catch(error){
    const status=error instanceof FormError?error.status:500;
    if(status===500)console.error('forms runtime:',error.name,error.cause?.code||'');
    return Response.json({error:{code:'FORMS_'+status,message:status===500?'验收服务暂时不可用，请重试。':error.message}},{status,headers:safeHeaders});
  }
}
