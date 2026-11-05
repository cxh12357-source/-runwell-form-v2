import { escape as esc } from '../../lib/api.js';
import { bindClassification, request, selectors, status, refresh } from './shared.js';

export function templatesView({ rows, workspace }) {
  const mapping = Object.fromEntries(Object.keys(workspace.labels).map(key => [key, key]));
  return '<form id="template-form">' + selectors() + '<div class="field-grid"><label>模板名称<input name="name" required maxlength="80"></label>' +
    '<label>版本号<input name="revision" required maxlength="80"></label><label>Word 模板（.docx）<input name="file" type="file" accept=".docx" required></label></div>' +
    '<details><summary>字段映射</summary><p>左侧是 Word 中双花括号内的占位符，右侧是资料字段。其他必填资料可用 extra_ 开头的字段名。</p>' +
    '<textarea name="mapping" aria-label="字段映射 JSON" rows="14" required style="width:100%;box-sizing:border-box">' + esc(JSON.stringify(mapping, null, 2)) +
    '</textarea></details><button class="button">上传新版本</button></form><div class="divider"></div><h3>模板目录</h3>' +
    '<p class="hint">可下载样表核对占位符。新上传的版本需要手动启用。</p><div class="table-wrap"><table><thead><tr><th>套餐</th><th>模板</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody id="template-rows">' +
    rows.map(t => '<tr data-tariff="' + esc(t.tariff_id) + '"><td>' + esc(workspace.tariffs.find(a => a.id === t.tariff_id)?.name) +
      '</td><td>' + esc(t.name) + '</td><td>' + esc(t.revision) + '</td><td>' + (t.active ? '已启用' : '已停用') + '</td><td>' +
      '<button type="button" data-active="' + String(!t.active) + '" data-id="' + esc(t.id) + '">' + (t.active ? '停用' : '启用') +
      '</button> <button type="button" data-file="/templates/' + esc(t.id) + '/file">下载模板</button>' +
      '<details><summary>查看映射</summary><pre>' + esc(JSON.stringify(t.mapping, null, 2)) + '</pre></details></td></tr>').join('') + '</tbody></table></div>';
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取模板文件。'));
    reader.readAsDataURL(file);
  });
}
export function bindTemplates(root, state) {
  const form = root.querySelector('#template-form');
  const selection = bindClassification(form, state);
  form.onchange = () => {
    const { biz, ver, attr, tariff } = form.elements;
    const selected = { business_id: biz.value, business_version_id: ver.value, business_attribute: attr.value, id: tariff.value };
    for (const tr of root.querySelectorAll('tr[data-tariff]')) {
      const t = state.workspace.tariffs.find(r => r.id === tr.dataset.tariff);
      tr.hidden = !t || Object.entries(selected).some(([k,v]) => v && v !== t[k]);
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const file = form.elements.file.files[0];
    const choice = selection();
    if (!choice || !file || !/\.docx$/i.test(file.name) || file.size > 524288) return status(root, '请选择套餐并上传 512 KiB 以内的 DOCX。');
    const submit = form.querySelector('button');
    submit.disabled = true;
    try {
      let mapping;
      try { mapping = JSON.parse(form.elements.mapping.value); } catch { throw new Error('请核对字段映射 JSON。'); }
      const data = { name: form.elements.namedItem('name').value, revision: form.elements.revision.value, tariff_id: choice.tariff_id, mapping, file: await readFile(file) };
      await request('/templates', { method: 'POST', data });
      if (root.isConnected) refresh();
    } catch (error) { status(root, error.message); } finally { submit.disabled = false; }
  };
  root.querySelector('#template-rows').onclick = async event => {
    const button = event.target.closest('button[data-active]');
    if (!button) return;
    button.disabled = true;
    try {
      await request('/templates/' + button.dataset.id, { method: 'PATCH', data: { active: button.dataset.active === 'true' } });
      if (root.isConnected) refresh();
    } catch (error) { status(root, error.message); } finally { button.disabled = false; }
  };
}
