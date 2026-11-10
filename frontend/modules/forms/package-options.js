// Controls are shown only for a verified template that advertises the exact
// fields and speed options its Word renderer understands.
const speedLabels = {
  '200m_month':'200M · 100元/月', '200m_year':'200M · 1200元/年',
  '300m_month':'300M · 150元/月', '300m_year':'300M · 1800元/年',
  '500m_month':'500M · 200元/月', '500m_year':'500M · 2400元/年',
  '1000m_month':'1000M · 300元/月', '1000m_year':'1000M · 3600元/年'
};

const checks = [
  ['package_fttr','FTTR 全光网主设备'],
  ['package_disk','智企硬盘（以所选套餐版本为准）'],
  ['package_free_ext','免费全光网从设备 1 线'],
  ['package_plugin','上网行为管理插件']
];
const counts = [
  ['package_landline_count','固话线数',4], ['package_cloudphone_count','商云通线数',4],
  ['package_mobile_count','移动主卡线数',5], ['package_secondary_count','移动副卡线数',10],
  ['package_paid_ext_count','收费全光网从设备数量（29元/月/线，限时优惠至2026年12月31日）',999]
];

export function bindPackageOptions(form) {
  const root=form.querySelector('#package-options');
  const control=key=>root.querySelector('[name="'+key+'"]');
  let enabled=false, voiceTemplate=true;

  function update() {
    if (!enabled) return;
    const mode=control('package_line_type');
    root.querySelector('[data-package-line-status]').textContent=mode.value==='existing'?'在用宽带':'纯新装宽带';
    const existing=control('package_existing_number');
    const existingLabel=root.querySelector('[data-package-existing]');
    existingLabel.hidden=mode.value!=='existing';
    existing.disabled=mode.value!=='existing';
    existing.required=mode.value==='existing';
    existing.setCustomValidity(existing.required && !existing.value.trim()?'请填写在用宽带号码。':'');
    for (const [key] of counts) {
      const input=control(key), toggle=root.querySelector('[data-package-toggle="'+key+'"]');
      input.disabled=!toggle.checked;
      input.required=toggle.checked;
      input.closest('label').hidden=!toggle.checked;
      input.setCustomValidity('');
      if (toggle.checked && input.value && !/^[1-9]\d*$/.test(input.value)) input.setCustomValidity('请输入正整数。');
    }
    for (const [key] of checks) control(key).setCustomValidity('');
    const checked=key=>Boolean(control(key)?.checked);
    const selected=key=>Boolean(root.querySelector('[data-package-toggle="'+key+'"]')?.checked);
    const value=key=>selected(key)?Number(control(key).value)||0:0;
    const voiceSelected=['package_landline_count','package_cloudphone_count','package_mobile_count','package_secondary_count'].some(selected);
    root.querySelector('[data-package-voice-warning]').hidden=voiceTemplate!==false || !voiceSelected;
    const errors=[];
    function fail(key,message) {control(key).setCustomValidity(message);errors.push(message);}
    if (checked('package_free_ext')&&!checked('package_fttr')) fail('package_free_ext','免费从设备需先订购 FTTR 全光网主设备。');
    if (selected('package_paid_ext_count')&&!checked('package_fttr')) fail('package_paid_ext_count','收费从设备需先订购 FTTR 全光网主设备。');
    if (checked('package_plugin')&&!checked('package_free_ext')&&!selected('package_paid_ext_count'))
      fail('package_plugin','上网行为管理插件需同时订购从设备。');
    if (value('package_landline_count')+value('package_cloudphone_count')>4)
      fail('package_cloudphone_count','固话和商云通合计不能超过 4 线。');
    if (selected('package_secondary_count') && (!selected('package_mobile_count') || value('package_secondary_count')>2*value('package_mobile_count')))
      fail('package_secondary_count','副卡需订购主卡，且数量不能超过主卡数量的两倍。');
    root.querySelector('[data-package-errors]').textContent=errors.join(' ');
  }

  form.addEventListener('input',update);
  form.addEventListener('change',update);
  // An invalid control inside a closed details element cannot receive focus.
  form.addEventListener('invalid',event=>{
    if (enabled && root.contains(event.target)) {
      let details=event.target.closest('details');
      while(details && root.contains(details)) { details.open=true; details=details.parentElement.closest('details'); }
    }
  },true);

  return {
    choose(metadata) {
      enabled=Boolean(metadata && Array.isArray(metadata.fields) && Array.isArray(metadata.speed));
      voiceTemplate=metadata?.voice;
      root.hidden=!enabled;
      root.replaceChildren();
      if(!enabled)return;
      const speed=metadata.speed.filter(key=>Object.hasOwn(speedLabels,key));
      const checkbox=([key,label])=>'<label class="package-check"><input type="checkbox" name="'+key+'" value="1"><span>'+label+'</span></label>';
      const count=([key,label,max])=>'<div class="package-count"><label class="package-check"><input type="checkbox" data-package-toggle="'+key+'"><span>订购'+label.replace(/线数|数量/,'')+'</span></label>'+
        '<label data-package-count-label hidden>'+label+'<input type="number" name="'+key+'" min="1" max="'+max+'" step="1" inputmode="numeric" disabled></label></div>';
      root.innerHTML='<h3>套餐办理方式</h3><p>办理方式：<span data-package-line-status>纯新装宽带</span></p>'+
        '<p class="hint">只勾选客户确认的业务；未勾选的项目不订购。涉及数量的项目需填写实际数量。</p>'+
        '<details class="package-details"><summary>1、基础套餐申请信息</summary>'+
        '<details><summary>修改办理方式</summary><div class="field-grid">'+
        '<label>办理方式<select name="package_line_type"><option value="new">纯新装宽带</option><option value="existing">在用宽带</option></select></label>'+
        '<label data-package-existing hidden>在用宽带号码<input name="package_existing_number" maxlength="40" pattern="(?:[A-Za-z0-9]|-){1,40}" title="请输入1至40位英文字母、数字或连字符" autocomplete="off" disabled></label></div></details>'+
        '<div class="package-list">'+checks.slice(0,2).map(checkbox).join('')+'</div></details>'+
        '<details class="package-details"><summary>2、增值免费可选包</summary><div class="package-list">'+
        checks.slice(2).map(checkbox).join('')+counts.slice(0,4).map(count).join('')+'</div></details>'+
        '<details class="package-details"><summary>3、收费可选包</summary><p class="hint">收费从设备优惠截止后，请核实实际资费。</p><div class="package-list">'+
        count(counts[4])+'<label>收费上行升速包<select name="package_speed"><option value="">不订购</option>'+speed.map(key=>'<option value="'+key+'">'+speedLabels[key]+'</option>').join('')+'</select></label></div></details>'+
        '<p class="hint" data-package-errors aria-live="polite"></p>'+
        '<p class="notice slim" data-package-voice-warning aria-live="polite" hidden>已选择语音或移动业务，当前是不带语音模板；请核对模板、授权书、实名资料及手续材料。</p>';
      update();
    },
    update
  };
}
