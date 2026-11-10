import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { generation, bindGeneration } from '../frontend/modules/forms/generate.js';
import { bindIntake } from '../frontend/modules/forms/intake.js';
import { bindDefaults } from '../frontend/modules/forms/defaults.js';
import { labels } from '../backend/modules/forms/preview/rules.mjs';

function page() {
  const styles=readFileSync(new URL('../frontend/styles.css',import.meta.url),'utf8');
  const dom=new JSDOM('<style>'+styles+'</style><div id="root">'+generation(labels)+'<div role="status"></div></div>');
  const root=dom.window.document.querySelector('#root'), form=root.querySelector('form');
  const input=(name,value,event='input')=>{
    const element=form.elements.namedItem(name);
    element.value=value;
    element.dispatchEvent(new dom.window.Event(event,{bubbles:true}));
  };
  return {dom,root,form,input};
}

test('非商务自定义模板按实际映射显示必需企业和实名资料，并提交这些字段',async t=>{
  const {dom,root,form,input}=page();
  const originals={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch};
  globalThis.Event=dom.window.Event;
  globalThis.FormData=dom.window.FormData;
  t.after(()=>Object.assign(globalThis,originals));
  const tariff={id:'ip-test',name:'测试专线',business_id:'ipman',business_version_id:'ip-version',business_attribute:'new',
    voice_required:false,bandwidth:'100M',cycle:'年',amount:'100'};
  const candidate={id:'ip-template',name:'IPMAN 测试模板',revision:'测试版',
    extra_fields:['extra_credit_code','extra_legal_name','extra_legal_id']};
  const state={hosted:false,catalog:{businesses:[{id:'ipman',name:'IPMAN'}],attributes:[{id:'new',name:'新装'}],versions:[]},
    workspace:{tariffs:[tariff]}};
  let submitted;
  globalThis.fetch=async (url,init)=>{
    if(url.endsWith('/match'))return new Response(JSON.stringify({data:{status:'unique',basis:['测试'],match_token:'token',candidates:[candidate]}}));
    if(url.endsWith('/generate')){submitted=JSON.parse(init.body);return new Response(JSON.stringify({data:{id:'record',tariff}}));}
    throw new Error('unexpected request '+url);
  };
  bindGeneration(root,state);
  for(const [key,value] of [['biz','ipman'],['business_name','测试专线'],['attr','new'],['voice','no'],['discount','no']])input(key,value,'change');
  assert.equal(root.querySelector('#company-fields').hidden,true);
  assert.equal(root.querySelector('#voice-fields').hidden,true);
  await root.querySelector('#match').onclick();
  assert.equal(root.querySelector('#intake').hidden,true,'不为其他业务展示商务专线话术');
  assert.equal(root.querySelector('#company-fields').hidden,false);
  assert.equal(root.querySelector('#voice-fields').hidden,false);
  assert.equal(form.elements.extra_credit_code.required,true);
  assert.equal(form.elements.extra_legal_name.required,true);
  assert.equal(form.elements.extra_legal_id.required,true);
  assert.equal(form.elements.extra_legal_name.disabled,false);
  assert.equal(form.elements.extra_legal_id.disabled,false);
  assert.equal(dom.window.getComputedStyle(form.elements.extra_user_name.closest('label')).display,'none');
  assert.equal(form.elements.extra_user_name.disabled,true);
  assert.equal(dom.window.getComputedStyle(form.elements.extra_industry.closest('label')).display,'none');
  assert.equal(dom.window.getComputedStyle(form.elements.insured.closest('label')).display,'none');
  for(const [key,value] of [['company_name','虚构测试企业'],['install_address','虚构一路'],['contact_name','测试甲'],
    ['phone','10000000000'],['id_number','000000000000000000'],['email','a@b.invalid'],['payment_method','cash']])input(key,value,key==='payment_method'?'change':'input');
  assert.equal(form.checkValidity(),false,'模板资料缺失仍须阻止生成');
  input('extra_credit_code','TEST00000000000001');
  input('extra_legal_name','测试法人');
  input('extra_legal_id','000000000000000001');
  assert.equal(form.checkValidity(),true);
  await form.onsubmit({preventDefault(){}});
  assert.equal(submitted.customer.extra_credit_code,'TEST00000000000001');
  assert.equal(submitted.customer.extra_legal_name,'测试法人');
  assert.equal(submitted.customer.extra_legal_id,'000000000000000001');
  assert.equal(Object.hasOwn(submitted.customer,'extra_user_name'),false);
  input('voice','yes','change');
  assert.equal(root.querySelector('#company-fields').hidden,true,'取消匹配后隐藏非必需资料');
  assert.equal(root.querySelector('#voice-fields').hidden,true);
});

test('商务语音与空白担保书的资料显示保持原有逻辑',()=>{
  const {dom,root,form}=page();
  const defaults=bindDefaults(form), intake=bindIntake(form,defaults);
  const setSelect=(name,value)=>{
    const element=form.elements.namedItem(name);
    element.innerHTML='<option value="'+value+'">'+value+'</option>';
    element.value=value;
    element.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  };
  setSelect('biz','business-line');
  setSelect('business_name','100M');
  setSelect('attr','new');
  setSelect('voice','no');
  assert.equal(root.querySelector('#intake').hidden,false);
  assert.equal(root.querySelector('#company-fields').hidden,false);
  assert.equal(root.querySelector('#voice-fields').hidden,true);
  setSelect('voice','yes');
  assert.equal(root.querySelector('#voice-fields').hidden,false);
  for(const key of ['extra_legal_name','extra_legal_id','extra_user_name','extra_user_id']) {
    assert.equal(form.elements.namedItem(key).disabled,false);
    assert.notEqual(dom.window.getComputedStyle(form.elements.namedItem(key).closest('label')).display,'none');
  }
  setSelect('business_name','外地公司担保书');
  intake.setExtras(['guarantee_company','guarantee_credit']);
  assert.equal(root.querySelector('#intake').hidden,true);
  assert.equal(root.querySelector('#company-fields').hidden,true);
  assert.equal(root.querySelector('#voice-fields').hidden,true);
  assert.equal(form.elements.extra_credit_code.required,false);
  assert.equal(form.elements.extra_legal_name.disabled,true);
});
