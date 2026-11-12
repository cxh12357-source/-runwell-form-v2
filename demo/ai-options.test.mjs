import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import sax from 'sax';
import {unzipSync,strFromU8} from 'fflate';
import documents from './default-docx.json' with {type:'json'};
import {generateReviewed,reviewedControls} from './reviewed-integration.mjs';
import {renderAiOptions,bindAiOptions} from '../frontend/modules/forms/ai-options.js';
import {IDBFactory} from 'fake-indexeddb';
import {bundleDemo} from './build.mjs';
import {generation,bindGeneration,generatedMaterials} from '../frontend/modules/forms/generate.js';
import {labels} from '../backend/modules/forms/preview/rules.mjs';

const basic={company_name:'虚构测试企业',extra_credit_code:'000000000000000000',extra_industry:'软件',
  install_address:'虚构安装路',billing_address:'虚构账单路',contact_name:'测试甲',phone:'10000000000',
  id_number:'000000000000000000',email:'test@example.invalid',payment_method:'cash',choice_billing:'1',
  extra_company_size:'31-80人',extra_computer_count:'16-40台',install_zip:'200001',billing_zip:'200002',
  job_title:'IT',security_name:'测试甲',security_role:'IT',security_phone:'10000000000',service_use:'公办',application_date:'2026-11-10',
  service_type_choice:'0'};
function paragraphs(file){
  const xml=strFromU8(unzipSync(file)['word/document.xml']); const result=[];let current=null,inText=false;
  const parser=sax.parser(true,{xmlns:true});
  parser.onopentag=n=>{if(n.local==='p')current='';if(n.local==='t')inText=true;};
  parser.ontext=t=>{if(inText && current!==null)current+=t;};
  parser.onclosetag=name=>{const n=name.split(':').at(-1);if(n==='t')inText=false;if(n==='p'){result.push(current);current=null;}};
  parser.write(xml).close();return result;
}
function source(index){return Uint8Array.from(Buffer.from(documents[index],'base64'));}
async function generate(id,index,extra={}){
  return generateReviewed({reviewed_id:id,reviewed_cycle:'document'},source(index),{...basic,...extra});
}

test('AI 两种内置版均默认纯新装，并按输入写入对应选项及申请线数',async()=>{
  for(const [id,index] of [['business-ai-v1',6],['business-ai-v2-no-voice',7]]){
    const out=await generate(id,index,{ai_line_count:'2',ai_disk:'1',ai_sase:'1',
      ai_it_name:'测试管理员',ai_it_phone:'10000000000',ai_it_email:'it@example.invalid',ai_paid_device:'1',ai_paid_device_count:'3'});
    const p=paragraphs(out.file);
    assert.equal(p[44],'6880元/年/线，申请线数：2线');
    assert.equal(p[46],'■ 纯新装宽带    □ 在用宽带（号码________________）');
    assert.match(p[52],/^■/);assert.match(p[54],/^□/);assert.match(p[64],/^□/);assert.match(p[67],/^■/);
    assert.match(p[68],/测试管理员/);assert.match(p[68],/10000000000/);assert.match(p[69],/it@example.invalid/);
    const box=id==='business-ai-v1'?72:107,quantity=id==='business-ai-v1'?73:108;
    assert.match(p[box],/^■/);assert.match(p[quantity],/订购数量：3/);
    assert.ok(!out.unmappedFields.includes('line_count'));
  }
});

