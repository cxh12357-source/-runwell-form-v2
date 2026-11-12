import { dashboardTrend } from './dashboard-trend.js';
import { escape as esc, get } from '../../lib/api.js';
import { request, status, refresh, hasToken, setToken, downloadControl, options } from './shared.js';
import { bindGeneration, generation } from './generate.js';
import { bindTemplates, templatesView } from './templates.js';
import { classifyTariff } from './business-selection.js';

function history(rows, catalog, hosted, fileRoot = '/records/', fileLabel = '下载 Word') {
  const label = (list, id) => esc(list.find(e => e.id === id)?.name ?? id);
  if (!rows.length) return '<p>当前账号还没有生成记录。</p>';
  return '<div class="table-wrap"><table><thead><tr><th>业务及套餐</th><th>模板版本</th><th>创建人</th><th>生成时间</th><th>状态</th><th>文件</th></tr></thead><tbody>' + rows.map(r =>
    '<tr><td>' + label(catalog.businesses, r.business_id) + '／' + label(catalog.versions, r.business_version_id) + '／' +
    label(catalog.attributes, r.business_attribute) + '<br>' + esc(r.tariff.name) + (r.discount?.factor?' · '+esc(r.discount.factor)+' 折':'') + '</td><td>' + esc(r.template.name) +
    '<br>' + esc(r.template.revision) + '</td><td>' + esc(r.created_by) + '</td><td>' + esc(new Date(r.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})) +
    '</td><td>已生成</td><td>' + downloadControl(fileRoot + r.id + '/file', fileLabel, hosted) + '</td></tr>').join('') + '</tbody></table></div>';
}

const periods=[['week','本周'],['month','本月'],['quarter','本季度'],['fiscal','本财年'],['all','累计'],['custom','自定义日期']];
const pageable=new Set(['week','month','quarter','fiscal']);
function dashboardChart(board, employee) {
  const max = Math.max(1, ...board.employees.map(person => person.forms_count));
  return '<section class="dashboard-chart" aria-labelledby="dashboard-chart-title">' +
    '<h3 id="dashboard-chart-title">Word 生成次数</h3>' +
    (!board.records.length ? '<p class="hint">没有符合所选条件的 Word 生成记录。</p>' : '') +
    '<ul class="dashboard-bars">' + board.employees.map(person => {
      const label = board.scope === 'team'
        ? '<button type="button" class="dashboard-employee" data-employee="' + esc(person.id) + '" aria-pressed="' +
          (employee === person.id) + '">' + esc(person.id) + '</button>'
        : '<span>' + esc(person.id) + '</span>';
      return '<li>' + label + '<svg class="dashboard-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        '<rect width="100" height="10" class="dashboard-bar-track"/><rect width="' + (person.forms_count / max * 100) +
        '" height="10" class="dashboard-bar-value"/></svg><strong>' + person.forms_count + '<span> 次</span></strong></li>';
    }).join('') + '</ul></section>';
}

