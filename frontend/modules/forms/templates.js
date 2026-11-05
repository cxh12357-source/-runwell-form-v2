import { escape as esc } from '../../lib/api.js';
import { bindClassification, downloadControl, request, selectors, status, refresh } from './shared.js';

export function templatesView({ rows, workspace, hosted }) {
  const mapping = Object.fromEntries(Object.keys(workspace.labels).map(key => [key, key]));
  const smart = workspace.smart_import ? '<section class="smart-import" aria-labelledby="smart-title"><h3 id="smart-title">智能导入 Word</h3>' +
    '<p>支持智云上海专线基础版（FTTR-B）2026/A 不带语音。演示请使用虚构资料。</p>' +
    '<div id="smart-drop"><label for="smart-file">把 .docx 文件拖到虚线框内</label><input id="smart-file" type="file" accept=".docx"></div>' +
    '<p class="hint">拖拽没有反应时，可点击「选择文件」，两种方式使用相同的解析流程。</p>' +
    '<p id="smart-status" role="status"></p><div id="smart-preview" aria-live="polite"></div></section><div class="divider"></div><h3>手动上传模板</h3>' : '';
  return smart + '<form id="template-form">' + selectors() + '<div class="field-grid"><label>模板名称<input name="name" required maxlength="80"></label>' +
    '<label>版本号<input name="revision" required maxlength="80"></label><label>Word 模板（.docx）<input name="file" type="file" accept=".docx" required></label></div>' +
    '<details><summary>字段映射</summary><p>左侧是 Word 中双花括号内的占位符，右侧是资料字段。其他必填资料可用 extra_ 开头的字段名。</p>' +
    '<textarea name="mapping" aria-label="字段映射 JSON" rows="14" required style="width:100%;box-sizing:border-box">' + esc(JSON.stringify(mapping, null, 2)) +
    '</textarea></details><button class="button">上传新版本</button></form><div class="divider"></div><h3>模板目录</h3>' +
    '<p class="hint">可下载样表核对占位符。新上传的版本需要手动启用。</p><div class="table-wrap"><table><thead><tr><th>套餐</th><th>模板</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody id="template-rows">' +
    rows.map(t => { const tariff=workspace.tariffs.find(a => a.id === t.tariff_id); return '<tr data-tariff="' + esc(t.tariff_id) + '"><td>' + esc(tariff?.name) +
      (tariff?.carrier_profile ? '<br>'+esc(tariff.bandwidth+' · '+tariff.amount+' 元/'+tariff.cycle+'/线') : '') +
      '</td><td>' + esc(t.name) + '</td><td>' + esc(t.revision) + '</td><td>' + (t.active ? '已启用' : '已停用') + '</td><td>' +
      '<button type="button" data-active="' + String(!t.active) + '" data-id="' + esc(t.id) + '">' + (t.active ? '停用' : '启用') +
      '</button> ' + downloadControl('/templates/' + t.id + '/file', '下载模板', hosted) +
      '<details><summary>查看映射</summary><pre>' + esc(JSON.stringify(t.mapping, null, 2)) + '</pre></details></td></tr>'; }).join('') + '</tbody></table></div>';
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
  const selection = bindClassification(form, { ...state, workspace: { ...state.workspace, tariffs: state.workspace.tariffs.filter(t=>!t.carrier_profile) } });
  if(state.workspace.smart_import) bindSmartImport(root);
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

function bindSmartImport(root) {
  const drop=root.querySelector('#smart-drop'), picker=root.querySelector('#smart-file'), preview=root.querySelector('#smart-preview');
  const section=drop.closest('.smart-import'), feedback=root.querySelector('#smart-status');
  const tell=message=>{feedback.textContent=message;};
  let epoch=0;
  async function inspect(files) {
    const ticket=++epoch;
    preview.replaceChildren();
    if(files.length!==1 || !/\.docx$/i.test(files[0].name) || !files[0].size || files[0].size>524288){
      tell('请一次选择一份 512 KiB 以内的 DOCX。'); return;
    }
    tell('已收到「'+files[0].name+'」，正在解析 Word…');
    try {
      const file=await readFile(files[0]);
      const result=await request('/templates/inspect',{method:'POST',data:{file}});
      if(ticket!==epoch || !root.isConnected)return;
      tell('解析成功，请确认基础资费。');
      preview.innerHTML='<p>识别到：<strong>'+esc(result.name)+'</strong> · 商务专线／不带语音／新装</p>'+
        '<p>已定位 '+Number(result.tags.length)+' 个占位符，所有方框默认留空。</p><form id="smart-confirm"><label>确认基础资费<select name="rate" required>'+
        '<option value="">请选择客户适用的套餐资费</option>'+result.rates.map(r=>'<option value="'+esc(r.key)+'">'+esc(r.bandwidth+' · '+r.amount+' 元/'+r.cycle+'/线')+'</option>').join('')+
        '</select></label> <button class="button">导入模板并新增套餐</button></form>';
      const confirm=preview.querySelector('form');
      confirm.onsubmit=async event=>{
        event.preventDefault();
        const button=confirm.querySelector('button');button.disabled=true;picker.disabled=true;
        try {
          const saved=await request('/templates/import',{method:'POST',data:{file,rate:confirm.elements.rate.value}});
          if(root.isConnected){
            const notice=saved.duplicate?'该资费已导入，未重复新增。':'模板和套餐已录入。请在目录中启用模板后再生成 Word。';
            sessionStorage.setItem('runwell-smart-import-notice',notice);
            refresh();
          }
        } catch(error){tell(error.message);}
        finally{button.disabled=false;picker.disabled=false;}
      };
    } catch(error){if(ticket===epoch && root.isConnected)tell(error.message);}
  }
  const notice=sessionStorage.getItem('runwell-smart-import-notice');
  if(notice){sessionStorage.removeItem('runwell-smart-import-notice');tell(notice);}
  picker.onchange=()=>{const files=Array.from(picker.files);picker.value='';inspect(files);};
  const acceptDrag=event=>{
    if(!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files'))return;
    event.preventDefault();
    event.dataTransfer.dropEffect=picker.disabled?'none':'copy';
    if(!picker.disabled)drop.classList.add('drag-active');
  };
  section.addEventListener('dragenter',acceptDrag,true);
  section.addEventListener('dragover',acceptDrag,true);
  section.addEventListener('dragleave',event=>{
    if(!event.relatedTarget || !section.contains(event.relatedTarget))drop.classList.remove('drag-active');
  });
  section.addEventListener('drop',event=>{
    event.preventDefault();
    drop.classList.remove('drag-active');
    if(picker.disabled){tell('正在保存模板，请稍候。');return;}
    const transfer=event.dataTransfer;
    const files=Array.from(transfer?.files||[]);
    if(!files.length)files.push(...Array.from(transfer?.items||[])
      .filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean));
    if(files.length)inspect(files);
    else tell('没有收到文件。请从文件资源管理器拖入 .docx，或点击「选择文件」。');
  },true);
}
