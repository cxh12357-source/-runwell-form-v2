import assert from 'node:assert/strict';
import test from 'node:test';
import sax from 'sax';
import {unzipSync, strFromU8} from 'fflate';
import {IDBFactory} from 'fake-indexeddb';
import {JSDOM} from 'jsdom';
import documents from './default-docx.json' with {type:'json'};
import {identifyReviewed, generateReviewed} from './reviewed-integration.mjs';
import {bundleDemo} from './build.mjs';
import {packageOptions} from './reviewed/package-options.mjs';
import {generation,bindGeneration} from '../frontend/modules/forms/generate.js';
import {labels} from '../backend/modules/forms/preview/rules.mjs';
import {generatedMaterials} from '../frontend/modules/forms/generate.js';

const base={company_name:'虚构测试企业',extra_credit_code:'000000000000000000',extra_industry:'软件',
  install_address:'虚构安装路',billing_address:'虚构安装路',contact_name:'测试甲',phone:'10000000000',
  id_number:'000000000000000000',email:'a@b.invalid',payment_method:'cash',choice_billing:'1',
  extra_company_size:'31-80人',extra_computer_count:'16-40台',install_zip:'200001',billing_zip:'200001',
  job_title:'IT',security_name:'测试甲',security_role:'IT',security_phone:'10000000000',
  service_use:'公办',application_date:'2026-11-10'};
const choices={package_line_type:'existing',package_existing_number:'02112345678',package_fttr:'1',package_disk:'1',
  package_free_ext:'1',package_plugin:'1',package_landline_count:'2',package_cloudphone_count:'2',
  package_mobile_count:'2',package_secondary_count:'3',package_paid_ext_count:'3'};

function paragraphs(xml) {
  const parser=sax.parser(true), out=[];let current=null,inText=false;
  parser.onopentag=({name})=>{if(name==='w:p')current='';if(name==='w:t')inText=true;};
  parser.ontext=value=>{if(inText && current!==null)current+=value;};
  parser.onclosetag=name=>{if(name==='w:t')inText=false;if(name==='w:p'){out.push(current.replace(/\s/g,''));current=null;}};
  parser.write(xml).close();return out;
}
const para=file=>paragraphs(strFromU8(unzipSync(file)['word/document.xml']));

test('不带语音模板选语音时，授权业务类型准确写入或留空并提醒核对',async t=>{
  const templates=[documents[0],documents[3]];
  for(const encoded of templates){
    const bytes=Uint8Array.from(Buffer.from(encoded,'base64'));
    const plan=await identifyReviewed(bytes),tariff={reviewed_id:plan.id,reviewed_cycle:'year'};
    for(const [name,selected,expected] of [
      ['不选语音',{},'宽带'],
      ['固话',{package_landline_count:'1'},'宽带、固话'],
      ['移动',{package_mobile_count:'1'},'宽带、手机'],
      ['固话与移动',{package_landline_count:'1',package_mobile_count:'1'},'宽带、固话、手机'],
      ['商云通',{package_cloudphone_count:'1'},'']
    ]) await t.test(plan.id+' '+name,async()=>{
      const output=await generateReviewed(tariff,bytes,{...base,...selected});
      const lines=para(output.file), authorization=lines.find(line=>line.includes('我单位电信业务经办人为：'));
      assert.ok(authorization);
      assert.ok(authorization.includes('在贵公司办理'+expected+'（手机/固话/宽带）业务的'),authorization);
      for(const key of ['voice_template','authorization','voice_identity'])
        assert.equal(output.manualActions.includes(key),name!=='不选语音',name+' '+key);
    });
  }
  const tariff={business_id:'business-line',business_attribute:'new',reviewed_id:'business-100m-no-voice',voice_required:false};
  assert.match(generatedMaterials(tariff,false),/手续材料提示（不带语音）/);
  const warning=generatedMaterials(tariff,true);
  assert.match(warning,/人工核对适用模板、授权书、带语音实名资料及手续材料/);
  assert.doesNotMatch(warning,/手续材料提示（不带语音）/);
  assert.doesNotMatch(warning,/copy-generated-materials/);
});

