import { catalog } from './data.mjs';
import { checkTariffMapping, sampleMapping, voiceVersion, FormError, insist, labels, match, tariffs, validateCustomer, validateMapping, version, workDashboard } from './rules.mjs';
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
async function body(req,limit=750000) {
  insist(req.headers.get('content-type')?.split(';')[0]==='application/json','请提交 JSON 数据。',415);
  const reader=req.body?.getReader();insist(reader,'缺少请求内容。',400);
  let size=0;const chunks=[];
  for(;;) {const {done,value}=await reader.read();if(done)break;
    size+=value.length;if(size>limit){await reader.cancel();throw new FormError('上传内容过大。',413);}chunks.push(value);}
  let data;
  try{data=JSON.parse(await new Blob(chunks).text());}catch{throw new FormError('JSON 内容无效。',400);}
  insist(isObject(data),'请求内容格式错误。',400);return data;
}
function unpack(t){return {...t,active:Boolean(t.active),mapping:JSON.parse(t.mapping)};}
async function templates(db,tenant,showDelete=false) {
  const fields=showDelete?', (object_key IS NOT NULL) AS custom, imported_at':'';
  const rows=await db.prepare('SELECT id,tariff_id,name,revision,active,mapping'+fields+' FROM qa_templates WHERE tenant=? ORDER BY id').bind(tenant).all();
  return rows.results.map(unpack);
}
async function directory(db,tenant,plugin){
  if(!plugin)return tariffs;
  const rows=await db.prepare('SELECT data FROM demo_tariffs WHERE tenant=? ORDER BY id').bind(tenant).all();
  const hidden=await db.prepare('SELECT hide_samples FROM demo_settings WHERE tenant=?').bind(tenant).first();
  const deleted=new Set((await db.prepare('SELECT id FROM demo_deleted_samples WHERE tenant=?').bind(tenant).all()).results.map(r=>r.id));
  const custom=hidden || deleted.size ? (await db.prepare('SELECT DISTINCT tariff_id FROM qa_templates WHERE tenant=? AND object_key IS NOT NULL').bind(tenant).all()).results : [];
  return [...tariffs.filter(t=>(!hidden && !deleted.has(t.id+'-sample')) || custom.some(r=>r.tariff_id===t.id)),...rows.results.map(row=>JSON.parse(row.data))];
}
async function candidates(selection,db,tenant,plugin){
  insist(isObject(selection),'请选择业务和套餐。');
  const plans=await directory(db,tenant,plugin);
  const rows=await templates(db,tenant);
  const chosen=plans.find(t=>t.id===selection.tariff_id);
  const matching=chosen?.template_id ? rows.map(t=>t.id===chosen.template_id?{...t,tariff_id:chosen.id}:t) : rows;
  const res=match(selection,matching,plans);
  if(chosen?.reviewed_id && res.basis) res.basis=[chosen.name,...(chosen.cycle==='—'?[]:[chosen.cycle+'付']),...(chosen.amount==='—'?[]:[chosen.amount+' 元/线'])];
  for(const c of res.candidates){
    c.extra_fields=[...new Set(Object.values(rows.find(t=>t.id===c.id).mapping).filter(k=>k.startsWith('extra_')))];
    const profile=plans.find(t=>t.id===selection.tariff_id)?.carrier_profile;
    if(chosen?.reviewed_id && c.id===chosen.template_id){
      c.reviewed_controls=plugin.reviewedControls(chosen.reviewed_id);
      c.extra_fields=[...c.reviewed_controls.inputs.map(x=>x[0]),...c.reviewed_controls.groups.map(x=>x.key),...(c.reviewed_controls.blank?[]:['manual_billing_ack'])];
    }
    if(profile && c.id.startsWith('carrier-')){
      c.carrier_controls=plugin.controls(profile);
      c.extra_fields=[...c.carrier_controls.inputs.map(x=>x[0]),...c.carrier_controls.groups.map(x=>x.key)];
    }
  }
  res.match_token=await signature(JSON.stringify(res.candidates));
  return res;
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
  const hidden=plugin && await db.prepare('SELECT hide_samples FROM demo_settings WHERE tenant=?').bind(tenant).first();
  const deleted=plugin ? new Set((await db.prepare('SELECT id FROM demo_deleted_samples WHERE tenant=?').bind(tenant).all()).results.map(r=>r.id)) : new Set();
  for(const t of hidden?[]:tariffs.filter(t=>!deleted.has(t.id+'-sample'))){
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
  const matches=await candidates(selection,db,tenant,plugin);
  insist(matches.match_token===data.match_token && matches.candidates.some(c=>c.id===template_id),'候选模板已变化，请重新匹配并确认。',409);
  const t=await db.prepare('SELECT * FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,template_id).first();
  const tariff=(await directory(db,tenant,plugin)).find(t=>t.id===selection.tariff_id);
  const mapping=JSON.parse(t.mapping);
  const bytes=await bytesFor(bucket,t.object_key,t.tariff_id);
  let file, review;
  if(tariff.reviewed_id && template_id===tariff.template_id){
    try {
      const output=await plugin.generateReviewed(tariff,bytes,customer);
      file=output.file;
      review=[...(output.manualActions||[]),...(output.unmappedFields||[])];
    } catch(error) { throw new FormError(error.message); }
  } else if(tariff.carrier_profile && template_id.startsWith('carrier-')){
    validateCustomer(customer,{},tariff);
    try { file=plugin.renderCarrier(bytes,customer,tariff); }
    catch(error) { throw new FormError(error.message); }
  } else file=renderWord(bytes,mapping,validateCustomer(customer,mapping,tariff));
  const id=crypto.randomUUID(), key='records/'+tenant+'/'+id;
  const snapshot={id,created_by:accounts[actor].id,created_at:new Date().toISOString(),status:'generated',
    business_id:tariff.business_id,business_version_id:tariff.business_version_id,business_attribute:tariff.business_attribute,
    tariff,template:{id:t.id,name:t.name,revision:t.revision},...(review?{review}:{})};
  await bucket.put(key,file);
  // Compare the active set inside the same statement that inserts the record.
  const activeIds=matches.candidates.map(c=>c.id).sort();
  const inserted=await db.prepare(`INSERT INTO qa_records(id,tenant,actor,request_id,digest,snapshot,object_key)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT json_group_array(id) FROM
      (SELECT id FROM qa_templates WHERE tenant=? AND tariff_id=? AND active=1 ORDER BY id))=?
    ON CONFLICT(tenant,actor,request_id) DO NOTHING`)
    .bind(id,tenant,actor,request_id,digest,JSON.stringify(snapshot),key,tenant,t.tariff_id,JSON.stringify(activeIds)).run();
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

async function importTemplate(data,db,bucket,tenant,plugin,save) {
  insist(typeof data.file==='string' && data.file.length>0 && data.file.length<=Math.ceil(plugin.reviewedLimit/3)*4,'请选择 10 MB 以内的 DOCX。');
  let bytes;
  try {bytes=Uint8Array.from(atob(data.file),c=>c.charCodeAt(0));}
  catch {throw new FormError('Word 文件编码无效。');}
  const plan=await plugin.identifyReviewed(bytes);
  if(!plan){
    insist(bytes.length<=524288,'此文件与已核验的空白原表不一致；普通智能转换仅支持 512 KiB 以内的文件。');
    return importCarrier(data,db,bucket,tenant,plugin,save);
  }
  const {id,name,revision,rates}=plugin.reviewedInfo(plan);
  if(!save)return json({reviewed:true,name,revision,rates});
  const existing=await db.prepare('SELECT id FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,id).first();
  if(existing)return json({id,duplicate:true});
  const key='templates/'+tenant+'/'+id;
  await bucket.put(key,bytes);
  try {
    await db.batch([
      ...rates.map(rate=>db.prepare('INSERT INTO demo_tariffs(tenant,id,data) VALUES(?,?,?)').bind(tenant,rate.id,JSON.stringify(rate))),
      db.prepare('INSERT INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping,object_key,imported_at) VALUES(?,?,?,?,?,0,?,?,?)')
        .bind(tenant,id,id,name,revision,'{}',key,new Date().toISOString())
    ]);
  } catch(error){await bucket.delete(key);throw error;}
  return json({id,duplicate:false},201);
}

async function importCarrier(data,db,bucket,tenant,plugin,save) {
  insist(typeof data.file==='string' && data.file.length>0 && data.file.length<=699052,'请选择 512 KiB 以内的 DOCX。');
  let info, metadata;
  try {
    const bytes=Uint8Array.from(atob(data.file),c=>c.charCodeAt(0));
    metadata=plugin.describeCarrier(bytes,typeof data.filename==='string'?data.filename.slice(0,240):'');
    if(metadata.voice==='带语音')throw new Error('带语音版的填写字段和方框位置尚未核对。');
    if(metadata.bandwidth && metadata.bandwidth!=='100M')throw new Error('此网速对应的 Word 填写版式尚未核对。');
    info=plugin.analyzeCarrier(bytes,data.variant);
  } catch(error) {
    if(!save && metadata)return json({metadata, convertible:false, conversionMessage:error.message});
    throw new FormError(error.message);
  }
  const {profile,name,revision,rates,tags,file}=info;
  if(!save)return json({name:'100M 智云上海专线基础版（'+revision+'）',metadata,convertible:true,rates,tags,variantRequired:info.variantRequired,discountNote:info.discountNote});
  insist(!info.variantRequired || ['discount','standard'].includes(data.variant),'请确认此模板属于打折还是不打折。');
  const id='carrier-'+profile;
  const existing=(await directory(db,tenant,plugin)).find(t=>t.carrier_profile===profile && t.template_id);
  if(existing)return json({id:existing.template_id,duplicate:true});
  const already=await db.prepare('SELECT id FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,id).first();
  if(already)return json({id,duplicate:true});
  const key='templates/'+tenant+'/'+id;
  await bucket.put(key,file);
  try {
    await db.batch([
      ...await carrierRates(db,tenant,info,id),
      db.prepare('INSERT INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping,object_key,imported_at) VALUES(?,?,?,?,?,0,?,?,?)')
        .bind(tenant,id,id,name+' 申请登记表',revision,JSON.stringify(Object.fromEntries(tags.map(tag=>[tag,tag]))),key,new Date().toISOString())
    ]);
  } catch(error){await bucket.delete(key);throw error;}
  return json({id,duplicate:false},201);
}

export async function handleForms(req,env) {
  try {
    const url=new URL(req.url), path=url.pathname.replace(/^\/api\/v1/,''), method=req.method;
    const visitor=req.headers.get('oai-authenticated-user-id');
    insist(visitor,'请先登录此私有验收站。',401);
    const tenant=await signature(visitor);
    if(!['GET','HEAD'].includes(method)){
      const origin=req.headers.get('origin');
      insist(!origin || origin===url.origin,'此操作必须从验收站内发起。',403);
    }
    if(path==='/forms/mode' && method==='GET')return json({preview:true,hosted:true});
    if(path==='/health' && method==='GET')return json({status:'ok',mode:'hosted-acceptance'});
    if(path==='/catalog' && method==='GET')return json({...catalog,versions:[...catalog.versions,version,voiceVersion,...(env.DEMO_IMPORT?.reviewedVersions||[])]});
    insist(env.DB && env.BUCKET,'验收存储尚未就绪。',503);
    const db=env.DB, bucket=env.BUCKET, plugin=env.DEMO_IMPORT;
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
    if(plugin)await consolidateCarrier(db,bucket,tenant,plugin);
    if(path==='/forms/workspace' && method==='GET')return json({actor:accounts[actor],tariffs:await directory(db,tenant,plugin),labels,smart_import:Boolean(plugin)});
    if(path==='/forms/match' && method==='POST')return json(await candidates((await body(req)).selection,db,tenant,plugin));
    if(path==='/forms/generate' && method==='POST')return await generate(await body(req),db,bucket,tenant,actor,plugin);
    if(path==='/forms/records' && method==='GET'){
      const rows=await db.prepare('SELECT snapshot FROM qa_records WHERE tenant=? AND actor=? ORDER BY rowid DESC').bind(tenant,actor).all();
      return list(rows.results.map(r=>JSON.parse(r.snapshot)));
    }
    if(path==='/forms/dashboard' && method==='GET'){
      const identity=accounts[actor];
      const query=identity.role==='admin' ?
        db.prepare('SELECT snapshot FROM qa_records WHERE tenant=? ORDER BY rowid DESC').bind(tenant) :
        db.prepare('SELECT snapshot FROM qa_records WHERE tenant=? AND actor=? ORDER BY rowid DESC').bind(tenant,actor);
      const rows=await query.all();
      return json(workDashboard(identity,Object.values(accounts),rows.results.map(r=>JSON.parse(r.snapshot))));
    }
    const boardRecord=/^\/forms\/dashboard\/records\/([\w-]+)\/file$/.exec(path);
    if(boardRecord && method==='GET'){
      const row=accounts[actor].role==='admin' ?
        await db.prepare('SELECT object_key FROM qa_records WHERE tenant=? AND id=?').bind(tenant,boardRecord[1]).first() :
        await db.prepare('SELECT object_key FROM qa_records WHERE tenant=? AND actor=? AND id=?').bind(tenant,actor,boardRecord[1]).first();
      insist(row,'找不到生成记录。',404);return documentFile(await bytesFor(bucket,row.object_key));
    }
    const record=/^\/forms\/records\/([\w-]+)\/file$/.exec(path);
    if(record && method==='GET'){
      const row=await db.prepare('SELECT object_key FROM qa_records WHERE tenant=? AND actor=? AND id=?').bind(tenant,actor,record[1]).first();
      insist(row,'找不到生成记录。',404);return documentFile(await bytesFor(bucket,row.object_key));
    }
    if(path==='/forms/templates'||path.startsWith('/forms/templates/')){
      insist(accounts[actor].role==='admin','仅模板管理员可执行此操作。',403);
      if(plugin && path==='/forms/templates/samples' && method==='DELETE'){
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO demo_settings(tenant,hide_samples) VALUES(?,1)').bind(tenant),
          db.prepare('DELETE FROM qa_templates WHERE tenant=? AND object_key IS NULL').bind(tenant)
        ]);
        return json({removed:true});
      }
      if(plugin && method==='POST' && ['/forms/templates/inspect','/forms/templates/import'].includes(path))
        return await importTemplate(await body(req,Math.ceil(plugin.reviewedLimit/3)*4+8192),db,bucket,tenant,plugin,path.endsWith('/import'));
      if(path==='/forms/templates' && method==='GET')return list(await templates(db,tenant,Boolean(plugin)));
      if(path==='/forms/templates' && method==='POST')return await upload(await body(req),db,bucket,tenant,plugin);
      const item=/^\/forms\/templates\/([\w-]+)(\/file)?$/.exec(path);
      if(plugin && item && !item[2] && method==='DELETE'){
        const id=item[1];
        const t=await db.prepare('SELECT object_key,tariff_id FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,id).first();
        insist(t,'找不到模板。',404);
        if(t.object_key===null){
          await db.batch([
            db.prepare('INSERT OR IGNORE INTO demo_deleted_samples(tenant,id) VALUES(?,?)').bind(tenant,id),
            db.prepare('DELETE FROM qa_templates WHERE tenant=? AND id=? AND object_key IS NULL').bind(tenant,id)
          ]);
          return json({id});
        }
        const [deleted]=await db.batch([
          db.prepare('DELETE FROM qa_templates WHERE tenant=? AND id=? AND object_key=?').bind(tenant,id,t.object_key),
          db.prepare("DELETE FROM demo_tariffs WHERE tenant=? AND json_extract(data,'$.template_id')=?").bind(tenant,id)
        ]);
        insist(resultChanges(deleted),'模板状态已变化，请刷新后再试。',409);
        await bucket.delete(t.object_key);
        return json({id});
      }
      if(item?.[2] && method==='GET'){
        const t=await db.prepare('SELECT object_key,tariff_id FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,item[1]).first();
        insist(t,'找不到模板。',404);return documentFile(await bytesFor(bucket,t.object_key,t.tariff_id));
      }
      if(item && !item[2] && method==='PATCH'){
        const {active}=await body(req);insist(typeof active==='boolean','请明确启用或停用。');
        const r=await db.prepare('UPDATE qa_templates SET active=? WHERE tenant=? AND id=?').bind(Number(active),tenant,item[1]).run();
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
