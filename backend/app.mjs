import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { voiceVersion } from './modules/forms/preview/rules.mjs';
import { catalog } from './modules/catalog/data.mjs';
import { getFormsResource } from './modules/forms/routes.mjs';
import { analyzeQuoteDialogue, customQuoteProvider, isQuoteProvider, quoteAiFailure, testQuoteConnection, validateQuoteDialogue } from '../online/quote-ai.mjs';

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

export function createApp(preview = null, { quoteAiKey, quoteAiModel, quoteAiFetch } = {}) {
  let aiWindow=0, aiUsed=0;
  let quoteAiProvider='deepseek';
  let quoteAiCustom;
  let qccCredentials;
  return createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if(path==='/api/v1/quotes/ai-settings'&&req.method==='POST'){
        const host=req.headers.host||'';
        if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)||req.headers.origin!=='http://'+host||
          req.headers['content-type']!=='application/json')
          return json(res,403,{error:'只接受本机润网设置页面的请求。'});
        let size=0, chunks=[];
        for await(const chunk of req.iterator({destroyOnReturn:false})){
          size+=chunk.length;
          if(size>4096){res.setHeader('Connection','close');return json(res,413,{error:'提交内容过长。'});}
          chunks.push(chunk);
        }
        try{
          const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(data.action==='save-qcc'){
            const {qccKey,qccSecret}=data;
            if(![qccKey,qccSecret].every(value=>typeof value==='string'&&/^[\x21-\x7e]{1,512}$/.test(value)))
              return json(res,400,{error:'请同时填写有效的企查查 API Key 和 Secret Key。'});
            qccCredentials={qccKey,qccSecret};
            return json(res,200,{data:{qcc:true}});
          }
          if(data.action==='save'||data.action==='test'){
            if(typeof data.ai!=='string'||!/^[\x21-\x7e]{1,512}$/.test(data.ai))throw new Error();
            const provider=data.provider??'deepseek';
            if(!isQuoteProvider(provider)&&provider!=='custom')return json(res,400,{error:'请选择支持的 AI 接口。'});
            let custom;
            if(provider==='custom'){
              try{custom=customQuoteProvider(data.baseUrl,data.model);}
              catch(error){return json(res,400,{error:error.message});}
            }
            if(data.action==='test'){
              if(!custom)return json(res,400,{error:'请填写要测试的自定义接口。'});
              try{
                await testQuoteConnection(custom,data.ai,quoteAiFetch);
                return json(res,200,{data:{connected:true}});
              }catch(error){return json(res,502,quoteAiFailure(error));}
            }
            quoteAiProvider=provider;
            quoteAiCustom=custom&&{...custom,baseUrl:data.baseUrl.trim()};
            quoteAiKey=data.ai;
          }else if(data.action!=='status')throw new Error();
          const dataOut={ai:Boolean(quoteAiKey),provider:quoteAiProvider};
          if(data.action==='status')dataOut.qcc=Boolean(qccCredentials);
          if(quoteAiCustom)Object.assign(dataOut,{baseUrl:quoteAiCustom.baseUrl,model:quoteAiCustom.model});
          return json(res,200,{data:dataOut});
        }catch{return json(res,400,{error:'请输入有效的 DeepSeek API Key。'});}
      }
      if(path==='/api/v1/quotes/advisor'&&req.method==='POST'){
        const host=req.headers.host||'';
        if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)||req.headers.origin!=='http://'+host||
          req.headers['content-type']!=='application/json')
          return json(res,403,{error:'只接受本机润网报价页面的请求。'});
        if(!quoteAiKey)return json(res,503,{error:'本机报价后台未配置 DeepSeek；请启动配置了密钥的服务。'});
        let size=0, chunks=[];
        for await(const chunk of req.iterator({destroyOnReturn:false})){
          size+=chunk.length;
          if(size>32000){res.setHeader('Connection','close');return json(res,413,{error:'对话内容过长。'});}
          chunks.push(chunk);
        }
        let dialogue;
        try{({dialogue}=JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{}
        if(!validateQuoteDialogue(dialogue))return json(res,400,{error:'请输入有效的对话内容（最多八轮、累计 5000 字）。'});
        if(Date.now()-aiWindow>=60000){aiWindow=Date.now();aiUsed=0;}
        if(aiUsed>=10)return json(res,429,{error:'分析次数过多，请稍后再试。'});
        aiUsed++;
        try{return json(res,200,{data:await analyzeQuoteDialogue(dialogue,quoteAiKey,quoteAiFetch,quoteAiModel,quoteAiProvider,quoteAiCustom)});}
        catch(error){return json(res,502,quoteAiFailure(error));}
      }
      if (preview && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) {
        return json(res, 403, { error: { code: 'LOCAL_ONLY', message: '联调模式只接受本机访问。' } });
      }
      if (path === '/api/v1/forms/mode' && req.method === 'GET') return json(res, 200, { data: { preview: Boolean(preview) } });
      if (preview && path.startsWith('/api/v1/forms/')) {
        return await preview.route(req, res, path.slice('/api/v1/forms'.length), json);
      }
      if (req.method !== 'GET') {
        return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '当前骨架仅提供读取接口，业务提交尚未开放。' } });
      }
      if (path === '/api/v1/health') return json(res, 200, { data: { status: 'ok', mode: preview ? 'forms-preview' : 'skeleton', version: '0.1.0' } });
      if (path === '/api/v1/catalog') return json(res, 200, { data: preview ? { ...catalog, versions: [...catalog.versions, preview.version, voiceVersion] } : catalog });
      const resource = getFormsResource(path);
      if (resource) return json(res, 200, resource);
      if (path.startsWith('/api/')) return json(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在或尚未开放。' } });

      const target = resolve(frontend, '.' + (path === '/' ? '/index.html' : path));
      const local = relative(frontend, target);
      if (local.startsWith('..') || isAbsolute(local) || !types[extname(target)]) {
        return json(res, 404, { error: { code: 'NOT_FOUND', message: '页面不存在。' } });
      }
      const content = await readFile(target);
      res.writeHead(200, { 'Content-Type': types[extname(target)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(content);
    } catch (error) {
      if (error.status) return json(res, error.status, { error: { code: 'FORMS_' + error.status, message: error.message } });
      const status = error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500;
      json(res, status, { error: { code: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_RESOURCE', message: '无法读取此资源。' } });
    }
  });
}
