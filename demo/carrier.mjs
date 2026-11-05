import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/content-types';
const profile = 'fttr-b-shanghai-2026-a';
const octoberProfile = 'fttr-b-shanghai-2026-10-21';
const name = '智云上海专线基础版（FTTR-B）';
const body = 'word/document.xml';
const removable = /^(customXml\/|docProps\/)/;
const allowed = /^(?:\[Content_Types\]\.xml|_rels\/\.rels|word\/(?:_rels\/(?:document|header\d+|footer\d+)\.xml\.rels|(?:document|header\d+|footer\d+|footnotes|endnotes|settings|styles|webSettings|numbering|fontTable)\.xml|theme\/theme\d+\.xml|media\/image\d+\.(?:png|jpe?g)))$/i;
const glyphs = /[□■☐☑]/g;
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const all = (x, ns, tag) => Array.from(x.getElementsByTagNameNS(ns, tag));
const wt = x => all(x, W, 't');
const text = x => wt(x).map(t => t.textContent).join('');
const compact = x => text(x).normalize('NFKC').replace(/\s+/g, '');
const token = key => '{{' + key + '}}';
const xmlSpace = 'http://www.w3.org/XML/1998/namespace';

function parse(bytes) {
  const xml = strFromU8(bytes);
  requireThat(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'Word 文件含不支持的 XML 声明。');
  const result = new DOMParser().parseFromString(xml, 'application/xml');
  requireThat(!result.getElementsByTagName('parsererror').length, 'Word 文件的 XML 无法读取。');
  return result;
}
function serialize(doc) { return strToU8(new XMLSerializer().serializeToString(doc)); }
function unpack(bytes) {
  requireThat(bytes.length && bytes.length <= 524288, '请选择 512 KiB 以内的 DOCX。');
  let total = 0;
  const names = new Set();
  const files = unzipSync(bytes, { filter(f) {
    total += f.originalSize;
    const emptyDirectory = f.originalSize === 0 && /^(_rels|customXml(?:\/_rels)?|docProps|word(?:\/(?:_rels|media|theme))?)\/$/.test(f.name);
    requireThat(total <= 3 * 1024 * 1024 && names.size < 80,'Word 展开后超过 3 MiB 或部件达到 80 个，无法解析。');
    requireThat(!names.has(f.name) && [0,8].includes(f.compression) &&
      (emptyDirectory || allowed.test(f.name) || removable.test(f.name) && /^[\w./-]+$/.test(f.name) && !f.name.includes('..')),
    'Word 文件包含不支持的部件、重复条目或压缩方式。');
    names.add(f.name);
    return !emptyDirectory && !removable.test(f.name);
  } });
  requireThat(files[body] && files['_rels/.rels'] && files['[Content_Types].xml'], '不是受支持的 Word 文档。');
  for (const [path, bytes] of Object.entries(files)) {
    if (!/\.(?:xml|rels)$/.test(path)) continue;
    const doc = parse(bytes);
    if (path.endsWith('.rels')) for (const link of all(doc, R, 'Relationship')) {
      const target = link.getAttribute('Target') || '';
      const kind = (link.getAttribute('Type') || '').split('/').at(-1);
      requireThat(!link.hasAttribute('TargetMode') && /^[\w./-]+$/.test(target), '不接受外部链接或嵌入对象。');
      if (['customXml','metadata/core-properties','extended-properties','custom-properties','core-properties'].includes(kind)) { link.remove(); continue; }
      const parts = (path.startsWith('word/') ? 'word/' : '').concat(target).split('/');
      const normalized = [];
      for (const part of parts) if (part === '..') normalized.pop(); else normalized.push(part);
      requireThat(Object.hasOwn(files,normalized.join('/')), 'Word 文档引用了不支持的部件。');
    }
    if (path === '[Content_Types].xml') {
      for (const node of [...all(doc,P,'Override'), ...all(doc,P,'Default')]) {
        requireThat(!/macro|oleObject|activex/i.test(node.getAttribute('ContentType') || ''), '不支持带宏或嵌入对象的 Word。');
        if (removable.test((node.getAttribute('PartName') || '').slice(1))) node.remove();
      }
    }
    for (const tag of ['object','altChunk','subDoc','dataBinding','del','ins','moveFrom','moveTo','fldSimple']) {
      requireThat(!all(doc,W,tag).length, '请先移除嵌入对象、外部数据或修订。');
    }
    for (const field of all(doc,W,'instrText')) requireThat(/^\s*(PAGE|NUMPAGES)\s*$/i.test(field.textContent), '只支持页码和总页数字段。');
    files[path] = serialize(doc);
  }
  return files;
}

