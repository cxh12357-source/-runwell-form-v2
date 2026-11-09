import {BusinessInputError} from './business-input-error.mjs';
import {fillOriginalDocx} from './full-word.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const required={company_name:'被担保企业名称',extra_credit_code:'被担保企业证件号码',guarantor_name:'担保人名称',guarantor_id:'担保人证件号码',guarantor_address:'担保人联系地址',guarantor_phone:'担保人联系电话'};
const optional=['business_number','application_date'];
export function validateGuaranteeValues(values){
  if(!values || typeof values!=='object' || Array.isArray(values) || Object.keys(values).some(k=>!Object.hasOwn(required,k)&&!optional.includes(k)))throw new BusinessInputError('担保书资料无效。');
  for(const [key,label] of Object.entries(required)) {
    const v=values[key]; if(typeof v!=='string'||!v||v!==v.trim()||v.length>100||!v.isWellFormed()||/[\x00-\x1f\x7f\ufffe\uffff]/u.test(v))throw new BusinessInputError('请填写并核对'+label+'。');
  }
  if(!/^[0-9A-Z]{18}$/.test(values.extra_credit_code))throw new BusinessInputError('被担保企业证件号码应为18位统一社会信用代码。');
  for(const key of optional){const v=values[key]??'';if(typeof v!=='string'||v!==v.trim()||v.length>50||!v.isWellFormed()||/[\x00-\x1f\x7f\ufffe\uffff]/u.test(v))throw new BusinessInputError('请核对担保书补充资料。');}
  const d=values.application_date||'';if(d&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d))throw new BusinessInputError('请填写有效的担保日期。');
}
export function buildGuaranteeEdits(bytes,values,{unzipSync,sax}){
  validateGuaranteeValues(values);
  const raw=unzipSync(bytes)['word/document.xml'];if(!raw)throw Error('担保书正文缺失。');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw),pars=[];let stack=[],current=null,t=null;
  const parser=sax.parser(true,{xmlns:true,position:true});parser.onopentag=n=>{if(n.uri===W&&n.local==='p'){if(current)throw Error('段落结构无效');current={start:xml.lastIndexOf('<',parser.position-1),texts:[]};}if(current&&n.uri===W&&n.local==='t')t='';stack.push(n.uri===W?n.local:'');};parser.ontext=s=>{if(t!==null)t+=s};parser.onclosetag=()=>{let n=stack.pop();if(n==='t'&&current){current.texts.push(t);t=null;}if(n==='p'&&current){current.raw=xml.slice(current.start,parser.position);pars.push(current);current=null;}};parser.write(xml).close();
  const p=pars[4];if(!p||!p.texts.join('').includes('本公司愿意为')||!p.texts.join('').includes('提供担保'))throw Error('担保书位置不符。');
  const locations=[[3,'company_name',/^_+\($/],[6,'extra_credit_code',/^_+\)$/],[10,'business_number',/^_+$/]],edits=[];
  for(const [index,key,pattern] of locations){const text=p.texts[index],value=values[key]||'';if(!pattern.test(text||''))throw Error('担保书空白位置不符。');if(!value)continue;const length=text.match(/^_+/)[0].length;edits.push({part:'word/document.xml',paragraph:4,text:index,expected:text,start:0,end:length,value});}
  for(const [index,key,label] of [[7,'guarantor_name','担保人名称'],[9,'guarantor_id','担保人证件号码'],[11,'guarantor_address','担保人联系地址'],[13,'guarantor_phone','担保人联系电话']]){const p=pars[index];if(!p||p.texts.length||pars[index-1]?.texts.join('')!==label)throw Error('担保人字段位置不符。');edits.push({part:'word/document.xml',paragraph:index,kind:'emptyParagraph',expectedXml:p.raw,value:values[key],format:{font:'宋体',sizeHalfPoints:30,bold:false}});}
  const idLabel=pars[8].texts[0];
  edits.push({part:'word/document.xml',paragraph:8,text:0,expected:idLabel,start:0,end:0,value:'*'});
  if(values.application_date){const p=pars[17];if(p?.texts.join('')!=='日期：')throw Error('担保日期位置不符。');edits.push({part:'word/document.xml',paragraph:17,text:0,expected:'日期：',start:3,end:3,value:values.application_date});}
  return edits;
}
export function fillGuarantee(bytes,values,dependencies){return {file:fillOriginalDocx(bytes,buildGuaranteeEdits(bytes,values,dependencies),dependencies),manualActions:['guarantee_signature',...(!values.business_number?['guarantee_number']:[]),...(!values.application_date?['guarantee_date']:[])],unmappedFields:[]};}
