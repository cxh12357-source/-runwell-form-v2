const endpoint=typeof __DEMO_AI_ENDPOINT__==='string'?__DEMO_AI_ENDPOINT__:'';

export function renderSettings(){
  return '<h1>设置</h1><section class="panel"><h2>接口凭据</h2>'+
    (!endpoint?'<p>当前环境尚未连接设置服务，暂不能保存 API 凭据。</p>':'')+
    '<form id="integration-settings"><fieldset'+(!endpoint?' disabled':'')+'><label>设置管理员口令<input name="access" type="password" autocomplete="off" required></label>'+
    '<div class="field-grid"><label>AI API Key（DeepSeek）<input name="ai" type="password" autocomplete="new-password" maxlength="512"></label>'+
    '<label>企查查 API Key<input name="qccKey" type="password" autocomplete="new-password" maxlength="512"></label>'+
    '<label>企查查 Secret Key<input name="qccSecret" type="password" autocomplete="new-password" maxlength="512"></label></div>'+
    '<p class="hint">只填写需要更新的凭据。企查查的两项需一起填写。</p>'+
    '<button class="button" type="button" data-check>查看配置状态</button> <button class="button">保存凭据</button></fieldset></form>'+
    '<p role="status"></p></section>';
}

export function bindSettings(root){
  if(!endpoint)return;
  const form=root.querySelector('#integration-settings'), fields=form.elements, status=root.querySelector('[role="status"]');
  async function run(save){
    if(!fields.access.reportValidity())return;
    const data=Object.fromEntries(['ai','qccKey','qccSecret'].map(k=>[k,fields[k].value.trim()]).filter(([,v])=>v));
    if(save && (!Object.keys(data).length || Boolean(data.qccKey)!==Boolean(data.qccSecret))){
      status.textContent='请填写要更新的凭据；企查查 API Key 和 Secret Key 需一起填写。';return;
    }
    const token=fields.access.value.trim();
    form.querySelector('fieldset').disabled=true;
    status.textContent='正在连接设置服务…';
    try {
      const response=await fetch(endpoint+'?settings=1',{method:save?'PUT':'GET',credentials:'omit',redirect:'error',
        signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,...(save?{'Content-Type':'application/json'}:{})},
        body:save?JSON.stringify(data):undefined});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'无法读取设置。');
      status.textContent=(save?'已保存。':'')+'AI：'+(result.data.ai?'已配置':'未配置')+'；企查查：'+(result.data.qcc?'已配置':'未配置')+'。';
    }catch(error){status.textContent=error.message;}
    finally{for(const k of ['access','ai','qccKey','qccSecret'])fields[k].value='';form.querySelector('fieldset').disabled=false;}
  }
  form.onsubmit=event=>{event.preventDefault();run(true);};
  form.querySelector('[data-check]').onclick=()=>run(false);
}
