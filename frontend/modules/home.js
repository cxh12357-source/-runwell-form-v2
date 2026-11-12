export const sections = [
  { path: '/quotes', number: '01', name: '业务报价', text: '选择商务专线套餐，核对费用并生成报价单。', status: '报价计算可用' },
  { path: '/forms', number: '02', name: '表单填写', text: '填写客户信息，匹配业务模板，管理申请表单。', status: '当前建设板块' },
  { path: '/review', number: '03', name: '手续审核', text: '核对申请资料与办理手续，跟进审核结果。', status: '功能建设中' }
];
export function renderHome() {
  return `<div class="eyebrow">RUNWELL WORKSPACE</div><h1>业务工作台</h1><p class="lead">围绕业务流程，让每一步工作清晰衔接。</p>
    <div class="flow"><span>01 业务报价</span><span aria-hidden="true">→</span><span>02 表单填写</span><span aria-hidden="true">→</span><span>03 手续审核</span></div>
    <div class="cards">${sections.map(s => `<a class="card ${s.path === '/forms' ? 'featured' : ''}" href="#${s.path}"><div class="card-top"><span class="number">${s.number}</span><span class="badge">${s.status}</span></div><h2>${s.name}</h2><p>${s.text}</p><span class="card-action">进入板块 <span aria-hidden="true">↗</span></span></a>`).join('')}</div>
    <section class="notice"><h2>从报价到表单</h2><p>可先计算商务专线报价，再进入表单填写。手续审核后续开放。</p></section>`;
}
export function renderPending(name) {
  return `<a class="back" href="#/">← 返回工作台</a><h1>${name}</h1><div class="empty"><span class="empty-symbol">◇</span><h2>功能建设中</h2><p>此板块将与表单填写流程衔接，当前暂未开放。</p><a class="button" href="#/forms">进入表单填写</a></div>`;
}
