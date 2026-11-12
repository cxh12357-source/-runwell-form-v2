// 全部为虚构的联调用例。正式资费和版本需另行核实。
export const version = { id: 'demo-no-voice', business_id: 'business-line', name: '测试版（不带语音）' };
export const voiceVersion = { ...version, id: 'demo-voice', name: '测试版（带语音）' };
export const tariffs = [
  { id: 'demo-a', name: '测试套餐 A', bandwidth: '100M', amount: '900.00' },
  { id: 'demo-b', name: '测试套餐 B', bandwidth: '200M', amount: '900.00' },
  { id: 'demo-c', name: '测试套餐 C（含工商栏）', bandwidth: '300M', amount: '1200.00' },
  { id: 'demo-v', name: '测试语音套餐', bandwidth: '100M', amount: '1100.00' }
].map(row => ({ ...row, cycle: '月', business_id: version.business_id, business_version_id: row.id === 'demo-v' ? voiceVersion.id : version.id,
  business_attribute: 'new', voice_required: row.id === 'demo-v' }));

export const labels = {
  company_name: '企业全称', install_address: '安装地址', billing_address: '账单地址',
  contact_name: '经办人完整姓名', phone: '经办人手机号', id_number: '身份证号', email: '电子邮箱',
  bank_name: '开户银行', bank_account: '银行账号', cash_mark: '现金勾选', collection_mark: '托收勾选',
  package_request: '套餐和资费'
};
export const defaultMapping = Object.fromEntries(Object.keys(labels).map(key => [key, key]));
export const companyLabels = {
  extra_credit_code: '统一社会信用代码', extra_industry: '企业所属行业',
  extra_company_size: '企业规模', extra_computer_count: '企业计算机数量'
};
export const voiceLabels = {
  extra_legal_name: '法定代表人', extra_legal_id: '法定代表人身份证号码',
  extra_user_name: '使用人（实名制）', extra_user_id: '使用人（实名制）身份证号码'
};
export function sampleLabels(tariff) {
  if (tariff.voice_required) return { ...labels, ...voiceLabels };
  return tariff.id === 'demo-c' ? { ...labels, ...companyLabels } : labels;
}
export const sampleMapping = tariff => Object.fromEntries(Object.keys(sampleLabels(tariff)).map(key => [key, key]));
export function checkTariffMapping(mapping, tariff) {
  if (tariff?.voice_required) {
    const fields = new Set(Object.values(mapping));
    for (const [key, label] of Object.entries(voiceLabels)) insist(fields.has(key), '带语音模板缺少映射：' + label);
  }
}
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
export function selectedDiscount(selection,tariff) {
  if(selection.discount_mode===undefined && selection.discount_factor===undefined)return null;
  const mode=(tariff.reviewed_id?.includes('-discount-')||tariff.carrier_profile?.endsWith('-discount'))?'yes':'no';
  if(selection.discount_mode!==mode || (mode==='no' && selection.discount_factor!==undefined))return false;
  if(mode==='no')return {mode};
  const factor=selection.discount_factor;
  if(typeof factor!=='string' || !/^(?:[1-9](?:\.\d{1,2})?|0\.\d{1,2})$/.test(factor) || Number(factor)<=0 ||
    (tariff.discount_rate && Number(tariff.discount_rate)!==Number(factor)))return false;
  return {mode,factor,manual:!tariff.discount_rate};
}
export function match(selection, templates, directory = tariffs) {
  const missing = ['tariff_id', ...dimensions].filter(key => selection[key] == null || selection[key] === '');
  const result = { status: 'not_found', candidates: [], missing_fields: missing, conflicts: [] };
  if (missing.length) return result;
  const tariff = directory.find(t => t.id === selection.tariff_id);
  if (!tariff) return result;
  result.conflicts = dimensions.filter(key => selection[key] !== tariff[key]);
  if(selectedDiscount(selection,tariff)===false)result.conflicts.push('discount_factor');
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
  checkTariffMapping(mapping, tariff);
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
    insist(values[field], '请补充模板资料：' + (voiceLabels[field] || companyLabels[field] || field.slice(6)));
    if (['extra_legal_id','extra_user_id'].includes(field)) insist(/^\d{17}[\dX]$/i.test(values[field]), '请核对' + voiceLabels[field]);
  }
  for (const value of Object.values(values)) {
    insist(value.length <= 500 && !/[\u0000-\u001f\u007f\ud800-\udfff\ufffe\uffff]/u.test(value) && !/[{}]{2}/.test(value),
      '资料含有不支持的字符，或超过 500 字。');
  }
  return Object.fromEntries(Object.entries(mapping).map(([tag, key]) => [tag, values[key]]));
}

