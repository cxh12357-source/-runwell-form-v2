import { reviewedCatalog, renderReviewed, reviewedLimit, identifyReviewed } from './reviewed/render.mjs';
import { guaranteeFields } from './supplement.mjs';

const business_id='business-line';
const revisions={
  'business-ai-v1':'2026-10-26 / V1','business-ai-v2-no-voice':'2026-11-02 / V2','business-ai-v2-voice':'2026-11-02 / V2',
  'business-guarantee':'已核验原表'
};
const cycles={month:'月',year:'年',two_years:'2年'};
const version=(id,name)=>({id:'reviewed-'+id,name,business_id});
const noVoice=version('no-voice','已核验原表（不带语音）');
const voice=version('voice','已核验原表（带语音）');
const ai=version('ai','智云护航 AI');
const guarantee=version('guarantee','外地公司担保书');
export const reviewedVersions=[noVoice,voice,ai,guarantee];
export { identifyReviewed, reviewedLimit };
export function reviewedInfo(plan) {
  const blank=plan.documentKind==='blank', isAi=plan.id.startsWith('business-ai-');
  const selected=blank?guarantee:isAi?ai:plan.voice?voice:noVoice;
  const bandwidth=plan.name.match(/^\d+M/)?.[0] || '—';
  const id='reviewed-'+plan.id;
  return {id,name:plan.name,revision:revisions[plan.id]||'2026-10-21',rates:(plan.cycles.length?plan.cycles:['document']).map(cycle=>({
    id:id+'-'+cycle, name:plan.name, bandwidth, cycle:cycles[cycle]||'—', amount:String(plan.prices?.[cycle]??'—'),
    business_id,business_version_id:selected.id,business_attribute:'new',voice_required:plan.voice===true,
    template_id:id,reviewed_id:plan.id,reviewed_cycle:cycle
  }))};
}

export function reviewedControls(id) {
  if(id==='business-guarantee') return {blank:true,groups:[],inputs:guaranteeFields.map(([key,label,,required=true,type])=>[
    key==='company_name'?'guarantee_company':key==='extra_credit_code'?'guarantee_credit':key,label,required,type
  ])};
  return {groups:[
    {key:'choice_billing',label:'账单地址方式',required:true,options:['同公司地址','其他地址（下载后手工填入）']},
    ...(['business-ai-v1','business-ai-v2-voice'].includes(id)?[{key:'service_type_choice',label:'授权书实际办理业务',required:true,options:['宽带','宽带、固话','宽带、手机','宽带、固话、手机']}]:[])
  ],inputs:[
    ['extra_credit_code','统一社会信用代码',true],['extra_industry','企业所属行业',true],
    ['extra_company_size','企业规模',true],['extra_computer_count','计算机数量',true],
    ['install_zip','安装邮编',true],['billing_zip','账单邮编',true],['job_title','经办人职务'],['fax','传真'],
    ['service_use','业务用途',true],['application_date','申请日期',true,'date']
  ]};
}

const clean=value=>typeof value==='string'?value.trim():'';
export async function generateReviewed(tariff,bytes,customer) {
  const id=tariff.reviewed_id, controls=reviewedControls(id);
  const values=Object.fromEntries(controls.inputs.map(([key])=>[key,clean(customer[key])]));
  if(controls.blank){
    const {guarantee_company,guarantee_credit,guarantee_date,...fields}=values;
    return renderReviewed(id,bytes,{...fields,company_name:guarantee_company,extra_credit_code:guarantee_credit,application_date:guarantee_date});
  }
  for(const key of ['company_name','install_address','contact_name','phone','id_number','email','payment_method']) values[key]=clean(customer[key]);
  if(!['0','1'].includes(customer.choice_billing))throw new Error('请选择账单地址方式。');
  values.billing_mode=customer.choice_billing==='0'?'same_company':'other_manual';
  if(values.billing_mode==='other_manual'){
    if(!clean(customer.billing_address)||customer.manual_billing_ack!=='on')throw new Error('请填写其他账单地址，并确认下载后手工填入 Word。');
    values.manual_billing_ack=true;
  }
  if(values.payment_method==='collection'){
    if(!clean(customer.bank_name))throw new Error('请填写开户银行。');
    values.bank_account=clean(customer.bank_account);
  }
  const serviceGroup=controls.groups.find(group=>group.key==='service_type_choice');
  if(serviceGroup)values.service_type=serviceGroup.options[clean(customer.service_type_choice)];
  if(tariff.reviewed_cycle!=='document')values.cycle=tariff.reviewed_cycle;
  const result=await renderReviewed(id,bytes,values);
  if(values.payment_method==='collection')result.manualActions.push('bank_name');
  if(/^business-(?:100m|200m)(?:-discount)?-voice$/.test(id))result.manualActions.push('authorization');
  return result;
}
