const remote=typeof __DEMO_AI_ENDPOINT__==='string'?__DEMO_AI_ENDPOINT__:'';
const bundled=typeof __RUNWELL_DEFAULT_CATALOG__==='boolean';

export function renderQuoteAdvisor(){
  return '<details class="quote-advisor"><summary>AI 报价顾问</summary>'+
    (bundled&&!remote?'<p class="hint">此展示环境未连接 AI 后台，请使用已配置 DeepSeek 的本地验收服务。</p>':
    '<form data-quote-advisor><p class="hint">粘贴客户和销售的微信对话，建议标注说话人。分析内容会发送给配置的 AI 接口，请先去掉姓名、电话和详细地址。后续可以继续补充客户回复。</p>'+
    (remote?'<label>AI 验收口令<input name="access" type="password" autocomplete="off" required></label>':'')+
    '<label>微信对话 / 后续回复<textarea name="dialogue" rows="4" maxlength="1500" required placeholder="客户：最近一开视频会就卡……"></textarea></label>'+
    '<div class="quote-actions"><button class="button">分析需求</button><button class="button" type="button" data-advisor-reset>清空对话</button></div></form>'+
    '<p data-advisor-status role="status"></p><ol data-advisor-history hidden></ol><div data-advisor-result></div>')+'</details>';
}

export function bindQuoteAdvisor(root,match,apply){
  const form=root.querySelector('[data-quote-advisor]');
  if(!form)return;
  const status=root.querySelector('[data-advisor-status]'), history=root.querySelector('[data-advisor-history]'),
    result=root.querySelector('[data-advisor-result]'), input=form.elements.dialogue;
  let turns=[], request=null;
  const add=(parent,tag,value)=>{
    const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;
  };
  form.querySelector('[data-advisor-reset]').onclick=()=>{
    request?.abort();request=null;turns=[];history.replaceChildren();history.hidden=true;
    result.replaceChildren();status.textContent='';input.value='';form.querySelector('button').disabled=false;
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    const value=input.value.trim();
    if(!value||request)return;
    const next=[...turns,value];
    if(next.length>8||next.join('').length>5000){status.textContent='已达对话上限，请清空后粘贴精简的对话摘要。';return;}
    const controller=new AbortController();request=controller;
    const submit=form.querySelector('button');submit.disabled=true;
    result.replaceChildren();status.textContent='DeepSeek 正在理解对话…';
    try{
      const response=await fetch(remote?remote+'?purpose=quote':'/api/v1/quotes/advisor',{
        method:'POST',credentials:'omit',redirect:'error',
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(23000)]),
        headers:{'Content-Type':'application/json',...(remote?{Authorization:'Bearer '+form.elements.access.value.trim()}:{})},
        body:JSON.stringify({dialogue:next})
      });
      const body=await response.json().catch(()=>null);
      if(!response.ok||!body?.data)throw new Error(body?.error||'当前页面没有可用的报价 AI 后台。');
      if(request!==controller)return;
      const advice=body.data;
      turns=next;if(input.value.trim()===value)input.value='';
      history.hidden=false;add(history,'li',value);
      add(result,'h3','需求理解');add(result,'p',advice.summary);
      for(const [label,items] of [['客户已确认',advice.confirmed],['AI 推测，待核对',advice.inferred]]){
        if(!items.length)continue;
        add(result,'h4',label);
        const list=add(result,'ul','');for(const item of items)add(list,'li',item);
      }
      if(advice.question)add(result,'p','建议追问：'+advice.question);
      if(advice.ready){
        const offers=match(advice);
        if(!offers.length)add(result,'p','现有已核验套餐没有匹配方案，请核对客户条件或人工选型。');
        offers.forEach(({selection,quote},i)=>{
          const card=add(result,'section','');card.className='notice slim';
          add(card,'h4',(i?'备选':'首推')+'：'+quote.speed+(quote.addon?'，上行升速至 '+quote.addon+'M':''));
          add(card,'p',quote.cycle.label+' · '+quote.recurring+' 元/'+quote.cycle.unit+' · 初装费 '+quote.installation+' 元 · 可装性待电信确认');
          const button=add(card,'button','带入报价计算');button.type='button';button.className='button';button.onclick=()=>apply(selection);
        });
      }
      status.textContent='分析完成。可补充客户回复继续分析。';
    }catch(error){if(request===controller)status.textContent=error.name==='TimeoutError'?'分析超时，请重试。':error.message;}
    finally{if(request===controller){request=null;submit.disabled=false;}}
  };
}
