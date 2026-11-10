import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {generation,bindGeneration} from '../frontend/modules/forms/generate.js';
import {reviewedControls} from './reviewed-integration.mjs';
import {labels} from '../backend/modules/forms/preview/rules.mjs';

function setup(t,withVoice=false) {
  const dom=new JSDOM('<div id="root">'+generation(labels)+'<div role="status"></div></div>');
  const root=dom.window.document.querySelector('#root'), form=root.querySelector('form');
  const original={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch};
  globalThis.Event=dom.window.Event; globalThis.FormData=dom.window.FormData;
  t.after(()=>Object.assign(globalThis,original));
  const reviewedId=withVoice?'business-100m-voice':'business-100m-no-voice';
  const controls=reviewedControls(reviewedId);
  const candidate={id:'reviewed-'+reviewedId,name:'测试原表',revision:'测试版',reviewed_controls:controls,
    extra_fields:[...controls.inputs.map(x=>x[0]),...controls.groups.map(x=>x.key),'manual_billing_ack']};
  const tariff={id:'one-year',name:'100M',reviewed_id:reviewedId,template_id:candidate.id,
    business_id:'business-line',business_version_id:withVoice?'reviewed-voice':'reviewed-no-voice',business_attribute:'new',
    voice_required:withVoice,bandwidth:'100M',cycle:'年',amount:'100'};
  const state={hosted:false,catalog:{businesses:[{id:'business-line',name:'商务专线'}],attributes:[{id:'new',name:'新装'}],versions:[]},
    workspace:{tariffs:[tariff]}};
  let submitted;
  globalThis.fetch=async (url,init)=>{
    if(url.endsWith('/match'))return new Response(JSON.stringify({data:{status:'unique',basis:['测试'],match_token:'token',candidates:[candidate]}}));
    if(url.endsWith('/generate')){submitted=JSON.parse(init.body);return new Response(JSON.stringify({data:{id:'record',tariff}}));}
    throw new Error('unexpected request '+url);
  };
  bindGeneration(root,state);
  const input=(name,value,event='input')=>{
    const element=form.elements.namedItem(name);element.value=value;
    element.dispatchEvent(new dom.window.Event(event,{bubbles:true}));
  };
  return {dom,root,form,input,submitted:()=>submitted};
}

const reply='企业全称：虚构测试企业，安装地址：虚构一路，经办人：测试甲，手机号：10000000000，身份证号：000000000000000000';
function choose(input,voice='no') {
  for(const [key,value] of [['biz','business-line'],['business_name','100M 智云上海专线基础版'],
    ['attr','new'],['voice',voice],['discount','no']])input(key,value,'change');
}
function proxy(root,key) { return root.querySelector('[data-proxy-for="'+key+'"]'); }

test('保留原有业务选择、客户话术及查询入口，识别后只展示缺项',async t=>{
  const {dom,root,form,input,submitted}=setup(t);
  choose(input);
  await root.querySelector('#match').onclick();
  assert.equal(root.querySelector('#customer-fields').open,false);
  assert.equal(root.querySelector('#company-fields').open,false);
  assert.equal(root.querySelector('#voice-fields').hidden,true);
  assert.equal(root.querySelector('#intake').hidden,false);
  assert.ok(root.querySelector('#info-text').value.includes('【商务专线·新装】'));
  assert.ok(root.querySelector('#read-reply'));
  assert.equal(root.querySelector('#company-lookup').hidden,false);
  assert.ok(root.querySelector('#lookup-fixture').textContent.includes('企查查'));
  assert.ok(root.querySelector('#company-lookup').textContent.includes('暂未接入'));
  input('company_name','虚构测试企业','change');
  root.querySelector('#reply-text').value=reply+'，付款方式：现金';
  root.querySelector('#read-reply').click();
  assert.equal(root.querySelector('#customer-fields').open,false);
  assert.equal(root.querySelector('#missing-profile').hidden,false);
  assert.deepEqual([...root.querySelectorAll('[data-proxy-for]')].map(el=>el.dataset.proxyFor),['email']);
  const mirror=proxy(root,'email');mirror.focus();mirror.value='a@b.invalid';
  mirror.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.elements.email.value,'a@b.invalid');
  assert.equal(root.querySelectorAll('[name="email"]').length,1,'只提交原表单字段');
  assert.ok(proxy(root,'email'),'输入期间不移除焦点');
  mirror.blur();await Promise.resolve();
  assert.equal(root.querySelector('#missing-profile').hidden,true);
  input('install_zip','200001');
  assert.equal(form.checkValidity(),true);
  await form.onsubmit({preventDefault(){}});
  assert.equal(submitted().customer.email,'a@b.invalid');
  assert.equal(submitted().customer.company_name,'虚构测试企业');
  assert.equal(submitted().customer.extra_company_size,'31-80人');
  root.querySelector('#edit-profile').click();
  assert.equal(root.querySelector('#customer-fields').open,true);
  assert.equal(form.elements.company_name.value,'虚构测试企业');
  input('contact_name','测试乙');root.querySelector('#customer-fields').open=false;root.querySelector('#customer-fields').open=true;
  assert.equal(form.elements.contact_name.value,'测试乙');
  assert.equal(form.elements.security_name.value,'测试乙','默认关联仍然生效');
});

