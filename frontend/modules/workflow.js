import { escape as esc } from '../lib/api.js';

const key='runwell-business-orders-v1';
const stages={quote:'报价阶段',form:'表单填写阶段',review:'手续审核中'};
const routes={quote:'/quotes',form:'/forms/generate',review:'/review'};
const idPattern=/^RW-[A-F0-9]{32}$/;
const handoffs=new Map();
export const workflowEnabled=()=>typeof __RUNWELL_DEFAULT_CATALOG__==='boolean'||
  (location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname));
function read(){
  const rows=JSON.parse(localStorage.getItem(key)||'[]');
  if(!Array.isArray(rows))throw new Error('业务单记录无法读取。');
  return rows;
}
function save(rows){localStorage.setItem(key,JSON.stringify(rows));}
export function createOrder(rows,{owner,stage,now=new Date().toISOString(),id='RW-'+crypto.randomUUID().replaceAll('-','').toUpperCase()}){
  if(!idPattern.test(id)||rows.some(row=>row.id===id)||!['quote','form'].includes(stage))throw new Error('无法创建业务单。');
  return {id,owner,stage,createdAt:now,updatedAt:now,events:[{stage,at:now}]};
}
export function advanceOrder(row,stage,now=new Date().toISOString()){
  if(row.stage===stage)return row;
  if(({quote:'form',form:'review'})[row.stage]!==stage)throw new Error('请按业务流程逐步处理。');
  if(stage==='review'&&!row.formRecord)throw new Error('请先成功生成 Word 表单。');
  return {...row,stage,updatedAt:now,events:[...row.events,{stage,at:now}]};
}
export const canViewOrder=(row,identity)=>identity.role==='admin'||row.owner===owner(identity);
const visible=canViewOrder;
const owner=identity=>identity.id||identity.role||'local';
const url=row=>'#'+routes[row.stage]+'?order='+encodeURIComponent(row.id);
const time=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const detail=row=>'<strong>'+esc(row.id)+'</strong> · '+esc(stages[row.stage])+
  (row.formRecord&&row.stage==='form'?'（Word 已生成）':'');

