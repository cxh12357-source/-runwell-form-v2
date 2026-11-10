// Verified option mappings for the two AI templates included in the demo.
// Unknown templates keep the existing manual-review path.
const common = ['ai_line_type','ai_existing_line','ai_line_count','ai_disk','ai_cloud','ai_token','ai_sase',
  'ai_ctyun_mode','ai_ctyun_account','ai_bizid','ai_vpc','ai_subnet','ai_it_name','ai_it_phone','ai_it_email',
  'ai_paid_device','ai_paid_device_count'];
const extended = ['ai_fixed','ai_fixed_count','ai_business','ai_business_count','ai_mobile','ai_mobile_count',
  'ai_sub','ai_sub_count','ai_switchboard','ai_switchboard_number','ai_coupon','ai_coupon_count','ai_coupon_color'];
const versions = {'business-ai-v1':'v1','business-ai-v2-no-voice':'v2'};
export function aiOptionsMetadata(id) {
  const version=versions[id];
  return version ? {version,fields:[...common,...(version==='v2'?extended:[])]} : null;
}

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const commonParagraphs={
  44:'6880元/年/线，申请线数：_____线',
  46:'□ 纯新装宽带    □ 在用宽带（号码________________）',
  52:'□ 开通权限：20人 ，云盘空间1TB ； 数量1线',
  54:'□含天翼云电脑云办公产品一线',
  59:'*CTYUN账号：___________________（xxxxxxx@XXX.XX）□ 新增  □ 存量',
  60:'*BIZID：______________________（ACMB或者22开头的编号，新开户可忽略，存量必填）',
  61:'VPC网段（默认172.16.0.0/16，有需要可修改，后续无法再修改）：______________________',
  62:'子网网段（默认172.16.0.0/20，有需要可修改，后续无法再修改）：_____________________',
  64:'□Token电表软件License ：含1个Token电表实例，服务期与套餐协议期一致',
  67:'□ 用于内网接入的云脉SASE VPN版1套（含10个零信任账号）',
  68:'企业IT管理员姓名：______________      电话：__________________',
  69:'企业IT管理员邮箱(用于收取业务账号激活邮件)：____________________________'
};
const versionParagraphs={
 v1:{72:'□ 29元/月/线（限时优惠至2027年12月31日）',73:'订购数量：______，限基础套餐订购FTTR全光网的用户订购。'},
 v2:{76:'□ 固话，申请线数：_____线',77:'□ 商云通（需自备商云通话机），申请线数：_____线',
   83:'□ 订购，申请主卡线数：______线（最多限5线）',89:'□ 是否订购副卡（每张主卡最多可订购2线） 数量：_________',
   93:'□固定电话/商云通号码：______________________',99:'□ 1000元/次，订购数量：______',103:'□ 1000元/次，订购数量：______',
   105:'爱办公青春版：包含32G本地存储+5G云空间，并含三年服务，即每月1000分钟转写时长（从设备激活之日起计算）。可选颜色   □银色  口紫色',
   107:'□ 29元/月/线（限时优惠至2027年12月31日）',108:'订购数量：______，限基础套餐订购FTTR全光网的用户订购。'}
};

function fail(message){throw new Error(message);}
function clean(value,label,max=100) {
  if(value===undefined || value===null)return '';
  if(typeof value!=='string')fail('请核对'+label+'。');
  const s=value.trim();
  if(s.length>max || !s.isWellFormed() || /[\x00-\x1f\x7f\ufffe\uffff]/u.test(s))fail('请核对'+label+'。');
  return s;
}
function positive(value,label,max=9999) {
  const s=clean(value,label,5);
  if(s && (!/^[1-9]\d*$/.test(s) || Number(s)>max))fail(label+'请填写 1 至 '+max+' 的整数。');
  return s;
}
function flag(value,label) {
  const s=clean(value,label,1);
  if(!['','1'].includes(s))fail('请核对'+label+'。');
  return s==='1';
}
function cidr(value,label) {
  const s=clean(value,label,40);
  if(s && !/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(s))fail(label+'格式应为 IP/掩码位数。');
  if(s) {const [ip,n]=s.split('/');if(ip.split('.').some(x=>Number(x)>255) || Number(n)>32)fail('请核对'+label+'。');}
  return s;
}