function replace(p, start, end, value) {
  let offset = 0, done = false;
  for (const t of wt(p)) {
    const old = t.textContent, stop = offset + old.length;
    if (offset < end && stop > start) {
      t.textContent = old.slice(0, Math.max(0,start-offset)) + (done ? '' : value) + old.slice(Math.min(old.length,end-offset));
      t.setAttributeNS(xmlSpace,'xml:space','preserve');
      done = true;
    }
    offset = stop;
  }
  requireThat(done,'无法确定填写字段的位置。');
}
function append(p, value) {
  const r = p.ownerDocument.createElementNS(W,'w:r');
  const t = p.ownerDocument.createElementNS(W,'w:t');
  t.setAttributeNS(xmlSpace,'xml:space','preserve');
  t.textContent = value; r.append(t); p.append(r);
}
function red(p, fields) {
  if (fields.every(f => text(p).includes(token(f)))) return;
  let offset = 0;
  const spans = [];
  for (const t of wt(p)) {
    const s = t.textContent;
    if (s && all(t.parentElement,W,'color').some(c => c.getAttributeNS(W,'val')?.toUpperCase() === 'FF0000')) {
      if (spans.at(-1)?.[1] === offset) spans.at(-1)[1] += s.length;
      else spans.push([offset, offset+s.length]);
    }
    offset += s.length;
  }
  requireThat(spans.length === fields.length,'样例填写区无法唯一定位，请用标准原表或已转换模板。');
  spans.map(([a,b],i)=>[a,b,fields[i]]).reverse().forEach(([a,b,key])=>replace(p,a,b,token(key)));
}

const primary = [[3,'company_name','企业全称'],[5,'extra_credit_code','统一社会信用代码'],[7,'extra_industry','企业所属行业'],
  [13,'install_address','安装地址'],[15,'install_zip','邮编'],[17,'contact_name','经办人'],[19,'id_number','身份证号码'],
  [21,'phone','联系电话'],[25,'email','E-MAIL'],[32,'billing_zip','邮编']];
const groups = [
  ['size','企业规模',true,[[9,0,'10 人以下'],[9,1,'10–30 人'],[9,2,'31–80 人'],[9,3,'81–200 人'],[9,4,'200 人以上']]],
  ['computers','计算机数量',true,[[11,0,'5 台及以下'],[11,1,'6–15 台'],[11,2,'16–40 台'],[11,3,'41–100 台'],[11,4,'100 台以上']]],
  ['billing','账单地址',true,[[29,0,'同公司地址'],[30,0,'其它']]],
  ['line','套餐类型',true,[[42,0,'纯新装宽带'],[42,1,'在用宽带']]],
  ['fttr','FTTR 全光网',false,[[44,0,'订购主设备']]], ['plugin','上网行为管理插件',false,[[46,0,'订购插件']]],
  ['ext','商企全光网免费从设备',false,[[49,0,'订购 1 线']]], ['paid','商企全光网收费从设备',false,[[71,0,'订购收费从设备']]],
  ['speed','上行升速包',false,[[74,0,'200M 月付'],[74,1,'200M 年付'],[75,0,'300M 月付'],[75,1,'300M 年付'],[76,0,'500M 月付'],[76,1,'500M 年付']]]
];
const inputs = [['extra_credit_code','统一社会信用代码',true],['extra_industry','企业所属行业',true],['install_zip','安装邮编',true],['billing_zip','账单邮编',true],
  ['job_title','经办人职务'],['fax','传真'],['existing_line','在用宽带号码（选择在用宽带时必填）'],['paid_count','收费从设备数量（订购时必填）'],
  ['security_name','信息安全责任人姓名',true],['security_role','信息安全责任人职务',true],['security_phone','信息安全责任人联系电话',true],
  ['service_use','业务用途',true],['delegate_company','代办单位'],['delegate_credit_code','代办单位信用代码'],['delegate_name','代办员工'],['delegate_id','代办员工身份证号']];
