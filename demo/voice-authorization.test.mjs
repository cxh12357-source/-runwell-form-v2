import assert from 'node:assert/strict';
import test from 'node:test';
import sax from 'sax';
import {unzipSync,strFromU8} from 'fflate';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import documents from './default-docx.json' with {type:'json'};
import {bundleDemo} from './build.mjs';
import {generateReviewed,identifyReviewed,reviewedControls} from './reviewed-integration.mjs';
import {generation,bindGeneration} from '../frontend/modules/forms/generate.js';
import {labels} from '../backend/modules/forms/preview/rules.mjs';

const customer={company_name:'虚构测试企业',extra_credit_code:'TEST00000000000001',extra_industry:'软件',
  install_address:'虚构安装路',billing_address:'虚构安装路',contact_name:'测试甲',phone:'10000000000',
  id_number:'000000000000000000',email:'qa@example.invalid',payment_method:'cash',choice_billing:'1',
  extra_company_size:'31-80人',extra_computer_count:'16-40台',install_zip:'200001',billing_zip:'200001',
  job_title:'IT',security_name:'测试甲',security_role:'IT',security_phone:'10000000000',
  service_use:'办公',application_date:'2026-11-10'};

function paragraphs(file) {
  const xml=strFromU8(unzipSync(file)['word/document.xml']);
  const parser=sax.parser(true), lines=[];let current=null,inText=false;
  parser.onopentag=({name})=>{if(name==='w:p')current='';if(name==='w:t')inText=true;};
  parser.ontext=value=>{if(inText && current!==null)current+=value;};
  parser.onclosetag=name=>{if(name==='w:t')inText=false;if(name==='w:p'){lines.push(current.replace(/\s/g,''));current=null;}};
  parser.write(xml).close();return lines;
}

test('所有内置套餐授权书使用当前客户单位和代码，受托员工暂时留空',async t=>{
  for(const encoded of documents) {
    const original=Uint8Array.from(Buffer.from(encoded,'base64'));
    const plan=await identifyReviewed(original);
    for(const current of [customer,{...customer,company_name:'虚构其他客户企业',extra_credit_code:'TEST00000000000002'}])
    await t.test(plan.id+' '+current.company_name,async()=>{
      const result=await generateReviewed({reviewed_id:plan.id,reviewed_cycle:plan.cycles.includes('year')?'year':'document'},original,
        {...current,service_type_choice:'0'});
      const lines=paragraphs(result.file);
      const auth=lines.find(line=>line.includes('现全权委托本单位员工')||line.includes('我单位电信业务经办人为：'));
      assert.ok(auth);
      assert.ok(auth.includes(`本单位${current.company_name}（统一社会信用代码为${current.extra_credit_code}）`));
      assert.ok(auth.includes('实际用途为办公')||auth.includes('用于：办公'));
      assert.ok(auth.includes('现全权委托本单位员工（身份证号为）')||auth.includes('我单位电信业务经办人为：（身份证号为）'));
      assert.ok(!auth.includes('上海润网通讯网络有限公司'));
      assert.ok(!auth.includes(current.contact_name));
      assert.ok(!auth.includes(current.id_number));
      assert.ok(lines.some(line=>line.includes(current.company_name)),'客户申请资料依然使用客户名称');
      assert.ok(result.manualActions.includes('authorization_employee'));
    });
    await assert.rejects(generateReviewed({reviewed_id:plan.id,reviewed_cycle:plan.cycles.includes('year')?'year':'document'},original,
      {...customer,extra_credit_code:'',service_type_choice:'0'}),/请填写并核对统一社会信用代码/);
  }
});