test('AI 在用宽带、云电脑、存量账号及 Token 逐项写入，不擅自订购其他选项',async()=>{
  const out=await generate('business-ai-v1',6,{ai_line_type:'existing',ai_existing_line:'A-1234',ai_line_count:'1',
    ai_cloud:'1',ai_token:'1',ai_ctyun_mode:'existing',ai_ctyun_account:'cloud@example.invalid',ai_bizid:'ACMB123',
    ai_vpc:'172.16.0.0/16',ai_subnet:'172.16.0.0/20'});
  const p=paragraphs(out.file);
  assert.equal(p[46],'□ 纯新装宽带    ■ 在用宽带（号码A-1234）');
  assert.match(p[54],/^■/);assert.match(p[64],/^■/);assert.match(p[52],/^□/);assert.match(p[67],/^□/);
  assert.match(p[59],/cloud@example.invalid/);assert.match(p[59],/□ 新增  ■ 存量/);
  assert.match(p[60],/ACMB123/);assert.match(p[61],/172\.16\.0\.0\/16/);assert.match(p[62],/172\.16\.0\.0\/20/);
  await assert.rejects(generate('business-ai-v1',6,{ai_token:'1'}),/须先订购天翼云电脑/);
  await assert.rejects(generate('business-ai-v1',6,{ai_line_type:'existing'}),/需要填写号码/);
  await assert.rejects(generate('business-ai-v1',6,{ai_paid_device:'1'}),/填写数量/);
});

test('AI 字段类型无效或当前文档不支持该选项时拒绝生成，避免静默丢失选择',async()=>{
  await assert.rejects(generate('business-ai-v1',6,{ai_disk:true}),/AI 套餐选项格式无效/);
  await assert.rejects(generate('business-ai-v1',6,{ai_paid_device_count:3}),/AI 套餐选项格式无效/);
  await assert.rejects(generate('business-ai-v1',6,{ai_fixed:'1'}),/AI 套餐选项尚未核验/);
  await assert.rejects(generate('business-ai-v1',6,{ai_unknown:'1'}),/AI 套餐选项尚未核验/);
  await assert.rejects(generateReviewed({reviewed_id:'business-100m-no-voice',reviewed_cycle:'year'},source(0),
    {...basic,ai_disk:'1'}),/AI 套餐选项尚未核验/);
  await assert.rejects(generateReviewed({reviewed_id:'business-guarantee',reviewed_cycle:'document'},source(0),
    {...basic,ai_disk:'1'}),/AI 套餐选项尚未核验/);
  await assert.doesNotReject(generate('business-ai-v1',6,{ai_fixed:''}));
});

test('AI V2 不带语音原表选语音时，授权内容按明确业务填写或留空并提示核对',async t=>{
  const scenarios=[
    ['不选语音',{},'宽带',false],
    ['仅固话',{ai_fixed:'1',ai_fixed_count:'1'},'宽带、固话',true],
    ['仅手机',{ai_mobile:'1',ai_mobile_count:'1'},'宽带、手机',true],
    ['固话与手机',{ai_fixed:'1',ai_fixed_count:'1',ai_mobile:'1',ai_mobile_count:'1'},'宽带、固话、手机',true],
    ['商云通',{ai_business:'1',ai_business_count:'1'},'',true],
    ['商云通与手机',{ai_business:'1',ai_business_count:'1',ai_mobile:'1',ai_mobile_count:'1'},'',true],
    ['云总机',{ai_switchboard:'1',ai_switchboard_number:'02112345678'},'',true]
  ];
  for(const [name,selection,expected,voice] of scenarios)await t.test(name,async()=>{
    const out=await generate('business-ai-v2-no-voice',7,{ai_line_count:'1',...selection});
    const authorization=paragraphs(out.file).find(text=>text.includes('我单位电信业务经办人为：'))?.replace(/\s/g,'');
    assert.ok(authorization);
    assert.ok(authorization.includes('在贵公司办理'+expected+'（手机/固话/宽带）业务的'),authorization);
    for(const key of ['voice_template','authorization','voice_identity'])
      assert.equal(out.manualActions.includes(key),voice,name+' '+key);
    assert.equal(out.unmappedFields.includes('voice_identity'),false);
  });
  const tariff={business_id:'business-line',business_attribute:'new',reviewed_id:'business-ai-v2-no-voice',voice_required:false};
  assert.match(generatedMaterials(tariff,false),/手续材料提示（不带语音）/);
  const warning=generatedMaterials(tariff,true);
  assert.match(warning,/人工核对适用模板、授权书、带语音实名资料及手续材料/);
  assert.doesNotMatch(warning,/copy-generated-materials/);
});

