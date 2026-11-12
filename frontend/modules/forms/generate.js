import { escape as esc } from '../../lib/api.js';
import { copyTextArea, downloadControl, options, request, status } from './shared.js';
import { classifyTariff, businessFields, businessSelectors, bindBusinessSelection } from './business-selection.js';

import { businessText } from './intake-rules.js';
import { bindIntake, intakePanel, lookupPanel, internalPanel, intakeExtraKeys } from './intake.js';
import { bindDefaults } from './defaults.js';
import { bindPackageOptions } from './package-options.js';
import { renderAiOptions, bindAiOptions } from './ai-options.js';
import { bindDisclosure } from './disclosure.js';

const customerFields = ['company_name','install_address','billing_address','contact_name','phone','id_number','email'];
const defaultFieldKeys = new Set(['install_zip','billing_zip','job_title','fax','security_name',
  'security_role','security_phone','service_use','application_date']);
const hiddenDefaultKeys = new Set(['install_zip','job_title','fax','application_date']);
const linkedSecurityFields = new Set(['security_name','security_phone']);
function field(name, title, type = 'text') {
  return '<label>' + esc(title) + '<input name="' + esc(name) + '" type="' + type + '" required maxlength="500" autocomplete="off"></label>';
}
export function generationShell(content) {
  return '<form id="generate-form">' + businessSelectors() +
    '<button class="button" type="button" id="match">匹配模板</button><div id="match-result"></div><div id="ai-options"></div>' + content +
    '<p id="generate-hint" class="hint">请先在上方选好业务和所需条件，再匹配一份已启用的模板。</p><button id="generate" class="button" aria-describedby="generate-hint" disabled>确认生成 Word</button></form><div id="generated"></div>';
}

export function generatedMaterials(tariff, voiceTemplateReview = false) {
  if(tariff?.business_id!=='business-line' || tariff.business_attribute!=='new')return '';
  if(voiceTemplateReview)return '<p class="hint">已选择语音或移动业务，当前是不带语音模板。请人工核对适用模板、授权书、带语音实名资料及手续材料后再提供给客户。</p>';
  const {blank,voice}=classifyTariff(tariff);
  if(blank)return '';
  if(voice==='unknown' || typeof tariff.voice_required!=='boolean')
    return '<p class="hint">该模板未确认是否带语音，请先核对 Word 和实际办理业务，再提供手续材料清单。</p>';
  const text=businessText[voice==='yes'?'voice':'no_voice'].materials;
  return '<section class="generated-materials"><div class="divider"></div><label>手续材料提示'+
    '<textarea id="generated-material-text" rows="8" readonly>'+esc(text)+'</textarea></label>'+
    '<button type="button" id="copy-generated-materials">复制手续材料提示</button>'+
    '<p id="generated-material-feedback" aria-live="polite"></p></section>';
}