test('100M 和 200M 带语音授权书使用客户单位，受托员工和签章日期留空',async t=>{
  for(const [id,index] of [['business-100m-voice',2],['business-200m-voice',5]]) {
    const original=Uint8Array.from(Buffer.from(documents[index],'base64'));
    const before=Buffer.from(original), tariff={reviewed_id:id,reviewed_cycle:'month'};
    for(const [label,extra,expected] of [
      ['默认宽带',{},'宽带'],
      ['固话',{service_type_choice:'1',package_landline_count:'1'},'宽带、固话'],
      ['手机',{service_type_choice:'2',package_mobile_count:'1'},'宽带、手机'],
      ['固话与手机',{service_type_choice:'3',package_landline_count:'1',package_mobile_count:'1'},'宽带、固话、手机'],
      ['商云通人工确认',{service_type_choice:'1',package_cloudphone_count:'1'},'宽带、固话']
    ]) await t.test(id+' '+label,async()=>{
      const result=await generateReviewed(tariff,original,{...customer,...extra});
      const lines=paragraphs(result.file),index=lines.findIndex(line=>line.includes('现全权委托本单位员工'));
      assert.ok(index>=0);
      assert.equal(lines[index],`本单位${customer.company_name}（统一社会信用代码为${customer.extra_credit_code}），现全权委托本单位员工（身份证号为），至贵公司办理${expected}（手机/固话/宽带）业务的新装（新装/移机/变更/改性能/拆机）事宜，其实际用途为${customer.service_use}。`);
      assert.ok(lines.some(line=>line.includes(customer.company_name)),'客户申请资料仍保留客户企业');
      assert.ok(lines.slice(index+1,index+8).includes('（盖章）'));
      assert.ok(lines.slice(index+1,index+8).includes('日期：年月日'));
      assert.ok(result.unmappedFields.includes('voice_identity'));
      assert.ok(result.manualActions.includes('authorization'));
      assert.ok(result.manualActions.includes('authorization_employee'));
      if(label==='商云通人工确认')assert.ok(result.manualActions.includes('authorization_service_type'));
    });
    await assert.rejects(generateReviewed(tariff,original,{...customer,service_type_choice:'0',package_landline_count:'1'}),/不一致/);
    await assert.rejects(generateReviewed(tariff,original,{...customer,service_type_choice:'1',package_mobile_count:'1'}),/不一致/);
    assert.deepEqual(Buffer.from(original),before,'未修改原始模板');
  }
});

test('带语音业务类型默认宽带，按已勾选业务推导并保留手动选择',async t=>{
  assert.equal(reviewedControls('business-ai-v1').groups.find(group=>group.key==='service_type_choice').default,'0');
  const dom=new JSDOM('<div id="root">'+generation(labels)+'<div role="status"></div></div>');
  const root=dom.window.document.querySelector('#root'),form=root.querySelector('form');
  const originals={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch};
  globalThis.Event=dom.window.Event;globalThis.FormData=dom.window.FormData;
  t.after(()=>{Object.assign(globalThis,originals);dom.window.close();});
  const controls=reviewedControls('business-100m-voice');
  const candidate={id:'reviewed-business-100m-voice',name:'测试原表',revision:'测试版',reviewed_controls:controls,
    extra_fields:[...controls.inputs.map(x=>x[0]),...controls.groups.map(x=>x.key),...controls.package_options.fields]};
  const tariff={id:'one-year',name:'100M',reviewed_id:'business-100m-voice',template_id:candidate.id,
    business_id:'business-line',business_version_id:'reviewed-voice',business_attribute:'new',voice_required:true,bandwidth:'100M',cycle:'年',amount:'100'};
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{status:'unique',basis:['测试'],match_token:'token',candidates:[candidate]}}));
  bindGeneration(root,{hosted:false,catalog:{businesses:[{id:'business-line',name:'商务专线'}],attributes:[{id:'new',name:'新装'}],versions:[]},workspace:{tariffs:[tariff]}});
  const set=(name,value)=>{const el=form.elements.namedItem(name);el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  for(const [key,value] of [['biz','business-line'],['business_name','100M 智云上海专线基础版'],['attr','new'],['voice','yes'],['discount','no']])set(key,value);
  await root.querySelector('#match').onclick();
  const select=form.elements.service_type_choice;
  assert.ok(select.required);
  assert.equal(select.value,'0','默认宽带，不从带语音猜测固话或手机');
  const toggle=(key,checked)=>{const el=root.querySelector('[data-package-toggle="'+key+'"]');el.checked=checked;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  toggle('package_landline_count',true);
  assert.equal(select.value,'1');
  toggle('package_mobile_count',true);
  assert.equal(select.value,'3');
  set('service_type_choice','0');
  assert.equal(select.validity.valid,false,'手动选择不得与明确勾选的业务冲突');
  set('service_type_choice','3');
  assert.equal(select.validity.valid,true);
  toggle('package_landline_count',false);
  assert.equal(select.value,'3','不得覆盖工作人员已确认的选择');
  toggle('package_mobile_count',false);
  set('service_type_choice','');
  toggle('package_cloudphone_count',true);
  assert.equal(select.value,'0','商云通的归类需工作人员核对');
});

