import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { renderReviewed, reviewedCatalog } from './reviewed/render.mjs';
import plans from './reviewed/business-3-metadata.json' with {type:'json'};
import ai from './reviewed/business-ai-metadata.json' with {type:'json'};
import guarantee from './reviewed/business-guarantee-metadata.json' with {type:'json'};
import assert from 'node:assert/strict';
import test from 'node:test';

const basic={company_name:'虚构测试企业',extra_credit_code:'000000000000000000'};
const guaranteeValues={...basic,guarantor_name:'虚构担保人',guarantor_id:'000000000000000000',guarantor_address:'虚构路一号',guarantor_phone:'10000000000',application_date:'2026-11-09'};
const application={...basic,extra_industry:'物流',install_address:'虚构安装地址',contact_name:'测试甲乙',id_number:'000000000000000000',phone:'10000000000',
  email:'a@b.invalid',extra_company_size:'31-80人',extra_computer_count:'16-40台',billing_mode:'same_company',payment_method:'cash',
  install_zip:'200001',billing_zip:'200002',job_title:'经理',fax:'1000000',service_use:'办公测试',application_date:'2026-11-09'};

test('已核验原表生成入口拒绝未知版式、未核验文件和无效日期',async()=>{
  const bytes=Uint8Array.of(1,2,3);
  await assert.rejects(renderReviewed('unknown',bytes,{}),/已核验/);
  await assert.rejects(renderReviewed('business-guarantee',bytes,guaranteeValues),/哈希校验/);
  await assert.rejects(renderReviewed('business-100m-no-voice',bytes,{...application,cycle:'year',application_date:'2026-02-30'}),/申请日期/);
});

const folder=process.env.RUNWELL_REVIEWED_FIXTURES;
test('用核验原表和虚构资料生成全部 v22 版式', {skip:!folder},async t=>{
  const found=new Map(), hashes=new Map(Object.entries({...plans,...ai,...guarantee}).map(([k,v])=>[v.sha256,k]));
  for (const file of await readdir(folder,{recursive:true,withFileTypes:true})){
    if(!file.isFile() || !file.name.endsWith('.docx') || file.name.startsWith('~')) continue;
    const bytes=await readFile(join(file.parentPath,file.name));
    const key=hashes.get(createHash('sha256').update(bytes).digest('hex'));
    if(key)found.set(key,bytes);
  }
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
      assert.match(xml,/■/);
      assert.match(xml,/□/);
      if(id.includes('ai')||id.endsWith('-no-voice'))assert.match(xml,/办公测试/);
      if(id==='business-ai-v2-voice')assert.match(xml,/宽带、固话/);
    }
  });
});
