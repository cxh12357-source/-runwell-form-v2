// 全部为虚构的联调用例。正式资费和版本需另行核实。
export const version = { id: 'demo-no-voice', business_id: 'business-line', name: '测试版（不带语音）' };
export const tariffs = [
  { id: 'demo-a', name: '测试套餐 A', bandwidth: '100M', amount: '900.00' },
  { id: 'demo-b', name: '测试套餐 B', bandwidth: '200M', amount: '900.00' }
].map(row => ({ ...row, cycle: '月', business_id: version.business_id, business_version_id: version.id,
  business_attribute: 'new', voice_required: false }));

export const labels = {
  company_name: '企业全称', install_address: '安装地址', billing_address: '账单地址',
  contact_name: '经办人完整姓名', phone: '经办人手机号', id_number: '身份证号', email: '电子邮箱',
  bank_name: '开户银行', bank_account: '银行账号', cash_mark: '现金勾选', collection_mark: '托收勾选',
  package_request: '套餐和资费'
};
export const defaultMapping = Object.fromEntries(Object.keys(labels).map(key => [key, key]));
export class FormError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}
export function insist(condition, message, status) {
  if (!condition) throw new FormError(message, status);
}
function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}
const dimensions = ['business_id', 'business_version_id', 'business_attribute', 'voice_required', 'cycle', 'bandwidth', 'amount'];
export function match(selection, templates, directory = tariffs) {
  const missing = ['tariff_id', ...dimensions].filter(key => selection[key] == null || selection[key] === '');
  const result = { status: 'not_found', candidates: [], missing_fields: missing, conflicts: [] };
  if (missing.length) return result;
  const tariff = directory.find(t => t.id === selection.tariff_id);
  if (!tariff) return result;
  result.conflicts = dimensions.filter(key => selection[key] !== tariff[key]);
  if (result.conflicts.length) return { ...result, status: 'conflict' };
  result.candidates = templates.filter(t => t.active && t.tariff_id === tariff.id).map(t =>
    ({ id: t.id, name: t.name, revision: t.revision }));
  result.basis = [tariff.name, tariff.bandwidth, tariff.amount + ' 元/' + tariff.cycle,
    tariff.business_version_id, tariff.voice_required ? '带语音' : '不带语音'];
  result.status = ['not_found', 'unique'][result.candidates.length] ?? 'ambiguous';
  return result;
}
export function validateMapping(mapping) {
  insist(mapping && typeof mapping === 'object' && !Array.isArray(mapping), '请提供字段映射。');
  const entries = Object.entries(mapping);
  insist(entries.length <= 60 && entries.every(([tag, field]) =>
    /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(tag) && typeof field === 'string' &&
    (Object.hasOwn(labels, field) || /^extra_[a-z0-9_]{1,40}$/.test(field))), '字段映射格式错误。');
  const fields = new Set(entries.map(([, field]) => field));
  for (const field of Object.keys(labels)) insist(fields.has(field), '模板缺少映射：' + labels[field]);
  return mapping;
}
export function validateCustomer(customer, mapping, tariff) {
  const values = Object.create(null);
  for (const key of ['company_name', 'install_address', 'billing_address', 'contact_name', 'phone', 'id_number', 'email']) {
    values[key] = clean(customer[key]);
    insist(values[key], '请填写' + labels[key]);
  }
  insist(/^1\d{10}$/.test(values.phone), '手机号应为 11 位数字。');
  insist(/^\d{17}[\dX]$/i.test(values.id_number), '请核对 18 位身份证号。');
  insist(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email), '请核对电子邮箱。');
  insist(['cash', 'collection'].includes(customer.payment_method), '请选择付款方式。');
  const bank = customer.payment_method === 'collection';
  values.bank_account = bank ? clean(customer.bank_account) : '';
  values.bank_name = bank ? clean(customer.bank_name) : '';
  if (bank) insist(/^\d{6,32}$/.test(values.bank_account) && values.bank_name, '托收需要有效的银行账号和开户银行。');
  values.cash_mark = bank ? '☐' : '☑';
  values.collection_mark = bank ? '☑' : '☐';
  values.package_request = [tariff.name, tariff.bandwidth, tariff.amount + ' 元/' + tariff.cycle].join(' · ');
  for (const field of Object.values(mapping).filter(key => key.startsWith('extra_'))) {
    values[field] = clean(customer[field]);
    insist(values[field], '请补充模板资料：' + field.slice(6));
  }
  for (const value of Object.values(values)) {
    insist(value.length <= 500 && !/[\u0000-\u001f\u007f\ud800-\udfff\ufffe\uffff]/u.test(value) && !/[{}]{2}/.test(value),
      '资料含有不支持的字符，或超过 500 字。');
  }
  return Object.fromEntries(Object.entries(mapping).map(([tag, key]) => [tag, values[key]]));
}
