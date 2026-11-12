const endpoint=typeof __DEMO_AI_ENDPOINT__==='string'?__DEMO_AI_ENDPOINT__:'';
const local=typeof __RUNWELL_DEFAULT_CATALOG__==='undefined'&&typeof location!=='undefined'&&
  location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname);

const qccFields='<label>企查查 API Key<input name="qccKey" type="password" autocomplete="new-password" maxlength="512"></label>'+
  '<label>企查查 Secret Key<input name="qccSecret" type="password" autocomplete="new-password" maxlength="512"></label>';

export function renderSettings(path='/settings/api',identity){
  if(path==='/settings/account'){
    const role=identity?.role==='admin'?'管理员':identity?.role==='staff'?'员工':'未登录';
    return '<h1>账号设置</h1><section class="panel"><h2>当前账号</h2><p>'+
      (identity?.simulated?'演示身份：':'当前身份：')+role+'</p>'+
      (identity?.simulated?'<a class="workflow-link" href="#/forms">前往表单页切换演示身份</a>':'<p class="hint">此环境未提供账号资料或密码修改功能。</p>')+'</section>';
  }
  if(path==='/settings/feedback')return '<h1>意见反馈</h1><section class="panel settings-feedback">'+
    '<label>反馈内容<textarea data-feedback rows="6" maxlength="2000" placeholder="例如：哪个页面遇到了什么问题？"></textarea></label>'+
    '<button class="button" type="button" data-copy-feedback>复制反馈</button><p class="hint" role="status">复制后可发给项目负责人。</p></section>';
  if(local)return '<h1>AI / 软件 API 接口设置</h1><section class="panel settings-section"><h2>自定义 AI 接口</h2>'+
    '<p class="hint">密钥仅保存在当前本地后台的内存中，服务重启后需重新填写。此设置用于 AI 报价顾问。</p>'+
    '<form id="local-quote-ai" class="local-quote-ai"><p class="hint">支持 OpenAI 兼容协议。报价分析会发送到你填写的接口。</p>'+
    '<label>接口地址<input name="baseUrl" type="url" value="https://ai.dxkp.com/v1" maxlength="500" required></label>'+
    '<label>API Key<input name="ai" type="password" autocomplete="new-password" maxlength="512" required></label>'+
    '<label>模型名称<input name="model" value="DeepSeek-V4-Pro-0813" maxlength="160" required></label>'+
    '<div class="quote-actions"><button class="button">保存到本地后台</button> <button type="button" class="button" data-check>测试连接</button></div></form>'+
    '<p data-ai-status role="status"></p><a class="back" href="#/quotes">前往业务报价 →</a></section>'+
    '<section class="panel settings-section"><h2>企查查 API</h2><p class="hint">两项密钥需一起保存。当前可配置凭据，企业查询尚未接入。</p>'+
    '<form id="local-qcc" class="local-quote-ai">'+qccFields+
    '<button class="button">保存企查查凭据</button></form><p data-qcc-status role="status"></p></section>';
  return '<h1>AI / 软件 API 接口设置</h1><section class="panel"><h2>接口凭据</h2>'+
    (!endpoint?'<p>当前为静态演示页。请在本地后台或已连接设置服务的版本中配置 API 凭据。</p>':'')+
    '<form id="integration-settings"><fieldset'+(!endpoint?' disabled':'')+'><label>设置管理员口令<input name="access" type="password" autocomplete="off" required></label>'+
    '<div class="field-grid"><label>AI API Key（DeepSeek）<input name="ai" type="password" autocomplete="new-password" maxlength="512"></label>'+
    qccFields+'</div>'+
    '<p class="hint">只填写需要更新的凭据。企查查的两项需一起填写。</p>'+
    '<button class="button" type="button" data-check>查看配置状态</button> <button class="button">保存凭据</button></fieldset></form>'+
    '<p role="status"></p></section>';
}

export function bindSettings(root,path='/settings/api'){
  if(path==='/settings/account')return;
  if(path==='/settings/feedback'){
    const input=root.querySelector('[data-feedback]'),status=root.querySelector('[role="status"]');
    root.querySelector('[data-copy-feedback]').onclick=async()=>{
      if(!input.value.trim()){status.textContent='请先填写反馈内容。';return;}
      try{await navigator.clipboard.writeText(input.value.trim());status.textContent='已复制，可发给项目负责人。';}
      catch{input.focus();input.select();status.textContent='请手动复制已选中的反馈。';}
    };
    return;
  }
  if(local){
    const form=root.querySelector('#local-quote-ai'), field=form.elements.ai, status=root.querySelector('[data-ai-status]');
    const qccForm=root.querySelector('#local-qcc'),qccStatus=root.querySelector('[data-qcc-status]');
    const postSettings=async data=>{
      const response=await fetch('/api/v1/quotes/ai-settings',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(data)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'设置请求失败。');
      return result.data;
    };
    qccForm.onsubmit=async event=>{
      event.preventDefault();
      const {qccKey,qccSecret}=qccForm.elements;
      if(!qccKey.value.trim()||!qccSecret.value.trim()){qccStatus.textContent='请同时填写 API Key 和 Secret Key。';return;}
      const save=qccForm.querySelector('button');
      save.disabled=true;
      try{
        await postSettings({action:'save-qcc',qccKey:qccKey.value.trim(),qccSecret:qccSecret.value.trim()});
        qccForm.reset();
        qccStatus.textContent='企查查凭据已保存到当前本地后台。';
      }catch(error){qccStatus.textContent=error.message;}
      finally{save.disabled=false;}
    };
    let busy=false;
    async function run(action){
      if(busy)return;
      if(action!=='status'&&!form.reportValidity())return;
      const data={action};
      if(action!=='status')Object.assign(data,{provider:'custom',ai:field.value.trim(),
        baseUrl:form.elements.baseUrl.value.trim(),model:form.elements.model.value.trim()});
      busy=true;status.textContent=action==='test'?'正在测试模型接口…':'正在连接本地后台…';
      try{
        const result=await postSettings(data);
        if(action==='test'){status.textContent='连接成功。可以保存此配置。';return;}
        if(action==='save')field.value='';
        if(action==='status'){
          qccStatus.textContent=result.qcc?'企查查凭据已配置。':'企查查凭据未配置。';
          if(result.baseUrl&&!field.value){
            form.elements.baseUrl.value=result.baseUrl;
            form.elements.model.value=result.model;
          }
        }
        status.textContent=action==='save'?'已保存到当前本地后台。':result.ai?'当前后台已配置。':'当前后台尚未配置。';
      }catch(error){status.textContent=error.message;}
      finally{busy=false;}
    }
    form.onsubmit=event=>{event.preventDefault();run('save');};
    form.querySelector('[data-check]').onclick=()=>run('test');
    run('status');
    return;
  }
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
