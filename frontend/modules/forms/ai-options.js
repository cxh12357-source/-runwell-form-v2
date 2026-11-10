// Controls correspond to fields on the hash-verified AI Word templates only.
const check=(key,label)=>'<label class="ai-check"><input type="checkbox" name="'+key+'" value="1"><span>'+label+'</span></label>';
const text=(key,label,type='text',extra='')=>'<label>'+label+'<input name="'+key+'" type="'+type+'" maxlength="100" autocomplete="off" '+extra+'></label>';
const quantity=(key,label,max=9999)=>text(key,label,'number','min="1" max="'+max+'" step="1" inputmode="numeric"');
const section=(key,content)=>'<fieldset data-ai-section="'+key+'" hidden disabled><div class="field-grid">'+content+'</div></fieldset>';
export function renderAiOptions(meta) {
  if(!meta || !['v1','v2'].includes(meta.version))return '';
  const base='<div class="divider"></div><h3>选择套餐业务</h3><p class="hint">按客户确认的内容勾选；未勾选的项目不会写入 Word。带费用的项目请核对资费。</p>'+
    '<div class="field-grid"><label>开通类型<select name="ai_line_type"><option value="new">纯新装宽带</option><option value="existing">在用宽带</option></select></label>'+
    quantity('ai_line_count','* 申请线数',9999)+'</div>'+
    section('existing',text('ai_existing_line','* 在用宽带号码'))+
    '<p>基础套餐中需要开通的业务</p><div class="field-grid">'+check('ai_disk','智企硬盘黄金版（20人、1TB、1线）')+
    check('ai_cloud','天翼云电脑（Token电表版）1线')+check('ai_token','Token电表软件 License（须开通云电脑）')+check('ai_sase','云脉SASE VPN版1套')+'</div>'+
    section('cloud', '<label>* CTYUN 账号类型<select name="ai_ctyun_mode"><option value="">请选择</option><option value="new">新增</option><option value="existing">存量</option></select></label>'+
      text('ai_ctyun_account','* CTYUN账号（邮箱）','email')+text('ai_bizid','BIZID（存量必填）')+
      text('ai_vpc','VPC网段（原表默认 172.16.0.0/16）')+text('ai_subnet','子网网段（原表默认 172.16.0.0/20）'))+
    '<details data-ai-admin hidden><summary>企业IT管理员资料（订购云脉SASE时填写）</summary>'+section('admin',text('ai_it_name','企业IT管理员姓名')+text('ai_it_phone','企业IT管理员电话','tel')+text('ai_it_email','企业IT管理员邮箱','email'))+'</details>';
  const additional=meta.version!=='v2'?'':
    '<p>增值免费可选包</p><div class="field-grid">'+check('ai_fixed','固话（与商云通合计最多4线）')+check('ai_business','商云通（与固话合计最多4线）')+
    check('ai_mobile','移动主卡（最多5线）')+check('ai_switchboard','云总机（需已有固话或商云通号码）')+'</div>'+
    section('fixed',quantity('ai_fixed_count','* 固话申请线数',4))+
    section('business',quantity('ai_business_count','* 商云通申请线数',4))+
    section('mobile',quantity('ai_mobile_count','* 主卡申请线数',5)+check('ai_sub','订购副卡（每张主卡最多2线）'))+
    section('sub',quantity('ai_sub_count','* 副卡数量',10))+
    section('switchboard',text('ai_switchboard_number','* 固定电话或商云通号码'))+
    '<p>Token 增值收费可选包</p><div class="field-grid"><label>可选包（互斥，每次1000元）<select name="ai_coupon"><option value="">不订购</option><option value="service1">服务1：1000元等值Token</option><option value="service2">服务2：400元等值Token及爱办公青春版</option></select></label></div>'+
    section('coupon',quantity('ai_coupon_count','* Token可选包订购数量'))+
    section('color','<label>* 爱办公青春版颜色<select name="ai_coupon_color"><option value="">请选择</option><option value="silver">银色</option><option value="purple">紫色</option></select></label>');
  return '<section id="ai-package-options">'+base+additional+
    '<p>增值收费可选包</p><div class="field-grid">'+check('ai_paid_device','商企全光网从设备（29元/月/线，优惠至2027年12月31日，请核实）')+'</div>'+
    section('paid',quantity('ai_paid_device_count','* 收费从设备数量'))+'</section>';
}
export function bindAiOptions(form) {
  const panel=form.querySelector('#ai-package-options');if(!panel)return;
  const field=k=>form.elements.namedItem(k);
  const selected=k=>Boolean(field(k)?.checked);
  function show(key,on) {
    const node=panel.querySelector('[data-ai-section="'+key+'"]');if(!node)return;
    node.hidden=node.disabled=!on;
  }
  function update() {
    const cloud=selected('ai_cloud'),sase=selected('ai_sase');
    const admin=panel.querySelector('[data-ai-admin]');
    admin.hidden=!sase;
    if(sase)admin.open=true;
    show('admin',sase);
    show('existing',field('ai_line_type').value==='existing');show('cloud',cloud);
    show('fixed',selected('ai_fixed'));show('business',selected('ai_business'));show('mobile',selected('ai_mobile'));
    show('sub',selected('ai_mobile')&&selected('ai_sub'));show('switchboard',selected('ai_switchboard'));
    show('coupon',Boolean(field('ai_coupon')?.value));show('color',field('ai_coupon')?.value==='service2');show('paid',selected('ai_paid_device'));
    for(const [key,on] of [['ai_line_count',true],['ai_existing_line',field('ai_line_type').value==='existing'],
      ['ai_ctyun_mode',cloud],['ai_ctyun_account',cloud],['ai_bizid',cloud && field('ai_ctyun_mode')?.value==='existing'],
      ['ai_it_name',sase],['ai_it_phone',sase],['ai_it_email',sase],
      ['ai_fixed_count',selected('ai_fixed')],['ai_business_count',selected('ai_business')],['ai_mobile_count',selected('ai_mobile')],
      ['ai_sub_count',selected('ai_mobile')&&selected('ai_sub')],['ai_switchboard_number',selected('ai_switchboard')],
      ['ai_coupon_count',Boolean(field('ai_coupon')?.value)],['ai_coupon_color',field('ai_coupon')?.value==='service2'],['ai_paid_device_count',selected('ai_paid_device')]]) {
      const el=field(key);if(el)el.required=on;
    }
  }
  panel.addEventListener('change',update);
  // Native validation must be able to focus an invalid administrator field
  // even if the user has collapsed the details section.
  panel.addEventListener('invalid',event=>{
    const details=event.target.closest('details');
    if(details && panel.contains(details))details.open=true;
  },true);
  update();
}
