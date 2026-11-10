import { escape as esc } from '../../lib/api.js';
import { copyTextArea, downloadControl, options, request, status } from './shared.js';
import { classifyTariff, businessFields, businessSelectors, bindBusinessSelection } from './business-selection.js';

import { businessText } from './intake-rules.js';
import { bindIntake, intakePanel, internalPanel, intakeExtraKeys } from './intake.js';
import { bindDefaults } from './defaults.js';
import { bindPackageOptions } from './package-options.js';
import { renderAiOptions, bindAiOptions } from './ai-options.js';

const customerFields = ['company_name','install_address','billing_address','contact_name','phone','id_number','email'];
const defaultFieldKeys = new Set(['install_zip','billing_zip','job_title','fax','security_name',
  'security_role','security_phone','service_use','application_date']);
const linkedSecurityFields = new Set(['security_name','security_role','security_phone']);
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
  return generationShell('<fieldset id="application-fields" class="application-fields">' + intakePanel() +
    '<div class="divider"></div><h3>客户资料</h3><button id="fill-example" type="button">用虚构样例补全空白栏</button><div class="field-grid">' +
    customerFields.map(key => {
      if (key === 'billing_address') return '<label>账单地址方式<select name="billing_address_mode"><option value="same">与安装地址相同</option><option value="different">不同，单独填写</option></select></label>' +
        '<label id="billing-address-field" hidden>* 账单地址<input name="billing_address" required maxlength="500" autocomplete="off"></label>';
      return field(key, '* ' + (key === 'id_number' ? '身份证号码' : key === 'email' ? 'E-MAIL' : labels[key]), key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text');
    }).join('') +
    '<label>* 付款方式<select name="payment_method" required><option value="">请选择</option><option value="cash">现金</option><option value="collection">托收</option></select></label></div>' +
    '<p class="hint">账单地址默认与安装地址相同。</p>' +
    '<fieldset hidden id="bank-fields" disabled><div class="field-grid">' + field('bank_account', labels.bank_account) +
    field('bank_name', labels.bank_name) + '</div></fieldset>' + internalPanel() + '</fieldset><div id="extra" class="field-grid"></div>' +
    '<section id="package-options" hidden></section>' +
    '<section id="missing-defaults" hidden><h3>需要补充的信息</h3><p class="hint">未能自动填写的模板资料，请补充后生成。</p>' +
    '<div id="missing-default-fields" class="field-grid"></div></section>' +
    '<details id="default-settings" hidden><summary>修改默认信息</summary>' +
    '<p class="hint">姓名和联系方式默认与经办人相同；申请人职务默认为 IT，可修改，经办人和信息安全责任人的职务默认与之相同。账单邮编在地址相同时复用安装邮编。</p>' +
    '<div id="default-fields" class="field-grid"><label id="applicant-role-field">申请人职务<input name="applicant_role" value="IT" maxlength="200" autocomplete="off"></label></div></details>');
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
  const reviewLabels={billing_address:'其他账单地址',bank_name:'开户银行',authorization:'授权委托书',voice_identity:'语音实名资料（如适用）',voice_template:'已选择语音或移动业务，请核对是否需要带语音模板和手续材料',
    discount_factor:'折数及折后资费',line_count:'线路数量',service_options:'业务选项',delegate_information:'委托代办信息（如适用）',signature:'签字盖章',guarantee_signature:'签字盖章',
    guarantee_number:'电信业务号码',guarantee_date:'担保日期'};
  let epoch = 0, candidates = [], template = null, matchToken, requestId, busy = false;

  function updateDefaultFields() {
    const securityRole = form.elements.namedItem('security_role');
    const hasRole = Boolean(securityRole || form.elements.namedItem('job_title'));
    applicantRoleLabel.hidden = !hasRole;
    applicantRole.required = Boolean(securityRole?.dataset.templateRequired === 'true' && defaults.isLinked('security_role'));
    applicantRole.setCustomValidity(applicantRole.required && !applicantRole.value.trim() ? '请填写申请人职务。' : '');

    const fields = [applicantRoleLabel, ...form.querySelectorAll('[data-default-field]')];
    for (const label of fields) {
      const input = label.querySelector('input');
      const key = input.name;
      if (key !== 'applicant_role') {
        const linked = linkedSecurityFields.has(key) && defaults.isLinked(key);
        input.required = input.dataset.templateRequired === 'true' && !linked;
        const blank = input.required && !input.value.trim();
        input.setCustomValidity(blank ? '请填写' + label.dataset.label + '。' : '');
      }
      const needsInput = !label.hidden && !input.disabled && input.required && !input.checkValidity();
      const destination = needsInput ? missingFields : defaultFields;
      // Do not move an input while someone is typing; reposition it on blur.
      if (label.parentElement !== destination && form.ownerDocument.activeElement !== input) destination.append(label);
    }
    missingDefaults.hidden = ![...missingFields.children].some(label => !label.hidden);
    defaultSettings.hidden = !form.querySelector('[data-default-field]');
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

  form.addEventListener('input', updateDefaultFields);
  form.addEventListener('change', updateDefaultFields);
  form.addEventListener('input', event => { if (['extra_company_size','extra_computer_count'].includes(event.target.name)) syncCompanyChoices(); });
  form.addEventListener('change', event => { if (['extra_company_size','extra_computer_count'].includes(event.target.name)) syncCompanyChoices(); });
  form.addEventListener('focusout', () => queueMicrotask(updateDefaultFields));
  root.querySelector('#fill-example').onclick = () => {
    const fixture = { company_name:'虚构测试企业', install_address:'虚构安装路一号',
      contact_name:'测试甲乙', applicant_role:'IT', phone:'10000000000', id_number:'000000000000000000', email:'a@b.invalid' };
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
    const keys = template?.extra_fields ?? [];
    intake.setExtras(keys);
    const reviewed=template?.reviewed_controls;
    aiOptions.innerHTML=renderAiOptions(reviewed?.ai_options);
    bindAiOptions(form);
    application.hidden=application.disabled=Boolean(reviewed?.blank);
    const custom=reviewed || template?.carrier_controls;
    packageOptions.choose(reviewed?.package_options);
    for (const label of form.querySelectorAll('[data-default-field]')) label.remove();
    extra.innerHTML = custom ? custom.groups.filter(g=>g.key!=='choice_billing').map(g=>'<label>'+esc(g.label)+'<select name="'+esc(g.key)+'" '+(g.required?'required':'')+'>'+options(g.options.map((name,id)=>({name,id})),g.required?'请选择':'不订购')+'</select></label>').join('')+
      custom.inputs.filter(([key])=>!intakeExtraKeys.includes(key) && !defaultFieldKeys.has(key)).map(([key,label,required,type])=>'<label>'+esc(label)+'<input type="'+(['date','email'].includes(type)?type:'text')+'" name="'+esc(key)+'" '+(required?'required':'')+' maxlength="500" autocomplete="off"></label>').join('') :
      keys.filter(k => !intakeExtraKeys.includes(k)).map(k => field(k, '模板必填 · ' + k.slice(6))).join('');
    if (custom) defaultFields.insertAdjacentHTML('beforeend', custom.inputs.filter(([key])=>defaultFieldKeys.has(key)).map(([key,label,required,type])=>
      '<label data-default-field data-label="'+esc(label)+'">'+esc(label)+'<input type="'+(['date','email'].includes(type)?type:'text')+'" name="'+esc(key)+'" data-template-required="'+Boolean(required)+'" '+
      (key.endsWith('_zip')?'inputmode="numeric" pattern="[0-9]{6}" title="请输入6位数字邮编" maxlength="6"':'maxlength="500"')+' autocomplete="off"></label>').join(''));
    if (custom) for (const group of custom.groups) {
      const control=form.elements.namedItem(group.key);
      const value=String(group.default ?? '');
      if (control && value && [...control.options].some(option=>option.value===value)) control.value=value;
    }
    defaults.templateChanged();
    syncCompanyChoices();
    updateDefaultFields();
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
      result.innerHTML = '<p>匹配依据　' + esc(match.basis.join(' · ')) + '</p>';
      if (candidates.length === 1) {
        result.innerHTML += '<p>已匹配　' + esc(candidates[0].name) + '（' + esc(candidates[0].revision) + '）</p>';
        choose(candidates[0].id);
      } else {
        result.innerHTML += '<label>多个模板符合条件，请选择<select name="candidate" required>' +
          options(candidates.map(t => ({ id: t.id, name: t.name + '（' + t.revision + '）' }))) + '</select></label>';
      }
    } catch (error) { if (ticket === epoch) status(root, error.message); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !template) return;
    const reminder=template.reviewed_controls?.blank?'':intake.beforeGenerate();
    if(reminder) return status(root, reminder);
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
    } catch (error) {
      status(root, error.message);
      if (error.status === 409) { invalidate(); status(root, error.message); }
    } finally { busy = false; generate.disabled = !template; }
  };
}
