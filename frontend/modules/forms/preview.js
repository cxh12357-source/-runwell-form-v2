import { escape as esc, get } from '../../lib/api.js';
import { request, status, refresh, hasToken, setToken, downloadControl } from './shared.js';
import { bindGeneration, generation } from './generate.js';
import { bindTemplates, templatesView } from './templates.js';

function history(rows, catalog, hosted, fileRoot = '/records/', fileLabel = '下载 Word') {
  const label = (list, id) => esc(list.find(e => e.id === id)?.name ?? id);
  if (!rows.length) return '<p>当前账号还没有生成记录。</p>';
  return '<div class="table-wrap"><table><thead><tr><th>业务及套餐</th><th>模板版本</th><th>创建人</th><th>生成时间</th><th>状态</th><th>文件</th></tr></thead><tbody>' + rows.map(r =>
    '<tr><td>' + label(catalog.businesses, r.business_id) + '／' + label(catalog.versions, r.business_version_id) + '／' +
    label(catalog.attributes, r.business_attribute) + '<br>' + esc(r.tariff.name) + '</td><td>' + esc(r.template.name) +
    '<br>' + esc(r.template.revision) + '</td><td>' + esc(r.created_by) + '</td><td>' + esc(new Date(r.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})) +
    '</td><td>已生成</td><td>' + downloadControl(fileRoot + r.id + '/file', fileLabel, hosted) + '</td></tr>').join('') + '</tbody></table></div>';
}

const periods=[['week','本周'],['month','本月'],['all','累计'],['custom','自定义日期']];
function dashboardResults(board, employee) {
  const {period,offset,from,to}=board.range;
  const label=period==='all'?'累计':period==='custom'?'自定义日期':offset===0?(period==='week'?'本周':'本月'):(period==='week'?'往期周':'往期月');
  return '<p class="dashboard-range"><strong>'+label+'</strong>'+(from?' · '+esc(from)+' 至 '+esc(to):' · 全部时间')+'（上海时间）</p>'+
    '<p class="dashboard-total"><strong>'+board.records.length+'</strong> 次 Word 生成'+(board.scope==='team'?' · '+board.employees.length+' 个账号':'')+'</p>'+
    '<div class="table-wrap"><table class="dashboard-summary"><thead><tr><th>账号</th><th>报价次数</th><th>Word 生成次数</th></tr></thead><tbody>'+
    board.employees.map(person=>'<tr><td>'+(board.scope==='team'?
      '<button type="button" class="dashboard-employee" data-employee="'+esc(person.id)+'" aria-pressed="'+(employee===person.id)+'">'+esc(person.id)+'</button>':
      esc(person.id))+'</td><td>'+(person.quote_count??'暂未开放')+'</td><td>'+person.forms_count+'</td></tr>').join('')+
    '</tbody></table></div>';
}
function dashboardDetails(board,catalog,employee) {
  const rows=employee?board.records.filter(row=>row.created_by===employee):board.records;
  return '<h3 id="dashboard-detail-title">'+(employee?esc(employee)+' · ':'')+'表单明细（'+rows.length+'）</h3>'+
    (employee?'<button type="button" class="dashboard-employee" data-clear-employee>查看全部账号</button>':'')+
    (rows.length?history(rows,catalog,false,'/dashboard/records/','下载 Word 查看'):'<p>所选范围内没有生成记录。</p>');
}
function dashboard(board,catalog) {
  return '<p class="hint">'+(board.scope==='team'?'点击员工姓名查看个人明细。':'仅查看当前账号的记录。')+
    ' 只统计成功生成的 Word；同一业务重新生成也会计一次。报价与审核暂未开放。</p>'+
    '<div class="dashboard-toolbar" role="group" aria-label="统计周期">'+periods.map(([value,label])=>
      '<button type="button" data-period="'+value+'" aria-pressed="'+(board.range.period===value)+'">'+label+'</button>').join('')+'</div>'+
    '<div id="dashboard-paging" class="dashboard-toolbar"><button type="button" data-period-step="1">上一期</button>'+
    '<button type="button" data-period-step="-1" disabled>下一期</button></div>'+
    '<form id="dashboard-custom" class="dashboard-custom" hidden><label>开始日期<input type="date" name="from" required></label>'+
    '<label>结束日期<input type="date" name="to" required></label><button class="button">应用日期</button></form>'+
    '<div id="dashboard-results" aria-live="polite">'+dashboardResults(board,'')+'</div>'+
    '<section id="dashboard-details" aria-labelledby="dashboard-detail-title">'+dashboardDetails(board,catalog,'')+'</section>';
}
function bindDashboard(root,state) {
  const paging=root.querySelector('#dashboard-paging'), custom=root.querySelector('#dashboard-custom');
  const results=root.querySelector('#dashboard-results'), details=root.querySelector('#dashboard-details');
  let board=state.board, employee='', selected=board.range.period, requestId=0;
  function controls() {
    for(const button of root.querySelectorAll('[data-period]'))button.setAttribute('aria-pressed',String(button.dataset.period===selected));
    custom.hidden=selected!=='custom';
    paging.hidden=selected!=='week' && selected!=='month';
    paging.querySelector('[data-period-step="-1"]').disabled=board.range.offset===0;
    paging.querySelector('[data-period-step="1"]').disabled=board.range.offset>=520;
  }
  async function load(params) {
    const ticket=++requestId;
    status(root,'正在更新统计…');
    try {
      const next=await request('/dashboard?'+new URLSearchParams(params));
      if(ticket!==requestId || !root.isConnected)return;
      board=next;
      if(!board.employees.some(person=>person.id===employee))employee='';
      results.innerHTML=dashboardResults(board,employee);
      details.innerHTML=dashboardDetails(board,state.catalog,employee);
      controls();
      status(root,'');
    } catch(error){
      if(ticket!==requestId || !root.isConnected)return;
      selected=board.range.period;
      controls();
      status(root,error.message);
    }
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.dataset.period){
      selected=button.dataset.period;
      controls();
      if(selected==='custom'){
        requestId++;
        status(root,'选择起止日期后，点击「应用日期」。');
        if(!custom.elements.from.value && board.range.from)custom.elements.from.value=board.range.from;
        if(!custom.elements.to.value && board.range.to)custom.elements.to.value=board.range.to;
      } else void load({period:selected});
    } else if(button.dataset.periodStep && selected===board.range.period){
      const offset=board.range.offset+Number(button.dataset.periodStep);
      if(offset>=0 && offset<=520)void load({period:selected,offset:String(offset)});
    } else if(button.dataset.employee || button.hasAttribute('data-clear-employee')){
      employee=button.dataset.employee||'';
      for(const row of results.querySelectorAll('[data-employee]'))row.setAttribute('aria-pressed',String(row.dataset.employee===employee));
      details.innerHTML=dashboardDetails(board,state.catalog,employee);
      if(!employee)results.querySelector('[data-employee]')?.focus({preventScroll:true});
    }
  });
  custom.onsubmit=event=>{
    event.preventDefault();
    if(custom.elements.from.value>custom.elements.to.value){status(root,'开始日期不能晚于结束日期。');return;}
    void load({period:'custom',from:custom.elements.from.value,to:custom.elements.to.value});
  };
  controls();
}

