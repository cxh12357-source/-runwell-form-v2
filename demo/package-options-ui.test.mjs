import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {bindPackageOptions} from '../frontend/modules/forms/package-options.js';
import {generation,bindGeneration} from '../frontend/modules/forms/generate.js';
import {labels} from '../backend/modules/forms/preview/rules.mjs';

const fields=['package_line_type','package_existing_number','package_fttr','package_disk','package_free_ext',
  'package_plugin','package_landline_count','package_cloudphone_count','package_mobile_count','package_secondary_count',
  'package_paid_ext_count','package_speed'];
const meta={fields,speed:['200m_month','200m_year','300m_month','300m_year','500m_month','500m_year']};
function prepare() {
  const dom=new JSDOM('<form><section id="package-options" hidden></section></form>');
  const form=dom.window.document.querySelector('form'), root=form.querySelector('section');
  const options=bindPackageOptions(form);
  const change=(selector,value)=>{
    const input=form.querySelector(selector);
    if(input.type==='checkbox')input.checked=value;
    else input.value=value;
    input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    return input;
  };
  return {dom,form,root,options,change};
}

test('已核验套餐默认纯新装，选择在用宽带时要求号码并按模板提供升速档',()=>{
  const {dom,form,root,options,change}=prepare();
  options.choose(meta);
  assert.equal(root.hidden,false);
  assert.equal(form.elements.package_line_type.value,'new');
  assert.equal(form.elements.package_existing_number.disabled,true);
  assert.equal(new dom.window.FormData(form).has('package_existing_number'),false);
  assert.equal(form.elements.package_speed.value,'');
  assert.match(root.textContent,/29元\/月\/线，限时优惠至2026年12月31日/);
  assert.match(root.textContent,/优惠截止后，请核实实际资费/);
  assert.equal(form.elements.package_speed.querySelector('[value="1000m_year"]'),null);
  for(const key of ['package_fttr','package_disk','package_free_ext','package_plugin'])assert.equal(form.elements[key].checked,false);
  change('[name="package_line_type"]','existing');
  assert.equal(form.elements.package_existing_number.disabled,false);
  assert.equal(form.elements.package_existing_number.required,true);
  assert.equal(form.elements.package_existing_number.checkValidity(),false);
  change('[name="package_existing_number"]','虚构在用宽带号码');
  assert.equal(form.elements.package_existing_number.checkValidity(),false);
  change('[name="package_existing_number"]','02112345678');
  assert.equal(form.elements.package_existing_number.checkValidity(),true);
  change('[name="package_existing_number"]','021-12345678');
  assert.equal(form.elements.package_existing_number.checkValidity(),true);
  change('[name="package_existing_number"]','1'.repeat(41));
  assert.equal(form.elements.package_existing_number.checkValidity(),false);
  change('[name="package_line_type"]','new');
  assert.equal(new dom.window.FormData(form).has('package_existing_number'),false);
  options.choose(null);
  assert.equal(root.hidden,true);
  assert.equal(root.querySelector('input'),null);
});

test('设备依赖、固话和主副卡数量校验，错误发生在折叠区时自动展开',()=>{
  const {form,root,options,change}=prepare();
  options.choose(meta);
  const el=key=>form.elements.namedItem(key);
  const toggle=(key,value=true)=>change('[data-package-toggle="'+key+'"]',value);
  change('[name="package_free_ext"]',true);
  assert.equal(el('package_free_ext').checkValidity(),false);
  assert.equal(el('package_free_ext').closest('details').open,true,'免费包的错误展开免费包');
  change('[name="package_fttr"]',true);
  assert.equal(el('package_free_ext').checkValidity(),true);
  change('[name="package_plugin"]',true);
  assert.equal(el('package_plugin').checkValidity(),true);
  change('[name="package_free_ext"]',false);
  assert.equal(el('package_plugin').checkValidity(),false);
  toggle('package_paid_ext_count');
  assert.equal(el('package_paid_ext_count').required,true);
  assert.equal(el('package_paid_ext_count').checkValidity(),false);
  assert.equal(el('package_paid_ext_count').closest('details').open,true,'收费包的错误展开收费包');
  change('[name="package_paid_ext_count"]','1');
  assert.equal(el('package_paid_ext_count').checkValidity(),true);
  assert.equal(el('package_plugin').checkValidity(),true);
  change('[name="package_fttr"]',false);
  assert.equal(el('package_paid_ext_count').checkValidity(),false);
  change('[name="package_fttr"]',true);
  toggle('package_landline_count'); toggle('package_cloudphone_count');
  change('[name="package_landline_count"]','3');
  change('[name="package_cloudphone_count"]','2');
  assert.equal(el('package_cloudphone_count').checkValidity(),false);
  change('[name="package_cloudphone_count"]','1');
  assert.equal(el('package_cloudphone_count').checkValidity(),true);
  toggle('package_mobile_count'); toggle('package_secondary_count');
  change('[name="package_mobile_count"]','2');
  change('[name="package_secondary_count"]','5');
  assert.equal(el('package_secondary_count').checkValidity(),false);
  change('[name="package_secondary_count"]','4');
  assert.equal(el('package_secondary_count').checkValidity(),true);
  change('[name="package_mobile_count"]','6');
  assert.equal(el('package_mobile_count').checkValidity(),false);
  toggle('package_mobile_count',false);
  assert.equal(el('package_mobile_count').disabled,true);
  assert.equal(el('package_secondary_count').checkValidity(),false);
});