test('AI V2 免费及收费选项按所选数量写入并校验上限和依赖',async()=>{
  const out=await generate('business-ai-v2-no-voice',7,{ai_line_count:'1',ai_cloud:'1',ai_token:'1',
    ai_ctyun_mode:'new',ai_ctyun_account:'cloud@example.invalid',ai_fixed:'1',ai_fixed_count:'2',ai_business:'1',ai_business_count:'2',
    ai_mobile:'1',ai_mobile_count:'3',ai_sub:'1',ai_sub_count:'5',ai_switchboard:'1',ai_switchboard_number:'02112345678',
    ai_coupon:'service2',ai_coupon_count:'2',ai_coupon_color:'purple'});
  const p=paragraphs(out.file);
  assert.ok(out.manualActions.includes('authorization'),'附加语音业务时提示核对授权书');
  for(const n of [76,77,83,89,93,103])assert.match(p[n],/^■/,String(n));
  assert.match(p[76],/申请线数：2线/);assert.match(p[77],/申请线数：2线/);
  assert.match(p[83],/申请主卡线数：3线/);assert.match(p[89],/数量：5/);assert.match(p[93],/02112345678/);
  assert.match(p[99],/^□/);assert.match(p[103],/订购数量：2/);assert.match(p[105],/□银色  ■紫色/);
  await assert.rejects(generate('business-ai-v2-no-voice',7,{ai_fixed:'1',ai_fixed_count:'3',ai_business:'1',ai_business_count:'2'}),/合计不能超过4线/);
  await assert.rejects(generate('business-ai-v2-no-voice',7,{ai_mobile:'1',ai_mobile_count:'1',ai_sub:'1',ai_sub_count:'3'}),/不能超过主卡数量的两倍/);
  await assert.rejects(generate('business-ai-v2-no-voice',7,{ai_coupon:'service1',ai_coupon_count:'1'}),/需要先订购 Token/);
});

test('AI 网页选项默认新装，取消勾选后隐藏并不提交条件字段',()=>{
  const meta=reviewedControls('business-ai-v2-no-voice').ai_options;
  assert.equal(reviewedControls('business-100m-no-voice').ai_options,null);
  const styles=readFileSync(new URL('../frontend/styles.css',import.meta.url),'utf8');
  const dom=new JSDOM('<style>'+styles+'</style><form>'+renderAiOptions(meta)+'</form>');const form=dom.window.document.querySelector('form');
  bindAiOptions(form);const e=form.elements;
  assert.equal(dom.window.getComputedStyle(e.ai_cloud).width,'auto');
  assert.equal(dom.window.getComputedStyle(e.ai_cloud.closest('label')).display,'flex');
  assert.equal(e.ai_line_type.value,'new');assert.equal(e.ai_line_count.required,true);
  assert.equal(form.querySelector('[data-ai-section="cloud"]').disabled,true);
  e.ai_cloud.checked=true;e.ai_cloud.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(form.querySelector('[data-ai-section="cloud"]').disabled,false);assert.equal(e.ai_ctyun_account.required,true);
  e.ai_ctyun_account.value='test@example.invalid';e.ai_cloud.checked=false;
  e.ai_cloud.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(new dom.window.FormData(form).has('ai_ctyun_account'),false);
});

