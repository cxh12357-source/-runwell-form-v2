import { renderHome, renderPending, sections } from './modules/home.js';
import { renderForms, bindForms } from './modules/forms.js';
import { renderSettings, bindSettings } from './modules/settings.js';

const view = document.querySelector('#view');
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#content').focus();
});
let sequence = 0;
async function render() {
  const request = ++sequence;
  let path = location.hash.slice(1) || '/';
  if (path === '/forms') path = '/forms/generate';
  const active = route => path === route || (route !== '/' && path.startsWith(route + '/'));
  const link = ({path: route, name}, className = '') => '<a href="#' + route + '" class="' + className + '"' +
    (active(route) ? ' aria-current="page"' : '') + '>' + name + '</a>';
  document.querySelector('#navigation').innerHTML =
    '<ul class="nav-root"><li class="nav-workbench' + (sections.some(section => active(section.path)) ? ' has-current-child' : '') + '">' +
    link({path:'/',name:'工作台'}, 'nav-parent') + '<ul class="nav-children" aria-label="工作台子导航">' +
    sections.map(section => '<li>' + link(section) + '</li>').join('') +
    '</ul></li><li>' + link({path:'/settings',name:'设置'}) + '</li></ul>';
  view.innerHTML = '<p role="status">正在加载…</p>';
  try {
    let html;
    if (path === '/') html = renderHome();
    else if (path === '/quotes') html = renderPending('业务报价');
    else if (path === '/review') html = renderPending('手续审核');
    else if (path === '/settings') html = renderSettings();
    else if (['/forms/generate', '/forms/history', '/forms/templates'].includes(path)) html = await renderForms(path);
    else html = '<h1>页面不存在</h1><a class="button" href="#/">返回工作台</a>';
    if (request !== sequence) return;
    view.innerHTML = html;
    if(path==='/settings')bindSettings(view);
    else bindForms();
    document.title = `${view.querySelector('h1')?.textContent || '工作台'} · 润网`;
  } catch {
    if (request !== sequence) return;
    view.innerHTML = '<h1>暂时无法加载</h1><p>请检查本地服务是否运行，然后重试。</p><button id="retry" class="button">重新加载</button>';
    document.querySelector('#retry').addEventListener('click', render);
  }
}
window.addEventListener('hashchange', render);
render();
