// Display fields from the reference form. Never embed customer values.
const requiredMark = '<span class="required-mark" aria-hidden="true">*</span>';

function field(name, title, { required = true, type = 'text', numeric = false } = {}) {
  return `<label><span>${required ? requiredMark : ''}${title}</span><input name="${name}" type="${type}"${numeric ? ' inputmode="numeric"' : ''}${required ? ' required' : ''} disabled placeholder="界面展示，暂不填写或保存"></label>`;
}

function select(name, title, options) {
  return `<label><span>${requiredMark}${title}</span><select name="${name}" required><option value="">请选择</option>${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>`;
}

const ranges = labels => labels.map((label, index) => [String(index + 1), label]);

export function renderDemoCustomerInfo() {
  return `<div class="divider"></div><h3>客户基础信息</h3><p class="hint">${requiredMark}为必填项</p>
<div class="field-grid">
  ${field('company_name', '企业全称')}
  ${field('credit_code', '统一社会信用代码')}
  ${field('industry', '企业所属行业')}
  ${select('company_size', '企业规模', ranges(['10 人以下', '10–30 人', '31–80 人', '81–200 人', '200 人以上']))}
  ${select('computer_count', '计算机数量', ranges(['5 台及以下', '6–15 台', '16–40 台', '41–100 台', '100 台以上']))}
</div>
<div class="field-grid">
  <div class="customer-wide">${field('install_address', '安装地址')}</div>
  ${field('install_postcode', '安装地址邮编', { numeric: true })}
</div>
<div class="field-grid">
  ${field('contact_name', '经办人姓名')}
  ${field('id_number', '身份证号码')}
  ${field('phone', '联系电话', { type: 'tel' })}
  ${field('contact_title', '经办人职务', { required: false })}
  ${field('email', 'E-mail', { type: 'email' })}
  ${field('fax', '传真', { required: false, type: 'tel' })}
</div>
<div class="field-grid">
  ${select('billing_address_mode', '账单地址', [['same', '同公司地址'], ['other', '其他']])}
  ${field('billing_postcode', '账单地址邮编', { numeric: true })}
  ${select('payment_method', '付款方式', [['cash', '现金'], ['collection', '托收']])}
</div>
<fieldset id="billing-address-details" hidden disabled><div class="field-grid"><div class="customer-wide">${field('billing_address', '其他账单地址')}</div></div></fieldset>
<fieldset id="bank-fields" hidden disabled><div class="field-grid">
  ${field('bank_account', '银行账号', { numeric: true })}
  ${field('bank_name', '开户银行')}
</div></fieldset><div id="extra" class="field-grid"></div>`;
}
