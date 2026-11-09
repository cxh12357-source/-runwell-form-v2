// Local verification prototype; do not use as proof that a form is complete.
import specs from './business-3-metadata.json' with {type:'json'};
import {buildReviewed17Edits} from './reviewed-17-locators.mjs';
import {fillOriginalDocx} from './full-word.mjs';
import {estimateBusiness3Layout} from './business-3-layout.mjs';
import {BusinessInputError} from './business-input-error.mjs';
import {buildAuthorizationEdits} from './business-authorization.mjs';
import {buildFirstPageEdits} from './first-page-fields.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REQUIRED=['company_name','extra_credit_code','extra_industry','install_address','contact_name','id_number','phone','email','extra_company_size','extra_computer_count'];
const ALLOWED=new Set([...REQUIRED,'cycle','billing_mode','manual_billing_ack','payment_method','bank_account','install_zip','billing_zip','job_title','fax','service_use','application_date','service_type']);
const FIELD_NAMES={company_name:'企业全称',extra_credit_code:'统一社会信用代码',extra_industry:'企业所属行业',install_address:'安装地址',contact_name:'经办人姓名',id_number:'身份证号',phone:'经办人手机号',email:'电子邮箱',extra_company_size:'企业规模',extra_computer_count:'企业计算机数量'};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

export function validateBusiness3Values(values, {requireSupplemental=true}={}) {
  if(!values || typeof values!=='object' || Array.isArray(values) || Object.keys(values).some(k=>!ALLOWED.has(k))) throw new BusinessInputError('资料中包含无效字段，请刷新页面后重试。');
  for(const key of REQUIRED) {
    const value=values[key];
    if(typeof value!=='string' || !value || value!==value.trim() || value.length>200 || !value.isWellFormed() || /[\x00-\x1f\x7f\ufffe\uffff]/u.test(value)) throw new BusinessInputError('请填写并核对'+FIELD_NAMES[key]+'。');
  }
  if(requireSupplemental && (typeof values.service_use!=='string' || !values.service_use || values.service_use!==values.service_use.trim() || values.service_use.length>200 || !values.service_use.isWellFormed() || /[\x00-\x1f\x7f\ufffe\uffff]/u.test(values.service_use))) throw new BusinessInputError('请填写并核对业务用途。');
  if(requireSupplemental && (typeof values.application_date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(values.application_date) || !Number.isFinite(Date.parse(values.application_date+'T00:00:00Z')) || new Date(values.application_date+'T00:00:00Z').toISOString().slice(0,10)!==values.application_date)) throw new BusinessInputError('请填写有效的申请日期。');
  for(const key of ['install_zip','billing_zip','job_title','fax']) {
    const v=values[key] ?? '';
    if(typeof v!=='string' || v!==v.trim() || v.length>200 || !v.isWellFormed() || /[\x00-\x1f\x7f\ufffe\uffff]/u.test(v)) throw new BusinessInputError('请核对补充资料。');
    if(key.endsWith('_zip') && (requireSupplemental || v) && !/^\d{6}$/.test(v)) throw new BusinessInputError('邮编应为6位数字。');
  }
  if(!/^[0-9A-Z]{18}$/.test(values.extra_credit_code)) throw new BusinessInputError('统一社会信用代码应为18位数字或大写字母，请核对后重试。');
  if(!/^\d{17}[\dX]$/i.test(values.id_number)) throw new BusinessInputError('身份证号应为18位，末位可为X，请核对后重试。');
  if(!/^1\d{10}$/.test(values.phone)) throw new BusinessInputError('经办人手机号应为1开头的11位数字，请核对后重试。');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) throw new BusinessInputError('电子邮箱格式不正确，请核对后重试。');
  if(!['month','year','two_years'].includes(values.cycle)) throw new BusinessInputError('请明确选择付费周期。');
  if(!['same_company','other_manual'].includes(values.billing_mode)) throw new BusinessInputError('请选择账单地址方式。');
  if(values.billing_mode==='other_manual' && values.manual_billing_ack!==true) throw new BusinessInputError('请确认需在 Word 中手动填写其他账单地址。');
  if(values.billing_mode==='same_company' && values.manual_billing_ack!==undefined && values.manual_billing_ack!==false) throw new BusinessInputError('账单确认与所选模式不一致。');
  if(!['cash','collection'].includes(values.payment_method)) throw new BusinessInputError('请选择付款方式。');
  if(values.payment_method==='collection' && (typeof values.bank_account!=='string' || !/^\d{6,32}$/.test(values.bank_account))) throw new BusinessInputError('托收需要填写6至32位数字的银行账号。');
  if(values.payment_method==='cash' && Object.hasOwn(values,'bank_account') && values.bank_account!=='') throw new BusinessInputError('现金付款不能填写托收账号。');
  return values;
}

