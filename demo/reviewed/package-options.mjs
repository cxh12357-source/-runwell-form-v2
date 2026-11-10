// Explicit choices for the individually verified 100M and 200M package forms.
// The caller must verify the complete original-document hash before editing.
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const packageFields = Object.freeze([
  'package_line_type','package_existing_number','package_fttr','package_disk','package_free_ext','package_plugin',
  'package_landline_count','package_cloudphone_count','package_mobile_count','package_secondary_count',
  'package_paid_ext_count','package_speed'
]);
// These six originals are embedded in the demo and were individually checked.
// Other imported variants remain on the existing manual-review path until their
// own source documents and option labels have been verified.
const verifiedIds=new Set([
  'business-100m-no-voice','business-100m-discount-no-voice','business-100m-voice',
  'business-200m-no-voice','business-200m-discount-no-voice','business-200m-voice'
]);

export function packageOptions(id) {
  const match=/^business-(100m|200m)(?:-discount)?-(?:no-voice|voice)$/.exec(id);
  if(!match || !verifiedIds.has(id))return null;
  const speeds=match[1]==='100m'?['200m','300m','500m']:['300m','500m','1000m'];
  return {fields:[...packageFields],speed:speeds.flatMap(speed=>[speed+'_month',speed+'_year']),voice:!id.endsWith('-no-voice')};
}

function valuesFor(id, values) {
  const spec=packageOptions(id);
  if(!spec)throw new Error('该套餐版式尚未核对可选业务。');
  const get=key=>typeof values[key]==='string'?values[key].trim():'';
  const line=get('package_line_type') || 'new';
  if(!['new','existing'].includes(line))throw new Error('请选择有效的套餐类型。');
  const number=get('package_existing_number');
  if(line==='existing' && !/^[a-z\d-]{1,40}$/i.test(number))throw new Error('请填写有效的在用宽带号码。');
  const flags={};
  for(const key of ['package_fttr','package_disk','package_free_ext','package_plugin']){
    const value=get(key);
    if(value && value!=='1')throw new Error('请核对套餐业务选项。');
    flags[key]=value==='1';
  }
  const counts={};
  for(const key of ['package_landline_count','package_cloudphone_count','package_mobile_count','package_secondary_count','package_paid_ext_count']){
    const value=get(key);
    if(value && !/^[1-9]\d{0,3}$/.test(value))throw new Error('业务数量应填写正整数。');
    counts[key]=value?Number(value):0;
  }
  if(counts.package_landline_count+counts.package_cloudphone_count>4)throw new Error('固话和商云通合计最多4线。');
  if(counts.package_mobile_count>5)throw new Error('移动主卡最多5线。');
  if(counts.package_secondary_count>counts.package_mobile_count*2)throw new Error('副卡数量不能超过主卡数量的两倍。');
  if((flags.package_free_ext || counts.package_paid_ext_count) && !flags.package_fttr)throw new Error('订购从设备前请先选择FTTR全光网。');
  if(flags.package_plugin && !(flags.package_free_ext || counts.package_paid_ext_count))throw new Error('上网行为管理插件须同时订购全光网从设备。');
  const speed=get('package_speed');
  if(speed && !spec.speed.includes(speed))throw new Error('所选上行升速包不适用于当前套餐。');
  return {line,number,flags,counts,speed};
}

function readParagraphs(xml,sax) {
  const parser=sax.parser(true,{xmlns:true,strictEntities:true,position:true}), stack=[], paragraphs=[];
  let current=null, text=null;
  parser.onopentag=node=>{
    if(node.uri===W && node.local==='p') {if(current)throw new Error('原表段落结构无效。');current={texts:[]};}
    if(current && node.uri===W && node.local==='t') {if(text!==null)throw new Error('原表文字结构无效。');text='';}
    stack.push(node.uri===W?node.local:'');
  };
  parser.ontext=value=>{if(text!==null)text+=value;};
  parser.onclosetag=()=>{
    const name=stack.pop();
    if(name==='t' && current){current.texts.push(text);text=null;}
    if(name==='p' && current){paragraphs.push(current);current=null;}
  };
  parser.write(xml).close();
  return paragraphs;
}

