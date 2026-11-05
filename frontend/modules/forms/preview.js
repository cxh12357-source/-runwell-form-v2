import { escape as esc, get } from '../../lib/api.js';
import { request, status, refresh, hasToken, setToken } from './shared.js';
import { bindGeneration, generation } from './generate.js';
import { bindTemplates, templatesView } from './templates.js';

function history(rows, catalog) {
  const label = (list, id) => esc(list.find(e => e.id === id)?.name ?? id);
  if (!rows.length) return '<p>当前账号还没有生成记录。</p>';
  return '<div class="table-wrap"><table><thead><tr><th>业务及套餐</th><th>模板版本</th><th>创建人</th><th>生成时间</th><th>状态</th><th>文件</th></tr></thead><tbody>' + rows.map(r =>
    '<tr><td>' + label(catalog.businesses, r.business_id) + '／' + label(catalog.versions, r.business_version_id) + '／' +
    label(catalog.attributes, r.business_attribute) + '<br>' + esc(r.tariff.name) + '</td><td>' + esc(r.template.name) +
    '<br>' + esc(r.template.revision) + '</td><td>' + esc(r.created_by) + '</td><td>' + esc(new Date(r.created_at).toLocaleString('zh-CN')) +
    '</td><td>已生成</td><td><button class="button" data-file="/records/' + esc(r.id) + '/file">下载 Word</button></td></tr>').join('') + '</tbody></table></div>';
}

async function workspace(path) {
  const [profile, directory] = await Promise.all([request('/workspace'), get('/catalog')]);
  const state = { workspace: profile, catalog: directory.data, path };
  if (path.endsWith('/history')) state.rows = await request('/records');
  if (path.endsWith('/templates') && profile.actor.role === 'admin') state.rows = await request('/templates');
  return state;
}
function login() {
  return '<form id="forms-login"><label>本机联调口令<input required type="password" name="token" autocomplete="off" placeholder="使用启动终端中的员工或管理员口令"></label><button class="button">进入表单工作区</button></form>';
}
export async function renderPreview(path, tabs) {
  let body = login();
  let state;
  if (hasToken()) {
    try {
      state = await workspace(path);
      if (path.endsWith('/generate')) body = generation(state.workspace.labels);
      if (path.endsWith('/history')) body = history(state.rows, state.catalog);
      if (path.endsWith('/templates')) body = state.rows ? templatesView(state) : '<p>当前为员工账号。请使用模板管理员口令管理模板。</p>';
    } catch (error) {
      if (error.status !== 401) throw error;
      setToken('');
    }
  }
  // Tie data to the rendered route, even when another navigation completes first.
  const viewId = crypto.randomUUID();
  pendingViews.set(viewId, state);
  if (pendingViews.size > 8) pendingViews.delete(pendingViews.keys().next().value);
  return '<a class="back" href="#/">← 返回工作台</a><h1>表单填写</h1><p class="lead">本机联调，仅填写虚构资料。</p>' +
    '<nav class="tabs" aria-label="表单子板块">' + tabs.map(([url, name]) => '<a href="#' + url + '" ' +
    (path === url ? 'aria-current="page"' : '') + '>' + name + '</a>').join('') + '</nav><section class="panel" id="forms-preview" data-view="' +
    viewId + '"><h2>' + tabs.find(t => t[0] === path)[1] + '</h2>' + (state ? '<p class="hint">当前身份　' + esc(state.workspace.actor.id) +
    '　<button id="forms-exit" type="button">切换账号</button></p>' : '') + body + '<p role="status"></p></section>';
}
const pendingViews = new Map();

async function download(button) {
  const blob = await request(button.dataset.file, { file: true });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (button.dataset.file.startsWith('/records/') ? '申请表-' : '联调模板-') + button.dataset.file.split('/')[2] + '.docx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function bindPreview() {
  const root = document.querySelector('#forms-preview');
  const current = pendingViews.get(root.dataset.view);
  pendingViews.delete(root.dataset.view);
  const loginForm = root.querySelector('#forms-login');
  if (loginForm) {
    loginForm.onsubmit = async event => {
      event.preventDefault();
      const credential = loginForm.elements.token.value.trim();
      try {
        await request('/workspace', { credential });
        if (root.isConnected) { setToken(credential); refresh(); }
      } catch (error) { status(root, error.message); }
    };
    return;
  }
  root.querySelector('#forms-exit').onclick = () => { setToken(''); refresh(); };
  root.addEventListener('click', async event => {
    const button = event.target.closest('button[data-file]');
    if (!button) return;
    try { await download(button); } catch (error) { status(root, error.message); }
  });
  if (root.querySelector('#generate-form')) bindGeneration(root, current);
  if (root.querySelector('#template-form')) bindTemplates(root, current);
}
