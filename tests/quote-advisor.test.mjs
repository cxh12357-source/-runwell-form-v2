import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';
import { matchQuoteAdvice } from '../frontend/modules/quotes.js';
import { createTemplateAi } from '../online/template-ai.mjs';
import { analyzeQuoteDialogue, quoteAiFailure } from '../online/quote-ai.mjs';

const chat='客户：下午开会老卡，月底还要给总部传备份。\n销售：是不是只有 Wi-Fi 卡？要不先上千兆？';
const update='客户：插网线也卡，就在传备份的时候。商务专线可以看，上行至少 200M。刚才说的 900 是月均，可以年付。';
const reply=data=>Response.json({choices:[{message:{content:JSON.stringify(data)}}]});
const pending={summary:'视频会议和备份可能相互影响',confirmed:['开会时卡顿'],inferred:['可能存在上传并发瓶颈'],
  question:'卡顿时使用网线也会出现吗？',ready:false};
const confirmed={summary:'有线会议在上传备份时卡顿；客户同意评估商务专线',confirmed:['最低上行 200M','接受年付'],
  inferred:[],question:'',period:'year',budget:900,budgetUnit:'month',minUp:200,ready:true};

test('DeepSeek 空白输出会重试，接口余额错误可辨识且不返回原始错误',async ()=>{
  let calls=0;
  const result=await analyzeQuoteDialogue([chat],'test-only',async ()=>{
    if(++calls===1)return Response.json({choices:[{message:{content:'  '}}]});
    return reply(pending);
  });
  assert.equal(calls,2);
  assert.equal(result.question,pending.question);
  await assert.rejects(analyzeQuoteDialogue([chat],'test-only',async ()=>new Response('private',{status:402})),error=>{
    const failure=quoteAiFailure(error);
    return failure.code==='DEEPSEEK_BALANCE'&&failure.error.includes('余额不足')&&!failure.error.includes('private');
  });
});

test('报价顾问保留微信上下文，客户改口后按年付月均预算匹配真实资费',async t=>{
  const requests=[];
  const server=createApp(null,{quoteAiFetch:async (url,options)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer test-only');
    const body=JSON.parse(options.body);
    const turns=JSON.parse(body.messages[1].content);
    requests.push(turns);
    return reply(turns.length===1?pending:confirmed);
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const origin='http://127.0.0.1:'+server.address().port;
  const call=(dialogue,site=origin)=>fetch(origin+'/api/v1/quotes/advisor',{method:'POST',
    headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify({dialogue})});
  const settings=(data,site=origin)=>fetch(origin+'/api/v1/quotes/ai-settings',{method:'POST',
    headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await call([chat],'https://elsewhere.invalid')).status,403);
  assert.equal((await call([chat])).status,503);
  assert.equal((await settings({action:'save',ai:'wrong-origin'},'https://elsewhere.invalid')).status,403);
  assert.deepEqual(await (await settings({action:'save',ai:'test-only'})).json(),{data:{ai:true,provider:'deepseek'}});
  const first=(await (await call([chat])).json()).data;
  assert.match(first.question,/网线/);
  assert.deepEqual(matchQuoteAdvice(first),[]);
  const second=(await (await call([chat,update])).json()).data;
  const [offer,...rest]=matchQuoteAdvice(second);
  assert.deepEqual(requests,[[chat],[chat,update]]);
  assert.deepEqual(offer.selection,{business:'商务专线',rate:'100',period:'year',discount:'standard',addon:'200'});
  assert.equal(offer.quote.recurring,8080);
  assert.equal(rest.length,0,'200M 基础套餐超过预算');
  assert.deepEqual(matchQuoteAdvice({...second,budget:600}),[]);
  assert.deepEqual(matchQuoteAdvice({...second,period:'twoYears',budget:900,minUp:300}),[]);
});

test('WorkBuddy 同款接口使用指定地址和模型，并能读取带代码围栏的 JSON',async ()=>{
  const result=await analyzeQuoteDialogue([chat],'test-only',async (url,options)=>{
    assert.equal(url,'https://ai.dxkp.com/v1/chat/completions');
    assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);
    assert.equal(body.model,'DeepSeek-V4-Pro-0813');
    assert.equal(body.thinking,undefined);
    return Response.json({choices:[{message:{content:'```json\n'+JSON.stringify(pending)+'\n```'}}]});
  },undefined,'dxkp');
  assert.equal(result.summary,pending.summary);
});

test('本机可测试和保存自定义接口，测试不覆盖已保存的配置',async t=>{
  const server=createApp(null,{quoteAiFetch:async (url,options)=>{
    assert.equal(url,'https://models.example/v1/chat/completions');
    assert.equal(JSON.parse(options.body).model,'example-pro');
    assert.equal(options.headers.Authorization,'Bearer test-only');
    return reply(pending);
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const origin='http://127.0.0.1:'+server.address().port;
  const post=(path,data)=>fetch(origin+'/api/v1/quotes/'+path,{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const custom={provider:'custom',baseUrl:'https://models.example/v1/',model:'example-pro',ai:'test-only'};
  assert.equal((await post('ai-settings',{...custom,baseUrl:'http://models.example/v1',action:'test'})).status,400);
  assert.deepEqual(await (await post('ai-settings',{...custom,action:'test'})).json(),{data:{connected:true}});
  assert.equal((await post('advisor',{dialogue:[chat]})).status,503);
  assert.deepEqual(await (await post('ai-settings',{...custom,action:'save'})).json(),
    {data:{ai:true,provider:'custom',baseUrl:custom.baseUrl,model:custom.model}});
  assert.equal((await (await post('advisor',{dialogue:[chat]})).json()).data.summary,pending.summary);
  assert.equal((await post('ai-settings',{action:'save-qcc',qccKey:'test-qcc-key'})).status,400);
  assert.deepEqual(await (await post('ai-settings',{action:'save-qcc',qccKey:'test-qcc-key',qccSecret:'test-qcc-secret'})).json(),{data:{qcc:true}});
  assert.deepEqual(await (await post('ai-settings',{action:'status'})).json(),
    {data:{ai:true,qcc:true,provider:'custom',baseUrl:custom.baseUrl,model:custom.model}});
});

test('远端报价入口需验收口令，且拒绝不完整的模型输出',async ()=>{
  const token='example-token-which-is-longer-than-32-characters';
  const env={DEMO_ORIGIN:'https://demo.example',DEMO_AI_TOKEN:token,AI_API_KEY:'test-only'};
  const handler=createTemplateAi(async()=>reply({}));
  const request=authorization=>new Request('https://worker.example/template-ai?purpose=quote',{method:'POST',
    headers:{Origin:env.DEMO_ORIGIN,Authorization:'Bearer '+authorization},
    body:JSON.stringify({dialogue:[chat]})});
  assert.equal((await handler(request('wrong'),env)).status,401);
  assert.equal((await handler(request(token),env)).status,502);
});
