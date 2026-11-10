// The caller verifies the complete source document hash before invoking this.
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function readParagraphs(xml, sax) {
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
    if(name==='p' && current){current.end=parser.position;current.raw=xml.slice(current.start,current.end);paragraphs.push(current);current=null;}
  };
  parser.write(xml).close();
  return paragraphs;
}

// Materialize the checkbox glyphs in the document itself. Word/WPS may
// suppress or ignore list-number glyphs in these table cells.
export function materializeFirstPageBoxes(bytes, values, spec, {sax,unzipSync,zipSync}) {
  const part='word/document.xml', files=unzipSync(bytes);
  let xml=new TextDecoder('utf-8',{fatal:true}).decode(files[part]);
  const paragraphs=readParagraphs(xml,sax);
  const options=[
    [spec.billing_same.paragraph,/^同公司地址$/,values.billing_mode==='same_company'],
    [spec.billing_same.paragraph+1,values.billing_mode==='other_address'
      ? text=>{const prefix=text.match(/^(?:其它|其他)[:：]?/); return Boolean(prefix) && text.slice(prefix[0].length)===values.billing_address.replace(/\s/g,'');}
      : text=>/^(?:其它|其他)[:：]?$/.test(text),['other_manual','other_address'].includes(values.billing_mode)],
    [spec.collection.paragraph,/^托收银行账号[:：]\d*$/,values.payment_method==='collection'],
    [spec.cash.paragraph,/^现金$/,values.payment_method==='cash']
  ];
  for(const [index,label,selected] of options.sort((a,b)=>b[0]-a[0])){
    const p=paragraphs[index], original=p?.texts.join('').replace(/\s/g,'')||'';
    const content=original.replace(/^□/,'');
    if(!p || !(typeof label==='function'?label(content):label.test(content)))throw new Error('账单地址或付款方式的位置不符。');
    const mark=selected?'■':'□';
    let raw;
    if(original.startsWith('□')){
      if(!/<w:t(?:\s[^>]*)?>□/.test(p.raw))throw new Error('现金方框位置不符。');
      raw=p.raw.replace(/(<w:t(?:\s[^>]*)?>)□/,'$1'+mark);
    }else{
      const numbering=/<w:numPr(?:\s[^>]*)?>[\s\S]*?<\/w:numPr>/g;
      if([...p.raw.matchAll(numbering)].length!==1 || !p.raw.includes('</w:pPr>'))throw new Error('原表方框定义不符。');
      raw=p.raw.replace(numbering,'').replace('</w:pPr>','</w:pPr><w:r><w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/></w:rPr><w:t xml:space="preserve">'+mark+' </w:t></w:r>');
    }
    xml=xml.slice(0,p.start)+raw+xml.slice(p.end);
  }
  files[part]=new TextEncoder().encode(xml);
  return zipSync(files,{level:6});
}