const dashboardDay=86400000, shanghaiOffset=8*3600000;
const dayLabel=milliseconds=>new Date(milliseconds).toISOString().slice(0,10);
function parseDashboardDay(value) {
  insist(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value>='1900-01-01','请选择有效的起止日期。',400);
  const day=Date.parse(value+'T00:00:00Z');
  insist(Number.isFinite(day) && dayLabel(day)===value,'请选择有效的起止日期。',400);
  return day;
}
export function dashboardPeriod(query=new URLSearchParams(), now=Date.now()) {
  const period=query.get('period') ?? 'week', rawOffset=query.get('offset') ?? '0';
  insist(['week','month','quarter','fiscal','all','custom'].includes(period),'请选择有效的统计周期。',400);
  insist(/^(0|[1-9]\d{0,2})$/.test(rawOffset) && Number(rawOffset)<=520,'请选择有效的往期范围。',400);
  const offset=Number(rawOffset);
  if(period==='all')return {period,offset:0,from:null,to:null};
  let start,end,fiscalStartMonth;
  if(period==='custom'){
    start=parseDashboardDay(query.get('from')); end=parseDashboardDay(query.get('to'));
    insist(start<=end,'开始日期不能晚于结束日期。',400);
  } else {
    const today=new Date(now+shanghaiOffset);
    const y=today.getUTCFullYear(), m=today.getUTCMonth(), d=today.getUTCDate();
    if(period==='week'){
      const monday=(today.getUTCDay()+6)%7;
      start=Date.UTC(y,m,d-monday-offset*7); end=start+6*dashboardDay;
    } else if(period==='quarter'){
      const first=Math.floor(m/3)*3-offset*3;
      start=Date.UTC(y,first,1); end=Date.UTC(y,first+3,1)-dashboardDay;
    } else if(period==='fiscal'){
      const raw=query.get('fiscal_start_month') ?? '1';
      insist(/^(?:[1-9]|1[0-2])$/.test(raw),'请选择有效的财年起始月份。',400);
      fiscalStartMonth=Number(raw);
      const first=fiscalStartMonth-1, year=y-(m<first?1:0)-offset;
      start=Date.UTC(year,first,1); end=Date.UTC(year+1,first,1)-dashboardDay;
    } else {
      start=Date.UTC(y,m-offset,1); end=Date.UTC(y,m-offset+1,1)-dashboardDay;
    }
  }
  return {period,offset,from:dayLabel(start),to:dayLabel(end),...(fiscalStartMonth?{fiscal_start_month:fiscalStartMonth}:{})};
}

const dashboardKeys=['business_id','business_name','business_attribute','voice','discount'];
export function dashboardFilters(query) {
  const filters={};
  for(const key of dashboardKeys){
    const value=query.get(key)?.trim();
    if(!value)continue;
    insist(value.length<=240 && (!['voice','discount'].includes(key)||['yes','no','unknown'].includes(value)),
      '请选择有效的业务筛选条件。',400);
    filters[key]=value;
  }
  return filters;
}

function recordBusiness(record) {
  const tariff=record.tariff||{}, id=tariff.reviewed_id||'';
  const guarantee=id==='business-guarantee';
  const name=/^business-200m-/.test(id)?'200M 智云上海专线升级版':
    /^business-100m-/.test(id)||tariff.carrier_profile?'100M 智云上海专线基础版':
    id.startsWith('business-ai-')?'智云护航 AI 套餐升级':guarantee?'外地公司担保书':tariff.name;
  const voice=guarantee||id==='business-ai-v1'||typeof tariff.voice_required!=='boolean'?'unknown':tariff.voice_required?'yes':'no';
  const discount=record.discount?.mode || (guarantee?'unknown':
    id.includes('-discount-')||tariff.carrier_profile?.endsWith('-discount')||tariff.discount_rate?'yes':
    /^business-(100m|200m)-/.test(id)||tariff.carrier_profile||tariffs.some(t=>t.id===tariff.id)?'no':'unknown');
  return {business_id:record.business_id,business_name:name,business_attribute:record.business_attribute,voice,discount};
}

export function workDashboard(actor, roster, records, range=dashboardPeriod(), filters={}) {
  const admin=actor.role==='admin';
  const visible=admin?records:records.filter(record=>record.created_by===actor.id);
  const classified=visible.map(record=>({record,business:recordBusiness(record)}));
  const names=[...new Map(classified.filter(({business:b})=>b.business_id&&b.business_name)
    .map(({business:b})=>[JSON.stringify([b.business_id,b.business_name]),{business_id:b.business_id,name:b.business_name}])).values()];
  records=classified.filter(({business})=>Object.entries(filters).every(([key,value])=>business[key]===value)).map(({record})=>record);
  if(range.from){
    const start=Date.parse(range.from+'T00:00:00+08:00');
    const end=Date.parse(range.to+'T00:00:00+08:00')+dashboardDay;
    records=records.filter(record=>{
      const time=Date.parse(record.created_at);
      return time>=start && time<end;
    });
  }
  const counts=new Map((admin?roster:[actor]).map(person=>[person.id,0]));
  for(const record of records) counts.set(record.created_by,(counts.get(record.created_by)||0)+1);
  return {scope:admin?'team':'self', range, filters, business_names:names, employees:[...counts].map(([id,forms_count])=>({id,forms_count,quote_count:null})), records};
}