test('浏览器演示从客户回复生成 Word，授权书使用客户单位且受托员工暂时留空',async t=>{
  const old={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch,
    location:globalThis.location,indexedDB:globalThis.indexedDB,locks:Object.getOwnPropertyDescriptor(navigator,'locks')};
  t.after(()=>{
    for(const key of ['Event','FormData','fetch','location','indexedDB'])globalThis[key]=old[key];
    if(old.locks)Object.defineProperty(navigator,'locks',old.locks);else delete navigator.locks;
  });
  globalThis.location=new URL('https://demo.example.invalid');globalThis.indexedDB=new IDBFactory();
  Object.defineProperty(navigator,'locks',{value:{request:(_,fn)=>fn()},configurable:true});
  const bundle=await bundleDemo('demo/runtime.mjs');
  const {localFetch}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
  const response=await localFetch('/api/v1/forms/workspace');
  assert.equal(response.status,200);
  const workspace=(await response.json()).data;
  const dom=new JSDOM('<div id="root">'+generation(labels)+'<div role="status"></div></div>');
  t.after(()=>dom.window.close());
  const root=dom.window.document.querySelector('#root'),form=root.querySelector('form');
  globalThis.Event=dom.window.Event;globalThis.FormData=dom.window.FormData;globalThis.fetch=localFetch;
  bindGeneration(root,{hosted:false,catalog:{businesses:[{id:'business-line',name:'商务专线'}],attributes:[{id:'new',name:'新装'}],versions:[]},workspace});
  const tariff=workspace.tariffs.find(row=>row.reviewed_id==='business-100m-voice' && row.cycle==='月');
  const set=(key,value,type='change')=>{const input=form.elements.namedItem(key);input.value=value;input.dispatchEvent(new dom.window.Event(type,{bubbles:true}));};
  for(const [key,value] of [['biz','business-line'],['business_name','100M 智云上海专线基础版'],['attr','new'],['voice','yes'],['discount','no'],['pay_cycle',tariff.id]])set(key,value);
  await root.querySelector('#match').onclick();
  root.querySelector('#reply-text').value='企业全称：虚构测试企业，安装地址：虚构路8号 邮编：200001，账单地址：与安装地址相同，经办人：测试甲，手机号：10000000000，身份证号：000000000000000000，邮箱：qa@example.invalid，付款方式：现金，法定代表人：测试法代，法定代表人身份证号码：111111111111111111，使用人（实名制）：测试使用人，使用人（实名制）身份证号码：222222222222222222';
  root.querySelector('#read-reply').click();root.querySelector('#lookup-fixture').click();await Promise.resolve();
  set('extra_industry','软件','input');
  const code=form.elements.extra_credit_code.value;
  set('extra_credit_code','','input');
  assert.equal(form.checkValidity(),false,'客户信用代码缺失时必须补充');
  assert.equal(root.querySelector('#missing-profile').hidden,false);
  assert.match(root.querySelector('#missing-profile').textContent,/统一社会信用代码/);
  set('extra_credit_code',code,'input');
  assert.equal(form.elements.service_use.value,'办公');
  assert.equal(form.elements.service_type_choice.value,'0');
  assert.equal(form.checkValidity(),true);
  await form.onsubmit({preventDefault(){}});
  assert.match(root.querySelector('[role=status]').textContent,/生成成功/);
  assert.match(root.querySelector('#generated').textContent,/授权委托书受托员工姓名和身份证号码/);
  const records=(await (await localFetch('/api/v1/forms/records')).json()).data;
  const result=await localFetch('/api/v1/forms/records/'+records[0].id+'/file');
  assert.equal(result.status,200);
  const lines=paragraphs(new Uint8Array(await result.arrayBuffer()));
  const auth=lines.find(line=>line.includes('现全权委托本单位员工'));
  assert.ok(auth.includes(`本单位虚构测试企业（统一社会信用代码为${code}）`));
  assert.ok(auth.includes('本单位员工（身份证号为）'));
  assert.ok(auth.includes('办理宽带（手机/固话/宽带）业务的新装'));
  assert.ok(auth.includes('实际用途为办公'));
  assert.ok(lines.some(line=>line.includes('虚构测试企业')));
});
