const requiredFields=['company_name','extra_credit_code','extra_industry','extra_company_size','extra_computer_count','install_address','contact_name','id_number','phone','email'];
const cycles=['month','year','two_years'];
const entry=(id,name,voice,prices)=>({id,name,voice:voice==='带语音',cycles,requiredFields,billingRequired:true,...(prices?{prices}:{})});
const ai=(id,name,voice)=>({id,name,voice:voice ? voice==='带语音' : null,cycles:[],requiredFields,billingRequired:true});
export const businessCatalog=Object.freeze([
  entry('business-100m-no-voice','100M 智云上海专线基础版 · 不带语音 · 不打折','不带语音',{month:688,year:6880,two_years:11880}),
  entry('business-100m-voice','100M 智云上海专线基础版 · 带语音 · 不打折','带语音',{month:688,year:6880,two_years:11880}),
  entry('business-100m-discount-no-voice','100M 智云上海专线基础版 · 不带语音 · 打折','不带语音'),
  entry('business-100m-discount-voice','100M 智云上海专线基础版 · 带语音 · 打折','带语音'),
  entry('business-200m-no-voice','200M 智云上海专线升级版 · 不带语音 · 不打折','不带语音',{month:1088,year:10880,two_years:15910}),
  entry('business-200m-voice','200M 智云上海专线升级版 · 带语音 · 不打折','带语音',{month:1088,year:10880,two_years:15910}),
  entry('business-200m-discount-no-voice','200M 智云上海专线升级版 · 不带语音 · 打折','不带语音'),
  entry('business-200m-discount-voice','200M 智云上海专线升级版 · 带语音 · 打折','带语音'),
  ai('business-ai-v1','智云护航 AI 套餐升级 V1',''),
  ai('business-ai-v2-no-voice','智云护航 AI 套餐升级 V2 · 不带语音','不带语音'),
  ai('business-ai-v2-voice','智云护航 AI 套餐升级 V2 · 带语音','带语音'),
  {id:'business-guarantee',name:'外地公司电信业务担保书（空白）',voice:null,cycles:[],requiredFields:[],billingRequired:false,documentKind:'blank'}
]);
