// 商务专线·新装：客户话术、资料核对与条件字段。
export const businessText = {
  no_voice: {
    info: `【商务专线·新装】填写表格需要的信息（不带语音）：
1、企业全称：
2、安装地址：
3、账单地址：
4、选择套餐和资费：
5、经办人：
6、经办人联系电话（手机）：
7、经办人身份证号码：
8、经办人E-MAIL：
9、付款方式：现金/托收
10、付款方式如选“托收”，提供：银行账号、开户银行`,
    materials: `【商务专线·新装】手续材料提示（不带语音）：
1、申请文档打印1份，每页加盖公章，指定位置经办人签字、日期并加盖公章，最后一页委托单位处加盖公章。
2、营业执照复印件1份（原件复印），加盖公章。
3、经办人身份证正反面复印件1份（原件复印，复印件大小与原件大小保持一致），加盖公章。
4、AI稽查，加盖的公章务必清晰。`,
  },
  voice: {
    info: `【商务专线·新装】填写表格需要的信息（带语音）：
1、企业全称：
2、安装地址：
3、账单地址：
4、选择套餐和资费：
5、经办人：
6、经办人联系电话（手机）：
7、经办人身份证号码：
8、经办人E-MAIL：
9、付款方式：现金/托收
10、付款方式如选“托收”，提供：银行账号、开户银行
11、法定代表人：
12、法定代表人身份证号码：
13、使用人（实名制）：
14、使用人（实名制）身份证号码：`,
    materials: `【商务专线·新装】手续材料提示（带语音）：
1、申请文档打印1份，每页加盖公章，指定位置经办人签字、日期并加盖公章，最后一页委托单位处加盖公章。
2、营业执照复印件1份（原件复印，有效期内），加盖公章。
3、经办人身份证正反面复印件1份（原件复印，复印件大小与原件大小保持一致），加盖公章。
4、法定代表人身份证正反面复印件1份（原件复印，复印件大小与原件大小保持一致），加盖公章。
5、使用人（实名制）身份证正反面复印件1份（原件复印，复印件大小与原件大小保持一致），加盖公章。
6、含语音业务工作人员上门受理，现场需准备好：盖章材料、经办人本人、经办人身份证原件、使用人的身份证原件。
7、AI稽查，加盖的公章务必清晰，红章不可有黑章。`,
  },
};

