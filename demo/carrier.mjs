import { unzipSync, zipSync, strToU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/content-types';
const profile = 'fttr-b-shanghai-2026-a';
const octoberProfile = 'fttr-b-shanghai-2026-10-21';
const discountProfile = octoberProfile+'-discount';
const name = '智云上海专线基础版（FTTR-B）';
const body = 'word/document.xml';
const removable = /^(?:docProps\/(?:app|core|custom)\.xml|customXml\/(?:item(?:Props)?\d+\.xml|_rels\/item\d+\.xml\.rels))$/i;
const allowed = /^(?:\[Content_Types\]\.xml|_rels\/\.rels|word\/(?:_rels\/(?:document|header\d+|footer\d+)\.xml\.rels|(?:document|header\d+|footer\d+|footnotes|endnotes|settings|styles|webSettings|numbering|fontTable)\.xml|theme\/theme\d+\.xml|media\/image\d+\.(?:png|jpe?g)))$/i;
const glyphs = /[□■☐☑]/g;
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const all = (x, ns, tag) => Array.from(x.getElementsByTagNameNS(ns, tag));
const wt = x => all(x, W, 't');
const text = x => wt(x).map(t => t.textContent).join('');
const compact = x => text(x).normalize('NFKC').replace(/\s+/g, '');
const token = key => '{{' + key + '}}';
const xmlSpace = 'http://www.w3.org/XML/1998/namespace';
const officeR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const mainType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const decoder = new TextDecoder('utf-8', { fatal: true });
const storyPath = /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;
const relationshipKinds = new Set(['officeDocument','styles','settings','webSettings','fontTable','theme',
  'numbering','header','footer','footnotes','endnotes','image']);
const detachedKinds = new Set(['customXml','core-properties','extended-properties','custom-properties']);

function parse(bytes, xmlRuntime) {
  const xml = decoder.decode(bytes);
  requireThat(!/<!DOCTYPE|<!ENTITY|<!--|<\?(?!xml\s)/i.test(xml), 'Word 文件含不支持的 XML 声明。');
  const result = xmlRuntime.parse(xml);
  requireThat(!result.getElementsByTagName('parsererror').length, 'Word 文件的 XML 无法读取。');
  return result;
}
const browserXml = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml'),
  serialize: doc => new XMLSerializer().serializeToString(doc)
};
function serialize(doc, xmlRuntime) { return strToU8(xmlRuntime.serialize(doc)); }
function unpack(bytes, xmlRuntime, metadataLabels) {
  requireThat(bytes.length && bytes.length <= 524288, '请选择 512 KiB 以内的 DOCX。');
  let total = 0;
  const names = new Set();
  const files = unzipSync(bytes, { filter(f) {
    total += f.originalSize;
    const emptyDirectory = f.originalSize === 0 && /^(_rels|customXml(?:\/_rels)?|docProps|word(?:\/(?:_rels|media|theme))?)\/$/.test(f.name);
    requireThat(total <= 3 * 1024 * 1024 && names.size < 80,'Word 展开后超过 3 MiB 或部件达到 80 个，无法解析。');
    requireThat(!names.has(f.name) && [0,8].includes(f.compression) &&
      (emptyDirectory || allowed.test(f.name) || removable.test(f.name)),
    'Word 文件包含不支持的部件、重复条目或压缩方式。');
    names.add(f.name);
    return !emptyDirectory;
  } });
  requireThat(files[body] && files['_rels/.rels'] && files['[Content_Types].xml'], '不是受支持的 Word 文档。');
  for (const [path, bytes] of Object.entries(files)) {
    if (/^word\/media\//.test(path)) {
      const signature = /\.png$/i.test(path) ? [137,80,78,71,13,10,26,10] : [255,216,255];
      requireThat(signature.every((v,i)=>bytes[i]===v),'图片格式与 Word 中的文件类型不一致。');
      continue;
    }
    const doc = parse(bytes, xmlRuntime);
    if (removable.test(path)) {
      if (path.endsWith('.rels')) for (const link of all(doc,R,'Relationship')) {
        requireThat(!link.hasAttribute('TargetMode') && link.getAttribute('Type')===officeR+'customXmlProps' &&
          /^itemProps\d+\.xml$/i.test(link.getAttribute('Target')||''),'不支持外部关系或嵌入对象。');
      }
      delete files[path];
      continue;
    }
    if (metadataLabels) {
      for (const el of Array.from(doc.getElementsByTagName('*'))) {
        for (const attr of Array.from(el.attributes)) {
          if (['descr','title','name','tooltip','author','alias'].includes(attr.localName)) metadataLabels.push(attr.value);
        }
      }
    }
    if (path.endsWith('.rels')) {
      const links = all(doc, R, 'Relationship');
      requireThat(doc.documentElement.namespaceURI===R && doc.documentElement.localName==='Relationships' &&
        Array.from(doc.documentElement.children).every(el=>el.namespaceURI===R && el.localName==='Relationship'), 'Word 关系清单格式无效。');
      if (path==='_rels/.rels') {
        const main = links.filter(link=>link.getAttribute('Type')===officeR+'officeDocument');
        requireThat(main.length===1 && main[0].getAttribute('Target')===body, '缺少 Word 正文关系。');
      }
      for (const link of links) {
        const target = link.getAttribute('Target') || '';
        const type = link.getAttribute('Type') || '', kind = type.split('/').at(-1);
        requireThat(!link.hasAttribute('TargetMode') && /^[\w./-]+$/.test(target), '不接受外部链接或嵌入对象。');
        if (detachedKinds.has(kind)) { link.parentNode.removeChild(link); continue; }
        requireThat(type === officeR+kind && relationshipKinds.has(kind), '不支持此 Word 关系类型。');
        const sourceDir = path.startsWith('word/') ? 'word/' : '';
        requireThat(!target.startsWith('/') && !target.split('/').includes('..') && Object.hasOwn(files,sourceDir+target), 'Word 文档引用了不支持的部件。');
      }
    }
    if (path === '[Content_Types].xml') {
      const overrides = all(doc,P,'Override');
      const main = overrides.filter(node=>node.getAttribute('PartName')==='/'+body);
      requireThat(doc.documentElement.namespaceURI===P && doc.documentElement.localName==='Types' && main.length===1 &&
        main[0].getAttribute('ContentType')===mainType,'缺少有效的 Word 正文内容类型。');
      for (const node of [...overrides, ...all(doc,P,'Default')]) {
        requireThat(!/macro|oleObject|activex/i.test(node.getAttribute('ContentType') || ''), '不支持带宏或嵌入对象的 Word。');
        if (removable.test((node.getAttribute('PartName') || '').slice(1))) node.parentNode.removeChild(node);
      }
    }
    for (const tag of ['object','altChunk','subDoc','dataBinding','del','ins','moveFrom','moveTo','delText','delInstrText']) {
      requireThat(!all(doc,W,tag).length, '请先移除嵌入对象、外部数据或修订。');
    }
    for (const field of all(doc,W,'fldSimple')) requireThat(/^\s*(PAGE|NUMPAGES)\s*$/i.test(field.getAttributeNS(W,'instr')||''), '只支持页码和总页数字段。');
    for (const field of all(doc,W,'instrText')) requireThat(/^\s*(PAGE|NUMPAGES)\s*$/i.test(field.textContent), '只支持页码和总页数字段。');
    if (path==='word/settings.xml') {
      for (const vars of all(doc,W,'docVars')) vars.parentNode.removeChild(vars);
    }
    if (path.endsWith('.rels') || path === '[Content_Types].xml' || path==='word/settings.xml') files[path] = serialize(doc, xmlRuntime);
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
  t.textContent = value; r.appendChild(t); p.appendChild(r);
}
function red(p, fields, examples) {
  if (fields.every(f => text(p).includes(token(f)))) return;
  let offset = 0;
  const spans = [];
  for (const t of wt(p)) {
    const s = t.textContent;
    if (s && all(t.parentNode,W,'color').some(c => c.getAttributeNS(W,'val')?.toUpperCase() === 'FF0000')) {
      if (spans.at(-1)?.[1] === offset) spans.at(-1)[1] += s.length;
      else spans.push([offset, offset+s.length]);
    }
    offset += s.length;
  }
  requireThat(spans.length === fields.length,'样例填写区无法唯一定位，请用标准原表或已转换模板。');
  spans.map(([a,b],i)=>[a,b,fields[i]]).reverse().forEach(([a,b,key])=>{
    remember(examples, key, text(p).slice(a,b));
    replace(p,a,b,token(key));
  });
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
const supportedKeys = new Set([
  ...primary.map(([,key])=>key), ...inputs.map(([key])=>key),
  'billing_address','bank_account','bank_name','service_type','application_type',
  ...['sign','principal','delegate'].flatMap(k=>['y','m','d'].map(part=>k+'_'+part))
]);
const privateText = /(?<!\d)1[3-9]\d(?:[ -]?\d{4}){2}(?!\d)|(?<!\d)\d{17}[\dX](?!\d)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;
const personalFields = new Set(['company_name','extra_credit_code','install_address','contact_name','phone',
  'email','id_number','billing_address','bank_account','fax','security_name','security_phone']);

function remember(examples, key, raw) {
  const value = raw.trim();
  if (!personalFields.has(key) || value.length < 2 || value.includes('{{')) return;
  if (!examples.has(value)) examples.set(value,key);
}

function substituteExamples(paragraph, examples) {
  for (const [example,key] of examples) {
    const original = text(paragraph);
    let start = original.lastIndexOf(example);
    while (start >= 0) {
      // An existing placeholder may contain the same letters as an example.
      if (original.lastIndexOf('{{',start) <= original.lastIndexOf('}}',start)) {
        replace(paragraph,start,start+example.length,token(key));
      }
      if (start < example.length) break;
      start = original.lastIndexOf(example,start-example.length);
    }
  }
}

function substituteTokens(paragraph, resolve) {
  const matches = [...text(paragraph).matchAll(/\{\{([a-z_]+)\}\}/g)];
  for (const match of matches.reverse()) {
    replace(paragraph, match.index, match.index+match[0].length, resolve(match[1]));
  }
}

function editStories(files, main, xmlRuntime, edit) {
  for (const [path,bytes] of Object.entries(files)) {
    if (!storyPath.test(path)) continue;
    const doc = path===body ? main : parse(bytes,xmlRuntime);
    for (const paragraph of all(doc,W,'p')) edit(paragraph);
    files[path] = serialize(doc,xmlRuntime);
  }
}

function blankListOptions(files, paragraphs, october, xmlRuntime) {
  const path='word/numbering.xml';
  requireThat(files[path], '账单地址和付款方式缺少 Word 方框编号。');
  const numbering=parse(files[path],xmlRuntime);
  const normalized=new Map();
  let nextId=Math.max(0,...all(numbering,W,'num').map(el=>Number(el.getAttributeNS(W,'numId')) || 0))+1;
  for (const index of october ? [29,30,34,35] : [30,34]) {
    const props=all(paragraphs[index],W,'numPr')[0];
    requireThat(props,'未能确认账单地址或付款方式的 Word 编号。');
    const reference=all(props,W,'numId')[0];
    const id=reference?.getAttributeNS(W,'val');
    const level=all(props,W,'ilvl')[0]?.getAttributeNS(W,'val') || '0';
    const num=all(numbering,W,'num').find(el=>el.getAttributeNS(W,'numId')===id);
    const abstractId=num && all(num,W,'abstractNumId')[0]?.getAttributeNS(W,'val');
    const abstract=all(numbering,W,'abstractNum').find(el=>el.getAttributeNS(W,'abstractNumId')===abstractId);
    const override=num && all(num,W,'lvlOverride').find(el=>el.getAttributeNS(W,'ilvl')===level);
    const definition=(override && all(override,W,'lvl')[0]) || (abstract && all(abstract,W,'lvl').find(el=>el.getAttributeNS(W,'ilvl')===level));
    const symbol=definition && all(definition,W,'lvlText')[0];
    requireThat(symbol && all(definition,W,'numFmt')[0]?.getAttributeNS(W,'val')==='bullet','账单地址或付款方式使用了不支持的编号格式。');
    if (['□','☐'].includes(symbol.getAttributeNS(W,'val'))) continue;
    // Other paragraphs can share the same numbering definition. Override just this option's list.
    const key=id+':'+level;
    if (!normalized.has(key)) {
      const newNum=num.cloneNode(true), newId=String(nextId++);
      newNum.setAttributeNS(W,'w:numId',newId);
      const oldOverride=all(newNum,W,'lvlOverride').find(el=>el.getAttributeNS(W,'ilvl')===level);
      if (oldOverride) newNum.removeChild(oldOverride);
      const custom=numbering.createElementNS(W,'w:lvlOverride');
      custom.setAttributeNS(W,'w:ilvl',level);
      const newLevel=definition.cloneNode(true);
      all(newLevel,W,'lvlText')[0].setAttributeNS(W,'w:val','□');
      for (const font of all(newLevel,W,'rFonts')) {
        for (const slot of ['ascii','hAnsi','eastAsia','cs']) font.setAttributeNS(W,'w:'+slot,'宋体');
        for (const slot of ['asciiTheme','hAnsiTheme','eastAsiaTheme','cstheme']) font.removeAttributeNS(W,slot);
      }
      custom.appendChild(newLevel);
      newNum.appendChild(custom);
      numbering.documentElement.appendChild(newNum);
      normalized.set(key,newId);
    }
    reference.setAttributeNS(W,'w:val',normalized.get(key));
  }
  files[path]=serialize(numbering,xmlRuntime);
}

const octoberGroups = groups.map(group=>{
  const [key,label,required,items]=group;
  if(key==='plugin')return [key,'智企硬盘黄金版',required,[[46,0,'开通 20 人／1 TB']]];
  if(key==='paid'||key==='speed')return [key,label,required,items.map(([i,j,option])=>[i+3,j,option])];
  return group;
});
export function controls(profileId) {
  return {inputs,groups:([octoberProfile,discountProfile].includes(profileId)?octoberGroups:groups).map(([key,label,required,items])=>
    ({key:'choice_'+key,label,required,options:items.map(x=>x[2])}))};
}

function profileDocument(files, xmlRuntime) {
  const doc = parse(files[body], xmlRuntime), p = all(doc,W,'p');
  const october=p.length===303;
  const anchors=october?[[45,'智企硬盘黄金版'],[73,'商企全光网从设备'],[76,'上行升速包'],[101,'经办人身份证号码'],[255,'信息安全责任人'],[281,'授权委托书']]:[[273,'授权委托书']];
  requireThat(doc.documentElement.namespaceURI===W && doc.documentElement.localName==='document' && (october || p.length===296) && compact(p[1]).startsWith('智云上海专线基础版(FTTR-B)套餐申请登记表(2026/A)') &&
    [[8,'企业规模'],[10,'计算机数量'],[28,'账单地址'],[33,'付款方式'],[36,'基础套餐申请信息'],[41,'套餐类型'],...anchors]
      .every(([i,s])=>compact(p[i]).includes(s)) && primary.every(([i,,label])=>compact(p[i-1]).includes(label)),
    '无法确认 Word 版式。仅支持智云上海专线基础版（FTTR-B）不带语音的 5 月版和 10 月 21 日版。');
  return {doc,p,october};
}

export function describeCarrier(bytes, filename='', xmlRuntime=browserXml) {
  const files=unpack(bytes, xmlRuntime), doc=parse(files[body], xmlRuntime);
  const paragraphs=all(doc,W,'p').map(p=>text(p).normalize('NFKC').trim());
  const fn=filename.normalize('NFKC').replace(/\.docx$/i,'');
  const title=paragraphs.slice(0,12).find(line=>line.includes('套餐申请登记表'))||'';
  const bodyName=title.split('套餐申请登记表')[0].trim();
  const filenameName=fn.match(/(?:\d+(?:\.\d+)?[MG]\s*)?([^】]+?)套餐申请登记表/i)?.[1]?.trim();
  const speed=fn.match(/(\d+(?:\.\d+)?)\s*([MG])(?=\s*智云)/i);
  const rateLines=paragraphs.slice(0,100).filter(line=>/[□■☐☑].*\d+\s*元\s*\//.test(line));
  const speeds=[...new Set(rateLines.flatMap(line=>[...line.matchAll(/(\d+(?:\.\d+)?)\s*([MG])\s*\/\s*\d+(?:\.\d+)?\s*[MG]/gi)].map(m=>m[1]+m[2].toUpperCase())))];
  const namedSpeed=speed?speed[1]+speed[2].toUpperCase():'';
  const bandwidth=namedSpeed && speeds.length && !speeds.includes(namedSpeed)?'':namedSpeed || (speeds.length===1?speeds[0]:'');
  const effective=fn.match(/(?:20\d{2})[.\-/]?\d{2}[.\-/]?\d{2}(?=起)/)?.[0];
  const revision=title.match(/\((20\d{2}\/[A-Z0-9]+)\)\s*$/i)?.[1]||'';
  const negativeVoice=/不带语音|不含语音|无语音/g;
  const noVoice=/(?:不带|不含|无)语音/.test(fn);
  const voice=/带语音|含语音/.test(fn.replace(negativeVoice,''));
  const conflicts=[];
  if(namedSpeed && speeds.length && !speeds.includes(namedSpeed)) conflicts.push('文件名网速与 Word 资费区不一致');
  if(noVoice && voice) conflicts.push('文件名同时包含带语音和不带语音');
  const noDiscount=/不打折|无折扣|未打折/.test(fn);
  const discount=/打折|折扣|\d+(?:\.\d+)?折/.test(fn.replace(/不打折|无折扣|未打折/g,''))||
    rateLines.some(line=>/\d+(?:\.\d+)?\s*折|折后|折扣/.test(line));
  return {bandwidth,conflicts,name:bodyName||filenameName||'',revision:[effective,revision].filter(Boolean).join(' · '),
    voice:noVoice===voice?'':voice?'带语音':'不带语音',discount:noDiscount===discount?'':discount?'打折':'不打折',
    evidence:[title.slice(0,120), '文件名网速：'+namedSpeed,'资费区速率：'+speeds.join('、'),'版本：'+[effective,revision].filter(Boolean).join(' · '),
      '语音证据：'+[voice?'带语音':'',noVoice?'不带语音':''].filter(Boolean).join('、'),
      '折扣证据：'+[discount?'有折扣标记':'',noDiscount?'不打折':''].filter(Boolean).join('、')].join('\n')};
}

export function analyzeCarrier(bytes,variant,xmlRuntime=browserXml) {
  const metadataLabels=[];
  const files = unpack(bytes, xmlRuntime,metadataLabels), {doc,p,october} = profileDocument(files, xmlRuntime);
  const rateRows = [39,40].map(i=>Array.from(compact(p[i]).matchAll(/[□■☐☑]拨号(\d+M\/\d+M)\((\d+(?:\.\d{1,2})?)元\/(月|年|2年)\/线\)/g)));
  const rates = rateRows.flat().map((m,index)=>({
    key: String(index), bandwidth: m[1], amount: Number(m[2]).toFixed(2), cycle: m[3]
  }));
  requireThat(rateRows[0].length === 2 && rateRows[1].length === 1 && rates.map(x=>x.cycle).join(',') === '月,年,2年' &&
    [39,40].every((i,j)=>(text(p[i]).match(glyphs)||[]).length===rateRows[j].length),
  '未能唯一定位三种基础资费，请核对 Word 原表。');
  requireThat(rates.every(rate=>rate.bandwidth==='100M/100M'),'目前仅支持三档网速均为 100M/100M 的原表。');
  const examples = new Map();
  for (const [i,key] of primary) {
    const n = text(p[i]);
    if (!n.trim() && october) append(p[i],token(key));
    else {
      requireThat(n.trim(),'原表缺少可识别的示例字段，请使用已转换模板。');
      remember(examples, key, n);
      if (n !== token(key)) replace(p[i],0,n.length,token(key));
    }
  }
  for (const [i,key] of [[23,'job_title'],[27,'fax']]) {
    const original = text(p[i]);
    if (original) { remember(examples,key,original); replace(p[i],0,original.length,token(key)); }
    else append(p[i],token(key));
  }
  for (const [i,key,label] of [[30,'billing_address',/^\s*其它\s*[:：]?\s*/],
    [34,'bank_account',/^\s*托收银行账号\s*[:：]\s*/]]) {
    const original = text(p[i]), prefix = original.match(label)?.[0];
    requireThat(prefix,'无法确认账单地址或托收银行账号的位置。');
    const tail = original.slice(prefix.length);
    const replacement = i === 30 ? token(key) : token(key)+'  开户银行：'+token('bank_name');
    if (tail) { remember(examples,key,tail); replace(p[i],prefix.length,original.length,replacement); }
    else append(p[i],(i === 30 && !/[:：]/.test(prefix)?'：':' ')+replacement);
  }
  const authKeys=['company_name','extra_credit_code','service_type','application_type','service_use','contact_name','id_number'];
  const securityKeys=['security_name','security_role','security_phone'];
  if(october){
    for (const [i,key,pattern] of [[101,'id_number',/\d{17}[\dX]/gi],[256,'security_phone',/1\d{2}[ -]?\d{4}[ -]?\d{4}/g]]) {
      const original=text(p[i]);
      if (original.includes(token(key))) continue;
      const numbers=[...original.matchAll(pattern)];
      requireThat(numbers.length<=1,'重复的证件或电话字段需要核对。');
      if (numbers.length) {
        const m=numbers[0];
        remember(examples,key,m[0]); replace(p[i],m.index,m.index+m[0].length,token(key));
      } else append(p[i],token(key));
    }
  }else{
    red(p[98],['id_number'],examples); red(p[248],securityKeys,examples); red(p[276],authKeys,examples);
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
  blankListOptions(files, p, october, xmlRuntime);
  const tags = new Set();
  const byLength=[...examples].sort(([a],[b])=>b.length-a.length);
  editStories(files, doc, xmlRuntime, paragraph => {
    substituteExamples(paragraph,byLength);
    substituteTokens(paragraph, key => {
      requireThat(supportedKeys.has(key),'文档含未识别的占位符，请核对模板。');
      tags.add(key);
      return token(key);
    });
    const remaining = text(paragraph).replace(/\{\{[a-z_]+\}\}/g,'');
    requireThat(!/\{\{|\}\}/.test(remaining) && !privateText.test(remaining),
      '在已映射字段以外发现号码、邮箱或不完整占位符，请核对原表。');
  });
  // Alternate text, shape titles and bookmark labels sit outside Word text runs.
  requireThat(metadataLabels.every(label=>!privateText.test(label) && !byLength.some(([value])=>label.includes(value))),
    'Word 图片说明或其它元数据中仍含样例资料，请清理后导入。');
  const discountNote=[39,40].some(i=>/(?:\d+(?:\.\d+)?折|折扣|折后)/.test(compact(p[i])));
  const discounted=variant==='discount';
  const baseProfile=october?octoberProfile:profile;
  return {profile:discounted?baseProfile+'-discount':baseProfile,variantRequired:october||discountNote,discountNote,
    name:october?name+(discounted?'（打折、不带语音 · 10 月 21 日版）':'（不打折、不带语音 · 10 月 21 日版）'):name+(discounted?'（打折、不带语音）':''),
    revision:october?'2026-10-21':'2026/A',rates,tags:[...tags],file:zipSync(files,{level:6})};
}

export function renderCarrier(bytes, customer, rate, xmlRuntime=browserXml) {
  const files = unpack(bytes, xmlRuntime), {doc,p,october} = profileDocument(files, xmlRuntime);
  requireThat((october?[octoberProfile,discountProfile]:[profile,profile+'-discount']).includes(rate.carrier_profile),'套餐与 Word 版式不一致。');
  const marks = new Map();
  const select = (i,j) => marks.set(i,[...(marks.get(i)||[]),j]);
  const value = key => typeof customer[key] === 'string' ? customer[key].trim() : '';
  for (const [key,label,required,items] of october?octoberGroups:groups) {
    const c = value('choice_'+key);
    requireThat(!required || c,'请选择'+label+'。');
    if (c) { requireThat(/^\d$/.test(c) && items[Number(c)],'请核对'+label+'。'); select(...items[Number(c)]); }
  }
  const collection = customer.payment_method === 'collection';
  requireThat(customer.payment_method === 'cash' || collection, '请选择付款方式。');
  if (collection) requireThat(/^\d{6,32}$/.test(value('bank_account')) && value('bank_name'), '托收需要有效的银行账号和开户银行。');
  if (!text(p[34]).includes(token('bank_name'))) append(p[34],'  开户银行：'+token('bank_name'));
  select(collection?34:35,0);
  const rateIndex = Number(rate.carrier_rate);
  requireThat([0,1,2].includes(rateIndex),'套餐资费无法确认。');
  select(rateIndex===2?40:39,rateIndex===2?0:rateIndex);
  for (const [i,positions] of marks) {
    if (i === 30 || i === 34 || october && (i === 29 || i === 35)) {
      const num = all(p[i],W,'numPr')[0]; requireThat(num,'空框编号已变化。'); num.parentNode.removeChild(num);
      const r=doc.createElementNS(W,'w:r'), t=doc.createElementNS(W,'w:t');
      t.setAttributeNS(xmlSpace,'xml:space','preserve'); t.textContent='■ '; r.appendChild(t);
      p[i].insertBefore(r,all(p[i],W,'pPr')[0]?.nextSibling || p[i].firstChild);
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
  values.bank_name=collection?value('bank_name'):'';
  values.service_type='宽带'; values.application_type='新装';
  editStories(files, doc, xmlRuntime, paragraph => substituteTokens(paragraph, key => {
    const v=values[key] ?? (/(?:sign|principal|delegate)_[ymd]$/.test(key)?'    ':null);
    requireThat(v!=null && v.length<=500 && !/[\u0000-\u001f<>]|\{\{|\}\}/.test(v),'发现无效或未映射的填写项。'); return v;
  }));
  return zipSync(files,{level:6});
}

// Compare document contents rather than ZIP modification times. Formatting and image changes matter.
const equalBytes = (a,b) => a.length===b.length && a.every((byte,i)=>byte===b[i]);
function canonicalElement(el) {
  const ns=el.namespaceURI, name=el.localName;
  const attrs=Array.from(el.attributes)
    .filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/' &&
      !(a.namespaceURI===xmlSpace && a.localName==='space') &&
      !(a.namespaceURI===W && a.localName.startsWith('rsid')) &&
      !(a.namespaceURI==='http://schemas.microsoft.com/office/word/2010/wordml' && ['paraId','textId'].includes(a.localName)))
    .map(a=>[a.namespaceURI,a.localName,a.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const children=[];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType===1) {
      const entry=canonicalElement(child);
      if (entry) children.push(entry);
    } else if ((child.nodeType===3 || child.nodeType===4) && (ns===W && name==='t' || child.nodeValue.trim())) {
      children.push(child.nodeValue);
    }
  }
  if (ns===W && name==='t' && children.every(t=>t==='')) return null;
  // Replacing a value spanning several Word runs can leave runs with only formatting.
  if (ns===W && name==='r' && children.every(c=>Array.isArray(c) && c[0]===W && c[1]==='rPr')) return null;
  return [ns,name,attrs,children];
}

export function sameCarrierTemplate(left, right, xmlRuntime=browserXml) {
  if (equalBytes(left,right)) return true;
  const a=unpack(left,xmlRuntime), b=unpack(right,xmlRuntime);
  const paths=Object.keys(a);
  if (paths.length!==Object.keys(b).length) return false;
  for (const path of paths) {
    if (!Object.hasOwn(b,path)) return false;
    if (equalBytes(a[path],b[path])) continue;
    if (!/\.(?:xml|rels)$/.test(path)) return false;
    const canonical=bytes=>JSON.stringify(canonicalElement(parse(bytes,xmlRuntime).documentElement));
    if (canonical(a[path])!==canonical(b[path])) return false;
  }
  return true;
}

export function createCarrier(xmlRuntime) {
  return {
    controls,
    sameCarrierTemplate: (left, right) => sameCarrierTemplate(left, right, xmlRuntime),
    describeCarrier: (bytes, filename) => describeCarrier(bytes, filename, xmlRuntime),
    analyzeCarrier: (bytes, variant) => analyzeCarrier(bytes, variant, xmlRuntime),
    renderCarrier: (bytes, customer, rate) => renderCarrier(bytes, customer, rate, xmlRuntime)
  };
}