/** Locate every checkbox/blank by its unique visible label and replace only
 * checked boxes or entered values. Hash verification happens in the caller. */
export function buildPackageEdits(id,bytes,values,{unzipSync,sax}) {
  const selected=valuesFor(id,values);
  const body=unzipSync(bytes)['word/document.xml'];
  if(!body)throw new Error('原表正文缺失。');
  const paragraphs=readParagraphs(new TextDecoder('utf-8',{fatal:true}).decode(body),sax);
  const entries=paragraphs.map((p,index)=>({index,text:p.texts.join(''),texts:p.texts}));
  const find=predicate=>{
    const matches=entries.filter(({text})=>predicate(text.replace(/\s/g,'')));
    if(matches.length!==1)throw new Error('套餐选项在此原表中无法唯一定位。');
    return matches[0];
  };
  const edits=[];
  function replaceRange(p,start,end,value) {
    let offset=0, changed=0;
    p.texts.forEach((expected,text)=>{
      const next=offset+expected.length;
      if(offset<end && next>start){
        edits.push({part:'word/document.xml',paragraph:p.index,text,expected,start:Math.max(0,start-offset),
          end:Math.min(expected.length,end-offset),value:changed++===0?value:''});
      }
      offset=next;
    });
    if(!changed)throw new Error('套餐内容的位置不明确。');
  }
  function mark(p,index=0) {
    const boxes=[...p.text.matchAll(/□/g)];
    if(!boxes[index])throw new Error('套餐复选框位置不明确。');
    replaceRange(p,boxes[index].index,boxes[index].index+1,'■');
  }
  function fillBlank(p,value) {
    const matches=[...p.text.matchAll(/_+/g)];
    if(matches.length!==1)throw new Error('套餐数量或号码位置不明确。');
    const blank=matches[0];replaceRange(p,blank.index,blank.index+blank[0].length,String(value));
  }
  const line=find(text=>/^□纯新装宽带□在用宽带（号码_+）$/.test(text));
  mark(line,selected.line==='new'?0:1);
  if(selected.line==='existing')fillBlank(line,selected.number);
  const actions=[
    ['package_fttr',text=>/^□FTTR全光网：含主设备一台$/.test(text)],
    ['package_disk',text=>/^□开通权限：(?:20人，云盘空间1TB|50人，云盘空间2TB)；数量1线$/.test(text)],
    ['package_free_ext',text=>/^□订购数量1线，限基础套餐订购FTTR全光网的用户订购。$/.test(text)],
    ['package_plugin',text=>/^插件服务：□上网行为管理插件$/.test(text)]
  ];
  for(const [key,predicate] of actions)if(selected.flags[key])mark(find(predicate));
  const counted=[
    ['package_landline_count',text=>/^□固话，申请线数：_+线$/.test(text)],
    ['package_cloudphone_count',text=>/^□商云通（需自备商云通话机），申请线数：_+线$/.test(text)],
    ['package_mobile_count',text=>/^□订购，申请主卡线数：_+线（最多限5线）$/.test(text)],
    ['package_secondary_count',text=>/^□是否订购副卡（每张主卡最多可订购2线）数量：_+$/.test(text)]
  ];
  for(const [key,predicate] of counted)if(selected.counts[key]){
    const p=find(predicate);mark(p);fillBlank(p,selected.counts[key]);
  }
  if(selected.counts.package_paid_ext_count){
    mark(find(text=>/^□29元\/月\/线（限时优惠至2026年12月31日）$/.test(text)));
    fillBlank(find(text=>/^订购数量：_+，限基础套餐订购FTTR全光网的用户订购。$/.test(text)),selected.counts.package_paid_ext_count);
  }
  if(selected.speed){
    const [speed,cycle]=selected.speed.split('_');
    const size=speed.slice(0,-1);
    const p=find(text=>text.startsWith('上行升速'+size+'M：□') && /元\/月□\d+元\/年$/.test(text));
    mark(p,cycle==='month'?0:1);
  }
  return edits;
}
