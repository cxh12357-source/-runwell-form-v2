import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import documents from './default-docx.json' with {type:'json'};
import { identifyReviewed } from './reviewed/render.mjs';
import { generateReviewed, reviewedControls } from './reviewed-integration.mjs';
import { generation, bindGeneration } from '../frontend/modules/forms/generate.js';
import { bindDefaults, explicitPostcode, todayInShanghai } from '../frontend/modules/forms/defaults.js';
import { labels } from '../backend/modules/forms/preview/rules.mjs';

function page() {
  const styles=readFileSync(new URL('../frontend/styles.css',import.meta.url),'utf8');
  const dom = new JSDOM('<style>'+styles+'</style><div id="root">' + generation(labels) + '<div role="status"></div></div>');
  const root = dom.window.document.querySelector('#root');
  const form = root.querySelector('form');
  const input = (name, value, event='input') => {
    const element=form.elements.namedItem(name);
    element.value=value;
    element.dispatchEvent(new dom.window.Event(event,{bubbles:true}));
  };
  return {dom,root,form,input};
}

test('自动填写跟随来源，分别手动修改后不被覆盖；地址与邮编切换安全', () => {
  const {dom,form,input}=page();
  const extra=form.querySelector('#extra');
  extra.innerHTML=['install_zip','billing_zip','job_title','security_name','security_role','security_phone','service_use','application_date']
    .map(name=>'<label><input name="'+name+'"></label>').join('');
  const defaults=bindDefaults(form);
  defaults.templateChanged();
  assert.equal(form.elements.service_use.value,'公办');
  assert.equal(form.elements.application_date.value,todayInShanghai());
  input('contact_name','测试甲'); input('phone','10000000000'); input('applicant_role','主管');
  assert.equal(form.elements.security_name.value,'测试甲');
  assert.equal(form.elements.security_phone.value,'10000000000');
  assert.equal(form.elements.security_role.value,'主管');
  assert.equal(form.elements.job_title.value,'主管');
  input('security_name','测试乙'); input('job_title','工程师');
  input('contact_name','测试丙'); input('applicant_role','经理');
  assert.equal(form.elements.security_name.value,'测试乙');
  assert.equal(form.elements.job_title.value,'工程师');
  assert.equal(form.elements.security_role.value,'经理');
  input('install_address','测试路1号 邮编：200001');
  assert.equal(form.elements.billing_address.value,'测试路1号 邮编：200001');
  assert.equal(form.elements.billing_address.disabled,true);
  assert.equal(dom.window.getComputedStyle(form.querySelector('#billing-address-field')).display,'none');
  assert.equal(dom.window.getComputedStyle(form.elements.billing_zip.closest('label')).display,'none');
  assert.equal(form.elements.install_zip.value,'200001');
  assert.equal(form.elements.billing_zip.value,'200001');
  input('billing_address_mode','different','change');
  assert.notEqual(dom.window.getComputedStyle(form.querySelector('#billing-address-field')).display,'none');
  assert.notEqual(dom.window.getComputedStyle(form.elements.billing_zip.closest('label')).display,'none');
  assert.equal(form.elements.billing_address.value,'');
  assert.equal(form.elements.billing_zip.value,'');
  input('billing_address','测试路2号 邮编：200002');
  assert.equal(form.elements.billing_zip.value,'200002');
  input('billing_zip','200003');
  input('billing_address','测试路3号');
  assert.equal(form.elements.billing_zip.value,'');
  input('billing_address_mode','same','change');
  assert.equal(form.elements.billing_address.value,form.elements.install_address.value);
  assert.equal(form.elements.billing_zip.value,form.elements.install_zip.value);
  assert.equal(explicitPostcode('上海市测试路200001号'),'');
  assert.equal(explicitPostcode('邮编 200001，邮编 200002'),'');
  assert.equal(todayInShanghai(new Date('2026-11-10T16:30:00Z')),'2026-11-11');
});