const fields = {
  company_name: ['企业全称','公司全称','企业名称','公司名称'],
  install_address: ['安装地址','实际安装地址','装机地址','安装地点'],
  billing_address: ['账单地址','账单寄送地址','账单寄到'],
  tariff: ['选择套餐和资费','套餐和资费','套餐及资费','套餐资费','选择套餐','套餐'],
  contact_name: ['经办人完整姓名','经办人姓名','经办人','联系人'],
  phone: ['经办人联系电话（手机）','经办人联系电话','经办人手机号','联系电话','手机号码','手机号','手机','电话'],
  id_number: ['经办人身份证号码','经办人身份证号','身份证号码','身份证号','身份证'],
  email: ['经办人E-MAIL','经办人邮箱','电子邮箱','邮箱','E-MAIL','EMAIL'],
  payment_method: ['付款方式','支付方式','付款'],
  bank_name: ['开户银行','开户行'], bank_account: ['银行账号','银行账户','银行帐号','银行卡号','账号'],
  extra_legal_name: ['法定代表人','法人代表','法人'],
  extra_legal_id: ['法定代表人身份证号码','法定代表人身份证号','法人身份证号码','法人身份证号'],
  extra_user_name: ['使用人（实名制）','实名制使用人','使用人'],
  extra_user_id: ['使用人（实名制）身份证号码','实名制使用人身份证号','使用人身份证号码','使用人身份证号']
};
export const titles = Object.fromEntries(Object.entries(fields).map(([key,names]) => [key,names[0]]));
export const companyTitles = {
  extra_credit_code:'统一社会信用代码', extra_industry:'企业所属行业', extra_company_size:'企业规模', extra_computer_count:'企业计算机数量'
};
const aliases = Object.entries(fields).flatMap(([key,names]) => names.map(name => [name.normalize('NFKC').toLowerCase(),key]));
const keyByAlias = new Map(aliases);
const escaped = [...keyByAlias.keys()].sort((a,b) => b.length-a.length).map(alias =>
  [...alias].map(ch=>ch==='-'?'[-‐‑–—]':ch.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')).join('[ \\t]*'));
const marker = new RegExp('(?:^|[\\n,;。]|[ \\t]+)[ \\t]*(?:\\d{1,2}[、.．)）][ \\t]*)?('+escaped.join('|')+')[ \\t]*(?:[:=]|是|为|[ \\t]+)[ \\t]*','giu');
const missingValue = /^(?:[-—/]|无|待定|暂无|未提供|不详|待补充|现金\s*[/／]\s*托收)$/;
function normalize(key, value) {
  let text = value.trim().replace(/[。;；,，、]+$/u,'').trim();
  if (!text || missingValue.test(text)) return '';
  if (key==='payment_method') return ({现金:'cash',托收:'collection',cash:'cash',collection:'collection'})[text] || text;
  if (key==='phone') {
    const digits=text.replace(/[ \t‐‑–—-]/gu,'');
    if (/^1\d{10}$/.test(digits)) return digits;
  }
  if (key==='bank_account') text=text.replace(/[ -]/g,'');
  if (['id_number','extra_legal_id','extra_user_id'].includes(key)) text=text.toUpperCase();
  return text;
}
export function parseReply(raw) {
  const text = raw.slice(0,12000).normalize('NFKC').replace(/\r/g,'\n');
  const found = {};
  function add(key, value) {
    const cleaned=normalize(key,value);
    if (cleaned) (found[key] ||= new Set()).add(cleaned);
  }
  const matches=[...text.matchAll(marker)];
  for (const [i,m] of matches.entries()) {
    const key=keyByAlias.get(m[1].toLowerCase().replace(/[ \t]/g,'').replace(/[‐‑–—]/g,'-'));
    const segment=text.slice(m.index+m[0].length, matches[i+1]?.index ?? text.length);
    const value=segment.split(/[\n,;。]/)[0].trim();
    add(key,value);
  }
  // Only infer values with a distinctive format from unlabeled clauses.
  for (const clause of text.split(/[,;。\n]/).map(s=>s.trim()).filter(Boolean)) {
    if ([...(' '+clause).matchAll(marker)].length) continue;
    const mail=clause.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/ig)||[];
    for(const value of mail) add('email',value);
    for(const m of clause.matchAll(/(?<!\d)1\d{10}(?!\d)/g)) add('phone',m[0]);
    if(/^(?:我们(?:公司)?(?:是|叫)|我司(?:为|是)?|公司叫)?[\u4e00-\u9fa5A-Za-z0-9（）()·]{2,60}(?:有限公司|股份公司|合伙企业)$/.test(clause))
      add('company_name',clause.replace(/^(?:我们(?:公司)?(?:是|叫)|我司(?:为|是)?|公司叫)/,''));
    const spoken=[
      ['install_address',/^(?:装在|安装在|安装到)(.+)$/], ['billing_address',/^(?:账单寄到|账单寄往)(.+)$/],
      ['contact_name',/^(?:由|经办人|联系人)([\u4e00-\u9fff·]{2,8}?)(?:经办|办理)?$/],
      ['bank_name',/^(?:开户行|开户银行)(.+银行.*|.+支行)$/],
      ['id_number',/^(?:经办人身份证号?|身份证号?)(\d{17}[\dXx])$/],
      ['tariff',/^(?:我们选|选用|选的是|选择)(.+套餐.+)$/]
    ];
    for(const [key,pattern] of spoken){const m=clause.match(pattern);if(m)add(key,m[1]);}
    if (/^(?:用|走|选择|付)?(?:现金|托收)(?:付款|支付)?$/.test(clause))
      add('payment_method', clause.includes('托收')?'托收':'现金');
  }
  return Object.fromEntries(Object.entries(found).map(([key,set])=>[key,[...set]]));
}
export function validValue(key, value) {
  if (!value || value.length>500 || /[\n{}*]/.test(value)) return false;
  if (key==='phone') return /^1\d{10}$/.test(value);
  if (['id_number','extra_legal_id','extra_user_id'].includes(key)) return /^\d{17}[\dX]$/i.test(value);
  if (key==='email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (key==='phone') {
    const digits=text.replace(/[ \t‐‑–—-]/gu,'');
    if (/^1\d{10}$/.test(digits)) return digits;
  }
  if (key==='bank_account') return /^\d{6,32}$/.test(value);
  if (key==='payment_method') return ['cash','collection'].includes(value);
  return true;
}
export function requiredKeys(voice, payment) {
  return Object.keys(fields).filter(key => (!key.startsWith('extra_') || voice) &&
    (!key.startsWith('bank_') || payment==='collection'));
}
export function followup(missing) {
  return missing.length ? '您好，办理商务专线新装还需补充或核对以下资料：\n'+
    missing.map((key,i)=>(i+1)+'、'+(key==='payment_method'?'付款方式（现金或托收）':titles[key])+'。').join('\n')+'\n谢谢！' : '';
}
export function matchReplyTariff(text, choices) {
  const flat = s=>s.normalize('NFKC').toLowerCase().replace(/\s/g,'');
  const raw=flat(text);
  const names=choices.filter(t=>raw.includes(flat(t.name).split('(')[0]));
  const speed=raw.match(/(\d+(?:\.\d+)?)m(?:bps)?/i);
  const price=raw.match(/(\d+(?:\.\d+)?)元/);
  const matched=choices.filter(t=>(!names.length||names.includes(t)) && (!speed||flat(t.bandwidth)===speed[1]+'m') &&
    (!price||Number(t.amount)===Number(price[1])) && (!/[年日季]/.test(raw)||raw.includes('/'+t.cycle)));
  if (/年|季度|按日/.test(raw)) return '';
  if (names.length>1 || (!names.length && !(speed && price && /月/.test(raw)))) return '';
  return matched.length===1?matched[0].id:'';
}
export function staffEstimates(input) {
  const s=String(input??'').trim();
  if(!/^\d{1,7}$/.test(s)) return null;
  const n=Number(s), computers=n*2;
  return {
    people:n, computers,
    extra_company_size:n<10?'10人以下':n<=30?'10-30人':n<=80?'31-80人':n<=200?'81-200人':'200人以上',
    extra_computer_count:computers<=5?'5台及以下':computers<=15?'6-15台':computers<=40?'16-40台':computers<=100?'41-100台':'100台以上'
  };
}
export function lookupFixture(name) {
  if (!['虚构测试企业','润网流程验收测试有限公司'].includes(name.trim())) return null;
  return {extra_credit_code:'TEST00000000000001',extra_industry:'软件和信息技术服务业',insured:'8'};
}