async function paragraphs(xml,wanted,sax) {
  const parser=sax.parser(true,{xmlns:true,strictEntities:true,position:true}),stack=[],found=new Map();let n=-1,current=null,t=null;
  parser.onopentag=node=>{if(node.uri===W&&node.local==='p'){if(stack.includes('p'))throw new Error('段落结构无效。');n++;if(wanted.has(n))current={start:xml.lastIndexOf('<',parser.position-1),texts:[]};}
    if(current&&node.uri===W&&node.local==='t'){if(t!==null)throw new Error('文字结构无效。');t='';}stack.push(node.uri===W?node.local:'');};
  parser.ontext=v=>{if(t!==null)t+=v;};
  parser.onclosetag=()=>{const name=stack.pop();if(name==='t'&&current){current.texts.push(t);t=null;}if(name==='p'&&current){current.end=parser.position;current.raw=xml.slice(current.start,current.end);found.set(n,current);current=null;}};
  parser.write(xml).close();return found;
}

async function markNumbers(bytes,spec,targets,dependencies) {
  const {unzipSync,zipSync,sax}=dependencies,files=unzipSync(bytes),dec=new TextDecoder('utf-8',{fatal:true}),enc=new TextEncoder();
  if(!files['word/document.xml']||!files['word/numbering.xml'])throw new Error('原表编号缺失。');
  const doc=dec.decode(files['word/document.xml']), numbering=dec.decode(files['word/numbering.xml']);
  const found=await paragraphs(doc,new Set(targets.map(x=>x.paragraph)),sax), selected=[];
  for(const item of targets){const p=found.get(item.paragraph);if(!p || await digest(enc.encode(p.raw))!==item.paragraph_sha256 || p.raw.split('<w:numId w:val="1"/>').length!==2)throw new Error('原表勾选位置不符。');selected.push(p);}
  const abstract=spec.abstract_id,pattern=new RegExp('<w:abstractNum\\b[^>]*w:abstractNumId="'+abstract+'"[^>]*>[\\s\\S]*?<\\/w:abstractNum>','g'),blocks=[...numbering.matchAll(pattern)];
  const originalNum=`<w:num w:numId="1"><w:abstractNumId w:val="${abstract}"/></w:num>`;
  if(blocks.length!==1 || numbering.split(originalNum).length!==2 || numbering.split('</w:numbering>').length!==2) throw new Error('原表编号结构不符。');
  const levels=[...blocks[0][0].matchAll(/<w:lvl\b[^>]*w:ilvl="0"[^>]*>[\s\S]*?<\/w:lvl>/g)];
  if(levels.length!==1 || levels[0][0].split('<w:lvlText w:val="□"/>').length!==2) throw new Error('原表方框定义不符。');
  const ids=[...numbering.matchAll(/<w:num\s+w:numId="(\d+)"/g)].map(m=>Number(m[1]));const id=Math.max(0,...ids)+1;
  if(!Number.isSafeInteger(id)||id>2147483647)throw new Error('编号无效。');
  let updated=doc;
  for(const p of selected.sort((a,b)=>b.start-a.start)) updated=updated.slice(0,p.start)+p.raw.replace('<w:numId w:val="1"/>',`<w:numId w:val="${id}"/>`)+updated.slice(p.end);
  const level=levels[0][0].replace('<w:lvlText w:val="□"/>','<w:lvlText w:val="■"/>');
  const addition=`<w:num w:numId="${id}"><w:abstractNumId w:val="${abstract}"/><w:lvlOverride w:ilvl="0">${level}</w:lvlOverride></w:num>`;
  files['word/document.xml']=enc.encode(updated);files['word/numbering.xml']=enc.encode(numbering.replace('</w:numbering>',addition+'</w:numbering>'));
  return zipSync(files,{level:6});
}