const octoberGroups = groups.map(group=>{
  const [key,label,required,items]=group;
  if(key==='plugin')return [key,'智企硬盘黄金版',required,[[46,0,'开通 20 人／1 TB']]];
  if(key==='paid'||key==='speed')return [key,label,required,items.map(([i,j,option])=>[i+3,j,option])];
  return group;
});
export function controls(profileId) {
  return {inputs,groups:(profileId===octoberProfile?octoberGroups:groups).map(([key,label,required,items])=>
    ({key:'choice_'+key,label,required,options:items.map(x=>x[2])}))};
}

function profileDocument(files) {
  const doc = parse(files[body]), p = all(doc,W,'p');
  const october=p.length===303;
  const anchors=october?[[45,'智企硬盘黄金版'],[73,'商企全光网从设备'],[76,'上行升速包'],[101,'经办人身份证号码'],[255,'信息安全责任人'],[281,'授权委托书']]:[[273,'授权委托书']];
  requireThat((october || p.length===296) && compact(p[1]).startsWith('智云上海专线基础版(FTTR-B)套餐申请登记表(2026/A)') &&
    [[8,'企业规模'],[10,'计算机数量'],[28,'账单地址'],[33,'付款方式'],[36,'基础套餐申请信息'],[41,'套餐类型'],...anchors]
      .every(([i,s])=>compact(p[i]).includes(s)) && primary.every(([i,,label])=>compact(p[i-1]).includes(label)),
    '无法确认 Word 版式。仅支持智云上海专线基础版（FTTR-B）不带语音的 5 月版和 10 月 21 日版。');
  return {doc,p,october};
}

export function analyzeCarrier(bytes) {
  const files = unpack(bytes), {doc,p,october} = profileDocument(files);
  const rateRows = [39,40].map(i=>Array.from(compact(p[i]).matchAll(/[□■☐☑]拨号(\d+M\/\d+M)\((\d+(?:\.\d{1,2})?)元\/(月|年|2年)\/线\)/g)));
  const rates = rateRows.flat().map((m,index)=>({
    key: String(index), bandwidth: m[1], amount: Number(m[2]).toFixed(2), cycle: m[3]
  }));
  requireThat(rateRows[0].length === 2 && rateRows[1].length === 1 && rates.map(x=>x.cycle).join(',') === '月,年,2年' &&
    [39,40].every((i,j)=>(text(p[i]).match(glyphs)||[]).length===rateRows[j].length),
  '未能唯一定位三种基础资费，请核对 Word 原表。');
  for (const [i,key] of primary) {
    const n = text(p[i]);
    if (!n.trim() && october) append(p[i],token(key));
    else {
      requireThat(n.trim(),'原表缺少可识别的示例字段，请使用已转换模板。');
      if (n !== token(key)) replace(p[i],0,n.length,token(key));
    }
  }
  for (const [i,key,prefix] of [[23,'job_title',''],[27,'fax',''],[30,'billing_address','：'],[34,'bank_account',' ']]) {
    if (!text(p[i]).includes(token(key))) {
      if (i === 23 || i === 27) requireThat(!text(p[i]).trim(),'发现未识别的填写内容，请使用空白模板。');
      if (i === 30 || i === 34) requireThat(/^(其它|托收银行账号[:：])$/.test(compact(p[i])),'发现未识别的账单地址或银行资料。');
      append(p[i],prefix+token(key));
    }
  }
  const authKeys=['company_name','extra_credit_code','service_type','application_type','service_use','contact_name','id_number'];
  const securityKeys=['security_name','security_role','security_phone'];
  if(october){
    if(!text(p[101]).includes(token('id_number')))append(p[101],token('id_number'));
    if(!text(p[256]).includes(token('security_phone')))append(p[256],token('security_phone'));
  }else{
    red(p[98],['id_number']); red(p[248],securityKeys); red(p[276],authKeys);
  }
  const blankFields=october?[[256,securityKeys.slice(0,2),/ {2,}/g],[284,authKeys,/ {2,}/g]]:[];
  for (const [i,keys,pattern] of [[october?287:280,['delegate_company','delegate_credit_code','delegate_name','delegate_id'],/_+/g],
    [october?112:109,['sign_y','sign_m','sign_d'],/ +(?=[年月日])/g],[october?292:285,['principal_y','principal_m','principal_d'],/ +(?=[年月日])/g],
    [october?301:294,['delegate_y','delegate_m','delegate_d'],/ +(?=[年月日])/g],[42,['existing_line'],/_+/g],[october?75:72,['paid_count'],/_+/g],...blankFields]) {
    if (keys.every(k=>text(p[i]).includes(token(k)))) continue;
    const found = [...text(p[i]).matchAll(pattern)];
    const matches = keys[0].endsWith('_y') ? found.slice(-3) : found;
    requireThat(matches.length===keys.length,'原表空白位置无法确认。');
    matches.map((m,j)=>[m.index,m.index+m[0].length,keys[j]]).reverse().forEach(([a,b,k])=>replace(p[i],a,b,token(k)));
  }
  for (const t of wt(doc)) t.textContent = t.textContent.replace(glyphs,'□');
  files[body] = serialize(doc);
  const tags = [...new Set(wt(doc).flatMap(t=>[...t.textContent.matchAll(/\{\{([a-z_]+)\}\}/g)].map(m=>m[1])))];
  return {profile:october?octoberProfile:profile,name:october?name+'（10 月 21 日版）':name,revision:october?'2026-10-21':'2026/A',rates,tags,file:zipSync(files,{level:6})};
}

