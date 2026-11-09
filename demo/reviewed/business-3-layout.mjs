// Conservative estimates from the three originals: fixed-width cells, 108
// twips left/right padding, 9-point SimSun, and the original paragraph indents.
// A 50% width floor is an experimental bound, not a readability guarantee.
// A successful estimate is not proof of Word pagination or readability.
const AVAILABLE=Object.freeze({company_name:6842,extra_credit_code:3039,extra_industry:551,install_address:4291,contact_name:1714,id_number:1036,phone:1059,email:995});
function estimatedWidth(value) {
  let width=0;
  for(const c of value) {
    if(/^[\x20-\x7e]$/.test(c)) width+=90;
    else if(/^[\u4e00-\u9fff\u3000-\u303f\uff01-\uff60]$/u.test(c)) width+=180;
    else throw new Error('字段含未验证字符，请人工处理。');
  }
  return width;
}
export function estimateBusiness3Layout(values) {
  const fits={};
  for(const [key,available] of Object.entries(AVAILABLE)) {
    const value=values[key];
    if(typeof value!=='string' || !value) throw new Error('请核对必填资料。');
    const width=estimatedWidth(value);
    if(available/width<0.5) throw new Error('原表字段空间不足，请人工处理：'+key);
    if(width>available) fits[key]=available;
  }
  return {fits,layoutReviewRequired:true};
}