export function buildFirstPageEdits(xml, values, spec, {sax}) {
  const paragraphs=readParagraphs(xml,sax);
  const offset=spec.billing_same.paragraph-29;
  const edits=[];
  for(const [i,label] of [[18,'身份证号码'],[24,'E-MAIL']]){
    const paragraph=i+offset, p=paragraphs[paragraph], actual=p?.texts.join('').replace(/\s/g,'');
    if(actual==='*'+label)continue;
    if(actual!==label)throw new Error('必填栏标签位置不符。');
    const text=p.texts.findIndex(t=>t.trim());
    edits.push({part:'word/document.xml',paragraph,text,expected:p.texts[text],start:0,end:0,value:'*'});
  }
  if(values.payment_method==='collection'){
    const {paragraph,text}=spec.collection, expected=paragraphs[paragraph]?.texts[text];
    if(!/^托\s*收\s*银行账号[：:]\s*$/.test(expected||''))throw new Error('托收账号位置不符。');
    edits.push({part:'word/document.xml',paragraph,text,expected,start:expected.length,end:expected.length,value:' '+values.bank_account});
  }
  if(values.billing_mode==='other_address') {
    const paragraph=spec.billing_same.paragraph+1, p=paragraphs[paragraph];
    const original=p?.texts.join('') || '';
    if(!/^(?:其它|其他)\s*[:：]?\s*$/.test(original) || !p.texts.length)throw new Error('账单地址位置不明确。');
    const text=p.texts.length-1, expected=p.texts[text];
    const separator=/[:：]\s*$/.test(original)?' ':'：';
    edits.push({part:'word/document.xml',paragraph,text,expected,start:expected.length,end:expected.length,value:separator+values.billing_address});
  }
  for(const [index,key,label] of [[15,'install_zip','邮编'],[23,'job_title','经办人职务'],[27,'fax','传真'],[32,'billing_zip','邮编']]) {
    const value=values[key]; if(!value)continue;
    const p=paragraphs[index+offset], previous=paragraphs[index+offset-1];
    const actual=previous?.texts.join('').replace(/\s/g,'').replace(/\*/g,'');
    if(!p || !previous || !(actual===label || key==='job_title' && actual==='联系人职务') || p.texts.length)throw new Error('原表字段位置不符。');
    edits.push({part:'word/document.xml',paragraph:index+offset,kind:'emptyParagraph',expectedXml:p.raw,value,format:{font:'宋体',sizeHalfPoints:18,bold:false}});
  }
  const security=paragraphs.flatMap((p,i)=>p.texts.join('').includes('信息安全责任人如下')?[i+1]:[]);
  const responsible=paragraphs[security[0]];
  const row=responsible?.texts.join('');
  const match=row?.match(/^姓名：( +)，职务：( +)，联系方式：$/d);
  if(security.length!==1 || !match)throw new Error('信息安全责任人位置不明确。');
  const ranges=[...match.indices.slice(1),[row.length,row.length]];
  const keys=['security_name','security_role','security_phone'];
  for(let i=0;i<keys.length;i++){
    const [start,end]=ranges[i];
    let offset=0, count=0;
    responsible.texts.forEach((expected,text)=>{
      const next=offset+expected.length;
      if(start===end ? text===responsible.texts.length-1 : offset<end && next>start){
        edits.push({part:'word/document.xml',paragraph:security[0],text,expected,
          start:Math.max(0,start-offset),end:Math.min(expected.length,end-offset),value:count++===0?values[keys[i]]:''});
      }
      offset=next;
    });
    if(!count)throw new Error('信息安全责任人字段位置不符。');
  }
  const matches=paragraphs.map((p,i)=>({p,i})).filter(({p})=>/^经办人身份证号码\s*[:：]\s*$/.test(p.texts.join('')));
  if(matches.length!==1)throw new Error('经办人身份证号码位置不明确。');
  const {p,i}=matches[0], iIdentity=i, index=p.texts.length-1, original=p.texts[index];
  if(index<0)throw new Error('经办人身份证号码位置不明确。');
  edits.push({part:'word/document.xml',paragraph:i,text:index,expected:original,start:original.length,end:original.length,value:values.id_number});
  if(values.application_date) {
    const dates=paragraphs.map((p,i)=>({p,i})).filter(({p})=>/^日期\s*[:：]\s*年\s*月\s*日\s*$/.test(p.texts.join('')));
    // This is the date on the signature page immediately following the identity field.
    const date=dates.find(({i})=>i>iIdentity && i<iIdentity+20);
    if(!date || dates.filter(({i})=>i>iIdentity && i<iIdentity+20).length!==1)throw new Error('申请日期位置不明确。');
    const [year,month,day]=values.application_date.split('-');
    if(date.p.texts.length!==1)throw new Error('申请日期格式不受支持。');
    const dateText=date.p.texts[0], replacement=dateText.replace(/(日期\s*[:：])\s*年\s*月\s*日\s*$/,(_,prefix)=>prefix+year+'年'+Number(month)+'月'+Number(day)+'日');
    edits.push({part:'word/document.xml',paragraph:date.i,text:0,expected:dateText,start:0,end:dateText.length,value:replacement});
  }
  return edits;
}
