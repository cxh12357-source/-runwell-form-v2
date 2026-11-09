import { escape as esc } from '../../lib/api.js';
import { options } from './shared.js';

export const businessFields=['biz','business_name','attr','voice','discount','discount_rate','form_variant','pay_cycle'];
export function classifyTariff(t) {
  const id=t.reviewed_id||'';
  const isLine=/^business-(100m|200m)-/.test(id)||Boolean(t.carrier_profile);
  const blank=id==='business-guarantee';
  const name=isLine ? (/^business-200m-/.test(id)?'200M 智云上海专线升级版':'100M 智云上海专线基础版') :
    id.startsWith('business-ai-')?'智云护航 AI 套餐升级':blank?'外地公司担保书':t.name;
  const discount=(id.includes('-discount-')||t.carrier_profile?.endsWith('-discount'))?'yes':'no';
  return {...t, name, voice:blank?'':id==='business-ai-v1'?'unknown':t.voice_required?'yes':'no',
    discount, blank, variant:t.template_id||t.id,
    form_revision:t.carrier_profile?.includes('10-21')?'2026-10-21 转换模板':t.carrier_profile?'2026/A 转换模板':
      /^business-(100m|200m)-/.test(id)?'2026-10-21 核验原表':undefined};
}
export const validDiscount=value=>/^(?:[1-9](?:\.\d{1,2})?|0\.\d{1,2})$/.test(value)&&Number(value)>0;

export function matchingBusinessRows(rows, criteria) {
  return rows.filter(t=>t.business_id===criteria.biz && t.name===criteria.business_name && t.business_attribute===criteria.attr &&
    (t.blank || (t.voice===criteria.voice && t.discount===criteria.discount &&
      (t.discount!=='yes'||!t.discount_rate||Number(t.discount_rate)===Number(criteria.discount_rate)))));
}

export function businessSelectors() {
  const select=(name,label,id)=>'<label'+(id?' id="'+id+'" hidden':'')+'>'+label+'<select required name="'+name+'"'+(id?' disabled':'')+'></select></label>';
  return '<div class="field-grid business-selection">'+select('biz','业务种类')+select('business_name','业务名称')+
    select('attr','业务属性')+select('voice','是否带语音','business-voice')+select('discount','是否打折','business-discount')+
    '<label id="business-discount-rate" hidden>打几折<input name="discount_rate" required disabled inputmode="decimal" maxlength="4" placeholder="例如 8.5"></label>'+
    select('form_variant','模板版式','business-variant')+select('pay_cycle','付款周期','business-cycle')+'</div><p class="hint" id="business-selection-note"></p>';
}
const titleCycle=cycle=>({'月':'月付','年':'年付','2年':'两年付'})[cycle]||cycle;
const choices=(items)=>[...new Set(items)].map(id=>({id,name:id}));

export function bindBusinessSelection(form,state) {
  const rows=state.workspace.tariffs.map(classifyTariff);
  const fields=form.elements;
  const note=form.querySelector('#business-selection-note');
  let group='',rate='';
  function set(name,items,placeholder,{hidden=false,automatic=false,disabled=false}={}){
    const control=fields[name], current=control.value;
    control.innerHTML=options(items,placeholder);
    control.disabled=hidden||disabled||!items.length;
    if(control.parentElement.id)control.parentElement.hidden=hidden;
    if(!control.disabled){
      if(items.some(item=>item.id===current))control.value=current;
      else if(automatic&&items.length===1)control.value=items[0].id;
    }
  }
  function sync(){
    const business=rows.filter(t=>t.business_id===fields.biz.value);
    set('business_name',choices(business.map(t=>t.name)),'选择业务名称');
    const named=business.filter(t=>t.name===fields.business_name.value);
    set('attr',state.catalog.attributes,'选择业务属性',{disabled:!named.length});
    const byAttribute=named.filter(t=>t.business_attribute===fields.attr.value);
    const blank=named.some(t=>t.blank), ready=Boolean(named.length&&fields.attr.value);
    const voices=[{id:'no',name:'不带语音'},{id:'yes',name:'带语音'}];
    if(byAttribute.some(t=>t.voice==='unknown'))voices.push({id:'unknown',name:'原表未标注（请核对）'});
    set('voice',voices,'选择是否带语音',{hidden:blank,disabled:!ready});
    set('discount',[{id:'no',name:'不打折'},{id:'yes',name:'打折'}],'选择是否打折',{hidden:blank,disabled:!ready});
    const discount=fields.discount_rate, discounted=ready&&!blank&&fields.discount.value==='yes';
    discount.disabled=discount.parentElement.hidden=!discounted;
    if(!discounted)discount.value='';
    const complete=ready&&(blank||(fields.voice.value&&fields.discount.value&&(!discounted||validDiscount(discount.value.trim()))));
    const filtered=complete?matchingBusinessRows(rows,Object.fromEntries(['biz','business_name','attr','voice','discount','discount_rate'].map(name=>[name,fields[name].value.trim()]))):[];
    const groups=new Map(filtered.filter(t=>t.template_active!==false).map(t=>[t.variant,t]));
    const variantItems=[...groups].map(([id,t])=>({id,name:(t.revision||t.form_revision||state.catalog.versions.find(v=>v.id===t.business_version_id)?.name||'已核验版式')+
      (t.discount_rate?' · '+t.discount_rate+' 折':'')}));
    const distinct=new Set(variantItems.map(v=>v.name));
    if(distinct.size!==variantItems.length)variantItems.forEach((v,i)=>{v.name+=' · 版式 '+(i+1);});
    set('form_variant',variantItems,'请选择模板版式',{hidden:groups.size<=1});
    group=groups.size===1?groups.keys().next().value:fields.form_variant.value;
    const cycles=filtered.filter(t=>t.variant===group);
    set('pay_cycle',cycles.map(t=>({id:t.id,name:titleCycle(t.cycle)})),'选择付款周期',{hidden:cycles.length<=1});
    rate=cycles.length===1?cycles[0]:cycles.find(t=>t.id===fields.pay_cycle.value);
    note.textContent=discounted&&discount.value.trim()&&!validDiscount(discount.value.trim())?'请输入大于 0 且小于 10 的折数，例如 8.5。':
      complete&&!groups.size?'没有符合所选条件的已启用模板，请核对选项或联系管理员。':
      discounted&&rate&&!rate.discount_rate?'该模板未记录固定折数。生成后请在 Word 中人工核对并填写折扣；系统不会改写资费。':'';
    return complete;
  }
  set('biz',state.catalog.businesses,'选择业务种类');
  sync();
  form.addEventListener('change',event=>{
    if(!businessFields.includes(event.target.name))return;
    if(['biz','business_name'].includes(event.target.name)){
      for(const key of ['voice','discount','discount_rate','form_variant','pay_cycle'])fields[key].value='';
    }
    sync();
  });
  form.addEventListener('input',event=>{if(event.target===fields.discount_rate)sync();});
  return ()=>{
    sync();
    if(!rate)return null;
    return {tariff_id:rate.id,business_id:rate.business_id,business_version_id:rate.business_version_id,business_attribute:rate.business_attribute,
      voice_required:rate.voice_required,bandwidth:rate.bandwidth,cycle:rate.cycle,amount:rate.amount,
      ...(rate.blank?{}:{discount_mode:rate.discount,...(rate.discount==='yes'?{discount_factor:fields.discount_rate.value.trim()}: {})})};
  };
}