test('托收与语音缺项按条件展示，切换后不留下无关字段',t=>{
  const {root,form,input}=setup(t);
  choose(input,'yes');
  root.querySelector('#reply-text').value=reply+'，邮箱：a@b.invalid，付款方式：托收';
  root.querySelector('#read-reply').click();
  assert.equal(root.querySelector('#voice-fields').hidden,false);
  assert.ok(proxy(root,'extra_legal_name'));
  assert.ok(proxy(root,'bank_name'));
  assert.equal(root.querySelector('#bank-fields').disabled,false);
  input('payment_method','cash','change');
  assert.equal(root.querySelector('#bank-fields').disabled,true);
  assert.equal(proxy(root,'bank_name'),null);
  input('voice','no','change');
  assert.equal(root.querySelector('#voice-fields').hidden,true);
  assert.equal(form.elements.extra_legal_name.disabled,true);
  assert.equal(proxy(root,'extra_legal_name'),null);
});

test('未粘贴回复时仍能显示并聚焦必填缺项，保留真实表单控件',async t=>{
  const {root,form,input}=setup(t);
  choose(input);
  await root.querySelector('#match').onclick();
  assert.equal(form.checkValidity(),false);
  assert.equal(root.querySelector('#customer-fields').open,false);
  assert.ok(proxy(root,'company_name'));
  assert.equal(form.elements.company_name.required,true);
  assert.equal(form.contains(form.elements.company_name),true);
  assert.equal(root.querySelector('#missing-profile').hidden,false);
  await Promise.resolve();
  assert.equal(form.ownerDocument.activeElement,proxy(root,'company_name'));
});

test('带语音业务缺少实名资料时，生成前提示补充并阻止提交',async t=>{
  const {root,input}=setup(t,true);
  choose(input,'yes');
  await root.querySelector('#match').onclick();
  root.querySelector('#fill-example').click();
  await root.querySelector('form').onsubmit({preventDefault(){}});
  assert.match(root.querySelector('[role="status"]').textContent,/语音实名资料/);
  for(const key of ['extra_legal_name','extra_legal_id','extra_user_name','extra_user_id']) assert.ok(proxy(root,key));
});

test('其他业务模板需要企业资料时仍可使用原有样例查询',async t=>{
  const dom=new JSDOM('<div id="root">'+generation(labels)+'<div role="status"></div></div>');
  const root=dom.window.document.querySelector('#root'),form=root.querySelector('form');
  const original={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch};
  globalThis.Event=dom.window.Event;globalThis.FormData=dom.window.FormData;
  t.after(()=>Object.assign(globalThis,original));
  const tariff={id:'ip-test',name:'测试专线',business_id:'ipman',business_version_id:'ip-version',
    business_attribute:'new',voice_required:false,bandwidth:'100M',cycle:'年',amount:'100'};
  const candidate={id:'ip-template',name:'IPMAN 测试模板',revision:'测试版',extra_fields:['extra_credit_code']};
  const state={hosted:false,catalog:{businesses:[{id:'ipman',name:'IPMAN'}],attributes:[{id:'new',name:'新装'}],versions:[]},workspace:{tariffs:[tariff]}};
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{status:'unique',basis:['测试'],match_token:'token',candidates:[candidate]}}));
  bindGeneration(root,state);
  for(const [key,value] of [['biz','ipman'],['business_name','测试专线'],['attr','new'],['voice','no'],['discount','no']]) {
    form.elements[key].value=value;form.elements[key].dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  }
  await root.querySelector('#match').onclick();
  assert.equal(root.querySelector('#intake').hidden,true);
  assert.equal(root.querySelector('#company-lookup').hidden,false);
  form.elements.company_name.value='虚构测试企业';
  root.querySelector('#lookup-fixture').click();
  assert.equal(form.elements.extra_credit_code.value,'TEST00000000000001');
  assert.match(root.querySelector('#lookup-status').textContent,/虚构验收样例/);
});