export function bindWorkflow(root,path,requested,identity={}){
  if(!workflowEnabled())return;
  const notice=document.createElement('section');
  notice.className='panel workflow-panel';
  let rows, row;
  try{rows=read();row=rows.find(v=>v.id===requested&&visible(v,identity));}
  catch{notice.textContent='浏览器无法读取业务单记录，请检查本站存储权限。';root.prepend(notice);return;}
  const report=message=>{notice.querySelector('[role="status"]').textContent=message;};
  function write(change){
    const latest=read(), existing=row&&latest.find(v=>v.id===row.id&&visible(v,identity));
    if(row&&!existing)throw new Error('该业务单已不可用。');
    const next=change(existing,latest);
    save(existing?latest.map(v=>v.id===next.id?next:v):[next,...latest]);
    row=next;
    return next;
  }
  if(path==='/dashboard'){
    notice.innerHTML='<h2>业务单进度</h2><p class="hint">记录保存在当前浏览器，可按完整单号或部分单号查询。</p>'+
      '<label>搜索业务单号<input data-order-search type="search" placeholder="输入 RW- 开头的单号"></label><div data-order-list></div>';
    const input=notice.querySelector('input'),list=notice.querySelector('[data-order-list]');
    const render=()=>{
      const query=input.value.trim().toUpperCase();
      const found=read().filter(v=>visible(v,identity)&&v.id.includes(query)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      list.innerHTML=found.length?'<div class="table-wrap"><table><thead><tr><th>业务单号</th><th>当前进度</th><th>最后更新（上海时间）</th><th>操作</th></tr></thead><tbody>'+
        found.map(v=>'<tr><td>'+esc(v.id)+'</td><td>'+esc(stages[v.stage])+(v.stage==='form'&&v.formRecord?'（Word 已生成）':'')+
        '</td><td>'+esc(time(v.updatedAt))+'</td><td><a class="workflow-link" href="'+esc(url(v))+'">打开业务单</a></td></tr>').join('')+
        '</tbody></table></div>':'<p>没有符合条件的业务单。</p>';
    };
    input.oninput=render;render();root.querySelector('h1')?.after(notice);return;
  }
  if(!Object.values(routes).includes(path))return;
  notice.innerHTML='<p data-workflow-detail></p><p class="hint" role="status"></p>';
  const detailNode=notice.querySelector('[data-workflow-detail]');
  const show=()=>{detailNode.innerHTML=row?detail(row):'尚未创建业务单';};
  const button=(label,action)=>{
    const el=document.createElement('button');el.type='button';el.className='button';el.textContent=label;
    el.onclick=()=>{try{action();}catch(error){report(error.message||'无法保存业务单。');}};
    return el;
  };
  const inaccessible=requested&&(!row||routes[row.stage]!==path);
  if(inaccessible){
    root.querySelector('h1')?.after(notice);
    show();report(row?'此业务单已进入其他阶段，请从看板打开当前阶段。':'找不到该业务单，或当前身份无权查看。');
    if(path==='/forms/generate'||path==='/quotes'){
      for(const child of [...root.children])if(child!==notice&&child.matches('section,form'))child.hidden=true;
    }
    return;
  }
  if(path==='/review'){
    root.querySelector('h1')?.after(notice);show();
    if(row){
      notice.insertAdjacentHTML('beforeend','<ol>'+row.events.map(v=>'<li>'+esc(stages[v.stage])+' · '+esc(time(v.at))+'</li>').join('')+'</ol>'+
        '<p>Word 表单已生成，等待手续审核。审核结论功能尚未开放。</p><a class="workflow-link" href="#/forms/history">查看表单历史</a>');
    }else report('请在表单生成成功后点击「下一步：手续审核」。');
    return;
  }
  if(path==='/quotes'){
    const preview=root.querySelector('#quote-preview');
    preview.append(notice);show();
    const next=button('下一步：表单填写',()=>{
      const saved=write(v=>advanceOrder(v,'form'));
      location.hash=url(saved);
    });
    next.disabled=true;notice.append(next);
    notice.append(button('另开一单',()=>{
      row=null;next.disabled=true;show();report('再次生成报价单时会分配新的业务单号。');
    }));
    root.querySelector('#quote-calculate').addEventListener('runwell:quote-generated',event=>{
      try{
        const saved=write((v,all)=>v??createOrder(all,{stage:'quote',owner:owner(identity)}));
        if(saved.stage!=='quote'){next.disabled=true;report('原单已进入下一阶段，请另开一单。');return;}
        handoffs.set(saved.id,event.detail);next.disabled=false;show();report('');
      }catch{next.disabled=true;report('报价预览已生成，但业务单未能保存。');}
    });
    return;
  }
  const form=root.querySelector('#generate-form');
  if(!form){
    if(row){root.querySelector('h1')?.after(notice);show();report('此环境未开启表单生成，请使用可生成 Word 的验收环境。');}
    return;
  }
  root.querySelector('#generated')?.after(notice);show();
  const next=button('下一步：手续审核',()=>{
    const saved=write(v=>advanceOrder(v,'review'));
    handoffs.delete(saved.id);location.hash=url(saved);
  });
  next.disabled=!row?.formRecord;notice.append(next);
  const prefill=handoffs.get(row?.id);
  for(const [field,value] of [['company_name',prefill?.customer],['install_address',prefill?.address]]){
    const input=form.elements[field];if(input&&!input.value&&value)input.value=value;
  }
  form.addEventListener('runwell:form-generated',event=>{
    try{
      const saved=write((v,all)=>{
        const base=v??createOrder(all,{stage:'form',owner:owner(identity)});
        if(base.stage!=='form')throw new Error('该业务单已提交审核。');
        return {...base,formRecord:event.detail.id,updatedAt:new Date().toISOString()};
      });
      next.disabled=!saved.formRecord;show();report('');
    }catch(error){report('Word 已生成，业务单进度未更新：'+error.message);}
  });
}
