import { escape as esc } from '../../lib/api.js';
import { businessText, titles, companyTitles, parseReply, validValue, requiredKeys, followup,
  lookupFixture, staffEstimates } from './intake-rules.js';

const voiceKeys = Object.keys(titles).filter(k=>k.startsWith('extra_'));
export const intakeExtraKeys = [...voiceKeys, ...Object.keys(companyTitles)];
const entry = (key,label)=>'<label>'+esc(label)+'<input name="'+esc(key)+'" maxlength="500" autocomplete="off"></label>';
const box = (id,label,rows)=>'<label>'+label+'<textarea id="'+id+'" rows="'+rows+'" maxlength="12000"></textarea></label>';
const copy = (id,label)=>'<button type="button" data-copy="'+id+'">'+label+'</button>';
export function intakePanel() {
  return '<section id="intake" hidden><div class="divider"></div><h3>发给客户</h3>'+
    '<div class="intake-columns"><div>'+box('info-text','填写信息话术',6)+copy('info-text','复制填写信息话术')+'</div>'+
    '<div>'+box('material-text','手续材料提示',6)+copy('material-text','复制手续材料提示')+'</div></div>'+
    '<h3>核对客户回复</h3>'+box('reply-text','粘贴客户整段回复或本次补充',4)+
    '<button type="button" class="button" id="read-reply">识别并填入空白栏</button>'+
    '<p class="hint">回复中的业务、语音及折扣请在上方核对并选择。</p>'+
    '<p id="read-summary" aria-live="polite"></p><div id="reply-conflicts"></div>'+
    '<div id="followup-block" hidden>'+box('followup-text','发给客户的补充话术',4)+copy('followup-text','复制缺项追问')+'</div>'+
    '<p id="copy-feedback" aria-live="polite"></p></section>';
}
export function internalPanel() {
  return '<section id="voice-fields" hidden><h3>语音实名资料</h3><div class="field-grid">'+
    voiceKeys.map(k=>entry(k,titles[k])).join('')+'</div></section>'+
    '<section id="company-fields" hidden><div class="divider"></div><h3>工作人员核对企业信息</h3>'+
    '<p class="hint">本次测试只查询虚构样例。选含工商栏的测试套餐，可将核对结果写入 Word。</p>'+
    '<button type="button" id="lookup-fixture">按企业全称补全</button><p id="lookup-status" aria-live="polite"></p>'+
    '<div class="field-grid">'+entry('insured','实际参保人数')+Object.entries(companyTitles).map(([key,label])=>entry(key,label)).join('')+
    '</div><p id="estimate" class="hint"></p></section>';
}

export function bindIntake(form) {
  const at=id=>form.querySelector('#'+id);
  const control=key=>form.elements.namedItem(key);
  const voice=()=>control('voice').value==='yes';
  const enabled=()=>control('biz').value==='business-line' && Boolean(control('business_name').value) &&
    control('business_name').value!=='外地公司担保书' && control('attr').value==='new' && Boolean(control('voice').value);
  const neededKeys=()=>requiredKeys(voice(),control('payment_method').value).filter(key=>key!=='tariff');
  let context='', checked=false, pending=false, activeCompany='', extras=[], conflicts=new Map(), missing=[];
  const put=(key,value)=>{ control(key).value=value; };
  function updateRequired() {
    for (const key of intakeExtraKeys) control(key).required=extras.includes(key);
    for (const key of voiceKeys) control(key).disabled=!enabled() || !voice();
  }
  function updateFollowup() {
    if(!checked || !enabled()) return;
    const needed=neededKeys();
    missing=needed.filter(key=>!conflicts.has(key) && !validValue(key,control(key).value.trim()));
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
    for (const key of ['insured',...Object.keys(companyTitles)]) put(key,'');
    at('lookup-status').textContent=''; at('estimate').textContent='';
    if (auto && name) lookup();
  }
  function derive() {
    const estimates=staffEstimates(control('insured').value);
    for(const key of ['extra_company_size','extra_computer_count']) put(key,estimates?.[key]||'');
    at('estimate').textContent=estimates?'按 '+estimates.people+' 名参保人估算 '+estimates.computers+' 台计算机，请员工核对。':'请输入实际参保人数计算区间。';
  }
  function lookup() {
    const name=control('company_name').value.trim();
    if(!name){at('lookup-status').textContent='请先填写企业全称。';return;}
    const row=lookupFixture(name);
    if(!row){at('lookup-status').textContent='无对应虚构样例，企查查查询暂缓。缺失工商资料由员工核对。';return;}
    for(const [key,value] of Object.entries(row)) if(!control(key).value) put(key,value);
    derive();
    at('lookup-status').textContent='来源：虚构验收样例。请核对信用代码、行业和估算区间。';
  }
  function setContext() {
    const next=enabled()?control('business_name').value+'|'+control('voice').value:'';
    at('intake').hidden=at('company-fields').hidden=!next;
    at('voice-fields').hidden=!next||!voice();
    if(next!==context) {
      context=next; checked=false; pending=false; conflicts.clear();
      at('read-summary').textContent=''; at('reply-conflicts').replaceChildren(); at('followup-block').hidden=true;
      at('copy-feedback').textContent=''; at('reply-text').value='';
      const scripts=businessText[voice()?'voice':'no_voice'];
      at('info-text').value=scripts.info; at('material-text').value=scripts.materials;
      if(!voice()) for(const key of voiceKeys) put(key,'');
    }
    updateRequired();updateFollowup();
  }
  function analyze() {
    if(!at('reply-text').value.trim()){at('read-summary').textContent='请先粘贴客户回复。';return;}
    const parsed=parseReply(at('reply-text').value);
    for(const key of ['payment_method',...Object.keys(parsed).filter(k=>k!=='payment_method')]){
      if(!parsed[key] || !neededKeys().includes(key)) continue;
      const values=parsed[key];
      const current=control(key).value.trim();
      if (values.length===1 && !validValue(key,values[0]) && !current) {conflicts.delete(key);continue;}
      if(values.length!==1 || !validValue(key,values[0]) || (current && values[0]!==current)) {conflicts.set(key,true);continue;}
      conflicts.delete(key);
      if(current) continue;
      put(key,values[0]);
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
    if(key==='insured') derive();
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
    try{await navigator.clipboard.writeText(area.value);at('copy-feedback').textContent='已复制，可粘贴给客户。';}
    catch{area.focus();area.select();at('copy-feedback').textContent=document.execCommand('copy')?'已复制，可粘贴给客户。':'已选中，请手动复制。';}
  });
  setContext();
  return {
    setExtras(keys) {extras=keys;updateRequired();},
    beforeGenerate() {
      if(!enabled())return '';
      if(pending)return '请先识别这次粘贴的回复，或清空回复框。';
      if(neededKeys().some(key=>conflicts.has(key)))return '请先处理客户回复中的冲突。';
      return '';
    }
  };
}
