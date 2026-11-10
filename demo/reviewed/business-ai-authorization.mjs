// V2 voice authorization has a different text and field order. The caller
// checks the full original document hash before invoking this locator.
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const labels=['本单位','（统一社会信用代码为','），现全权委托本单位员工','（身份证号为','），至贵公司办理','（手机/固话/宽带）业务的','（新装/移机/变更/改性能/拆机）事宜，其实际用途为','。'];
const fields=['company_name','extra_credit_code','contact_name','id_number','service_type','application_type','service_use'];
export function buildAiVoiceAuthorizationEdits(bytes,values,{unzipSync,sax},{skipFields=[]}={}) {
  const raw=unzipSync(bytes)['word/document.xml'];
  if(!raw)throw new Error('原表正文缺失。');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw), paragraphs=[];
  let index=-1,stack=[],current=null,text=null;
  const parser=sax.parser(true,{xmlns:true,strictEntities:true});
  parser.onopentag=node=>{if(node.uri===W&&node.local==='p'){index++;current={index,texts:[]};}if(current&&node.uri===W&&node.local==='t')text='';stack.push(node.uri===W?node.local:'');};
  parser.ontext=value=>{if(text!==null)text+=value;};
  parser.onclosetag=()=>{const name=stack.pop();if(name==='t'&&current){current.texts.push(text);text=null;}if(name==='p'&&current){paragraphs.push(current);current=null;}};
  parser.write(xml).close();
  const candidates=paragraphs.filter(p=>p.texts.join('').includes('现全权委托本单位员工'));
  if(candidates.length!==1)throw new Error('授权委托书填写位置无法唯一确认。');
  const p=candidates[0],groups=[],fragments=[''];
  for(let i=0;i<p.texts.length;i++){
    const t=p.texts[i];
    if(/^\s+$/.test(t)){if(i===0||!/^\s+$/.test(p.texts[i-1])){groups.push([]);fragments.push('');}groups.at(-1).push(i);}
    else fragments[fragments.length-1]+=t;
  }
  if(groups.length!==fields.length||fragments.length!==labels.length||fragments.some((s,i)=>s!==labels[i]))throw new Error('授权委托书内容或空白位置已变化，请核对原表。');
  return groups.flatMap((group,i)=>{
    if(skipFields.includes(fields[i]))return [];
    const value=values[fields[i]];
    if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>200)throw new Error('授权委托书资料不完整。');
    return group.map((j,k)=>({part:'word/document.xml',paragraph:p.index,text:j,expected:p.texts[j],start:0,end:p.texts[j].length,value:k===0?value:''}));
  });
}
