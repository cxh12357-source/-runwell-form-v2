import assert from 'node:assert/strict';
import test from 'node:test';
import sax from 'sax';
import {unzipSync,zipSync} from 'fflate';
import documents from './default-docx.json' with {type:'json'};
import {identifyReviewed} from './reviewed/render.mjs';
import {generateReviewed} from './reviewed-integration.mjs';
import {adjustFirstPageIdentityLayout,hasWiderIdentityLayout} from './reviewed/identity-layout.mjs';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const attr=(node,key)=>Object.values(node.attributes).find(a=>a.uri===W && a.local===key)?.value;
const compact=s=>s.replace(/\s/g,'').replace(/^\*/, '');
function firstApplicationTable(bytes) {
  const xml=new TextDecoder().decode(unzipSync(bytes)['word/document.xml']);
  const parser=sax.parser(true,{xmlns:true,strictEntities:true});
  const stack=[],tables=[];let table,row,cell,inText=false;
  parser.onopentag=node=>{
    const name=node.uri===W?node.local:'',parent=stack.at(-1);
    if(name==='tbl'&&!table){table={grid:[],rows:[]};tables.push(table);}
    else if(table&&name==='gridCol'&&parent==='tblGrid')table.grid.push(Number(attr(node,'w')));
    else if(table&&name==='tr'&&parent==='tbl'){row={cells:[],height:null};table.rows.push(row);}
    else if(row&&name==='trHeight'&&parent==='trPr')row.height=Number(attr(node,'val'));
    else if(row&&name==='tc'&&parent==='tr'){cell={text:'',span:1,width:null,fit:false,merge:''};row.cells.push(cell);}
    else if(cell&&name==='gridSpan'&&parent==='tcPr')cell.span=Number(attr(node,'val'));
    else if(cell&&name==='tcW'&&parent==='tcPr')cell.width=Number(attr(node,'w'));
    else if(cell&&name==='vMerge'&&parent==='tcPr')cell.merge=attr(node,'val')||'continue';
    else if(cell&&name==='fitText')cell.fit=true;
    if(cell&&name==='t')inText=true;
    stack.push(name);
  };
  parser.ontext=t=>{if(cell&&inText)cell.text+=t;};
  parser.onclosetag=()=>{const name=stack.pop();if(name==='t')inText=false;if(name==='tc')cell=null;if(name==='tr')row=null;if(name==='tbl')table=null;};
  parser.write(xml).close();
  const results=tables.filter(t=>t.rows.some(r=>r.cells.length===6&&/^(经办人|联系人)$/.test(compact(r.cells[0].text))&&compact(r.cells[2].text)==='身份证号码'));
  assert.equal(results.length,1);
  return results[0];
}
function positions(table,row) {
  const edges=[0];for(const n of table.grid)edges.push(edges.at(-1)+n);
  let index=0;const cells=row.cells.map(cell=>{const left=edges[index];index+=cell.span;return {left,right:edges[index],width:cell.width,text:cell.text,merge:cell.merge};});
  assert.equal(index,table.grid.length);
  return cells;
}
const customer={company_name:'虚构测试企业',extra_credit_code:'000000000000000000',extra_industry:'软件',
  install_address:'虚构安装路1号',billing_address:'虚构账单路2号',contact_name:'测试甲乙',phone:'10000001234',
  id_number:'120987654321098765',email:'chen@example.com',payment_method:'cash',choice_billing:'1',
  extra_company_size:'10人以下',extra_computer_count:'5台及以下',install_zip:'200001',billing_zip:'200002',
  job_title:'经理',security_name:'测试甲乙',security_role:'经理',security_phone:'10000001234',
  service_use:'公办',application_date:'2026-11-10',service_type_choice:'0'};

test('八个内置原表只改变身份证、邮箱两行的边界，并保留原件和其他行',async t=>{
  for(const encoded of documents)await t.test('verified document',async()=>{
    const bytes=Uint8Array.from(Buffer.from(encoded,'base64')),original=Buffer.from(bytes);
    const plan=await identifyReviewed(bytes);
    assert.ok(plan);assert.equal(hasWiderIdentityLayout(plan.id),true);
    const adjusted=adjustFirstPageIdentityLayout(bytes,{unzipSync,zipSync,sax});
    assert.deepEqual(Buffer.from(bytes),original,'不修改原表字节');
    const before=firstApplicationTable(bytes),after=firstApplicationTable(adjusted);
    assert.equal(after.rows.length,before.rows.length);
    let targets=0;
    before.rows.forEach((row,i)=>{
      const left=positions(before,row),right=positions(after,after.rows[i]);
      assert.equal(right.length,left.length);
      if(row.cells.length===6&&['身份证号码','E-MAIL'].includes(compact(row.cells[2].text))&&/^(经办人|联系人)/.test(compact(row.cells[0].text))){
        targets++;
        assert.equal(right[1].right-right[1].left,1050);
        assert.ok(right[3].right-right[3].left>left[3].right-left[3].left);
        assert.ok(right[5].right-right[5].left>left[5].right-left[5].left,'联系电话栏加宽');
        assert.equal(right[0].left,left[0].left);assert.equal(right[4].left,left[4].left);assert.equal(right.at(-1).right,left.at(-1).right);
        assert.deepEqual(right.map(c=>c.text),left.map(c=>c.text));
        const label=compact(row.cells[2].text),standard=left[1].right-left[1].left===1930;
        assert.equal(after.rows[i].height,label==='身份证号码'?(standard?915:721):(standard?549:527));
      }else assert.deepEqual(right,left,'非目标行的单元格边界和内容保持不变');
    });
    assert.equal(targets,2);
    const generated=await generateReviewed({reviewed_id:plan.id,reviewed_cycle:plan.cycles.includes('year')?'year':'document'},bytes,customer);
    const table=firstApplicationTable(generated.file);
    const rows=table.rows.filter(row=>row.cells.length===6&&['身份证号码','E-MAIL'].includes(compact(row.cells[2].text)));
    assert.deepEqual(rows.map(row=>row.cells[3].text),[customer.id_number,customer.email]);
    assert.equal(rows[0].cells[3].fit,false,'18 位身份证不再因旧窄格被压缩');
    assert.equal(rows[1].cells[3].fit,false,'普通邮箱不再因旧窄格被压缩');
    assert.equal(rows[0].cells[5].text,customer.phone);
  });
  assert.equal(hasWiderIdentityLayout('business-ai-v2-voice'),false);
  assert.equal(hasWiderIdentityLayout('business-guarantee'),false);
});