test('取消 SASE 后管理员资料不提交，重新勾选时保留先前输入',()=>{
  for(const id of ['business-ai-v1','business-ai-v2-no-voice']) {
    const dom=new JSDOM('<form>'+renderAiOptions(reviewedControls(id).ai_options)+'</form>');
    const form=dom.window.document.querySelector('form'),fields=form.elements;
    bindAiOptions(form);
    const admin=form.querySelector('[data-ai-admin]');
    assert.equal(admin.hidden,true);
    assert.equal(form.querySelector('[data-ai-section="admin"]').disabled,true);
    fields.ai_sase.checked=true;
    fields.ai_sase.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(admin.hidden,false);
    assert.equal(fields.ai_it_name.required,true);
    admin.open=false;
    fields.ai_it_name.checkValidity();
    assert.equal(admin.open,true,'收起区域中的必填项无效时应自动展开');
    fields.ai_it_name.value='测试管理员';fields.ai_it_phone.value='10000000000';fields.ai_it_email.value='it@example.invalid';
    fields.ai_sase.checked=false;
    fields.ai_sase.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(admin.hidden,true);
    const data=new dom.window.FormData(form);
    for(const key of ['ai_it_name','ai_it_phone','ai_it_email'])assert.equal(data.has(key),false,key);
    fields.ai_sase.checked=true;
    fields.ai_sase.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(fields.ai_it_name.value,'测试管理员');
    assert.equal(fields.ai_it_phone.value,'10000000000');
    assert.equal(fields.ai_it_email.value,'it@example.invalid');
  }
});

test('未勾选 SASE 时不得提交或写入管理员资料',async()=>{
  for(const [id,index] of [['business-ai-v1',6],['business-ai-v2-no-voice',7]]) {
    const admin={ai_it_name:'测试管理员',ai_it_phone:'10000000000',ai_it_email:'it@example.invalid'};
    await assert.rejects(generate(id,index,{ai_line_count:'1',...admin}),/未订购云脉SASE/);
    const out=await generate(id,index,{ai_line_count:'1'}),p=paragraphs(out.file);
    assert.equal(p[68],'企业IT管理员姓名：______________      电话：__________________');
    assert.equal(p[69],'企业IT管理员邮箱(用于收取业务账号激活邮件)：____________________________');
  }
});

test('AI 选项经过匹配、生成接口及浏览器存储后写入 Word',async()=>{
  const bundle=await bundleDemo('demo/runtime.mjs');
  globalThis.location=new URL('https://demo.example.invalid');
  globalThis.indexedDB=new IDBFactory();
  Object.defineProperty(navigator,'locks',{value:{request:(_,fn)=>fn()},configurable:true});
  const {localFetch}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
  const call=(path,method='GET',data)=>localFetch('/api/v1/forms'+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data&&JSON.stringify(data)});
  async function data(response){const r=await response,body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.data;}
  const workspace=await data(call('/workspace'));
  const tariff=workspace.tariffs.find(t=>t.reviewed_id==='business-ai-v2-no-voice');assert.ok(tariff);
  const selection={tariff_id:tariff.id,business_id:tariff.business_id,business_version_id:tariff.business_version_id,
    business_attribute:tariff.business_attribute,voice_required:tariff.voice_required,bandwidth:tariff.bandwidth,
    cycle:tariff.cycle,amount:tariff.amount,discount_mode:'no'};
  const match=await data(call('/match','POST',{selection}));assert.equal(match.status,'unique');
  const candidate=match.candidates[0];assert.equal(candidate.reviewed_controls.ai_options.version,'v2');
  for(const name of ['ai_line_count','ai_line_type','ai_paid_device_count'])assert.ok(candidate.extra_fields.includes(name));
  const customer={...basic,ai_line_count:'2',ai_paid_device:'1',ai_paid_device_count:'3'};
  const row=await data(call('/generate','POST',{selection,customer,match_token:match.match_token,template_id:candidate.id,request_id:crypto.randomUUID()}));
  const file=await call('/records/'+row.id+'/file');assert.equal(file.status,200);
  const p=paragraphs(new Uint8Array(await file.arrayBuffer()));
  assert.match(p[44],/申请线数：2线/);assert.match(p[46],/^■ 纯新装/);
  assert.match(p[107],/^■ 29元/);assert.match(p[108],/订购数量：3/);
  for(const key of ['voice_template','authorization','voice_identity'])assert.ok(!row.review.includes(key));

  const voiceCustomer={...customer,ai_fixed:'1',ai_fixed_count:'1',ai_mobile:'1',ai_mobile_count:'1'};
  const voiceRow=await data(call('/generate','POST',{selection,customer:voiceCustomer,match_token:match.match_token,template_id:candidate.id,request_id:crypto.randomUUID()}));
  for(const key of ['voice_template','authorization','voice_identity'])assert.ok(voiceRow.review.includes(key));
  const voiceFile=await call('/records/'+voiceRow.id+'/file');assert.equal(voiceFile.status,200);
  const authorization=paragraphs(new Uint8Array(await voiceFile.arrayBuffer())).find(text=>text.includes('我单位电信业务经办人为：'))?.replace(/\s/g,'');
  assert.ok(authorization.includes('在贵公司办理宽带、固话、手机（手机/固话/宽带）业务的'));

  const mixedCustomer={...customer,ai_business:'1',ai_business_count:'1',ai_mobile:'1',ai_mobile_count:'1'};
  const mixedRow=await data(call('/generate','POST',{selection,customer:mixedCustomer,match_token:match.match_token,template_id:candidate.id,request_id:crypto.randomUUID()}));
  assert.ok(mixedRow.review.includes('authorization'));
  const mixedFile=await call('/records/'+mixedRow.id+'/file');assert.equal(mixedFile.status,200);
  const mixedAuth=paragraphs(new Uint8Array(await mixedFile.arrayBuffer())).find(text=>text.includes('我单位电信业务经办人为：'))?.replace(/\s/g,'');
  assert.ok(mixedAuth.includes('在贵公司办理（手机/固话/宽带）业务的'));
});