export function generation(labels) {
  return generationShell('<fieldset id="application-fields" class="application-fields">' + intakePanel() + lookupPanel() +
    '<div class="divider"></div><div class="profile-heading"><h3>查看/修改资料</h3><button id="edit-profile" type="button">查看/修改资料</button></div>' +
    '<details id="customer-fields" class="profile-section"><summary>客户资料</summary>' +
    '<button id="fill-example" type="button">用虚构样例补全空白栏</button><div class="field-grid">' +
    customerFields.map(key => {
      if (key === 'billing_address') return '<label>账单地址方式<select name="billing_address_mode"><option value="same">与安装地址相同</option><option value="different">不同，单独填写</option></select></label>' +
        '<label id="billing-address-field" hidden>* 账单地址<input name="billing_address" required maxlength="500" autocomplete="off"></label>';
      return field(key, '* ' + (key === 'id_number' ? '身份证号码' : key === 'email' ? 'E-MAIL' : labels[key]), key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text');
    }).join('') +
    '<label>* 付款方式<select name="payment_method" required><option value="">请选择</option><option value="cash">现金</option><option value="collection">托收</option></select></label></div>' +
    '<p class="hint">账单地址默认与安装地址相同。</p>' +
    '<fieldset hidden id="bank-fields" disabled><div class="field-grid">' + field('bank_account', labels.bank_account) +
    field('bank_name', labels.bank_name) + '</div></fieldset></details>' + internalPanel() + '</fieldset>' +
    '<section id="missing-profile" class="notice slim" hidden><h3>请补充以下信息</h3>' +
    '<p class="hint" id="profile-missing-summary" aria-live="polite"></p><div id="missing-profile-fields" class="field-grid"></div>' +
    '<div id="missing-defaults" hidden><div id="missing-default-fields" class="field-grid"></div></div></section>' +
    '<div id="extra" class="field-grid"></div>' +
    '<section id="package-options" hidden></section>' +
    '<details id="default-settings" hidden><summary>修改默认信息</summary>' +
    '<p class="hint">信息安全责任人的姓名和联系方式默认与经办人相同，职务默认 IT，可按实际情况修改。</p>' +
    '<div id="default-fields" class="field-grid"><label id="applicant-role-field" hidden>申请人职务<input name="applicant_role" maxlength="200" autocomplete="off"></label></div></details>');
}

export function bindGeneration(root, state) {
  const form = root.querySelector('#generate-form');
  const selected = bindBusinessSelection(form, state);
  const defaults = bindDefaults(form);
  const packageOptions = bindPackageOptions(form);
  const intake = bindIntake(form, defaults);
  defaults.sync();
  const result = root.querySelector('#match-result');
  const extra = root.querySelector('#extra');
  const aiOptions = root.querySelector('#ai-options');
  const missingDefaults = root.querySelector('#missing-defaults');
  const missingFields = root.querySelector('#missing-default-fields');
  const defaultSettings = root.querySelector('#default-settings');
  const defaultFields = root.querySelector('#default-fields');
  const applicantRole = form.elements.namedItem('applicant_role');
  const applicantRoleLabel = root.querySelector('#applicant-role-field');
  const generate = root.querySelector('#generate');
  const generated = root.querySelector('#generated');
  const hint = root.querySelector('#generate-hint');
  const bank = root.querySelector('#bank-fields');
  const application = form.querySelector('#application-fields');
  let disclosure;
  const reviewLabels={billing_address:'其他账单地址',bank_name:'开户银行',authorization:'授权委托书',authorization_employee:'授权委托书受托员工姓名和身份证号码',authorization_service_type:'授权书中商云通业务类型',voice_identity:'语音实名资料（如适用）',voice_template:'已选择语音或移动业务，请核对是否需要带语音模板和手续材料',
    discount_factor:'折数及折后资费',line_count:'线路数量',service_options:'业务选项',delegate_information:'委托代办信息（如适用）',signature:'签字盖章',guarantee_signature:'签字盖章',
    guarantee_number:'电信业务号码',guarantee_date:'担保日期'};
  let epoch = 0, candidates = [], template = null, matchToken, requestId, busy = false, authorizationTypeEdited = false;

  function updateDefaultFields() {
    applicantRoleLabel.hidden = true;
    applicantRole.required = false;
    applicantRole.setCustomValidity('');

    const fields = [applicantRoleLabel, ...form.querySelectorAll('[data-default-field]')];
    for (const label of fields) {
      const input = label.querySelector('input');
      const key = input.name;
      if (key !== 'applicant_role') {
        if (hiddenDefaultKeys.has(key)) label.hidden = true;
        const linked = linkedSecurityFields.has(key) && defaults.isLinked(key);
        input.required = input.dataset.templateRequired === 'true' && !linked && !hiddenDefaultKeys.has(key);
        const blank = input.required && !input.value.trim();
        input.setCustomValidity(blank ? '请填写' + label.dataset.label + '。' : '');
      }
      const needsInput = !label.hidden && !input.disabled && input.required && !input.validity.valid;
      const destination = needsInput ? missingFields : defaultFields;
      // Do not move an input while someone is typing; reposition it on blur.
      if (label.parentElement !== destination && form.ownerDocument.activeElement !== input) destination.append(label);
    }
    missingDefaults.hidden = ![...missingFields.children].some(label => !label.hidden);
    defaultSettings.hidden = !form.querySelector('[data-default-field]');
    disclosure?.refresh();
  }

  function syncCompanyChoices() {
    const normalize = value => value.replace(/\s/g,'').replace(/[–—−]/g,'-');
    for (const [groupName,sourceName] of [['choice_size','extra_company_size'],['choice_computers','extra_computer_count']]) {
      const group = form.elements.namedItem(groupName);
      if (!group) continue;
      const source = form.elements.namedItem(sourceName);
      const matches = [...group.options].filter(option => option.value && normalize(option.textContent) === normalize(source.value));
      group.value = matches.length===1 ? matches[0].value : '';
      group.closest('label').hidden = matches.length===1;
    }
  }

  function syncAuthorizationChoice() {
    const group=template?.reviewed_controls?.groups?.find(item=>item.key==='service_type_choice' && item.auto_from_package);
    const select=form.elements.namedItem('service_type_choice');
    if (!group || !select) return;
    const selected=key=>Boolean(form.querySelector('[data-package-toggle="'+key+'"]')?.checked);
    const landline=selected('package_landline_count');
    const mobile=selected('package_mobile_count') || selected('package_secondary_count');
    if (!authorizationTypeEdited) {
      // Default to broadband; explicitly selected fixed/mobile services
      // determine the additional categories. 商云通 is reviewed separately.
      select.value=landline && mobile ? '3' : landline ? '1' : mobile ? '2' : '0';
    }
    const actual=group.options[select.value];
    const conflict=actual && ((landline && !actual.includes('固话')) || (mobile && !actual.includes('手机')));
    select.setCustomValidity(conflict?'授权书业务类型与勾选的固话或手机业务不一致，请核对。':'');
  }

  form.addEventListener('input', updateDefaultFields);
  form.addEventListener('change', updateDefaultFields);
  form.addEventListener('input', event => { if (['extra_company_size','extra_computer_count'].includes(event.target.name)) syncCompanyChoices(); });
  form.addEventListener('change', event => { if (['extra_company_size','extra_computer_count'].includes(event.target.name)) syncCompanyChoices(); });
  form.addEventListener('change', event => {
    if (event.target.name==='service_type_choice' && template?.reviewed_controls?.groups?.some(g=>g.key==='service_type_choice' && g.auto_from_package))
      authorizationTypeEdited=Boolean(event.target.value);
    if (event.target.matches('[data-package-toggle]') || event.target.name?.startsWith('package_') || event.target.name==='service_type_choice') {
      syncAuthorizationChoice();
      disclosure?.refresh();
    }
  });
  form.addEventListener('input', event => {
    if (event.target.name?.startsWith('package_')) { syncAuthorizationChoice(); disclosure?.refresh(); }
  });
  form.addEventListener('focusout', () => queueMicrotask(updateDefaultFields));
  root.querySelector('#fill-example').onclick = () => {
    const fixture = { company_name:'虚构测试企业', install_address:'虚构安装路一号',
      contact_name:'测试甲乙', phone:'10000000000', id_number:'000000000000000000', email:'a@b.invalid' };
    for (const [key, value] of Object.entries(fixture)) {
      if (!form.elements[key].value) {
        form.elements[key].value = value;
        form.elements[key].dispatchEvent(new Event('input', {bubbles:true}));
      }
    }
    form.elements.company_name.dispatchEvent(new Event('change', {bubbles:true}));
    const payment = form.elements.payment_method;
    if (!payment.value) payment.value = 'collection';
    payment.dispatchEvent(new Event('change', {bubbles:true}));
    if (payment.value === 'collection') {
      if (!form.elements.bank_account.value) form.elements.bank_account.value = '00000000654321';
      if (!form.elements.bank_name.value) form.elements.bank_name.value = '虚构测试银行';
    }
    form.dispatchEvent(new Event('input', {bubbles:true}));
  };
  function choose(id) {
    template = candidates.find(row => row.id === id);
    authorizationTypeEdited = false;
    const keys = template?.extra_fields ?? [];
    intake.setExtras(keys);
    const reviewed=template?.reviewed_controls;
    aiOptions.innerHTML=renderAiOptions(reviewed?.ai_options);
    bindAiOptions(form);
    application.hidden=application.disabled=Boolean(reviewed?.blank);
    const custom=reviewed || template?.carrier_controls;
    packageOptions.choose(reviewed?.package_options);
    for (const label of form.querySelectorAll('[data-default-field]')) label.remove();
    extra.innerHTML = custom ? custom.groups.filter(g=>g.key!=='choice_billing').map(g=>'<label>'+esc(g.label)+'<select name="'+esc(g.key)+'" '+(g.required?'required':'')+'>'+options(g.options.map((name,id)=>({name,id})),g.required?'请选择':'不订购')+'</select>'+
      (g.auto_from_package?'<span class="hint">默认宽带，可根据已勾选的固话、手机业务调整；商云通请核对。</span>':'')+'</label>').join('')+
      custom.inputs.filter(([key])=>!intakeExtraKeys.includes(key) && !defaultFieldKeys.has(key)).map(([key,label,required,type])=>'<label>'+esc(label)+'<input type="'+(['date','email'].includes(type)?type:'text')+'" name="'+esc(key)+'" '+(required?'required':'')+' maxlength="500" autocomplete="off"></label>').join('') :
      keys.filter(k => !intakeExtraKeys.includes(k)).map(k => field(k, '模板必填 · ' + k.slice(6))).join('');
    if (custom) defaultFields.insertAdjacentHTML('beforeend', custom.inputs.filter(([key])=>defaultFieldKeys.has(key)).map(([key,label,required,type])=>
      '<label data-default-field data-label="'+esc(label)+'" '+(hiddenDefaultKeys.has(key)?'hidden':'')+'>'+esc(label)+'<input type="'+(['date','email'].includes(type)?type:'text')+'" name="'+esc(key)+'" data-template-required="'+Boolean(required)+'" '+
      (key.endsWith('_zip')?'inputmode="numeric" pattern="[0-9]{6}" title="请输入6位数字邮编" maxlength="6"':'maxlength="500"')+' autocomplete="off"></label>').join(''));
    if (custom) for (const group of custom.groups) {
      const control=form.elements.namedItem(group.key);
      const value=String(group.default ?? '');
      if (control && value && [...control.options].some(option=>option.value===value)) control.value=value;
    }
    defaults.templateChanged();
    syncCompanyChoices();
    syncAuthorizationChoice();
    updateDefaultFields();
    disclosure?.refresh();
    generate.disabled = busy || !template;
    hint.hidden=Boolean(template);
    requestId = undefined;
  }
  function invalidate() {
    epoch++;
    candidates = [];
    matchToken = undefined;
    result.replaceChildren();
    choose('');
    status(root, '');
  }
  form.oninput = event => {
    requestId = undefined;
    generated.replaceChildren();
    if(event.target.name==='discount_rate')invalidate();
  };
  form.addEventListener('change', event => {
    if (businessFields.includes(event.target.name)) invalidate();
    if (event.target.name === 'candidate') choose(event.target.value);
    if (event.target.name === 'payment_method') {
      bank.disabled = bank.hidden = event.target.value !== 'collection';
      if (bank.disabled) for (const input of bank.querySelectorAll('input')) input.value = '';
    }
  });
  root.querySelector('#match').onclick = async () => {
    invalidate();
    const selection = selected();
    if (!selection) return status(root, '请核对业务种类、业务名称、业务属性、语音和折扣；如有多种版式或付费周期，也请选择。');
    const ticket = epoch;
    try {
      const match = await request('/match', { method: 'POST', data: { selection } });
      if (ticket !== epoch) return;
      candidates = match.candidates;
      matchToken = match.match_token;
      if (!candidates.length) return status(root, match.status === 'conflict' ? '套餐与已选资料冲突，请重新核对。' : '没有可用模板，请核对套餐或联系模板管理员。');
      if (candidates.length === 1) {
        const basis=match.basis.join(' · ');
        const description=basis.includes(candidates[0].name)?basis:candidates[0].name+' · '+basis;
        result.innerHTML = '<p>已匹配　' + esc(description) + '（' + esc(candidates[0].revision) + '）</p>';
        choose(candidates[0].id);
      } else {
        result.innerHTML = '<p>匹配依据　' + esc(match.basis.join(' · ')) + '</p>';
        result.innerHTML += '<label>多个模板符合条件，请选择<select name="candidate" required>' +
          options(candidates.map(t => ({ id: t.id, name: t.name + '（' + t.revision + '）' }))) + '</select></label>';
      }
    } catch (error) { if (ticket === epoch) status(root, error.message); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !template) return;
    const reminder=template.reviewed_controls?.blank?'':intake.beforeGenerate();
    if(reminder) { disclosure.reveal(true); return status(root, reminder); }
    const customer = {};
    for (const [name, value] of new FormData(form)) {
      if (customerFields.includes(name) || ['payment_method','bank_name','bank_account'].includes(name) || template.extra_fields?.includes(name)) customer[name] = value;
    }
    if(defaults.sameBilling()) {
      customer.billing_address = customer.install_address;
      if (template.extra_fields?.includes('billing_zip')) customer.billing_zip = customer.install_zip;
    }
    // The verified Word labels its checkbox “same as company address”, which
    // is not necessarily the installation address. Write the actual address.
    if (template.reviewed_controls && !template.reviewed_controls.blank || template.carrier_controls) customer.choice_billing = '1';
    requestId ??= crypto.randomUUID();
    busy = true;
    generate.disabled = true;
    try {
      const row = await request('/generate', { method: 'POST', data: { request_id: requestId, match_token: matchToken, template_id: template.id, selection: selected(), customer } });
      status(root, '生成成功，文件已保存到此账号的历史记录。');
      generated.innerHTML = (row.review?.length ? '<p>下载后请核对版式，并处理：'+esc(row.review.map(key=>reviewLabels[key]||key).join('、'))+'。</p>' : '')+
        downloadControl('/records/' + row.id + '/file', '下载已生成的 Word', state.hosted) + generatedMaterials(row.tariff,row.review?.includes('voice_template'));
      const copyMaterials=generated.querySelector('#copy-generated-materials');
      if(copyMaterials)copyMaterials.onclick=()=>copyTextArea(generated.querySelector('#generated-material-text'),generated.querySelector('#generated-material-feedback'));
      form.dispatchEvent(new CustomEvent('runwell:form-generated',{detail:{id:row.id}}));
    } catch (error) {
      status(root, error.message);
      if (error.status === 409) { invalidate(); status(root, error.message); }
    } finally { busy = false; generate.disabled = !template; }
  };
  disclosure = bindDisclosure(form, intake);
}
