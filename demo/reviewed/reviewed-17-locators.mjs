// Offline mapping prototype. Structural evidence does not constitute approval
// to publish a template or a guarantee that filled content retains pagination.
import reviewed from './reviewed-17-metadata.json' with {type:'json'};
import ai from './business-ai-metadata.json' with {type:'json'};
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

/** Return guarded edits only; caller must separately perform Word visual QA.
 * Supports the eight confirmed empty text positions and two option groups.
 * Billing, payment, voice identity, package/fees and all other fields are
 * deliberately rejected until independently reviewed for each template.
 */
export async function buildReviewed17Edits(bytes, values, {unzipSync,sax}) {
  if(!(bytes instanceof Uint8Array) || !bytes.length || bytes.length>10_000_000) throw new Error('原表无效。');
  const sourceHash=await digest(bytes), spec=reviewed[sourceHash] || Object.values(ai).find(entry=>entry.sha256===sourceHash);
  if(!spec) throw new Error('原表不在已核对范围。');
  if(!values || typeof values!=='object' || Array.isArray(values)) throw new Error('字段无效。');
  const entries=Object.entries(values);
  if(!entries.length || entries.some(([key,value])=>(!Object.hasOwn(spec.fields,key) && !Object.hasOwn(spec.options,key)) || typeof value!=='string' || !value || value!==value.trim() || value.length>200 || !value.isWellFormed() || /[\x00-\x1f\x7f\ufffe\uffff]/u.test(value))) throw new Error('字段未确认或资料无效，需要人工处理。');
  const parts=unzipSync(bytes), raw=parts['word/document.xml'];
  if(!raw || raw.length>10_000_000) throw new Error('原表正文无效。');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  if(/<!|<\?(?!xml\s)/i.test(xml)) throw new Error('原表正文结构无效。');
  const wanted=new Set(entries.map(([key])=>(spec.fields[key] || spec.options[key]).paragraph));
  const found=new Map(), stack=[];let number=-1,current=null,text=null;
  const parser=sax.parser(true,{xmlns:true,strictEntities:true,position:true});
  parser.onopentag=node=>{
    if(node.uri===W && node.local==='p') {
      if(stack.includes('p')) throw new Error('不支持嵌套段落。');
      number++;if(wanted.has(number))current={start:xml.lastIndexOf('<',parser.position-1),texts:[]};
    }
    if(current && node.uri===W && node.local==='t') {if(text!==null)throw new Error('文字结构无效。');text='';}
    stack.push(node.uri===W?node.local:'');
  };
  parser.ontext=value=>{if(text!==null)text+=value;};
  parser.onclosetag=()=>{const node=stack.pop();if(node==='t'&&current){current.texts.push(text);text=null;}
    if(node==='p'&&current){current.raw=xml.slice(current.start,parser.position);found.set(number,current);current=null;}};
  parser.write(xml).close();
  const edits=[];
  for(const [key,value] of entries) {
    const field=spec.fields[key], option=spec.options[key], target=field || option,node=found.get(target.paragraph);
    if(!node || await digest(new TextEncoder().encode(node.raw))!==target.paragraph_sha256) throw new Error('原表字段位置不符。');
    const base={part:'word/document.xml',paragraph:target.paragraph};
    if(field){if(node.texts.length)throw new Error('字段并非空白。');edits.push({...base,kind:'emptyParagraph',expectedXml:node.raw,value});continue;}
    if(!Object.hasOwn(option.choices,value)) throw new Error('档位未确认。');
    const selected=option.choices[value], original=node.texts[selected.text];
    if(typeof original!=='string' || await digest(new TextEncoder().encode(original))!==selected.text_sha256 || original.slice(selected.start,selected.end)!=='□') throw new Error('档位位置不符。');
    edits.push({...base,text:selected.text,expected:original,start:selected.start,end:selected.end,value:option.marked});
  }
  return {sourceSha256:sourceHash,edits,layoutReviewRequired:true};
}
