import { escape as esc } from '../../lib/api.js';
import { copyTextArea } from './shared.js';
import { businessText, titles, companyTitles, parseReply, validValue, requiredKeys, followup,
  lookupFixture } from './intake-rules.js';

const voiceKeys = Object.keys(titles).filter(k=>k.startsWith('extra_'));
export const intakeExtraKeys = [...voiceKeys, ...Object.keys(companyTitles)];
const companyDefaults = {extra_company_size:'31-80人', extra_computer_count:'16-40台'};
const companyOptions = {
  extra_company_size:['10人以下','10-30人','31-80人','81-200人','200人以上'],
  extra_computer_count:['5台及以下','6-15台','16-40台','41-100台','100台以上']
};
const entry = (key,label,value='')=>'<label>'+esc(label)+'<input name="'+esc(key)+'" value="'+esc(value)+'" maxlength="500" autocomplete="off"></label>';
const companyEntry = (key,label)=>companyOptions[key] ? '<label>'+esc(label)+'<select name="'+esc(key)+'">'+companyOptions[key].map(value=>
  '<option value="'+esc(value)+'" '+(value===companyDefaults[key]?'selected':'')+'>'+esc(value)+'</option>').join('')+'</select></label>' : entry(key,label);
const box = (id,label,rows)=>'<label>'+label+'<textarea id="'+id+'" rows="'+rows+'" maxlength="12000"></textarea></label>';
const copy = (id,label)=>'<button type="button" data-copy="'+id+'">'+label+'</button>';
export function intakePanel() {
  return '<section id="intake" hidden><div class="divider"></div><h3>发给客户</h3>'+
    box('info-text','填写信息话术',6)+copy('info-text','复制填写信息话术')+
    '<h3>核对客户回复</h3>'+box('reply-text','粘贴客户整段回复或本次补充',4)+
    '<button type="button" class="button" id="read-reply">识别并填入空白栏</button>'+
    '<p class="hint">回复中的业务、语音及折扣请在上方核对并选择。</p>'+
    '<p id="read-summary" aria-live="polite"></p><div id="reply-conflicts"></div>'+
    '<div id="followup-block" hidden>'+box('followup-text','发给客户的补充话术',4)+copy('followup-text','复制缺项追问')+'</div>'+
    '<p id="copy-feedback" aria-live="polite"></p></section>';
}
export function lookupPanel() {
  return '<section id="company-lookup" hidden>'+
    '<button type="button" id="lookup-fixture">企查查查询企业信息</button> ' +
    '<span class="hint">当前仅支持虚构样例，企查查接口暂未接入。</span><p id="lookup-status" aria-live="polite"></p></section>';
}
export function internalPanel() {
  return '<details id="voice-fields" class="profile-section" hidden><summary>语音实名资料</summary><div class="field-grid">'+
    voiceKeys.map(k=>entry(k,titles[k])).join('')+'</div></details>'+
    '<details id="company-fields" class="profile-section" hidden><summary>企业信息</summary>'+
    '<p class="hint">本次测试只查询虚构样例。选含工商栏的测试套餐，可将核对结果写入 Word。</p>'+
    '<div class="field-grid">'+entry('insured','实际参保人数（仅供参考）')+Object.entries(companyTitles).map(([key,label])=>companyEntry(key,label)).join('')+
    '</div><p class="hint">企业规模默认为 31–80 人，计算机数量默认为 16–40 台；可按实际情况修改。</p></details>';
}