test('不带语音模板选择语音或移动业务时及时提示，取消后不误报',()=>{
  const {root,options,change}=prepare();
  options.choose({...meta,voice:false});
  const notice=root.querySelector('[data-package-voice-warning]');
  assert.equal(notice.hidden,true);
  change('[data-package-toggle="package_cloudphone_count"]',true);
  assert.equal(notice.hidden,false);
  assert.match(notice.textContent,/授权书、实名资料及手续材料/);
  change('[data-package-toggle="package_cloudphone_count"]',false);
  assert.equal(notice.hidden,true);
  options.choose({...meta,voice:true});
  change('[data-package-toggle="package_mobile_count"]',true);
  assert.equal(root.querySelector('[data-package-voice-warning]').hidden,true);
});

test('匹配到声明支持的模板后，页面提交所选套餐字段',async t=>{
  const dom=new JSDOM('<div id="root">'+generation(labels)+'<div role="status"></div></div>');
  const root=dom.window.document.querySelector('#root'), form=root.querySelector('form');
  const originals={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch};
  globalThis.Event=dom.window.Event;globalThis.FormData=dom.window.FormData;
  t.after(()=>Object.assign(globalThis,originals));
  const candidate={id:'reviewed-business-100m-no-voice',name:'测试原表',revision:'测试版',
    reviewed_controls:{groups:[],inputs:[],package_options:meta},extra_fields:fields};
  const tariff={id:'one-year',name:'100M',reviewed_id:'business-100m-no-voice',template_id:candidate.id,business_id:'business-line',
    business_version_id:'reviewed-no-voice',business_attribute:'new',voice_required:false,bandwidth:'100M',cycle:'年',amount:'100'};
  const state={hosted:false,catalog:{businesses:[{id:'business-line',name:'商务专线'}],attributes:[{id:'new',name:'新装'}],versions:[]},workspace:{tariffs:[tariff]}};
  let submitted;
  globalThis.fetch=async (url,init)=>{
    if(url.endsWith('/match'))return new Response(JSON.stringify({data:{status:'unique',basis:['测试'],match_token:'token',candidates:[candidate]}}));
    if(url.endsWith('/generate')){submitted=JSON.parse(init.body);return new Response(JSON.stringify({data:{id:'record',tariff}}));}
    throw Error('unexpected request');
  };
  bindGeneration(root,state);
  function set(key,value,event='change'){
    const input=form.elements.namedItem(key);
    if(input.type==='checkbox')input.checked=value;else input.value=value;
    input.dispatchEvent(new dom.window.Event(event,{bubbles:true}));
  }
  for(const [key,value] of [['biz','business-line'],['business_name','100M 智云上海专线基础版'],['attr','new'],['voice','no'],['discount','no']])set(key,value);
  await root.querySelector('#match').onclick();
  assert.equal(root.querySelector('#package-options').hidden,false);
  set('package_fttr',true);set('package_free_ext',true);set('package_speed','200m_year');
  const toggle=root.querySelector('[data-package-toggle="package_landline_count"]');toggle.checked=true;
  toggle.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  set('package_landline_count','2','input');
  await form.onsubmit({preventDefault(){}});
  assert.equal(submitted.customer.package_line_type,'new');
  assert.equal(submitted.customer.package_fttr,'1');
  assert.equal(submitted.customer.package_free_ext,'1');
  assert.equal(submitted.customer.package_landline_count,'2');
  assert.equal(submitted.customer.package_speed,'200m_year');
  assert.equal(Object.hasOwn(submitted.customer,'package_disk'),false);
  assert.equal(Object.hasOwn(submitted.customer,'package_mobile_count'),false);
});
