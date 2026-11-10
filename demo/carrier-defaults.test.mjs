import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { analyzeCarrier, controls, renderCarrier } from './carrier.mjs';

// Reuse the existing synthetic carrier fixture without requiring the hosted
// build's vendor output directory in the browser-demo test environment.
const source=readFileSync(new URL('../online/carrier-fixture.mjs',import.meta.url),'utf8')
  .replace("'../vendor/qa-fflate/browser.js'",JSON.stringify(import.meta.resolve('fflate')));
const {makeCarrierFixture}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const dom=new JSDOM();
const xmlRuntime={parse:xml=>new dom.window.DOMParser().parseFromString(xml,'application/xml'),
  serialize:doc=>new dom.window.XMLSerializer().serializeToString(doc)};
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const customer={company_name:'虚构测试企业',install_address:'虚构一路',billing_address:'虚构一路',
  contact_name:'测试甲',phone:'10000000000',id_number:'000000000000000000',email:'a@b.invalid',
  payment_method:'cash',extra_credit_code:'TEST00000000000001',extra_industry:'软件',
  install_zip:'200001',billing_zip:'200001',security_name:'测试甲',security_role:'IT',
  security_phone:'10000000000',service_use:'公办',choice_size:'2',choice_computers:'2',
  choice_line:'0',choice_billing:'1'};

for (const october of [false,true]) {
  const label=october?'10月版':'5月版';
  test(label+'提供明确默认值，生成 Word 保留手动选择和业务选项',()=>{
    const prepared=analyzeCarrier(makeCarrierFixture({october}),'standard',xmlRuntime);
    const groups=controls(prepared.profile).groups;
    for(const [key,value] of [['choice_size','2'],['choice_computers','2'],['choice_line','0']])
      assert.equal(groups.find(group=>group.key===key).default,value);
    const defaults=renderCarrier(prepared.file,customer,{carrier_profile:prepared.profile,carrier_rate:'1'},xmlRuntime);
    const defaultsDoc=xmlRuntime.parse(strFromU8(unzipSync(defaults)['word/document.xml']));
    const defaultParagraphs=Array.from(defaultsDoc.getElementsByTagNameNS(W,'p'),node=>node.textContent);
    assert.match(defaultParagraphs[9],/■31–80人/);
    assert.match(defaultParagraphs[11],/■16–40台/);
    assert.match(defaultParagraphs[42],/■纯新装宽带/);
    const out=renderCarrier(prepared.file,{...customer,choice_size:'3',choice_computers:'1',
      choice_fttr:'0',choice_ext:'0',choice_paid:'0',paid_count:'2',choice_speed:'2'},
      {carrier_profile:prepared.profile,carrier_rate:'1'},xmlRuntime);
    const xml=strFromU8(unzipSync(out)['word/document.xml']);
    const doc=xmlRuntime.parse(xml), p=Array.from(doc.getElementsByTagNameNS(W,'p'),node=>node.textContent);
    assert.match(p[9],/■81–200人/);
    assert.match(p[11],/■6–15台/);
    assert.match(p[42],/■纯新装宽带/);
    assert.match(p[44],/■订购主设备/);
    assert.match(p[49],/■订购1线/);
    assert.match(p[october?74:71],/■订购收费从设备/);
    assert.match(p[october?75:72],/2/);
    assert.match(p[october?78:75],/■300M月付/);
  });

  test(label+'在用宽带和收费设备需补充对应信息',()=>{
    const prepared=analyzeCarrier(makeCarrierFixture({october}),'standard',xmlRuntime);
    const render=extra=>renderCarrier(prepared.file,{...customer,...extra},
      {carrier_profile:prepared.profile,carrier_rate:'0'},xmlRuntime);
    assert.throws(()=>render({choice_fttr:'0',choice_paid:'0',paid_count:'0'}),/收费从设备数量/);
    assert.throws(()=>render({choice_line:'1'}),/在用宽带号码/);
    assert.doesNotThrow(()=>render({choice_line:'1',existing_line:'虚构号码123'}));
  });
}
