import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote, renderQuotes, renderQuoteDocument } from '../frontend/modules/quotes.js';

const quote = (overrides = {}) => calculateQuote({business:'商务专线',rate:'100',period:'month',discount:'eight',addon:'300',...overrides});

test('商务专线按周期报价，月付折扣不作用于升速包或初装费', () => {
  const monthly = quote();
  assert.equal(monthly.recurring,700.4);
  assert.equal(monthly.installation,310);
  const yearly = quote({period:'year'});
  assert.equal(yearly.discount,'标准资费');
  assert.equal(yearly.recurring,8680);
  const twoYears = quote({period:'twoYears'});
  assert.equal(twoYears.discount,'标准资费');
  assert.equal(twoYears.recurring,11880);
  assert.equal(twoYears.separateAddon,true);
  assert.equal(twoYears.addonMonthly,150);
});

test('两种速率只接受各自允许的单个升速包，不为未接入的业务计算价格', () => {
  assert.equal(quote({rate:'200',addon:'200'}).addon,'');
  assert.equal(quote({rate:'200',addon:'500'}).addon,'500');
  assert.equal(quote({addon:'200'}).addon,'200');
  assert.equal(quote({addon:['200','300']}).addon,'');
  assert.equal(quote({business:'精品专线'}),null);
  assert.doesNotMatch(renderQuotes(),/智云随选商企云宽/);
});

test('月付折扣档位可挂年付包，预览按年计算升速包并保留月标准资费单位', () => {
  for (const [rate, discount, price] of [
    ['100','eight',6600], ['100','seven',5780], ['200','eight',10450], ['200','seven',9140]
  ]) {
    const result=quote({rate,discount,yearPack:true});
    assert.equal(result.base,price);
    assert.equal(result.recurring,price+1800);
    assert.equal(result.cycle.unit,'年');
  }
  assert.equal(quote({period:'year',yearPack:true}).base,6880);
  assert.equal(quote({discount:'standard',yearPack:true}).base,688);
  assert.match(renderQuoteDocument(quote({yearPack:true})),/688 元\/月.*挂年付包.*6,600 元\/年.*8,400 元\/年/);
});

test('报价单按样例分列费用，并安全写入实际填写的客户资料', () => {
  const now=new Date('2026-11-09T16:00:00Z');
  const doc=renderQuoteDocument(quote(),{customer:'甲 & 乙 <测试>',address:' ',contact:'测试联系人'},now);
  assert.match(doc,/报价日期：<b>2026-11-10<\/b>/);
  assert.match(doc,/甲 &amp; 乙 &lt;测试&gt;/);
  assert.match(doc,/联系方式：<b>测试联系人<\/b>/);
  assert.doesNotMatch(doc,/安装地址：|<测试>/);
  assert.match(doc,/一次性费用.*初装费.*310.*使用费.*标准资费.*550\.4 元\/月.*上行升速300M.*700\.4 元\/月.*备注/);
  assert.match(renderQuoteDocument(quote({period:'twoYears'})),/两年付结算待核价.*未计入合计/);
});
