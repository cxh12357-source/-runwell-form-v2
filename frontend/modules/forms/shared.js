import { escape as esc } from '../../lib/api.js';

let token = '';
let actor = null;
export function setToken(value, identity = null) { token = value; actor = identity; }
export function currentIdentity() { return actor; }
export function hasToken() { return Boolean(token); }
export async function request(path, { method = 'GET', data, file = false, credential = token } = {}) {
  const headers = { Authorization: 'Bearer ' + credential };
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api/v1/forms' + path, { method, headers, body: data && JSON.stringify(data) });
  if (!response.ok) {
    const error = new Error((await response.json()).error.message);
    error.status = response.status;
    throw error;
  }
  return file ? response.blob() : (await response.json()).data;
}
export const refresh = (resetProgress = false) => window.dispatchEvent(new CustomEvent('runwell:refresh', { detail: { resetProgress } }));
export const status = (root, message) => { root.querySelector('[role="status"]:not(#smart-status)').textContent = message; };
export function options(rows, label = '请选择') {
  return '<option value="">' + esc(label) + '</option>' + rows.map(row =>
    '<option value="' + esc(row.id) + '">' + esc(row.name) + '</option>').join('');
}

function classification(controls, catalog, tariffs) {
  const [biz, version, attr, tariff] = controls;
  biz.innerHTML = options(catalog.businesses, '选择业务');
  function updateSelect(select, rows, placeholder) {
    select.innerHTML = options(rows, placeholder);
    select.disabled = !rows.length;
  }
  function setTariffs() {
    const rows = tariffs.filter(t => t.business_id === biz.value && t.business_version_id === version.value &&
      t.business_attribute === attr.value).map(t => ({ id: t.id, name: t.reviewed_id ? [t.name,t.cycle==='—'?'':t.cycle+'付',t.amount==='—'?'':t.amount+' 元/线'].filter(Boolean).join(' · ') : t.name + ' · ' + t.bandwidth + ' · ' + t.amount + ' 元/' + t.cycle }));
    updateSelect(tariff, rows, attr.value ? '选择已核对的套餐' : '请先选择属性');
  }
  function setAttributes() {
    updateSelect(attr, version.value ? catalog.attributes : [], '选择业务属性');
    setTariffs();
  }
  function setVersions() {
    const rows = catalog.versions.filter(v => v.business_id === biz.value);
    updateSelect(version, rows, biz.value && !rows.length ? '此业务暂无测试版本' : '选择业务版本');
    setAttributes();
  }
  biz.onchange = setVersions;
  version.onchange = setAttributes;
  attr.onchange = setTariffs;
  setVersions();
}

export function selectors() {
  return '<div class="field-grid">' + [['biz','业务名称'],['ver','业务版本'],['attr','业务属性'],['tariff','套餐和资费']]
    .map(([id, title]) => '<label>' + title + '<select required name="' + id + '"></select></label>').join('') + '</div>';
}

export function bindClassification(form, state) {
  const controls = ['biz', 'ver', 'attr', 'tariff'].map(name => form.elements.namedItem(name));
  classification(controls, state.catalog, state.workspace.tariffs);
  return () => {
    const t = state.workspace.tariffs.find(row => row.id === controls[3].value);
    if (!t) return null;
    return { tariff_id: t.id, business_id: controls[0].value, business_version_id: controls[1].value,
      business_attribute: controls[2].value, voice_required: t.voice_required, bandwidth: t.bandwidth, cycle: t.cycle, amount: t.amount };
  };
}

export function downloadControl(path, title, hosted) {
  return hosted
    ? '<a class="button" download href="/api/v1/forms' + esc(path) + '">' + esc(title) + '</a>'
    : '<button class="button" type="button" data-file="' + esc(path) + '">' + esc(title) + '</button>';
}

export async function copyTextArea(area,feedback) {
  let copied=false;
  try { await navigator.clipboard.writeText(area.value); copied=true; }
  catch {
    area.focus();
    area.select();
    try { copied=document.execCommand('copy'); } catch {}
  }
  feedback.textContent=copied?'已复制，可粘贴给客户。':'已选中，请手动复制。';
}