test('所有内置 100M/200M 原表按已确认选项和数量生成；未选选项保留空框',async t=>{
  let tested=0;
  for(const encoded of documents){
    const bytes=Uint8Array.from(Buffer.from(encoded,'base64'));
    const plan=await identifyReviewed(bytes);
    if(!/^business-(100m|200m)/.test(plan.id))continue;
    tested++;
    await t.test(plan.id,async()=>{
      const tariff={reviewed_id:plan.id,reviewed_cycle:'year'};
      const blank=para((await generateReviewed(tariff,bytes,base)).file);
      assert.ok(blank.some(x=>x.startsWith('■纯新装宽带□在用宽带')));
      assert.ok(blank.some(x=>x.startsWith('□FTTR全光网')));
      const speed=plan.id.includes('100m')?'200m_year':'1000m_year';
      const result=await generateReviewed(tariff,bytes,{...base,...choices,package_speed:speed});
      assert.ok(!result.unmappedFields.includes('line_count'));
      assert.ok(!result.unmappedFields.includes('service_options'));
      assert.ok(result.unmappedFields.includes(plan.id.endsWith('-no-voice')?'delegate_information':'voice_identity'));
      const filled=para(result.file);
      for(const pattern of [/^□纯新装宽带■在用宽带（号码02112345678）$/,/^■FTTR全光网/,
        /^■开通权限：/,/^■订购数量1线/,/^插件服务：■上网行为管理插件$/,/^■固话，申请线数：2线$/,
        /^■商云通（需自备商云通话机），申请线数：2线$/,/^■订购，申请主卡线数：2线/,
        /^■是否订购副卡.*数量：3$/,/^■29元\/月\/线/,/^订购数量：3，限基础套餐/])
        assert.ok(filled.some(line=>pattern.test(line)),String(pattern));
      assert.ok(filled.some(line=>new RegExp('^上行升速'+(plan.id.includes('100m')?'200':'1000')+'M：□.*元/月■.*元/年$').test(line)));
    });
  }
  assert.equal(tested,6);
});

test('业务选项的依赖和数量不符时拒绝生成',async()=>{
  const bytes=Uint8Array.from(Buffer.from(documents[0],'base64'));
  const tariff={reviewed_id:'business-100m-no-voice',reviewed_cycle:'year'};
  for(const [customer,pattern] of [
    [{package_line_type:'existing'},/在用宽带号码/],
    [{package_fttr:'',package_free_ext:'1'},/FTTR/],
    [{package_fttr:'1',package_plugin:'1'},/同时订购/],
    [{package_landline_count:'3',package_cloudphone_count:'2'},/最多4线/],
    [{package_mobile_count:'6'},/最多5线/],
    [{package_mobile_count:'1',package_secondary_count:'3'},/副卡数量/],
    [{package_speed:'1000m_year'},/不适用于/],
    [{package_paid_ext_count:'-1'},/正整数/]
  ]) await assert.rejects(generateReviewed(tariff,bytes,{...base,...customer}),pattern);
  assert.equal(packageOptions('business-100m-discount-voice'),null);
  assert.equal(packageOptions('business-200m-discount-voice'),null);
  assert.equal(packageOptions('unknown'),null);
});

test('免登录接口匹配并提交业务选项到生成的 Word',async()=>{
  const bundle=await bundleDemo('demo/runtime.mjs');
  globalThis.location=new URL('https://demo.example.invalid');globalThis.indexedDB=new IDBFactory();
  Object.defineProperty(navigator,'locks',{value:{request:(_,fn)=>fn()},configurable:true});
  const {localFetch}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
  const call=(path,method='GET',data)=>localFetch('/api/v1/forms'+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data&&JSON.stringify(data)});
  async function result(response){const r=await response,body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.data;}
  const workspace=await result(call('/workspace'));
  const tariff=workspace.tariffs.find(t=>t.reviewed_id==='business-100m-no-voice' && t.cycle==='年');
  const selection={tariff_id:tariff.id,business_id:tariff.business_id,business_version_id:tariff.business_version_id,
    business_attribute:tariff.business_attribute,voice_required:tariff.voice_required,bandwidth:tariff.bandwidth,
    cycle:tariff.cycle,amount:tariff.amount,discount_mode:'no'};
  const match=await result(call('/match','POST',{selection}));
  assert.equal(match.status,'unique');
  const candidate=match.candidates[0];
  for(const field of ['package_line_type','package_fttr','package_free_ext','package_speed'])assert.ok(candidate.extra_fields.includes(field));
  const payload={selection,customer:{...base,...choices,package_speed:'200m_year'},template_id:candidate.id,
    match_token:match.match_token,request_id:crypto.randomUUID()};
  const row=await result(call('/generate','POST',payload));
  for(const key of ['voice_template','authorization','voice_identity'])assert.ok(row.review.includes(key));
  assert.ok(row.review.includes('delegate_information'));
  assert.ok(!row.review.includes('line_count') && !row.review.includes('service_options'));
  const file=await call('/records/'+row.id+'/file');assert.equal(file.status,200);
  const lines=para(new Uint8Array(await file.arrayBuffer()));
  assert.ok(lines.some(line=>line.startsWith('□纯新装宽带■在用宽带（号码02112345678）')));
  assert.ok(lines.some(line=>line.startsWith('■订购，申请主卡线数：2线')));
  const invalid=await call('/generate','POST',{...payload,customer:{...payload.customer,package_mobile_count:'6'},request_id:crypto.randomUUID()});
  assert.equal(invalid.status,422);
  const noVoice=await result(call('/generate','POST',{...payload,customer:base,request_id:crypto.randomUUID()}));
  for(const key of ['voice_template','authorization','voice_identity'])assert.ok(!noVoice.review.includes(key));
  const noVoiceFile=await call('/records/'+noVoice.id+'/file');
  const noVoiceLines=para(new Uint8Array(await noVoiceFile.arrayBuffer()));
  assert.ok(noVoiceLines.some(line=>line.includes('在贵公司办理宽带（手机/固话/宽带）业务的')));
});

