import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { voiceVersion } from './modules/forms/preview/rules.mjs';
import { catalog } from './modules/catalog/data.mjs';
import { getFormsResource } from './modules/forms/routes.mjs';

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

export function createApp(preview = null) {
  return createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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