export function bindIntake(form, defaults) {
  const at=id=>form.querySelector('#'+id);
  const control=key=>form.elements.namedItem(key);
  const voice=()=>control('voice').value==='yes';
  const enabled=()=>control('biz').value==='business-line' && Boolean(control('business_name').value) &&
    control('business_name').value!=='外地公司担保书' && control('attr').value==='new' && Boolean(control('voice').value);
  const neededKeys=()=>requiredKeys(voice(),control('payment_method').value).filter(key=>key!=='tariff');
  let context='', checked=false, pending=false, activeCompany='', extras=[], conflicts=new Map(), missing=[];
  const put=(key,value)=>{ control(key).value=value; };
  function attentionKeys() {
    if (!enabled()) return [];
    return neededKeys().filter(key=>conflicts.has(key) ||
      !(key==='billing_address' && defaults.sameBilling() && !control('install_address').value.trim()) &&
      !validValue(key,control(key).value.trim()));
  }
  function updateRequired() {
    for (const key of intakeExtraKeys) control(key).required=extras.includes(key);
    const businessVoice=enabled() && voice();
    for (const key of voiceKeys) {
      const show=businessVoice || extras.includes(key);
      control(key).disabled=!show;
      control(key).closest('label').hidden=!show;
    }
    at('voice-fields').hidden=!(businessVoice || voiceKeys.some(key=>extras.includes(key)));
    const companyKeys=Object.keys(companyTitles);
    const showCompany=enabled();
    for(const key of companyKeys) control(key).closest('label').hidden=!(showCompany || extras.includes(key));
    control('insured').closest('label').hidden=!showCompany;
    at('company-fields').hidden=at('company-lookup').hidden=!(showCompany || companyKeys.some(key=>extras.includes(key)));
  }
  function updateFollowup() {
    if(!checked || !enabled()) return;
    const needed=neededKeys();
    missing=needed.filter(key=>!conflicts.has(key) && !(key==='billing_address' && defaults.sameBilling() && !control('install_address').value.trim()) && !validValue(key,control(key).value.trim()));
    const review=needed.filter(key=>conflicts.has(key));
    at('followup-block').hidden=!missing.length;
    at('followup-text').value=followup(missing);
    at('read-summary').textContent='已识别或已填 '+(needed.length-missing.length-review.length)+' 项。'+
      (missing.length?'请向客户补充或核对 '+missing.length+' 项。':review.length?'':'客户资料已填齐。')+
      (review.length?' 有 '+review.length+' 项需员工处理冲突。':'');
    at('reply-conflicts').innerHTML=review.map(key=>'<div class="notice slim">'+esc(titles[key])+'：回复与已填内容不一致、存在多种填写或格式需核对。'+
      (control(key).value && validValue(key,control(key).value)?' <button type="button" data-keep="'+key+'">保留当前'+esc(titles[key])+'</button>':'')+
      ' 请核对原文，在下方'+esc(titles[key])+'栏填写正确值。</div>').join('');
  }
  function syncCompany(auto) {
    const name=control('company_name').value.trim();
    if(name===activeCompany) return;
    activeCompany=name;
    for (const key of ['insured','extra_credit_code','extra_industry']) put(key,'');
    at('lookup-status').textContent='';
    if (auto && name) lookup();
  }
  function lookup() {
    const name=control('company_name').value.trim();
    if(!name){at('lookup-status').textContent='请先填写企业全称。';return;}
    const row=lookupFixture(name);
    if(!row){at('lookup-status').textContent='无对应虚构样例，企查查查询暂缓。缺失工商资料由员工核对。';return;}
    for(const [key,value] of Object.entries(row)) if(!control(key).value) put(key,value);
    at('lookup-status').textContent='来源：虚构验收样例。请核对信用代码、行业和企业规模、计算机数量。';
  }
  function setContext() {
    const next=enabled()?control('business_name').value+'|'+control('voice').value:'';
    at('intake').hidden=!next;
    if(next!==context) {
      context=next; checked=false; pending=false; conflicts.clear();
      at('read-summary').textContent=''; at('reply-conflicts').replaceChildren(); at('followup-block').hidden=true;
      at('copy-feedback').textContent=''; at('reply-text').value='';
      const scripts=businessText[voice()?'voice':'no_voice'];
      at('info-text').value=scripts.info;
      if(!voice()) for(const key of voiceKeys) put(key,'');
    }
    updateRequired();updateFollowup();
  }
  function analyze() {
    if(!at('reply-text').value.trim()){at('read-summary').textContent='请先粘贴客户回复。';return;}
    const parsed=parseReply(at('reply-text').value);
    for(const key of ['payment_method',...Object.keys(parsed).filter(k=>k!=='payment_method')]){
      if(!parsed[key] || !(neededKeys().includes(key) || key==='billing_address')) continue;
      const values=parsed[key];
      if (key==='billing_address' && values.length===1) {
        if (/^(?:同|与)(?:安装|装机)地址(?:相同|一致)?$/.test(values[0])) {
          if (!defaults.sameBilling()) conflicts.set(key,true);
          else conflicts.delete(key);
          continue;
        }
        if (defaults.sameBilling() && values[0]!==control('install_address').value.trim() && validValue(key,values[0])) {
          defaults.setBillingFromReply(values[0]);
          conflicts.delete(key);
          continue;
        }
      }
      const current=control(key).value.trim();
      if (values.length===1 && !validValue(key,values[0]) && !current) {conflicts.delete(key);continue;}
      if(values.length!==1 || !validValue(key,values[0]) || (current && values[0]!==current)) {conflicts.set(key,true);continue;}
      conflicts.delete(key);
      if(current) continue;
      put(key,values[0]);
      control(key).dispatchEvent(new Event('input',{bubbles:true}));
      if(key==='payment_method') control(key).dispatchEvent(new Event('change',{bubbles:true}));
    }
    syncCompany(true); checked=true;pending=false;
    form.dispatchEvent(new Event('input',{bubbles:true}));updateFollowup();
  }
  form.addEventListener('change',event=>{
    const key=event.target.name;
    if(['biz','business_name','attr','voice'].includes(key)) setContext();
    if(key==='company_name'){syncCompany(false);if(control(key).value.trim())lookup();}
    if(key && key==='payment_method' && validValue(key,control(key).value)) conflicts.delete(key);
    if(key) updateFollowup();
  });
  form.addEventListener('input',event=>{
    const key=event.target.name;
    if(event.target===at('reply-text')){pending=Boolean(event.target.value.trim());return;}
    if(key==='company_name') syncCompany(false);
    if(key && conflicts.has(key) && validValue(key,control(key).value.trim())) conflicts.delete(key);
    if(key) updateFollowup();
  });
  at('lookup-fixture').onclick=()=>{syncCompany(false);lookup();};
  at('read-reply').onclick=analyze;
  at('reply-conflicts').onclick=event=>{const key=event.target.closest('[data-keep]')?.dataset.keep;if(key){conflicts.delete(key);updateFollowup();}};
  at('intake').addEventListener('click',async event=>{
    const button=event.target.closest('[data-copy]');if(!button)return;
    const area=at(button.dataset.copy);
    await copyTextArea(area,at('copy-feedback'));
  });
  setContext();
  return {
    setExtras(keys) {extras=keys;updateRequired();},
    attentionKeys,
    beforeGenerate() {
      if(!enabled())return '';
      if(pending)return '请先识别这次粘贴的回复，或清空回复框。';
      if(neededKeys().some(key=>conflicts.has(key)))return '请先处理客户回复中的冲突。';
      if(voice() && attentionKeys().some(key=>key.startsWith('extra_')))return '请先补充本次业务所需的语音实名资料。';
      return '';
    }
  };
}