test('真实页面选项通过浏览器演示接口写入生成文件',async t=>{
  const bundle=await bundleDemo('demo/runtime.mjs');
  globalThis.location=new URL('https://demo.example.invalid');globalThis.indexedDB=new IDBFactory();
  Object.defineProperty(navigator,'locks',{value:{request:(_,fn)=>fn()},configurable:true});
  const {localFetch}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
  const dom=new JSDOM('<div id="root">'+generation(labels)+'<div role="status"></div></div>');
  const root=dom.window.document.querySelector('#root'),form=root.querySelector('form');
  const originals={Event:globalThis.Event,FormData:globalThis.FormData,fetch:globalThis.fetch};
  globalThis.Event=dom.window.Event;globalThis.FormData=dom.window.FormData;globalThis.fetch=localFetch;
  t.after(()=>Object.assign(globalThis,originals));
  const workspaceResponse=await localFetch('/api/v1/forms/workspace');
  assert.equal(workspaceResponse.status,200);
  const workspace=(await workspaceResponse.json()).data;
  const state={hosted:false,catalog:{businesses:[{id:'business-line',name:'商务专线'}],attributes:[{id:'new',name:'新装'}],versions:[]},workspace};
  bindGeneration(root,state);
  function set(key,value,event='input'){
    const input=form.elements.namedItem(key);assert.ok(input,key);
    if(input.type==='checkbox')input.checked=value;else input.value=value;
    input.dispatchEvent(new dom.window.Event(event,{bubbles:true}));
  }
  const tariff=workspace.tariffs.find(t=>t.reviewed_id==='business-100m-no-voice' && t.cycle==='年');
  for(const [key,value] of [['biz','business-line'],['business_name','100M 智云上海专线基础版'],['attr','new'],['voice','no'],['discount','no'],['pay_cycle',tariff.id]])set(key,value,'change');
  await root.querySelector('#match').onclick();
  assert.equal(root.querySelector('#package-options').hidden,false);
  for(const [key,value] of Object.entries({...base,applicant_role:'IT'}))if(form.elements.namedItem(key))set(key,value);
  set('payment_method','cash','change');set('package_fttr',true,'change');set('package_free_ext',true,'change');
  const mobile=root.querySelector('[data-package-toggle="package_mobile_count"]');mobile.checked=true;mobile.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  set('package_mobile_count','2');set('package_speed','200m_year','change');
  assert.equal(form.checkValidity(),true);
  await form.onsubmit({preventDefault(){}});
  assert.match(root.querySelector('[role="status"]').textContent,/生成成功/);
  assert.match(root.querySelector('#generated').textContent,/带语音实名资料及手续材料/);
  assert.equal(root.querySelector('#generated-material-text'),null);
  const records=await localFetch('/api/v1/forms/records');const record=(await records.json()).data[0];
  const file=await localFetch('/api/v1/forms/records/'+record.id+'/file');
  assert.equal(file.status,200);
  const lines=para(new Uint8Array(await file.arrayBuffer()));
  for(const pattern of [/^■纯新装宽带/,/^■FTTR全光网/,/^■订购数量1线/,/^■订购，申请主卡线数：2线/,/^上行升速200M：□.*元\/月■.*元\/年$/])
    assert.ok(lines.some(line=>pattern.test(line)),String(pattern));
});