export function validateAiOptions(id,raw={}) {
  const meta=aiOptionsMetadata(id); if(!meta)return null;
  if(!raw || typeof raw!=='object' || Array.isArray(raw))fail('业务选项无效。');
  const v={};
  for(const field of meta.fields)v[field]=clean(raw[field],field);
  v.ai_line_type ||= 'new';
  if(!['new','existing'].includes(v.ai_line_type))fail('请选择开通类型。');
  if(v.ai_line_type==='existing' && !v.ai_existing_line)fail('在用宽带需要填写号码。');
  if(v.ai_line_type==='new' && v.ai_existing_line)fail('纯新装宽带不能填写在用宽带号码。');
  v.ai_line_count=positive(v.ai_line_count,'申请线数');
  for(const [k,label] of [['ai_disk','智企硬盘'],['ai_cloud','天翼云电脑'],['ai_token','Token电表'],['ai_sase','云脉SASE'],['ai_paid_device','收费从设备']]) v[k]=flag(v[k],label);
  if(v.ai_token&&!v.ai_cloud)fail('Token电表须先订购天翼云电脑。');
  if(v.ai_cloud) {
    if(!v.ai_ctyun_account || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.ai_ctyun_account))fail('请填写有效的 CTYUN 账号邮箱。');
    if(!['new','existing'].includes(v.ai_ctyun_mode))fail('请选择 CTYUN 账号新增或存量。');
    if(v.ai_ctyun_mode==='existing' && !v.ai_bizid)fail('存量账号需要填写 BIZID。');
  } else if(['ai_ctyun_account','ai_ctyun_mode','ai_bizid','ai_vpc','ai_subnet'].some(k=>v[k]))fail('未勾选云电脑，不应填写云电脑资料。');
  v.ai_vpc=cidr(v.ai_vpc,'VPC网段'); v.ai_subnet=cidr(v.ai_subnet,'子网网段');
  if(!v.ai_sase && ['ai_it_name','ai_it_phone','ai_it_email'].some(k=>v[k]))fail('未订购云脉SASE，不应提交企业IT管理员资料。');
  if(v.ai_it_phone && !/^1\d{10}$/.test(v.ai_it_phone))fail('请核对企业IT管理员手机号。');
  if(v.ai_it_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.ai_it_email))fail('请核对企业IT管理员邮箱。');
  if(v.ai_sase && (!v.ai_it_name || !v.ai_it_phone || !v.ai_it_email))fail('订购云脉SASE时请填写企业IT管理员姓名、电话和邮箱。');
  v.ai_paid_device_count=positive(v.ai_paid_device_count,'收费从设备数量');
  if(v.ai_paid_device!==Boolean(v.ai_paid_device_count))fail('勾选收费从设备后请填写数量；未勾选时请清空数量。');
  if(meta.version==='v2') {
    for(const [flagKey,countKey,label,max] of [['ai_fixed','ai_fixed_count','固话线数',4],['ai_business','ai_business_count','商云通线数',4],
      ['ai_mobile','ai_mobile_count','移动主卡线数',5],['ai_sub','ai_sub_count','副卡数量',10]]) {
      v[flagKey]=flag(v[flagKey],label);v[countKey]=positive(v[countKey],label,max);
      if(v[flagKey]!==Boolean(v[countKey]))fail('勾选'+label.replace(/线数|数量/,'')+'后请填写数量；未勾选时请清空数量。');
    }
    if(Number(v.ai_fixed_count||0)+Number(v.ai_business_count||0)>4)fail('固话和商云通合计不能超过4线。');
    if(v.ai_sub && (!v.ai_mobile || Number(v.ai_sub_count)>2*Number(v.ai_mobile_count)))fail('副卡数量不能超过主卡数量的两倍。');
    v.ai_switchboard=flag(v.ai_switchboard,'云总机');
    if(v.ai_switchboard!==Boolean(v.ai_switchboard_number))fail('勾选云总机后请填写固定电话或商云通号码。');
    if(!['','service1','service2'].includes(v.ai_coupon))fail('请选择有效的 Token 可选包。');
    v.ai_coupon_count=positive(v.ai_coupon_count,'Token可选包数量');
    if(Boolean(v.ai_coupon)!==Boolean(v.ai_coupon_count))fail('订购 Token 可选包后请填写数量。');
    if(v.ai_coupon && !v.ai_token)fail('Token 可选包需要先订购 Token 电表。');
    if(v.ai_coupon==='service2' && !['silver','purple'].includes(v.ai_coupon_color))fail('请选择爱办公青春版颜色。');
    if(v.ai_coupon!=='service2' && v.ai_coupon_color)fail('未订购爱办公青春版时不能选择颜色。');
  }
  return v;
}

