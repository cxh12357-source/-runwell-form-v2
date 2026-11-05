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
async function templates(db,tenant,showDelete=false) {
  const fields=showDelete?', (object_key IS NOT NULL AND active=0) AS deletable':'';
  const rows=await db.prepare('SELECT id,tariff_id,name,revision,active,mapping'+fields+' FROM qa_templates WHERE tenant=? ORDER BY id').bind(tenant).all();
  return rows.results.map(unpack);
}
async function directory(db,tenant,plugin){
  if(!plugin)return tariffs;
  const rows=await db.prepare('SELECT data FROM demo_tariffs WHERE tenant=? ORDER BY id').bind(tenant).all();
  return [...tariffs,...rows.results.map(row=>JSON.parse(row.data))];
}
async function candidates(selection,db,tenant,plugin){
  insist(isObject(selection),'请选择业务和套餐。');
  const plans=await directory(db,tenant,plugin);
  const rows=await templates(db,tenant), res=match(selection,rows,plans);
  for(const c of res.candidates){
    c.extra_fields=[...new Set(Object.values(rows.find(t=>t.id===c.id).mapping).filter(k=>k.startsWith('extra_')))];
    const profile=plans.find(t=>t.id===selection.tariff_id)?.carrier_profile;
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
async function startSession(req,db,tenant) {
  const {account}=await body(req);
  insist(typeof account==='string' && Object.hasOwn(accounts,account),'请选择有效验收身份。');
  const token=crypto.randomUUID()+crypto.randomUUID();
  const now=Date.now(), statements=[
    db.prepare('DELETE FROM qa_sessions WHERE tenant=? AND expires<=?').bind(tenant,now),
    db.prepare('INSERT INTO qa_sessions(hash,tenant,actor,expires) VALUES(?,?,?,?)').bind(await signature(token),tenant,account,now+8*60*60*1000)
  ];
  for(const t of tariffs){
    statements.push(db.prepare('INSERT OR IGNORE INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping) VALUES(?,?,?,?,?,1,?)')
      .bind(tenant,t.id+'-sample',t.id,t.name+' 新装样表','demo-1',JSON.stringify(sampleMapping(t))));
  }
  await db.batch(statements);
  const response=json({token,actor:accounts[account]});
  response.headers.set('Set-Cookie','__Secure-rw-download='+token+'; Path=/api/v1/forms/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800');
  return response;
}
async function upload(data,db,bucket,tenant) {
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
  const result=await db.prepare('INSERT INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping,object_key) VALUES(?,?,?,?,?,0,?,?) ON CONFLICT DO NOTHING')
    .bind(tenant,id,tariff_id,name.trim(),revision.trim(),JSON.stringify(mapping),key).run();
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
    SELECT ?,?,?,?,?,?,? WHERE (SELECT json_group_array(id) FROM
      (SELECT id FROM qa_templates WHERE tenant=? AND tariff_id=? AND active=1 ORDER BY id))=?
    ON CONFLICT(tenant,actor,request_id) DO NOTHING`)
    .bind(id,tenant,actor,request_id,digest,JSON.stringify(snapshot),key,tenant,tariff.id,JSON.stringify(activeIds)).run();
  if(resultChanges(inserted))return json(snapshot);
  await bucket.delete(key);
  const row=await existing();if(row)return replay(row);
  throw new FormError('候选模板已变化，请重新匹配。',409);
}

async function importCarrier(data,db,bucket,tenant,plugin,save) {
  insist(typeof data.file==='string' && data.file.length>0 && data.file.length<=699052,'请选择 512 KiB 以内的 DOCX。');
  let info;
  try { info=plugin.analyzeCarrier(Uint8Array.from(atob(data.file),c=>c.charCodeAt(0))); }
  catch(error) { throw new FormError(error.message); }
  const {profile,name,revision,rates,tags,file}=info;
  if(!save)return json({name,rates,tags});
  const rate=rates.find(r=>r.key===data.rate);
  insist(rate,'请选择管理员已核对的基础资费。');
  const id='carrier-'+(await signature(JSON.stringify([profile,rate.bandwidth,rate.amount,rate.cycle]))).slice(0,24);
  const tariff={id,name,bandwidth:rate.bandwidth,amount:rate.amount,cycle:rate.cycle,business_id:version.business_id,
    business_version_id:version.id,business_attribute:'new',voice_required:false,carrier_profile:profile,carrier_rate:rate.key};
  const already=await db.prepare('SELECT id FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,id).first();
  if(already)return json({id,duplicate:true});
  const key='templates/'+tenant+'/'+id;
  await bucket.put(key,file);
  try {
    await db.batch([
      db.prepare('INSERT INTO demo_tariffs(tenant,id,data) VALUES(?,?,?)').bind(tenant,id,JSON.stringify(tariff)),
      db.prepare('INSERT INTO qa_templates(tenant,id,tariff_id,name,revision,active,mapping,object_key) VALUES(?,?,?,?,?,0,?,?)')
        .bind(tenant,id,id,name+' 申请登记表',revision,JSON.stringify(Object.fromEntries(tags.map(tag=>[tag,tag]))),key)
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
    if(path==='/catalog' && method==='GET')return json({...catalog,versions:[...catalog.versions,version,voiceVersion]});
    insist(env.DB && env.BUCKET,'验收存储尚未就绪。',503);
    const db=env.DB, bucket=env.BUCKET, plugin=env.DEMO_IMPORT;
    if(path==='/forms/test-session' && method==='POST')return await startSession(req,db,tenant);
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
    if(path==='/forms/workspace' && method==='GET')return json({actor:accounts[actor],tariffs:await directory(db,tenant,plugin),labels,smart_import:Boolean(plugin)});
    if(path==='/forms/match' && method==='POST')return json(await candidates((await body(req)).selection,db,tenant,plugin));
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
      if(plugin && method==='POST' && ['/forms/templates/inspect','/forms/templates/import'].includes(path))
        return await importCarrier(await body(req),db,bucket,tenant,plugin,path.endsWith('/import'));
      if(path==='/forms/templates' && method==='GET')return list(await templates(db,tenant,Boolean(plugin)));
      if(path==='/forms/templates' && method==='POST')return await upload(await body(req),db,bucket,tenant);
      const item=/^\/forms\/templates\/([\w-]+)(\/file)?$/.exec(path);
      if(plugin && item && !item[2] && method==='DELETE'){
        const id=item[1];
        const t=await db.prepare('SELECT object_key,tariff_id,active FROM qa_templates WHERE tenant=? AND id=?').bind(tenant,id).first();
        insist(t,'找不到模板。',404);
        insist(t.object_key,'内置样表不能删除。',403);
        insist(!t.active,'请先停用模板，再删除。',409);
        const [deleted]=await db.batch([
          db.prepare('DELETE FROM qa_templates WHERE tenant=? AND id=? AND active=0 AND object_key=?').bind(tenant,id,t.object_key),
          db.prepare('DELETE FROM demo_tariffs WHERE tenant=? AND id=? AND NOT EXISTS (SELECT 1 FROM qa_templates WHERE tenant=? AND tariff_id=?)')
            .bind(tenant,t.tariff_id,tenant,t.tariff_id)
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
