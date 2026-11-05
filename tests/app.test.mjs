import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';
import { renderHome, renderPending } from '../frontend/modules/home.js';
import { renderForms, formFields } from '../frontend/modules/forms.js';

let server, base;
before(async () => {
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

test('主入口与建设中页面', () => {
  const html = renderHome();
  for (const path of ['/quotes', '/forms', '/review']) assert.ok(html.includes(`href="#${path}"`));
  assert.ok(renderPending('业务报价').includes('功能建设中'));
});
test('统一分类和真实空状态', async () => {
  const response = await fetch(base + '/api/v1/catalog');
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.businesses.map(b => b.name), ['IPMAN', '精品专线', '商务专线', '智能专线']);
  assert.deepEqual(data.attributes.map(b => b.name), ['新装', '移机', '变更', '拆机']);
  assert.deepEqual(data.versions, []);
  for (const resource of ['templates', 'records']) {
    const body = await (await fetch(base + '/api/v1/forms/' + resource)).json();
    assert.deepEqual(body.data, []);
    assert.equal(body.meta.implementation, 'skeleton');
  }
});
test('表单子页面通过真实接口渲染，客户输入禁用', async () => {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => nativeFetch(new URL(url, base), options);
  try {
    for (const path of ['/forms/generate', '/forms/history', '/forms/templates']) {
      const html = await renderForms(path);
      for (const title of ['表单生成', '表单历史记录', '套餐模板管理']) assert.ok(html.includes(title));
      if (path.endsWith('generate')) {
        for (const [key] of formFields) assert.ok(html.includes(`name="${key}"`));
        assert.ok(html.includes('<fieldset disabled'));
        assert.ok(html.includes('开户银行'));
        assert.ok(html.includes('禁止猜测'));
      }
    }
  } finally { globalThis.fetch = nativeFetch; }
});
test('静态页面及模块依赖可读取', async () => {
  for (const path of ['/', '/app.js', '/styles.css', '/modules/home.js', '/modules/forms.js', '/lib/api.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0);
  }
});
test('未实现写入不伪造成功，内部文件不可访问', async () => {
  assert.equal((await fetch(base + '/api/v1/forms/generate', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/v1/unknown')).status, 404);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e%2fbackend/app.mjs')).status, 404);
  assert.equal((await fetch(base + '/bad%ZZ')).status, 400);
});