export async function fillReviewedBusiness3(templateId,bytes,values,dependencies) {
  if(typeof templateId!=='string' || !Object.hasOwn(specs,templateId))throw new Error('请选择已核对的原表。');
  validateBusiness3Values(values);
  const spec=specs[templateId];
  if(!(bytes instanceof Uint8Array) || !bytes.length || bytes.length>10_000_000 || await digest(bytes)!==spec.sha256)throw new Error('原表未通过哈希校验。');
  const {fits}=estimateBusiness3Layout(values);
  const base=Object.fromEntries(REQUIRED.map(key=>[key,values[key]]));
  const {edits}=await buildReviewed17Edits(bytes,base,dependencies);
  if(edits.length!==REQUIRED.length)throw new Error('原表字段定位不完整。');
  // Match the typeface and size used by the original form and by the layout
  // estimator; otherwise an empty paragraph can inherit a different font.
  for(const edit of edits) if(edit.kind==='emptyParagraph') edit.format={font:'宋体',sizeHalfPoints:18,bold:false};
  for(let i=0;i<REQUIRED.length;i++)if(Object.hasOwn(fits,REQUIRED[i])) edits[i].fitTextTwips=fits[REQUIRED[i]];
  const {unzipSync,sax}=dependencies,parts=unzipSync(bytes),raw=parts['word/document.xml'];
  if(!raw)throw new Error('原表正文缺失。');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw),cycle=spec.cycles[values.cycle], selectedPayment=spec[values.payment_method];
  if(templateId.endsWith('-no-voice')) edits.push(...buildAuthorizationEdits(bytes,{...values,service_type:'宽带',application_type:'新装'},dependencies));
  edits.push(...buildFirstPageEdits(xml,values,spec,dependencies));
  const needed=[cycle,selectedPayment,...(values.billing_mode==='same_company'?[spec.billing_same]:[])];
  const found=await paragraphs(xml,new Set(needed.map(x=>x.paragraph)),sax);
  async function checked(item){const p=found.get(item.paragraph),t=p?.texts[item.text];if(!p || typeof t!=='string' || await digest(new TextEncoder().encode(p.raw))!==item.paragraph_sha256 || await digest(new TextEncoder().encode(t))!==item.text_sha256)throw new Error('原表文字位置不符。');return t;}
  const priceText=await checked(cycle);
  if(priceText.slice(cycle.start,cycle.end)!=='□')throw new Error('套餐选项不符。');
  edits.push({part:'word/document.xml',paragraph:cycle.paragraph,text:cycle.text,expected:priceText,start:cycle.start,end:cycle.end,value:'■'});
  const paymentText=await checked(selectedPayment);
  if(values.payment_method==='collection') {
    if(!/^托\s*收\s*银行账号[：:]\s*$/.test(paymentText))throw new Error('托收账号位置不符。');
    edits.push({part:'word/document.xml',paragraph:selectedPayment.paragraph,text:selectedPayment.text,expected:paymentText,start:paymentText.length,end:paymentText.length,value:values.bank_account});
  }
  const targets=[selectedPayment];
  if(values.billing_mode==='same_company'){await checked(spec.billing_same);targets.push(spec.billing_same);}
  const marked=await markNumbers(bytes,spec,targets,dependencies);
  const file=fillOriginalDocx(marked,edits,dependencies);
  return {file,manualActions:values.billing_mode==='other_manual'?['billing_address']:[],layoutReviewRequired:true,
    unmappedFields:['voice_identity','line_count','service_options','signature']};
}