function paragraphTexts(xml,sax,wanted) {
  const parser=sax.parser(true,{xmlns:true,strictEntities:true});
  const result=new Map(), stack=[];let p=-1, current=null, inText=false;
  parser.onopentag=n=>{
    if(n.uri===W && n.local==='p'){p++;current=wanted.has(p)?[]:null;}
    if(current && n.uri===W && n.local==='t'){current.push('');inText=true;}
    stack.push(n.uri===W?n.local:'');
  };
  parser.ontext=t=>{if(current && inText)current[current.length-1]+=t;};
  parser.onclosetag=()=>{const name=stack.pop();if(name==='t')inText=false;if(name==='p'&&current){result.set(p,current);current=null;}};
  parser.write(xml).close();return result;
}

// Return source-anchored edits. A range can cross w:t nodes (common for quantity blanks).
export function buildAiOptionEdits(id,xml,raw,dependencies) {
  const meta=aiOptionsMetadata(id);if(!meta)return {edits:[],hasLineCount:false,supported:false};
  const v=validateAiOptions(id,raw);
  const expected={...commonParagraphs,...versionParagraphs[meta.version]};
  const paragraphs=paragraphTexts(xml,dependencies.sax,new Set(Object.keys(expected).map(Number)));
  for(const [index,text] of Object.entries(expected))if(paragraphs.get(Number(index))?.join('')!==text)fail('AI 套餐选项位置不符，请核对原表。');
  const edits=[];
  function change(index,needle,value,occurrence=0) {
    const texts=paragraphs.get(index), joined=texts.join('');let start=-1,from=0;
    for(let i=0;i<=occurrence;i++){start=joined.indexOf(needle,from);if(start<0)fail('AI 套餐选项位置不符，请核对原表。');from=start+needle.length;}
    const end=start+needle.length;let offset=0,inserted=false;
    texts.forEach((text,i)=>{const begin=Math.max(start,offset),finish=Math.min(end,offset+text.length);
      if(begin<finish){edits.push({part:'word/document.xml',paragraph:index,text:i,expected:text,start:begin-offset,end:finish-offset,value:inserted?'':value});inserted=true;}offset+=text.length;});
    if(!inserted)fail('AI 套餐选项位置不符，请核对原表。');
  }
  if(v.ai_line_count)change(44,'_____',v.ai_line_count);
  change(46,'□','■',v.ai_line_type==='new'?0:1);
  if(v.ai_line_type==='existing')change(46,'________________',v.ai_existing_line);
  if(v.ai_disk)change(52,'□','■');
  if(v.ai_cloud) {
    change(54,'□','■');change(59,'___________________',v.ai_ctyun_account);
    change(59,'□','■',v.ai_ctyun_mode==='new'?0:1);
    if(v.ai_bizid)change(60,'______________________',v.ai_bizid);
    if(v.ai_vpc)change(61,'______________________',v.ai_vpc);
    if(v.ai_subnet)change(62,'_____________________',v.ai_subnet);
  }
  if(v.ai_token)change(64,'□','■');
  if(v.ai_sase)change(67,'□','■');
  if(v.ai_sase){
    change(68,'______________',v.ai_it_name);
    change(68,'__________________',v.ai_it_phone);
    change(69,'____________________________',v.ai_it_email);
  }
  const paidBox=meta.version==='v1'?72:107, paidCount=meta.version==='v1'?73:108;
  if(v.ai_paid_device){change(paidBox,'□','■');change(paidCount,'______',v.ai_paid_device_count);}
  if(meta.version==='v2') {
    for(const [key,num,p,count] of [['ai_fixed','ai_fixed_count',76,'_____'],['ai_business','ai_business_count',77,'_____'],
      ['ai_mobile','ai_mobile_count',83,'______'],['ai_sub','ai_sub_count',89,'_________']])if(v[key]){change(p,'□','■');change(p,count,v[num]);}
    if(v.ai_switchboard){change(93,'□','■');change(93,'______________________',v.ai_switchboard_number);}
    if(v.ai_coupon){const p=v.ai_coupon==='service1'?99:103;change(p,'□','■');change(p,'______',v.ai_coupon_count);
      if(v.ai_coupon==='service2')change(105,v.ai_coupon_color==='silver'?'□':'口','■');}
  }
  return {edits,hasLineCount:Boolean(v.ai_line_count),supported:true};
}