test('实际表单匹配后显示 AI 选项并提交员工选择',async t=>{
  const dom=new JSDOM('<div id="root">'+generation(labels)+'<div role="status"></div></div>');
  const root=dom.window.document.querySelector('#root'),form=root.querySelector('form');
  const originals={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch};
  globalThis.Event=dom.window.Event;globalThis.FormData=dom.window.FormData;t.after(()=>Object.assign(globalThis,originals));
  const id='business-ai-v2-no-voice',controls=reviewedControls(id);
  const candidate={id:'reviewed-'+id,name:'AI 测试原表',revision:'V2',reviewed_controls:controls,
    extra_fields:[...controls.inputs.map(x=>x[0]),...controls.groups.map(x=>x.key),...controls.ai_options.fields]};
  const tariff={id:'ai-tariff',name:'智云护航 AI 套餐升级 V2 · 不带语音',reviewed_id:id,template_id:candidate.id,business_id:'business-line',
    business_version_id:'reviewed-ai',business_attribute:'new',voice_required:false,bandwidth:'—',cycle:'—',amount:'—'};
  const state={hosted:false,catalog:{businesses:[{id:'business-line',name:'商务专线'}],attributes:[{id:'new',name:'新装'}],versions:[]},workspace:{tariffs:[tariff]}};
  let submitted;globalThis.fetch=async(url,init)=>{
    if(url.endsWith('/match'))return new Response(JSON.stringify({data:{status:'unique',basis:['测试'],match_token:'token',candidates:[candidate]}}));
    if(url.endsWith('/generate')){submitted=JSON.parse(init.body);return new Response(JSON.stringify({data:{id:'record',tariff}}));}
    throw Error('unexpected request');
  };
  bindGeneration(root,state);
  const set=(key,value,type='change')=>{form.elements[key].value=value;form.elements[key].dispatchEvent(new dom.window.Event(type,{bubbles:true}));};
  for(const [key,value] of [['biz','business-line'],['business_name','智云护航 AI 套餐升级'],['attr','new'],['voice','no'],['discount','no']])set(key,value);
  await root.querySelector('#match').onclick();
  assert.equal(form.elements.ai_line_type.value,'new');set('ai_line_count','2','input');
  form.elements.ai_paid_device.checked=true;form.elements.ai_paid_device.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  set('ai_paid_device_count','3','input');
  await form.onsubmit({preventDefault(){}});
  assert.equal(submitted.customer.ai_line_type,'new');assert.equal(submitted.customer.ai_line_count,'2');
  assert.equal(submitted.customer.ai_paid_device,'1');assert.equal(submitted.customer.ai_paid_device_count,'3');
  assert.equal(submitted.customer.ai_disk,undefined);
});