test('整段客户回复中的不同账单地址进入表单，默认信息随之提交', async t => {
  const {dom,root,form,input}=page();
  const originals={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch};
  globalThis.Event=dom.window.Event;
  globalThis.FormData=dom.window.FormData;
  t.after(()=>Object.assign(globalThis,originals));
  const controls=reviewedControls('business-100m-no-voice');
  const candidate={id:'reviewed-business-100m-no-voice',name:'测试原表',revision:'测试版',reviewed_controls:controls,
    extra_fields:[...controls.inputs.map(x=>x[0]),...controls.groups.map(x=>x.key),'manual_billing_ack']};
  const tariff={id:'one-year',name:'100M',reviewed_id:'business-100m-no-voice',template_id:candidate.id,business_id:'business-line',
    business_version_id:'reviewed-no-voice',business_attribute:'new',voice_required:false,bandwidth:'100M',cycle:'年',amount:'100'};
  const state={hosted:false,catalog:{businesses:[{id:'business-line',name:'商务专线'}],attributes:[{id:'new',name:'新装'}],versions:[]},
    workspace:{tariffs:[tariff]}};
  let submitted;
  globalThis.fetch=async (url,init)=>{
    if(url.endsWith('/match'))return new Response(JSON.stringify({data:{status:'unique',basis:['测试'],match_token:'token',candidates:[candidate]}}));
    if(url.endsWith('/generate')){submitted=JSON.parse(init.body);return new Response(JSON.stringify({data:{id:'record',tariff}}));}
    throw new Error('unexpected request '+url);
  };
  bindGeneration(root,state);
  for(const [key,value] of [['biz','business-line'],['business_name','100M 智云上海专线基础版'],['attr','new'],['voice','no'],['discount','no']]) input(key,value,'change');
  await root.querySelector('#match').onclick();
  assert.ok(form.elements.security_name);
  input('applicant_role','主管');
  root.querySelector('#reply-text').value='企业全称：虚构测试企业，安装地址：虚构一路，账单地址：虚构二路，经办人：测试甲，手机号：10000000000，身份证号：000000000000000000，邮箱：a@b.invalid，付款方式：现金';
  root.querySelector('#read-reply').click();
  assert.equal(form.elements.billing_address_mode.value,'different');
  assert.equal(form.elements.billing_address.value,'虚构二路');
  assert.equal(form.elements.security_name.value,'测试甲');
  assert.equal(form.elements.security_role.value,'主管');
  assert.equal(form.elements.security_phone.value,'10000000000');
  for(const [key,value] of [['install_zip','200001'],['billing_zip','200002'],['extra_credit_code','000000000000000000'],
    ['extra_industry','软件'],['extra_company_size','10人以下'],['extra_computer_count','5台及以下']]) input(key,value);
  assert.equal(form.checkValidity(),true);
  await form.onsubmit({preventDefault(){}});
  assert.equal(submitted.customer.billing_address,'虚构二路');
  assert.equal(submitted.customer.choice_billing,'1');
  assert.equal(submitted.customer.billing_zip,'200002');
  assert.equal(submitted.customer.security_name,'测试甲');
  assert.equal(submitted.customer.security_role,'主管');
  assert.equal(submitted.customer.job_title,'主管');
  assert.equal(submitted.customer.service_use,'公办');
  assert.equal(submitted.customer.application_date,todayInShanghai());
  input('billing_address_mode','same','change');
  input('install_address','虚构三路');
  input('install_zip','200003');
  assert.equal(form.checkValidity(),true);
  await form.onsubmit({preventDefault(){}});
  assert.equal(submitted.customer.billing_address,'虚构三路');
  assert.equal(submitted.customer.billing_zip,'200003');
  assert.equal(submitted.customer.choice_billing,'1');
});

test('已核验套餐 Word 写入实际账单地址和默认资料，传真可留空', async t => {
  for(const encoded of documents) {
    const bytes=Uint8Array.from(Buffer.from(encoded,'base64'));
    const plan=await identifyReviewed(bytes);
    if(plan.documentKind==='blank')continue;
    await t.test(plan.id,async()=>{
      const customer={company_name:'虚构测试企业',extra_credit_code:'000000000000000000',extra_industry:'软件',
        install_address:'虚构安装路1号',billing_address:'虚构账单路2号',contact_name:'测试甲',phone:'10000000000',
        id_number:'000000000000000000',email:'a@b.invalid',payment_method:'cash',choice_billing:'1',
        extra_company_size:'10人以下',extra_computer_count:'5台及以下',install_zip:'200001',billing_zip:'200002',
        job_title:'主管',security_name:'测试甲',security_role:'主管',security_phone:'10000000000',
        service_use:'公办',application_date:'2026-11-10',service_type_choice:'0'};
      const result=await generateReviewed({reviewed_id:plan.id,reviewed_cycle:plan.cycles.includes('year')?'year':'document'},bytes,customer);
      const xml=strFromU8(unzipSync(result.file)['word/document.xml']);
      assert.match(xml,/虚构账单路2号/);
      assert.match(xml,/测试甲/);
      assert.match(xml,/主管/);
      assert.match(xml,/2026年11月10日/);
      assert.ok(!result.manualActions.includes('billing_address'));
    });
  }
});
