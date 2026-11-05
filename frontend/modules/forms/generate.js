import { escape as esc } from '../../lib/api.js';
import { bindClassification, downloadControl, options, request, selectors, status } from './shared.js';

import { bindIntake, intakePanel, internalPanel, intakeExtraKeys } from './intake.js';

const customerFields = ['company_name','install_address','billing_address','contact_name','phone','id_number','email'];
function field(name, title, type = 'text') {
  return '<label>' + esc(title) + '<input name="' + esc(name) + '" type="' + type + '" required maxlength="500" autocomplete="off"></label>';
}
export function generationShell(content) {
  return '<form id="generate-form">' + selectors() +
    '<button class="button" type="button" id="match">匹配模板</button><div id="match-result"></div>' + content +
    '<button id="generate" class="button" disabled>确认生成 Word</button></form><div id="generated"></div>';
}

export function generation(labels) {
  return generationShell(intakePanel() +
    '<div class="divider"></div><h3>客户资料</h3><button id="fill-example" type="button">用虚构样例补全空白栏</button><div class="field-grid">' +
    customerFields.map(key => field(key, labels[key], key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text')).join('') +
    '<label>付款方式<select name="payment_method" required><option value="">请选择</option><option value="cash">现金</option><option value="collection">托收</option></select></label></div>' +
    '<fieldset hidden id="bank-fields" disabled><div class="field-grid">' + field('bank_account', labels.bank_account) +
    field('bank_name', labels.bank_name) + '</div></fieldset><div id="extra" class="field-grid"></div>' + internalPanel());
}

export function bindGeneration(root, state) {
  const form = root.querySelector('#generate-form');
  const selected = bindClassification(form, state);
  const intake = bindIntake(form, state);
  const result = root.querySelector('#match-result');
  const extra = root.querySelector('#extra');
  const generate = root.querySelector('#generate');
  const generated = root.querySelector('#generated');
  const bank = root.querySelector('#bank-fields');
  let epoch = 0, candidates = [], template = null, matchToken, requestId, busy = false;
  root.querySelector('#fill-example').onclick = () => {
    const fixture = { company_name:'虚构测试企业', install_address:'虚构安装路一号', billing_address:'虚构账单路二号',
      contact_name:'测试甲乙', phone:'10000000000', id_number:'000000000000000000', email:'fixture@example.invalid' };
    for (const [key, value] of Object.entries(fixture)) {
      if (!form.elements[key].value) form.elements[key].value = value;
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
    const custom=template?.carrier_controls;
    extra.innerHTML = custom ? custom.groups.map(g=>'<label>'+esc(g.label)+'<select name="'+esc(g.key)+'" '+(g.required?'required':'')+'>'+options(g.options.map((name,id)=>({name,id})),g.required?'请选择':'不订购')+'</select></label>').join('')+
      custom.inputs.filter(([key])=>!intakeExtraKeys.includes(key)).map(([key,label,required])=>'<label>'+esc(label)+'<input name="'+esc(key)+'" '+(required?'required':'')+' maxlength="500" autocomplete="off"></label>').join('') :
      keys.filter(k => !intakeExtraKeys.includes(k)).map(k => field(k, '模板必填 · ' + k.slice(6))).join('');
    form.elements.billing_address.disabled=false;
    generate.disabled = busy || !template;
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
  form.oninput = () => { requestId = undefined; generated.replaceChildren(); };
  form.addEventListener('change', event => {
    if (['biz','ver','attr','tariff'].includes(event.target.name)) invalidate();
    if (event.target.name === 'candidate') choose(event.target.value);
    if(event.target.name==='choice_billing')form.elements.billing_address.disabled=event.target.value==='0';
    if (event.target.name === 'payment_method') {
      bank.disabled = bank.hidden = event.target.value !== 'collection';
      if (bank.disabled) for (const input of bank.querySelectorAll('input')) input.value = '';
    }
  });
  root.querySelector('#match').onclick = async () => {
    invalidate();
    const selection = selected();
    if (!selection) return status(root, '请依次选择业务名称、版本、属性及套餐。');
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
    const reminder=intake.beforeGenerate();
    if(reminder) return status(root, reminder);
    const customer = {};
    for (const [name, value] of new FormData(form)) {
      if (customerFields.includes(name) || ['payment_method','bank_name','bank_account'].includes(name) || template.extra_fields?.includes(name)) customer[name] = value;
    }
    if(customer.choice_billing==='0')customer.billing_address=customer.install_address;
    requestId ??= crypto.randomUUID();
    busy = true;
    generate.disabled = true;
    try {
      const row = await request('/generate', { method: 'POST', data: { request_id: requestId, match_token: matchToken, template_id: template.id, selection: selected(), customer } });
      status(root, '生成成功，文件已保存到此账号的历史记录。');
      generated.innerHTML = downloadControl('/records/' + row.id + '/file', '下载已生成的 Word', state.hosted);
    } catch (error) {
      status(root, error.message);
      if (error.status === 409) { invalidate(); status(root, error.message); }
    } finally { busy = false; generate.disabled = !template; }
  };
}
