// The caller verifies the complete source document hash before invoking this.
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export function buildFirstPageEdits(xml, values, spec, {sax}) {
  const parser=sax.parser(true,{xmlns:true,strictEntities:true,position:true}), stack=[], paragraphs=[];
  let current=null, text=null;
  parser.onopentag=node=>{
    if(node.uri===W && node.local==='p') {
      if(current)throw new Error('段落结构无效。');
      current={start:xml.lastIndexOf('<',parser.position-1),texts:[]};
    }
    if(current && node.uri===W && node.local==='t')text='';
    stack.push(node.uri===W?node.local:'');
  };
  parser.ontext=value=>{if(text!==null)text+=value;};
  parser.onclosetag=()=>{
    const name=stack.pop();
    if(name==='t' && current){current.texts.push(text);text=null;}
    if(name==='p' && current){current.raw=xml.slice(current.start,parser.position);paragraphs.push(current);current=null;}
  };
  parser.write(xml).close();
  const offset=spec.billing_same.paragraph-29;
  const edits=[];
  for(const [index,key,label] of [[15,'install_zip','邮编'],[23,'job_title','经办人职务'],[27,'fax','传真'],[32,'billing_zip','邮编']]) {
    const value=values[key]; if(!value)continue;
    const p=paragraphs[index+offset], previous=paragraphs[index+offset-1];
    const actual=previous?.texts.join('').replace(/\s/g,'').replace(/\*/g,'');
    if(!p || !previous || !(actual===label || key==='job_title' && actual==='联系人职务') || p.texts.length)throw new Error('原表字段位置不符。');
    edits.push({part:'word/document.xml',paragraph:index+offset,kind:'emptyParagraph',expectedXml:p.raw,value,format:{font:'宋体',sizeHalfPoints:18,bold:false}});
  }
  const matches=paragraphs.map((p,i)=>({p,i})).filter(({p})=>/^经办人身份证号码\s*[:：]\s*$/.test(p.texts.join('')));
  if(matches.length!==1)throw new Error('经办人身份证号码位置不明确。');
  const {p,i}=matches[0], iIdentity=i, index=p.texts.length-1, original=p.texts[index];
  if(index<0)throw new Error('经办人身份证号码位置不明确。');
  edits.push({part:'word/document.xml',paragraph:i,text:index,expected:original,start:original.length,end:original.length,value:values.id_number});
  const dates=paragraphs.map((p,i)=>({p,i})).filter(({p})=>/^日期\s*[:：]\s*年\s*月\s*日\s*$/.test(p.texts.join('')));
  // This is the date on the signature page immediately following the identity field.
  const date=dates.find(({i})=>i>iIdentity && i<iIdentity+20);
  if(!date || dates.filter(({i})=>i>iIdentity && i<iIdentity+20).length!==1)throw new Error('申请日期位置不明确。');
  const [year,month,day]=values.application_date.split('-');
  if(date.p.texts.length!==1)throw new Error('申请日期格式不受支持。');
  const dateText=date.p.texts[0], replacement=dateText.replace(/(日期\s*[:：])\s*年\s*月\s*日\s*$/,(_,prefix)=>prefix+year+'年'+Number(month)+'月'+Number(day)+'日');
  edits.push({part:'word/document.xml',paragraph:date.i,text:0,expected:dateText,start:0,end:dateText.length,value:replacement});
  return edits;
}
