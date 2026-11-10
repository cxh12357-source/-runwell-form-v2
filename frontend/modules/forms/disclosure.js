// Keep original controls and their form associations intact. The compact
// missing-fields area edits those same controls through unnamed mirrors.
export function bindDisclosure(form, intake) {
  const sections = ['customer-fields','voice-fields','company-fields'].map(id=>form.querySelector('#'+id));
  const panel = form.querySelector('#missing-profile');
  const list = form.querySelector('#missing-profile-fields');
  const summary = form.querySelector('#profile-missing-summary');
  const mirrors = new Map();
  let revealing = false, focusQueued = false;

  function applicable(control) {
    return control && !control.disabled && !control.matches(':disabled') && !control.closest('[hidden]');
  }
  function createMirror(control) {
    const label = control.closest('label').cloneNode(true);
    label.removeAttribute('id');
    const mirror = label.querySelector('input,select,textarea');
    mirror.removeAttribute('id');
    mirror.removeAttribute('name'); // Never submit a second copy of a field.
    mirror.required = false;
    mirror.dataset.proxyFor = control.name;
    mirror.value = control.value;
    for (const type of ['input','change']) mirror.addEventListener(type,()=>{
      control.value = mirror.value;
      control.dispatchEvent(new control.ownerDocument.defaultView.Event(type,{bubbles:true}));
    });
    list.append(label);
    mirrors.set(control,{label,mirror});
  }
  function refresh() {
    if (!revealing) return;
    const attention = new Set(intake.attentionKeys());
    const missing = [];
    for (const section of sections) for (const control of section.querySelectorAll('label input,label select,label textarea')) {
      if (applicable(control) && (attention.has(control.name) || (control.required && !control.validity.valid)))
        missing.push({control,section});
    }
    const wanted = new Set(missing.filter(item=>!item.section.open).map(item=>item.control));
    for (const [control,item] of mirrors) {
      if (!wanted.has(control) && (!applicable(control) || form.ownerDocument.activeElement!==item.mirror)) {
        item.label.remove(); mirrors.delete(control);
      }
    }
    for (const control of wanted) {
      if (!mirrors.has(control)) createMirror(control);
      const mirror = mirrors.get(control).mirror;
      if (form.ownerDocument.activeElement!==mirror && mirror.value!==control.value) mirror.value=control.value;
    }
    panel.hidden = mirrors.size===0;
    summary.textContent = missing.length ? '请补充或核对 '+missing.length+' 项资料。' : '资料已补齐。';
  }
  function focusMissing() {
    if (focusQueued) return;
    focusQueued = true;
    queueMicrotask(()=>{
      focusQueued = false;
      list.querySelector('input,select,textarea')?.focus();
    });
  }
  function reveal(focus=false) {
    revealing = true;
    refresh();
    if (focus) focusMissing();
  }

  form.querySelector('#edit-profile').addEventListener('click',()=>{ sections[0].open=true; });
  for (const section of sections) section.addEventListener('toggle',refresh);
  form.querySelector('#read-reply').addEventListener('click',()=>{
    if (form.querySelector('#reply-text').value.trim() && !form.querySelector('#intake').hidden) reveal();
  });
  form.querySelector('#lookup-fixture').addEventListener('click',()=>{
    if (!form.elements.namedItem('company_name').value.trim()) reveal(true);
    else queueMicrotask(refresh);
  });
  form.querySelector('#reply-conflicts').addEventListener('click',()=>queueMicrotask(refresh));
  form.addEventListener('input',refresh);
  form.addEventListener('change',refresh);
  form.addEventListener('focusout',()=>queueMicrotask(refresh));
  // Native validation runs before submit. A closed disclosure's real input
  // cannot receive focus, so show and focus its mirror instead.
  form.addEventListener('invalid',event=>{
    const section = event.target.closest('.profile-section');
    if (!section || section.hidden) return;
    reveal();
    if (!section.open) { event.preventDefault(); focusMissing(); }
  },true);
  return {refresh,reveal};
}
