import { loadReviewedFixtures } from './reviewed-fixtures.mjs';
import sax from 'sax';
import { unzipSync } from 'fflate';
import { renderReviewed, reviewedCatalog } from './reviewed/render.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const basic={company_name:'虚构测试企业',extra_credit_code:'000000000000000000'};
const guaranteeValues={...basic,guarantor_name:'虚构担保人',guarantor_id:'000000000000000000',guarantor_address:'虚构路一号',guarantor_phone:'10000000000',application_date:'2026-11-09'};
const application={...basic,extra_industry:'物流',install_address:'虚构安装地址',contact_name:'测试甲乙',id_number:'000000000000000000',phone:'10000000000',
  email:'a@b.invalid',security_name:'测试安全员',security_role:'主管',security_phone:'10000000000',extra_company_size:'31-80人',extra_computer_count:'16-40台',billing_mode:'same_company',payment_method:'cash',
  install_zip:'200001',billing_zip:'200002',job_title:'经理',fax:'1000000',service_use:'办公测试',application_date:'2026-11-09'};

test('已核验原表生成入口拒绝未知版式、未核验文件和无效日期',async()=>{
  const bytes=Uint8Array.of(1,2,3);
  await assert.rejects(renderReviewed('unknown',bytes,{}),/已核验/);
  await assert.rejects(renderReviewed('business-guarantee',bytes,guaranteeValues),/哈希校验/);
  await assert.rejects(renderReviewed('business-100m-no-voice',bytes,{...application,cycle:'year',application_date:'2026-02-30'}),/申请日期/);
});

function visibleParagraphs(xml){
  const parser=sax.parser(true), result=[];
  let paragraph=null, inText=false;
  parser.onopentag=({name})=>{if(name==='w:p')paragraph='';if(name==='w:t')inText=true;};
  parser.ontext=text=>{if(inText && paragraph!==null)paragraph+=text;};
  parser.onclosetag=name=>{if(name==='w:t')inText=false;if(name==='w:p'){result.push(paragraph.replace(/\s/g,''));paragraph=null;}};
  parser.write(xml).close();
  return result;
}

const folder=process.env.RUNWELL_REVIEWED_FIXTURES;
test('用核验原表和虚构资料生成全部 v22 版式', {skip:!folder},async t=>{
  const found=await loadReviewedFixtures(folder);
  for (const {id,cycles} of reviewedCatalog) await t.test(id,async()=>{
    assert.ok(found.has(id),'未找到对应空白原表');
    const data=id==='business-guarantee'?guaranteeValues:{...application,...(cycles.length?{cycle:'year'}:{}),
      ...(['business-ai-v1','business-ai-v2-voice'].includes(id)?{service_type:'宽带、固话'}:{})};
    const result=await renderReviewed(id,found.get(id),data);
    const xml=new TextDecoder().decode(unzipSync(result.file)['word/document.xml']);
    assert.match(xml,/虚构测试企业/);
    if(id==='business-guarantee'){
      assert.match(xml,/虚构担保人/);
      assert.match(xml,/2026-11-09/);
      assert.deepEqual(result.manualActions,['guarantee_signature','guarantee_number']);
    } else {
      assert.match(xml,/2026年11月9日/);
      assert.match(xml,/200002/);
      const cash=visibleParagraphs(xml);
      assert.ok(cash.includes('姓名：测试安全员，职务：主管，联系方式：10000000000'));
      for(const expected of ['*身份证号码','*E-MAIL','■同公司地址','■现金','□托收银行账号：'])assert.ok(cash.includes(expected),expected);
      assert.ok(cash.some(line=>/^□(?:其它|其他)[:：]?$/.test(line)));
      await assert.rejects(renderReviewed(id,found.get(id),{...data,payment_method:'collection'}),/银行账号/);
      const collection=await renderReviewed(id,found.get(id),{...data,payment_method:'collection',bank_account:'00000000654321',billing_mode:'other_manual',manual_billing_ack:true});
      const collected=visibleParagraphs(new TextDecoder().decode(unzipSync(collection.file)['word/document.xml']));
      for(const expected of ['□同公司地址','□现金','■托收银行账号：00000000654321'])assert.ok(collected.includes(expected),expected);
      assert.ok(collected.some(line=>/^■(?:其它|其他)[:：]?$/.test(line)));
      assert.match(xml,/■/);
      assert.match(xml,/□/);
      if(id.includes('ai')||id.endsWith('-no-voice'))assert.match(xml,/办公测试/);
      if(id==='business-ai-v2-voice')assert.match(xml,/宽带、固话/);
    }
  });
});
