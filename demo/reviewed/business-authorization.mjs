// Locate the authorization form by its exact surrounding text and fill only its
// seven blank runs. The original document has already passed its SHA-256 check.
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const labels=['本单位','（统一社会信用代码为','），在贵公司办理','（手机/固话/宽带）业务的','（新装/移机/变更/改性能/拆机）事宜，本单位使用上述业务用于：','。我单位电信业务经办人为：','（身份证号为','）。'];
const fields=['company_name','extra_credit_code','service_type','application_type','service_use','contact_name','id_number'];
// The authorization uses the customer company on the application. The
// entrusted employee is not yet specified.
export const deferredAuthorizationFields=Object.freeze(['contact_name','id_number']);
export function buildAuthorizationEdits(bytes, values, {unzipSync,sax}, {skipFields=[]}={}) {
  const raw=unzipSync(bytes)['word/document.xml'];
  if(!raw) throw new Error('原表正文缺失。');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw), paragraphs=[];
  let index=-1, stack=[], current=null, text=null;
  const parser=sax.parser(true,{xmlns:true,strictEntities:true});
  parser.onopentag=node=>{
    if(node.uri===W && node.local==='p') { index++; current={index,texts:[]}; }
    if(current && node.uri===W && node.local==='t') text='';
    stack.push(node.uri===W?node.local:'');
  };
  parser.ontext=value=>{if(text!==null)text+=value;};
  parser.onclosetag=()=>{const name=stack.pop();if(name==='t'&&current){current.texts.push(text);text=null;}if(name==='p'&&current){paragraphs.push(current);current=null;}};
  parser.write(xml).close();
  const candidates=paragraphs.filter(p=>p.texts.join('').includes('我单位电信业务经办人为：'));
  if(candidates.length!==1) throw new Error('授权委托书填写位置无法唯一确认。');
  const p=candidates[0], groups=[], fragments=[''];
  for(let i=0;i<p.texts.length;i++) {
    const t=p.texts[i];
    if(/^\s+$/.test(t)) {
      if(i===0 || !/^\s+$/.test(p.texts[i-1])) {groups.push([]); fragments.push('');}
      groups.at(-1).push(i);
    } else fragments[fragments.length-1]+=t;
  }
  if(groups.length!==fields.length || fragments.length!==labels.length || fragments.some((s,i)=>s!==labels[i])) throw new Error('授权委托书内容或空白位置已变化，请核对原表。');
  const edits=[];
  groups.forEach((group,i)=>{
    if(skipFields.includes(fields[i]))return;
    const value=values[fields[i]];
    if(typeof value!=='string' || !value.trim() || value!==value.trim() || value.length>200) throw new Error('授权委托书资料不完整。');
    group.forEach((j,k)=>edits.push({part:'word/document.xml',paragraph:p.index,text:j,expected:p.texts[j],start:0,end:p.texts[j].length,value:k===0?value:''}));
  });
  return edits;
}
