import specs from './business-ai-metadata.json' with {type:'json'};
import {buildReviewed17Edits} from './reviewed-17-locators.mjs';
import {fillOriginalDocx} from './full-word.mjs';
import {validateBusiness3Values} from './business-3-bridge.mjs';
import {estimateBusiness3Layout} from './business-3-layout.mjs';
import {buildFirstPageEdits} from './first-page-fields.mjs';
import {buildAuthorizationEdits} from './business-authorization.mjs';
import {buildAiVoiceAuthorizationEdits} from './business-ai-authorization.mjs';
import {BusinessInputError} from './business-input-error.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

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

// Fill only reviewed, hash-guarded positions on a copy of the approved original.
export async function fillBusinessAi(id,bytes,values,dependencies) {
  if(!Object.hasOwn(specs,id))throw new Error('原表未核对。');
  if(!values || typeof values!=='object' || Array.isArray(values) || Object.hasOwn(values,'cycle'))throw new Error('资料格式无效。');
  if(id!=='business-ai-v2-no-voice' && !['宽带','宽带、固话','宽带、手机','宽带、固话、手机'].includes(values.service_type))throw new BusinessInputError('请选择授权书中的实际业务类型。');
  validateBusiness3Values({...values,cycle:'year'},{requireSupplemental:true});
  const spec=specs[id];
  if(!(bytes instanceof Uint8Array) || !bytes.length || bytes.length>10_000_000 || await digest(bytes)!==spec.sha256)throw new Error('原表未通过哈希校验。');
  const base={};
  for(const key of ['company_name','extra_credit_code','extra_industry','install_address','contact_name','id_number','phone','email','extra_company_size','extra_computer_count'])base[key]=values[key];
  const {edits}=await buildReviewed17Edits(bytes,base,dependencies);
  if(edits.length!==10)throw new Error('字段定位不完整。');
  const {fits}=estimateBusiness3Layout(values);
  for(let i=0;i<edits.length;i++) {
    if(edits[i].kind==='emptyParagraph') edits[i].format={font:'宋体',sizeHalfPoints:18,bold:false};
    const key=Object.keys(base)[i];
    if(Object.hasOwn(fits,key)) edits[i].fitTextTwips=fits[key];
  }
  const {unzipSync,sax}=dependencies,parts=unzipSync(bytes),raw=parts['word/document.xml'];
  if(!raw)throw new Error('原表正文缺失。');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw),payment=spec[values.payment_method];
  const authValues={...values,service_type:id==='business-ai-v2-no-voice'?'宽带':values.service_type,application_type:'新装'};
  edits.push(...(id==='business-ai-v2-voice'?buildAiVoiceAuthorizationEdits(bytes,authValues,dependencies):buildAuthorizationEdits(bytes,authValues,dependencies)));
  edits.push(...buildFirstPageEdits(xml,values,spec,dependencies));
  const needed=[payment,...(values.billing_mode==='same_company'?[spec.billing_same]:[])];
  const found=await paragraphs(xml,new Set(needed.map(x=>x.paragraph)),sax);
  async function checked(item){
    const p=found.get(item.paragraph),t=p?.texts[item.text];
    if(!p || typeof t!=='string' || await digest(new TextEncoder().encode(p.raw))!==item.paragraph_sha256 || await digest(new TextEncoder().encode(t))!==item.text_sha256)throw new Error('原表文字位置不符。');
    return t;
  }
  const paymentText=await checked(payment),targets=[];
  if(values.payment_method==='collection'){
    if(!/^托\s*收\s*银行账号[：:]\s*$/.test(paymentText))throw new Error('托收账号位置不符。');
    edits.push({part:'word/document.xml',paragraph:payment.paragraph,text:payment.text,expected:paymentText,start:paymentText.length,end:paymentText.length,value:values.bank_account});
    targets.push(payment);
  } else {
    if(paymentText!=='□')throw new Error('现金勾选位置不符。');
    edits.push({part:'word/document.xml',paragraph:payment.paragraph,text:payment.text,expected:paymentText,start:0,end:1,value:'■'});
  }
  if(values.billing_mode==='same_company'){await checked(spec.billing_same);targets.push(spec.billing_same);}
  const marked=targets.length ? await markNumbers(bytes,spec,targets,dependencies) : bytes;
  return {file:fillOriginalDocx(marked,edits,dependencies),manualActions:values.billing_mode==='other_manual'?['billing_address']:[],layoutReviewRequired:true,
    unmappedFields:['voice_identity','line_count','service_options','signature']};
}
