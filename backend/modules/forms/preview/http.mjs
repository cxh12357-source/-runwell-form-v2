import { FormError, insist, labels, tariffs, dashboardPeriod, workDashboard } from './rules.mjs';
import { isObject } from './store.mjs';

async function input(req) {
  insist(req.headers['content-type']?.split(';')[0] === 'application/json', '请求应为 JSON 格式。', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    insist(size <= 750000, '上传内容过大。', 413);
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new FormError('JSON 格式错误。', 400); }
  insist(isObject(data), '请提供对象格式的数据。', 400);
  return data;
}

export function previewRoutes(store, identities) {
  return async (req, res, path, json) => {
    const actor = identities.get(req.headers.authorization);
    insist(actor, '请输入启动终端显示的联调口令。', 401);
    const { method } = req;
    const send = data => json(res, 200, { data });
    const list = data => json(res, 200, { data, meta: { total: data.length, implementation: 'preview' } });
    const file = bytes => {
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="runwell.docx"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(Buffer.from(bytes));
    };
    if (path === '/workspace' && method === 'GET') return send({ actor, tariffs, labels });
    if (path === '/match' && method === 'POST') return send(store.match((await input(req)).selection));
    if (path === '/generate' && method === 'POST') return send(await store.generate(actor.id, await input(req)));
    if (path === '/records' && method === 'GET') return list(store.history(actor.id));
    if (path === '/dashboard' && method === 'GET') {
      const range=dashboardPeriod(new URL(req.url,'http://localhost').searchParams);
      return send(workDashboard(actor,[...identities.values()],actor.role==='admin'?store.teamHistory():store.history(actor.id),range));
    }
    const boardDownload = /^\/dashboard\/records\/([\w-]+)\/file$/.exec(path);
    if (boardDownload && method === 'GET') return file(store.recordFile(boardDownload[1],actor.id,actor.role==='admin'));
    const download = /^\/records\/([\w-]+)\/file$/.exec(path);
    if (download && method === 'GET') return file(store.recordFile(download[1], actor.id));
    if (path === '/templates' || path.startsWith('/templates/')) {
      insist(actor.role === 'admin', '仅模板管理员可以管理模板。', 403);
      if (path === '/templates' && method === 'GET') return list(store.templates());
      if (path === '/templates' && method === 'POST') return json(res, 201, { data: await store.upload(await input(req)) });
      const item = /^\/templates\/([\w-]+)(\/file)?$/.exec(path);
      if (item && !item[2] && method === 'PATCH') return send(store.setActive(item[1], (await input(req)).active));
      if (item?.[2] && method === 'GET') return file(store.templateFile(item[1]));
    }
    throw new FormError('此接口或操作不存在。', 404);
  };
}
