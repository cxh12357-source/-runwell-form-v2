export const guaranteeFields = [
  ['company_name','被担保企业全称',100], ['extra_credit_code','被担保企业统一社会信用代码',18],
  ['guarantor_name','担保人名称',100], ['guarantor_id','担保人证件号码',100],
  ['guarantor_address','担保人联系地址',100], ['guarantor_phone','担保人联系电话',100],
  ['business_number','电信业务号码',50,false], ['guarantee_date','担保日期',10,false,'date']
];

export function dateParts(value, label) {
  const date = new Date(value+'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-') ||
      !Number.isFinite(+date) || date.toISOString().slice(0,10)!==value) throw new Error('请填写有效的'+label+'。');
  return value.split('-').map((part,i)=>i?String(Number(part)):part);
}
