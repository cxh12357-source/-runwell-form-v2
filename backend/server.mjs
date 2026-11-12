import { createApp } from './app.mjs';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const port = Number(process.env.PORT ?? 3000);
let preview, store;
const tokens = [];
if (process.argv.includes('--forms-preview')) {
  const { openStore } = await import('./modules/forms/preview/store.mjs');
  const { previewRoutes } = await import('./modules/forms/preview/http.mjs');
  const { version } = await import('./modules/forms/preview/rules.mjs');
  const directory = resolve(process.env.FORMS_PREVIEW_DIR || '.forms-preview');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  store = await openStore(join(directory, 'forms.sqlite'));
  const identities = new Map();
  for (const [id, role] of [['员工A', 'staff'], ['员工B', 'staff'], ['模板管理员', 'admin']]) {
    const token = randomBytes(24).toString('base64url');
    identities.set('Bearer ' + token, { id, role });
    tokens.push([id, token]);
  }
  preview = { version, route: previewRoutes(store, identities) };
}
const server = createApp(preview,{quoteAiKey:process.env.DEEPSEEK_API_KEY||process.env.AI_API_KEY,quoteAiModel:process.env.AI_MODEL});
server.on('close', () => store?.close());
server.on('error', error => { console.error('本地服务启动失败：', error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`润网本地预览：http://127.0.0.1:${server.address().port}`);
  if (preview) {
    console.log('仅输入虚构资料。以下为本次启动的本机联调口令：');
    for (const [id, token] of tokens) console.log(id, token);
  }
});
