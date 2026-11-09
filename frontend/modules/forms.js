import { bindPreview, renderPreview } from './forms/preview.js';
import { get, escape } from '../lib/api.js';

const tabs = [['/forms/generate', '表单生成'], ['/forms/history', '表单历史记录'], ['/forms/templates', '套餐模板管理']];
export const formFields = [
  ['company_name', '企业全称'], ['install_address', '安装地址'], ['billing_address', '账单地址'],
  ['package_request', '套餐和资费'], ['contact_name', '经办人'], ['phone', '经办人手机号', 'tel'],
  ['id_number', '身份证号'], ['email', 'E-mail', 'email']
];
function fields() {
  return formFields.map(([key, label, type]) => `<label>${label}<input name="${key}" type="${type || 'text'}" autocomplete="off" disabled placeholder="待接入填写功能"></label>`).join('');
}
function selector(catalog) {
  return `<div class="classification"><label>业务名称<select id="business"><option value="">请选择业务名称</option>${catalog.businesses.map(b => `<option value="${escape(b.id)}">${escape(b.name)}</option>`).join('')}</select></label><label>业务版本<select id="version" disabled><option value="">请先选择业务名称</option></select></label><label>业务属性<select id="attribute" disabled><option value="">请先选择业务版本</option>${catalog.attributes.map(a => `<option value="${escape(a.id)}">${escape(a.name)}</option>`).join('')}</select></label></div><p class="hint" id="classification-note">分类顺序：业务名称 → 业务版本 → 业务属性。当前尚未录入业务版本与正式模板。</p>`;
}
export async function renderForms(path) {
  const { data: mode } = await get('/forms/mode');
  if (mode.preview) return renderPreview(path, tabs, mode.hosted === true);
  if (path === '/dashboard') return '<h1>看板</h1><section class="panel"><p>当前是结构预览。请开启表单联调模式后，使用管理员或员工账号查看工作记录。</p></section>';
  const [{ data: catalog }, resource] = await Promise.all([
    get('/catalog'),
    path === '/forms/history' ? get('/forms/records') : path === '/forms/templates' ? get('/forms/templates') : Promise.resolve(null)
  ]);
  let body;
  if (path === '/forms/history') {
    body = `<section class="panel"><h2>表单历史记录</h2><p class="hint">生成记录将保留业务分类、模板版本、创建人和处理状态。</p><div class="table-wrap"><table><thead><tr>${['业务名称','业务版本','业务属性','表单名称','创建人','创建时间','状态'].map(t => `<th>${t}</th>`).join('')}</tr></thead><tbody><tr><td colspan="7" class="table-empty">暂无历史记录 · 当前为结构预览，尚未连接业务数据库</td></tr></tbody></table></div><p class="hint">记录数：${resource.meta.total}</p></section>`;
  } else if (path === '/forms/templates') {
    body = `<section class="panel"><h2>套餐模板管理</h2><p class="hint">使用统一业务分类查看和管理套餐模板。</p>${selector(catalog)}<div class="empty compact"><h3>尚未录入套餐模板</h3><p>后续核对模板内容、适用版本及语音属性后录入，不自动迁移旧项目数据。</p></div></section>`;
  } else {
    body = `<section class="panel"><h2>客户及套餐信息</h2><p class="hint">业务选择与客户资料放在同一页面，后续根据套餐信息匹配模板。</p>${selector(catalog)}<div class="divider"></div><p class="preview-label">以下为字段布局预览，暂不收集或保存客户资料</p><fieldset disabled class="field-grid">${fields()}<label>付款方式<select id="payment" disabled><option>现金 / 托收（待接入）</option></select></label><label>银行账号<input disabled placeholder="托收时必填"></label><label>开户银行<input disabled placeholder="托收时必填"></label></fieldset><div class="notice slim">匹配规则：仅在唯一确定时选中模板；存在多个候选或信息不足时，提示员工选择或补充，禁止猜测。</div><button class="button" disabled>匹配模板并继续 · 待接入</button></section>`;
  }
  return `<a class="back" href="#/">← 返回工作台</a><div class="eyebrow">FORM WORKSPACE</div><h1>表单填写</h1><p class="lead">客户资料、业务模板与生成记录，集中处理。</p><nav class="tabs" aria-label="表单子板块">${tabs.map(([url, title]) => `<a href="#${url}" ${path === url ? 'aria-current="page"' : ''}>${title}</a>`).join('')}</nav>${body}`;
}
export function bindForms() {
  if (document.querySelector('#forms-preview')) return bindPreview();
  const business = document.querySelector('#business');
  if (!business) return;
  business.addEventListener('change', () => {
    document.querySelector('#version').innerHTML = `<option value="">${business.value ? '此业务尚未录入版本' : '请先选择业务名称'}</option>`;
    document.querySelector('#classification-note').textContent = business.value ? '此业务暂无可用版本和模板，请后续在套餐模板管理中配置。' : '分类顺序：业务名称 → 业务版本 → 业务属性。当前尚未录入业务版本与正式模板。';
  });
}
