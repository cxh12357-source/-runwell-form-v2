import test from 'node:test';
import assert from 'node:assert/strict';
import {businessText,parseReply,requiredKeys,matchReplyTariff,followup,validValue,lookupFixture,staffEstimates} from '../frontend/modules/forms/intake-rules.js';
import {tariffs} from '../backend/modules/forms/preview/rules.mjs';

test('两种版本复制的原文、条件银行字段及语音实名字段',()=>{
  assert.match(businessText.no_voice.materials,/最后一页委托单位处加盖公章/);
  assert.doesNotMatch(businessText.no_voice.info,/法定代表人/);
  assert.match(businessText.voice.info,/14、使用人（实名制）身份证号码/);
  assert.match(businessText.voice.materials,/上门受理/);
  assert.equal(requiredKeys(true,'collection').length,15);
  assert.equal(requiredKeys(false,'cash').length,9);
});
test('单段回复、编号清单、自然语句，付款和两种地址单独识别',()=>{
  const free=parseReply('我们公司叫润网流程验收测试有限公司，装在虚构一路1号，账单寄到虚构二路2号，经办人测试甲，手机10000000000，邮箱：qa@example.invalid，走托收');
  assert.deepEqual(free,{email:['qa@example.invalid'],company_name:['润网流程验收测试有限公司'],install_address:['虚构一路1号'],billing_address:['虚构二路2号'],contact_name:['测试甲'],phone:['10000000000'],payment_method:['collection']});
  const rows=parseReply('1、企业全称：虚构测试企业\n2、安装地址：甲\n3、账单地址：乙\n9、付款方式：现金/托收');
  assert.deepEqual(rows,{company_name:['虚构测试企业'],install_address:['甲'],billing_address:['乙']});
});
test('只追问开户行或缺失实名资料；不向客户提内部字段',()=>{
  const first=parseReply('企业全称：虚构测试企业，安装地址：甲，账单地址：乙，套餐：测试套餐 C，经办人：测试甲，手机号：10000000000，身份证号：000000000000000000，邮箱：qa@example.invalid，付款方式：托收，银行账号：000000654321');
  const missing=(voice, parsed)=>requiredKeys(voice,parsed.payment_method?.[0]).filter(k=>!validValue(k,parsed[k]?.[0]));
  assert.deepEqual(missing(false,first),['bank_name']);
  assert.deepEqual(missing(false,{...first,...parseReply('开户行：虚构测试银行')}),[]);
  assert.deepEqual(missing(true,{...first,payment_method:['cash']}),['extra_legal_name','extra_legal_id','extra_user_name','extra_user_id']);
  assert.doesNotMatch(followup(missing(false,first)),/账号|信用代码|行业|参保/);
  assert.equal(followup([]),'');assert.deepEqual(parseReply('邮箱：a@example.invalid，邮箱：b@example.invalid').email.length,2);
  assert.equal(validValue('id_number','123'),false);
});
test('套餐唯一选择；只给金额、冲突带宽、不同周期均不猜',()=>{
  const choices=tariffs.filter(t=>!t.voice_required);
  assert.equal(matchReplyTariff('测试套餐 C',choices),'demo-c');
  assert.equal(matchReplyTariff('200M 900元/月',choices),'demo-b');
  for(const s of ['900元/月','测试套餐 A 200M','测试套餐 B 900元/年','测试套餐 A 及测试套餐 B'])
    assert.equal(matchReplyTariff(s,choices),'',s);
});
test('样例按企业全称精确命中；零、分档边界和未知参保数',()=>{
  assert.equal(lookupFixture('虚构测试企'),null);
  const d=staffEstimates(lookupFixture('虚构测试企业').insured);
  assert.equal(d.people,8);assert.equal(d.extra_company_size,'10人以下');assert.equal(d.computers,16);
  assert.equal(d.extra_computer_count,'16-40台');
  assert.equal(staffEstimates(0).extra_computer_count,'5台及以下');
  assert.equal(staffEstimates(10).extra_company_size,'10-30人');
  assert.equal(staffEstimates(201).extra_company_size,'200人以上');
  for(const x of ['',null,'未披露','8至10'])assert.equal(staffEstimates(x),null);
});
