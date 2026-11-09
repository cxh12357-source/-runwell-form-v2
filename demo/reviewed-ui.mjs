import { reviewedCatalog, renderReviewed, reviewedLimit } from './reviewed/render.mjs';
import { guaranteeFields } from './supplement.mjs';
import { escape as esc } from '../frontend/lib/api.js';

const sizes=['10人以下','10-30人','31-80人','81-200人','200人以上'];
const computers=['5台及以下','6-15台','16-40台','41-100台','100台以上'];
const cycles={month:'月付',year:'年付',two_years:'两年付'};
const service=['宽带','宽带、固话','宽带、手机','宽带、固话、手机'];
const manual={billing_address:'其他账单地址',voice_identity:'语音实名资料（如适用）',line_count:'线路数量',service_options:'业务选项',signature:'签字盖章',
  guarantee_signature:'签字盖章',guarantee_number:'电信业务号码',guarantee_date:'担保日期'};
const input=(key,label,max=200,required=true,type='text')=>'<label>'+esc(label)+'<input name="'+key+'" type="'+type+'" maxlength="'+max+'" '+(required?'required':'')+' autocomplete="off"></label>';
const select=(key,label,opts)=>'<label>'+esc(label)+'<select name="'+key+'" required><option value="">请选择</option>'+
  opts.map(opt=>'<option value="'+esc(opt[0])+'">'+esc(opt[1])+'</option>').join('')+'</select></label>';
const options=items=>items.map(x=>[x,x]);

export function reviewedPanel() {
  return '<details id="reviewed-panel" class="divider"><summary>用已核验原表生成 Word（含外地公司担保书）</summary>'+
    '<p>选择原表版式，并上传对应的未修改空白 Word。文件在当前浏览器处理，下载后请核对；此入口不写入套餐模板库或历史。</p>'+
    '<form id="reviewed-form"><div class="field-grid">'+select('templateId','原表版式',reviewedCatalog.map(({id,name})=>[id,name]))+
    '<label>空白 Word 原表<input name="source" type="file" accept=".docx" required></label></div>'+
    '<div id="reviewed-fields" class="field-grid"></div><button class="button" disabled>生成并下载 Word</button> <span role="status"></span></form></details>';
}

function applicationFields(plan) {
  return [
    input('company_name','企业全称'),input('extra_credit_code','统一社会信用代码',18),input('extra_industry','企业所属行业'),
    select('extra_company_size','企业规模',options(sizes)),select('extra_computer_count','计算机数量',options(computers)),
    input('install_address','安装地址'),input('install_zip','安装邮编',6),input('billing_zip','账单邮编',6),
    input('contact_name','经办人姓名'),input('id_number','经办人身份证号',18),input('phone','经办人手机号',11),input('email','电子邮箱',200,true,'email'),
    input('job_title','经办人职务',200,false),input('fax','传真',200,false),input('service_use','业务用途'),input('application_date','申请日期',10,true,'date'),
    plan.cycles.length?select('cycle','基础资费',plan.cycles.map(key=>[key,cycles[key]+(plan.prices?.[key]?' · '+plan.prices[key]+' 元/线':'')])):'',
    ['business-ai-v1','business-ai-v2-voice'].includes(plan.id)?select('service_type','授权书实际办理业务',options(service)):'',
    select('billing_mode','账单地址', [['same_company','同公司地址'],['other_manual','其他地址（下载后手工填入）']]),
    '<label data-when="billing" hidden><input type="checkbox" name="manual_billing_ack" required disabled> 确认在 Word 中手工填写账单地址</label>',
    select('payment_method','付款方式',[['cash','现金'],['collection','托收']]),
    '<fieldset data-when="bank" hidden disabled>'+input('bank_account','银行账号',32)+input('bank_name','开户银行（下载后核对并手工补填）',100)+'</fieldset>'
  ].join('');
}

export function bindReviewed(root) {
  const form=root.querySelector('#reviewed-form'), message=form.querySelector('[role="status"]'), button=form.querySelector('button');
  const fields=form.querySelector('#reviewed-fields');
  let busy=false;
  const plan=()=>reviewedCatalog.find(x=>x.id===form.elements.templateId.value);
  form.addEventListener('input',()=>{message.textContent='';});
  form.addEventListener('change',event=>{
    if(event.target.name==='templateId'){
      const p=plan(); form.elements.source.value='';
      fields.innerHTML=!p?'':p.documentKind==='blank'?guaranteeFields.map(args=>input(...args)).join(''):applicationFields(p);
      button.disabled=busy||!p;
    } else if(event.target.name==='billing_mode'){
      const item=form.querySelector('[data-when="billing"]');
      item.hidden=event.target.value!=='other_manual';
      form.elements.manual_billing_ack.disabled=item.hidden;
      form.elements.manual_billing_ack.checked=false;
    } else if(event.target.name==='payment_method'){
      const bank=form.querySelector('[data-when="bank"]');
      bank.hidden=bank.disabled=event.target.value!=='collection';
      if(bank.disabled) for(const field of bank.elements) field.value='';
    }
  });
  form.onsubmit=async event=>{
    event.preventDefault();
    if(busy||!plan()) return;
    const {source,templateId,bank_name,manual_billing_ack,...raw}=Object.fromEntries(new FormData(form));
    if(!source?.size || source.size>reviewedLimit || !/\.docx$/i.test(source.name)){
      message.textContent='请选择 10 MB 以内的 DOCX 原表。'; return;
    }
    if(raw.payment_method==='collection' && !bank_name?.trim()){message.textContent='请填写开户银行。';return;}
    const values=Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,value.trim()]));
    if(manual_billing_ack)values.manual_billing_ack=true;
    if(templateId==='business-guarantee'){
      values.application_date=values.guarantee_date;
      delete values.guarantee_date;
    }
    busy=button.disabled=true;
    try {
      const result=await renderReviewed(templateId,new Uint8Array(await source.arrayBuffer()),values);
      const url=URL.createObjectURL(new Blob([result.file],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
      const link=document.createElement('a');
      link.href=url; link.download=templateId==='business-guarantee'?'外地公司电信业务担保书.docx':'商务专线申请表.docx'; link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      const review=[...(result.manualActions||[]),...(result.unmappedFields||[])].map(k=>manual[k]||k);
      if(bank_name)review.push('开户银行');
      if(/^business-(?:100m|200m)(?:-discount)?-voice$/.test(templateId))review.push('授权委托书');
      message.textContent='Word 已生成。请核对版式及以下事项：'+review.join('、')+'。';
    } catch(error){message.textContent=error.message;}
    finally{busy=false;button.disabled=!plan();}
  };
}
