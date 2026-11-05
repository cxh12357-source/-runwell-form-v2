import { readFile, writeFile, mkdir, lstat, readdir } from 'node:fs/promises';
import { resolve, dirname, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { renderDemoCustomerInfo } from './demo-customer-info.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || resolve(source, 'dist/demo'));
const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('无法确认当前提交，停止发布。');
function before(text, marker) {
  if (!text.includes(marker)) throw new Error('展示构建需要适配最新界面：' + marker);
  return text.slice(0, text.indexOf(marker));
}
function replaceRequired(text, from, to) {
  if (!text.includes(from)) throw new Error('展示构建需要适配最新界面：' + from);
  return text.replace(from, to);
}
const { catalog } = await import(pathToFileURL(resolve(source, 'backend/modules/catalog/data.mjs')));
const { labels, tariffs, version, defaultMapping } = await import(pathToFileURL(resolve(source, 'backend/modules/forms/preview/rules.mjs')));
const read = name => readFile(resolve(source, 'frontend', name), 'utf8');
const files = [];
const add = (path, content) => files.push({ path, content });
add('index.html', (await read('index.html')).replace('href="/styles.css"', 'href="./styles.css"').replace('src="/app.js"', 'src="./app.js"').replace('本地开发预览', '免登录展示版 · ' + commit.slice(0, 7)));
add('styles.css', await read('styles.css') + '\n.demo-banner{margin:0 0 24px}.demo-banner p+p{margin-top:6px}#bank-fields[hidden]{display:none}button:disabled{cursor:not-allowed;opacity:.65}input[type=file]{height:auto}textarea:disabled{color:#64778b;background:#f6f8fb}td{padding:20px 14px}pre{white-space:pre-wrap;max-width:480px}.demo-version{color:#7a899b;font-size:12px;margin-top:28px}\n');
files.find(f => f.path === 'styles.css').content += '.required-mark{color:#b42318;font-weight:700;margin-inline-end:.35em}.customer-wide{grid-column:span 2}#billing-address-details[hidden]{display:none}@media(max-width:680px){.customer-wide{grid-column:auto}}\n';
add('modules/home.js', (await read('modules/home.js')).replace('当前先搭建表单生成、历史记录和套餐模板管理。', '表单生成、历史记录和套餐模板管理已接入新版展示界面。'));
add('lib/api.js', (await read('lib/api.js')).split('export async function get')[0]);
// Include the colleague's actual rendering and classification functions, without
// the server mutation handlers. Source files in both worktrees stay untouched.
const generation = before(await read('modules/forms/generate.js'), 'export function bindGeneration')
  .replace("import { bindClassification, options, request, selectors, status }", 'import { selectors }');
const customerStart = generation.indexOf(`'<div class="divider"></div><h3>客户资料</h3>`);
const customerEnd = generation.indexOf(`'<button id="generate"`, customerStart);
if (customerStart < 0 || customerEnd < 0) throw new Error('无法定位生成页的客户资料区域，请检查展示构建。');
add('modules/forms/generate.js', generation.slice(0, customerStart) + JSON.stringify(renderDemoCustomerInfo()) + ' +\n    ' + generation.slice(customerEnd));
add('modules/forms/templates.js', before(await read('modules/forms/templates.js'), 'function readFile').replace('import { bindClassification, request, selectors, status, refresh }', 'import { selectors }').replace('可下载样表核对占位符。新上传的版本需要手动启用。', '目录仅供展示，可展开查看字段映射；上传、下载和启停暂不可用。'));
const shared = await read('modules/forms/shared.js');
add('modules/forms/shared.js', "import { escape as esc } from '../../lib/api.js';\n" + shared.slice(shared.indexOf('export function options')));
add('demo-data.js', 'export const state = ' + JSON.stringify({
  catalog: { ...catalog, versions: [version] },
  workspace: { labels, tariffs },
  rows: tariffs.map(t => ({ id: t.id + '-sample', tariff_id: t.id, name: t.name + ' 新装样表', revision: 'demo-1', active: true, mapping: defaultMapping }))
}) + ';\n');
add('modules/demo-forms.js', `import { generation } from './forms/generate.js';
import { templatesView } from './forms/templates.js';
import { bindClassification } from './forms/shared.js';
import { state } from '../demo-data.js';
const tabs = [['/forms/generate','表单生成'],['/forms/history','表单历史记录'],['/forms/templates','套餐模板管理']];
export function renderForms(path) {
  const title = tabs.find(t => t[0] === path)[1];
  const body = path.endsWith('/generate') ? generation(state.workspace.labels) : path.endsWith('/templates') ? '<p class="hint">以下为 oneaskq 验收版内置测试样表的目录预览，不代表正式套餐。</p>' + templatesView(state) : '<div class="table-wrap"><table><thead><tr><th>业务及套餐</th><th>模板版本</th><th>创建人</th><th>生成时间</th><th>状态</th><th>文件</th></tr></thead><tbody><tr><td colspan="6" class="table-empty">展示版未连接记录数据库，暂无可展示的生成记录。</td></tr></tbody></table></div>';
  return '<a class="back" href="#/">← 返回工作台</a><div class="eyebrow">FORM WORKSPACE</div><h1>表单填写</h1><p class="lead">客户资料、业务模板与生成记录，集中处理。</p><nav class="tabs" aria-label="表单子板块">' + tabs.map(([url,name]) => '<a href="#' + url + '" ' + (path === url ? 'aria-current="page"' : '') + '>' + name + '</a>').join('') + '</nav><section class="panel" id="demo-forms"><h2>' + title + '</h2>' + body + '</section>';
}
export function bindForms() {
  const root = document.querySelector('#demo-forms');
  if (!root) return;
  const form = root.querySelector('form');
  if (form) {
    bindClassification(form, state);
    if (form.id === 'template-form') form.addEventListener('change', () => {
      for (const row of root.querySelectorAll('tr[data-tariff]')) {
        const tariff = state.workspace.tariffs.find(t => t.id === row.dataset.tariff);
        row.hidden = [['biz','business_id'],['ver','business_version_id'],['attr','business_attribute'],['tariff','id']].some(([name,key]) => form.elements.namedItem(name).value && tariff[key] !== form.elements.namedItem(name).value);
      }
    });
    form.onsubmit = event => event.preventDefault();
    for (const element of form.querySelectorAll('input,textarea')) {
      element.disabled = true;
      if (element.tagName === 'INPUT' && element.type !== 'file') element.placeholder = '界面展示，暂不填写或保存';
    }
    const payment = form.elements.namedItem('payment_method');
    if (payment) payment.onchange = () => { root.querySelector('#bank-fields').hidden = payment.value !== 'collection'; };
    const billingMode = form.elements.namedItem('billing_address_mode');
    if (billingMode) billingMode.onchange = () => { root.querySelector('#billing-address-details').hidden = billingMode.value !== 'other'; };
  }
  for (const button of root.querySelectorAll('button')) {
    button.disabled = true;
    button.title = '展示版暂不可用，需连接服务器';
  }
}
`);
add('app.js', replaceRequired(await read('app.js'), "from './modules/forms.js'", "from './modules/demo-forms.js'").replace("view.innerHTML = html;", `view.innerHTML = html + '<p class="demo-version">界面来源：GitHub 已合并版本 ${commit.slice(0, 7)} · 表单填写由 oneaskq 负责</p>';`));
add('version.json', JSON.stringify({ commit, branch: 'feature/project-skeleton', mode: 'static-demo' }));
add('ship.json', JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }] }));
const names = new Set(files.map(f => f.path));
// The host uploads the whole output folder. Refuse stale or unexpected files.
async function checkOutput(directory, prefix = '') {
  let stat;
  try { stat = await lstat(directory); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('展示目录不是普通目录：' + directory);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory() && [...names].some(path => path.startsWith(name + '/'))) {
      await checkOutput(resolve(directory, entry.name), name + '/');
    } else if (!entry.isFile() || !names.has(name)) {
      throw new Error('展示目录含未批准发布的文件：' + name);
    }
  }
}
await checkOutput(output);
for (const file of files) {
  if (/fetch\s*\(|XMLHttpRequest|Authorization|localStorage|sessionStorage|(?:ship|deploy)-[a-f0-9]{32}/i.test(file.content)) throw new Error('展示包包含业务请求或身份凭据：' + file.path);
  if (file.path.endsWith('.js')) for (const match of file.content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const dependency = posix.normalize(posix.join(posix.dirname(file.path), match[1]));
    if (!match[1].startsWith('.') || !names.has(dependency)) throw new Error('展示包缺少依赖：' + dependency);
  }
}
for (const file of files) {
  const target = resolve(output, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content);
}
console.log(JSON.stringify({ output, commit, files: files.length, bytes: files.reduce((n,f)=>n+Buffer.byteLength(f.content),0) }));