async function workspace(path) {
  const [profile, directory] = await Promise.all([request('/workspace'), get('/catalog')]);
  const state = { workspace: profile, catalog: directory.data, path };
  if (path === '/dashboard') state.board = await request('/dashboard');
  if (path.endsWith('/history')) state.rows = await request('/records');
  if (path.endsWith('/templates') && profile.actor.role === 'admin') state.rows = await request('/templates');
  return state;
}
function login(hosted) {
  if (hosted) return '<form id="forms-login"><p>选择本次验收身份。员工 A 和员工 B 分别拥有自己的生成记录。</p><label>验收身份<select name="account"><option value="a">员工 A</option><option value="b">员工 B</option><option value="admin">模板管理员</option></select></label><button class="button">进入工作区</button></form>';
  return '<form id="forms-login"><label>本机联调口令<input required type="password" name="token" autocomplete="off" placeholder="使用启动终端中的员工或管理员口令"></label><button class="button">进入表单工作区</button></form>';
}
export async function renderPreview(path, tabs, hosted = false) {
  let body = login(hosted);
  let state;
  if (hasToken()) {
    try {
      state = await workspace(path);
      state.hosted = hosted;
      if (path === '/dashboard') body = dashboard(state.board,state.catalog);
      if (path.endsWith('/generate')) body = generation(state.workspace.labels);
      if (path.endsWith('/history')) body = history(state.rows, state.catalog, hosted);
      if (path.endsWith('/templates')) body = state.rows ? templatesView(state) : '<p>当前为员工账号。请切换为模板管理员后管理模板。</p>';
    } catch (error) {
      if (error.status !== 401) throw error;
      setToken('');
    }
  }
  // Tie data to the rendered route, even when another navigation completes first.
  const viewId = crypto.randomUUID();
  pendingViews.set(viewId, state);
  if (pendingViews.size > 8) pendingViews.delete(pendingViews.keys().next().value);
  const board=path==='/dashboard';
  return '<a class="back" href="#/">← 返回工作台</a><h1>'+(board?'看板':'表单填写')+'</h1><p class="lead">仅使用虚构客户资料和测试套餐。</p>' +
    (board?'':'<nav class="tabs" aria-label="表单子板块">' + tabs.map(([url, name]) => '<a href="#' + url + '" ' +
    (path === url ? 'aria-current="page"' : '') + '>' + name + '</a>').join('') + '</nav>') + '<section class="panel" id="forms-preview" data-view="' +
    viewId + '"><h2>' + (board?'工作统计':tabs.find(t => t[0] === path)[1]) + '</h2>' + (state ? '<p class="hint">当前身份　' + esc(state.workspace.actor.id) +
    '　<button id="forms-exit" type="button">切换账号</button></p>' : '') + body + '<p role="status"></p></section>';
}
const pendingViews = new Map();

async function download(button) {
  const blob = await request(button.dataset.file, { file: true });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (button.dataset.file.startsWith('/templates/') ? '联调模板-' : '申请表-') + button.dataset.file.split('/').at(-2) + '.docx';
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
      const submit = loginForm.querySelector('button');
      submit.disabled = true;
      try {
        let credential;
        if (loginForm.elements.account) {
          const session = await request('/test-session', {method:'POST', data:{account:loginForm.elements.account.value}});
          credential = session.token;
        } else {
          credential = loginForm.elements.token.value.trim();
          await request('/workspace', {credential});
        }
        if (root.isConnected) { setToken(credential); refresh(); }
      } catch (error) { status(root, error.message); } finally { submit.disabled = false; }
    };
    return;
  }
  root.querySelector('#forms-exit').onclick = () => { setToken(''); refresh(); };
  root.addEventListener('click', async event => {
    const button = event.target.closest('button[data-file]');
    if (!button) return;
    try { await download(button); } catch (error) { status(root, error.message); }
  });
  if (current?.board) bindDashboard(root,current);
  if (root.querySelector('#generate-form')) bindGeneration(root, current);
  if (root.querySelector('#template-form')) bindTemplates(root, current);
}