export function renderCarrier(bytes, customer, rate) {
  const files = unpack(bytes), {doc,p,october} = profileDocument(files);
  requireThat(rate.carrier_profile===(october?octoberProfile:profile),'套餐与 Word 版式不一致。');
  const marks = new Map();
  const select = (i,j) => marks.set(i,[...(marks.get(i)||[]),j]);
  const value = key => typeof customer[key] === 'string' ? customer[key].trim() : '';
  for (const [key,label,required,items] of october?octoberGroups:groups) {
    const c = value('choice_'+key);
    requireThat(!required || c,'请选择'+label+'。');
    if (c) { requireThat(/^\d$/.test(c) && items[Number(c)],'请核对'+label+'。'); select(...items[Number(c)]); }
  }
  const collection = customer.payment_method === 'collection';
  select(collection?34:35,0);
  const rateIndex = Number(rate.carrier_rate);
  requireThat([0,1,2].includes(rateIndex),'套餐资费无法确认。');
  select(rateIndex===2?40:39,rateIndex===2?0:rateIndex);
  for (const [i,positions] of marks) {
    if (i === 30 || i === 34 || october && (i === 29 || i === 35)) {
      const num = all(p[i],W,'numPr')[0]; requireThat(num,'空框编号已变化。'); num.remove();
      const r=doc.createElementNS(W,'w:r'), t=doc.createElementNS(W,'w:t');
      t.setAttributeNS(xmlSpace,'xml:space','preserve'); t.textContent='■ '; r.append(t);
      p[i].insertBefore(r,p[i].children[1] || null);
    } else {
      const squares = [...text(p[i]).matchAll(/□/g)];
      for (const j of [...positions].sort((a,b)=>b-a)) {
        requireThat(squares[j],'空框位置已变化。'); replace(p[i],squares[j].index,squares[j].index+1,'■');
      }
    }
  }
  const values = {};
  for (const [key,label,required] of inputs) {
    const v=value(key);
    requireThat(!required || v,'请填写'+label+'。');
    if (key.endsWith('_zip')) requireThat(/^\d{6}$/.test(v),'请填写 6 位'+label+'。');
    values[key]=v;
  }
  requireThat(value('choice_line')!=='1' || values.existing_line,'请填写在用宽带号码。');
  requireThat(!value('choice_paid') || /^[1-9]\d*$/.test(values.paid_count),'请填写收费从设备数量。');
  values.existing_line=value('choice_line')==='1'?values.existing_line:'';
  values.paid_count=value('choice_paid')?values.paid_count:'';
  for (const key of ['company_name','install_address','contact_name','phone','id_number','email']) values[key]=value(key);
  values.billing_address=value('choice_billing')==='1'?value('billing_address'):'';
  requireThat(value('choice_billing')!=='1' || values.billing_address,'请填写其它账单地址。');
  values.bank_account=collection?value('bank_account'):'';
  values.service_type='宽带'; values.application_type='新装';
  for (const t of wt(doc)) t.textContent=t.textContent.replace(/\{\{([a-z_]+)\}\}/g,(_,key)=> {
    const v=values[key] ?? (/(?:sign|principal|delegate)_[ymd]$/.test(key)?'    ':null);
    requireThat(v!=null && v.length<=500 && !/[\u0000-\u001f<>]|\{\{|\}\}/.test(v),'发现无效或未映射的填写项。'); return v;
  });
  files[body]=serialize(doc);
  return zipSync(files,{level:6});
}
