import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTemplateAi} from '../online/template-ai.mjs';

test('AI 模板预览限制来源与口令，并只返回五个可核对字段',async()=>{
  const env={DEMO_ORIGIN:'https://demo.example',DEMO_AI_TOKEN:'x'.repeat(48),AI_API_KEY:'test-provider-secret'};
  let calls=0;
  const handler=createTemplateAi(async(url,options)=>{
    calls++;
    assert.equal(new URL(url).hostname,'api.deepseek.com');
    assert.equal(JSON.parse(options.body).messages[1].content,'100M 测试摘要');
    return Response.json({choices:[{message:{content:JSON.stringify({bandwidth:'100M',voice:'可能',extra:'忽略'})}}]});
  });
  const send=(origin,token,evidence='100M 测试摘要')=>handler(new Request('https://api.example/template-ai',{
    method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token},body:JSON.stringify({evidence})
  }),env);
  assert.equal((await send('https://other.example',env.DEMO_AI_TOKEN)).status,403);
  assert.equal((await send(env.DEMO_ORIGIN,'wrong')).status,401);
  assert.equal((await send(env.DEMO_ORIGIN,env.DEMO_AI_TOKEN,'x'.repeat(5000))).status,413);
  assert.equal(calls,0);
  assert.deepEqual((await (await send(env.DEMO_ORIGIN,env.DEMO_AI_TOKEN)).json()).data,
    {bandwidth:'100M',name:'',revision:'',voice:'',discount:''});
  assert.equal(calls,1);
});