function dashboardResults(board, employee) {
  const {period,offset,from,to}=board.range;
  const label=period==='all'?'累计':period==='custom'?'自定义日期':
    period==='quarter'?from.slice(0,4)+' 年第 '+Math.ceil(Number(from.slice(5,7))/3)+' 季度':
    period==='fiscal'?from.slice(0,4)+' 财年（'+board.range.fiscal_start_month+' 月起）':
    offset===0?(period==='week'?'本周':'本月'):(period==='week'?'往期周':'往期月');
  return '<p class="dashboard-range"><strong>'+label+'</strong>'+(from?' · '+esc(from)+' 至 '+esc(to):' · 全部时间')+'（上海时间）</p>'+
    '<p class="dashboard-total"><strong>'+board.records.length+'</strong> 次 Word 生成'+(board.scope==='team'?' · '+board.employees.length+' 个账号':'')+'</p>'+
    dashboardChart(board, employee) +
    '<section id="dashboard-trend" class="dashboard-chart" aria-labelledby="dashboard-trend-title">' + dashboardTrend(board, employee) + '</section>' +
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
  const select=(name,label)=>'<label>'+label+'<select name="'+name+'"><option value="">全部</option></select></label>';
  return '<p class="hint">'+(board.scope==='team'?'点击员工姓名查看个人明细。':'仅查看当前账号的记录。')+
    ' 只统计成功生成的 Word；同一业务重新生成也会计一次。报价与审核暂未开放。</p>'+
    '<div class="dashboard-toolbar" role="group" aria-label="统计周期">'+periods.map(([value,label])=>
      '<button type="button" data-period="'+value+'" aria-pressed="'+(board.range.period===value)+'">'+label+'</button>').join('')+'</div>'+
    '<div id="dashboard-paging" class="dashboard-toolbar"><button type="button" data-period-step="1">上一期</button>'+
    '<button type="button" data-period-step="-1" disabled>下一期</button></div>'+
    '<div id="dashboard-fiscal" class="dashboard-toolbar" hidden><label>财年起始月份<select>'+
    Array.from({length:12},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+' 月</option>').join('')+'</select></label></div>'+
    '<form id="dashboard-custom" class="dashboard-custom" hidden><label>开始日期<input type="date" name="from" required></label>'+
    '<label>结束日期<input type="date" name="to" required></label><button class="button">应用日期</button></form>'+
    '<form id="dashboard-business"><div class="field-grid">'+select('business_id','业务种类')+
    select('business_name','业务名称')+select('business_attribute','业务属性')+
    select('voice','是否带语音')+select('discount','是否打折')+'</div>'+
    '<div class="dashboard-toolbar"><button class="button">应用筛选</button>'+
    '<button type="reset">清空业务筛选</button></div></form>'+
    '<div id="dashboard-results" aria-live="polite">'+dashboardResults(board,'')+'</div>'+
    '<section id="dashboard-details" aria-labelledby="dashboard-detail-title">'+dashboardDetails(board,catalog,'')+'</section>';
}
function bindDashboard(root,state) {
  const paging=root.querySelector('#dashboard-paging'), custom=root.querySelector('#dashboard-custom');
  const fiscal=root.querySelector('#dashboard-fiscal'), fiscalMonth=fiscal.querySelector('select');
  const business=root.querySelector('#dashboard-business'), fields=business.elements;
  const results=root.querySelector('#dashboard-results'), details=root.querySelector('#dashboard-details');
  let board=state.board, employee='', selected=board.range.period, requestId=0;
  const currentNames=state.workspace.tariffs.map(classifyTariff);
  function names() {
    const type=fields.business_id.value, previous=fields.business_name.value;
    const choices=[...new Set([...currentNames,...(board.business_names||[])]
      .filter(item=>!type||item.business_id===type).map(item=>item.name).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
    fields.business_name.innerHTML=options(choices.map(name=>({id:name,name})),'全部业务名称');
    if(choices.includes(previous))fields.business_name.value=previous;
  }
  fields.business_id.innerHTML=options(state.catalog.businesses,'全部业务种类');
  fields.business_attribute.innerHTML=options(state.catalog.attributes,'全部业务属性');
  const binary=(yes,no)=>options([{id:'yes',name:yes},{id:'no',name:no},{id:'unknown',name:'未记录或不适用'}],'全部');
  fields.voice.innerHTML=binary('带语音','不带语音');
  fields.discount.innerHTML=binary('打折','不打折');
  names();
  fields.business_id.onchange=names;
  function appliedRange(){
    const {period,offset,from,to}=board.range;
    return period==='custom'?{period,from,to}:{period,offset:String(offset)};
  }
  function controls() {
    for(const button of root.querySelectorAll('[data-period]'))button.setAttribute('aria-pressed',String(button.dataset.period===selected));
    custom.hidden=selected!=='custom';
    paging.hidden=!pageable.has(selected);
    fiscal.hidden=selected!=='fiscal';
    paging.querySelector('[data-period-step="-1"]').disabled=board.range.offset===0;
    paging.querySelector('[data-period-step="1"]').disabled=board.range.offset>=520;
  }
  async function load(params) {
    const ticket=++requestId;
    status(root,'正在更新统计…');
    try {
      const query=new URLSearchParams(params);
      if(params.period==='fiscal')query.set('fiscal_start_month',fiscalMonth.value);
      for(const [key,value] of new FormData(business))if(value)query.set(key,value);
      const next=await request('/dashboard?'+query);
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
      results.querySelector('#dashboard-trend').innerHTML=dashboardTrend(board,employee);
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
  business.onsubmit=event=>{event.preventDefault();void load(appliedRange());};
  fiscalMonth.onchange=()=>{void load({period:'fiscal'});};
  business.onreset=event=>{
    event.preventDefault();
    for(const field of business.querySelectorAll('select'))field.value='';
    names();
    void load(appliedRange());
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
  return '<a class="back" href="#/">← 返回工作台</a><h1>'+(board?'工作量统计':'表单填写')+'</h1><p class="lead">仅使用虚构客户资料和测试套餐。</p>' +
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
        let credential, actor;
        if (loginForm.elements.account) {
          const session = await request('/test-session', {method:'POST', data:{account:loginForm.elements.account.value}});
          credential = session.token;
          actor = session.actor;
        } else {
          credential = loginForm.elements.token.value.trim();
          ({actor} = await request('/workspace', {credential}));
        }
        if (root.isConnected) { setToken(credential, actor); refresh(true); }
      } catch (error) { status(root, error.message); } finally { submit.disabled = false; }
    };
    return;
  }
  root.querySelector('#forms-exit').onclick = () => { setToken(''); refresh(true); };
  root.addEventListener('click', async event => {
    const button = event.target.closest('button[data-file]');
    if (!button) return;
    try { await download(button); } catch (error) { status(root, error.message); }
  });
  if (current?.board) bindDashboard(root,current);
  if (root.querySelector('#generate-form')) bindGeneration(root, current);
  if (root.querySelector('#template-form')) bindTemplates(root, current);
}
