import specs from './business-ai-metadata.json' with {type:'json'};
import {buildReviewed17Edits} from './reviewed-17-locators.mjs';
import {fillOriginalDocx} from './full-word.mjs';
import {validateBusiness3Values} from './business-3-bridge.mjs';
import {estimateBusiness3Layout} from './business-3-layout.mjs';
import {buildFirstPageEdits,materializeFirstPageBoxes} from './first-page-fields.mjs';
import {buildAuthorizationEdits,deferredAuthorizationFields} from './business-authorization.mjs';
import {buildAiVoiceAuthorizationEdits} from './business-ai-authorization.mjs';
import {BusinessInputError} from './business-input-error.mjs';
import {aiOptionsMetadata, buildAiOptionEdits} from './ai-options.mjs';
import {adjustFirstPageIdentityLayout,hasWiderIdentityLayout} from './identity-layout.mjs';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

export async function fillBusinessAi(id,bytes,values,dependencies) {
  if(!Object.hasOwn(specs,id))throw new Error('原表未核对。');
  if(!values || typeof values!=='object' || Array.isArray(values) || Object.hasOwn(values,'cycle'))throw new Error('资料格式无效。');
  if(id!=='business-ai-v2-no-voice' && !['宽带','宽带、固话','宽带、手机','宽带、固话、手机'].includes(values.service_type))throw new BusinessInputError('请选择授权书中的实际业务类型。');
  const aiFields=new Set(aiOptionsMetadata(id)?.fields ?? []);
  const baseValues=Object.fromEntries(Object.entries(values).filter(([key])=>!aiFields.has(key)));
  validateBusiness3Values({...baseValues,cycle:'year'},{requireSupplemental:true});
  const spec=specs[id];
  if(!(bytes instanceof Uint8Array) || !bytes.length || bytes.length>10_000_000 || await digest(bytes)!==spec.sha256)throw new Error('原表未通过哈希校验。');
  const base={};
  for(const key of ['company_name','extra_credit_code','extra_industry','install_address','contact_name','id_number','phone','email','extra_company_size','extra_computer_count'])base[key]=values[key];
  const {edits}=await buildReviewed17Edits(bytes,base,dependencies);
  if(edits.length!==10)throw new Error('字段定位不完整。');
  const wider=hasWiderIdentityLayout(id);
  const {fits}=estimateBusiness3Layout(values,{wideIdentity:wider});
  for(let i=0;i<edits.length;i++) {
    if(edits[i].kind==='emptyParagraph') edits[i].format={font:'宋体',sizeHalfPoints:18,bold:false};
    const key=Object.keys(base)[i];
    if(Object.hasOwn(fits,key)) edits[i].fitTextTwips=fits[key];
  }
  const {unzipSync,sax}=dependencies,parts=unzipSync(bytes),raw=parts['word/document.xml'];
  if(!raw)throw new Error('原表正文缺失。');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  const optionEdits=buildAiOptionEdits(id,xml,values,dependencies);
  edits.push(...optionEdits.edits);
  const noVoice=id==='business-ai-v2-no-voice';
  const voiceOptions=noVoice && ['ai_fixed','ai_business','ai_mobile','ai_sub','ai_switchboard'].some(key=>values[key]==='1');
  const uncertain=noVoice && ['ai_business','ai_switchboard'].some(key=>values[key]==='1');
  const categories=['宽带'];
  if(noVoice && values.ai_fixed==='1')categories.push('固话');
  if(noVoice && (values.ai_mobile==='1'||values.ai_sub==='1'))categories.push('手机');
  const authValues={...values,service_type:noVoice?categories.join('、'):values.service_type,application_type:'新装'};
  edits.push(...(id==='business-ai-v2-voice'?buildAiVoiceAuthorizationEdits(bytes,authValues,dependencies,{skipFields:deferredAuthorizationFields}):
    buildAuthorizationEdits(bytes,authValues,dependencies,{skipFields:[...deferredAuthorizationFields,...(uncertain?['service_type']:[])]})));
  edits.push(...buildFirstPageEdits(xml,values,spec,dependencies));
  let filled=fillOriginalDocx(bytes,edits,dependencies);
  if(wider)filled=adjustFirstPageIdentityLayout(filled,dependencies);
  return {file:materializeFirstPageBoxes(filled,values,spec,dependencies),
    manualActions:[...(values.billing_mode==='other_manual'?['billing_address']:[]),...(voiceOptions?['voice_template','authorization','voice_identity']:[]),'authorization_employee'],layoutReviewRequired:true,
    unmappedFields:[...(!noVoice?['voice_identity']:[]),...(!optionEdits.hasLineCount?['line_count']:[]),...(!optionEdits.supported?['service_options']:[]),'signature']};
}
