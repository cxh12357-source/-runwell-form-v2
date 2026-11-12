import { renderHome, renderPending, sections } from './modules/home.js';
import { renderForms, bindForms } from './modules/forms.js';
import { renderSettings, bindSettings } from './modules/settings.js';
import { renderQuotes, bindQuotes } from './modules/quotes.js';
import { currentIdentity } from './modules/forms/shared.js';
import { bindWorkflow } from './modules/workflow.js';

const view = document.querySelector('#view');
const identity = document.querySelector('#workspace-identity');
function updateIdentity() {
  const {role, simulated} = currentIdentity() || {};
  const label = role === 'admin' ? '管理员' : role === 'staff' ? '员工' : '未登录';
  identity.textContent = (simulated ? '演示身份：' : '当前身份：') + label;
}
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#content').focus();
});
let sequence = 0;
let workbenchExpanded = false;
let settingsExpanded = false;
const settingsLinks = [
  {path:'/settings/account',name:'账号设置'},
  {path:'/settings/feedback',name:'意见反馈'},
  {path:'/settings/api',name:'AI / 软件 API 接口设置'}
];
let activePath = '';
let activeKey = '';
const retainedRoutes = new Set(['/forms/generate', '/quotes', '/review', '/settings/feedback']);
// Keep work in this tab only; the detached controls retain their live state.
const workInProgress = new Map();

async function render(event) {
  const request = ++sequence;
  updateIdentity();
  let [path, query] = (location.hash.slice(1) || '/').split('?');
  if (path === '/forms') path = '/forms/generate';
  if (path === '/settings') path = '/settings/api';
  const settingsActive = settingsLinks.some(item => item.path === path);
  const order = new URLSearchParams(query).get('order') || '';
  const routeKey=path+'?order='+order;
  const active = route => path === route || (route !== '/' && path.startsWith(route + '/'));
  const link = ({path: route, name}) => '<a href="#' + route + '"' +
    (active(route) ? ' aria-current="page"' : '') + '>' + name + '</a>';
  const activeChild = sections.some(section => active(section.path));
  if (activeChild) workbenchExpanded = true;
  if (settingsActive) settingsExpanded = true;
  const navigation = document.querySelector('#navigation');
  navigation.innerHTML =
    '<ul class="nav-root"><li class="nav-workbench' + (activeChild ? ' has-current-child' : '') + '">' +
    '<button type="button" class="nav-parent" aria-controls="workbench-children" aria-expanded="' + workbenchExpanded +
    '">工作台<span class="nav-chevron" aria-hidden="true"></span></button>' +
    '<ul id="workbench-children" class="nav-children" aria-label="工作台子导航"' + (workbenchExpanded ? '' : ' hidden') + '>' +
    sections.map(section => '<li>' + link(section) + '</li>').join('') +
    '</ul></li><li>' + link({path:'/dashboard',name:'工作量统计'}) + '</li>'+
    '<li class="nav-settings'+(settingsActive?' has-current-child':'')+'">'+
    '<button type="button" class="nav-parent" aria-controls="settings-children" aria-expanded="'+settingsExpanded+'">'+
    '设置<span class="nav-chevron" aria-hidden="true"></span></button>'+
    '<ul id="settings-children" class="nav-children" aria-label="设置子导航"'+(settingsExpanded?'':' hidden')+'>'+
    settingsLinks.map(item=>'<li>'+link(item)+'</li>').join('')+'</ul></li></ul>';
  const toggle = navigation.querySelector('[aria-controls="workbench-children"]');
  toggle.onclick = () => {
    workbenchExpanded = !workbenchExpanded;
    toggle.setAttribute('aria-expanded', String(workbenchExpanded));
    navigation.querySelector('#workbench-children').hidden = !workbenchExpanded;
  };
  const settingsToggle = navigation.querySelector('[aria-controls="settings-children"]');
  settingsToggle.onclick = () => {
    settingsExpanded = !settingsExpanded;
    settingsToggle.setAttribute('aria-expanded', String(settingsExpanded));
    navigation.querySelector('#settings-children').hidden = !settingsExpanded;
  };
  const refresh = event?.type === 'runwell:refresh';
  if (event?.detail?.resetProgress) workInProgress.clear();
  if (!refresh && activeKey === routeKey) return;
  if (activePath && activeKey !== routeKey && !event?.detail?.resetProgress && retainedRoutes.has(activePath)) {
    const content = document.createDocumentFragment();
    content.append(...view.childNodes);
    workInProgress.set(activeKey, content);
  }
  activePath = '';activeKey='';
  if (!refresh && workInProgress.has(routeKey)) {
    view.replaceChildren(workInProgress.get(routeKey));
    workInProgress.delete(routeKey);
    activePath = path;
    activeKey = routeKey;
    document.title = (view.querySelector('h1')?.textContent || '工作台') + ' · 润网';
    return;
  }
  view.innerHTML = '<p role="status">正在加载…</p>';
  try {
    let html;
    if (path === '/') html = renderHome();
    else if (path === '/quotes') html = renderQuotes();
    else if (path === '/review') html = renderPending('手续审核');
    else if (settingsActive) html = renderSettings(path,currentIdentity());
    else if (['/dashboard', '/forms/generate', '/forms/history', '/forms/templates'].includes(path)) html = await renderForms(path);
    else html = '<h1>页面不存在</h1><a class="button" href="#/">返回工作台</a>';
    if (request !== sequence) return;
    view.innerHTML = html;
    if(settingsActive)bindSettings(view,path);
    else if(path==='/quotes')bindQuotes(view);
    else bindForms();
    bindWorkflow(view,path,order,currentIdentity()||{});
    activePath = path;
    activeKey = routeKey;
    document.title = `${view.querySelector('h1')?.textContent || '工作台'} · 润网`;
  } catch {
    if (request !== sequence) return;
    view.innerHTML = '<h1>暂时无法加载</h1><p>请检查本地服务是否运行，然后重试。</p><button id="retry" class="button">重新加载</button>';
    document.querySelector('#retry').addEventListener('click', render);
  } finally {
    if (request === sequence) updateIdentity();
  }
}
window.addEventListener('hashchange', render);
window.addEventListener('runwell:refresh', render);
render();
