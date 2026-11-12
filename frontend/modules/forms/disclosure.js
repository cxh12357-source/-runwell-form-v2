// Keep original controls and their form associations intact. The compact
// missing-fields area edits those same controls through unnamed mirrors.
export function bindDisclosure(form, intake) {
  const sections = ['customer-fields','voice-fields','company-fields'].map(id=>form.querySelector('#'+id));
  const panel = form.querySelector('#missing-profile');
  const list = form.querySelector('#missing-profile-fields');
  const defaultList = form.querySelector('#missing-default-fields');
  const summary = form.querySelector('#profile-missing-summary');
  const mirrors = new Map();
  let revealing = false, focusQueued = false;

  function applicable(control) {
    return control && form.contains(control) && !control.disabled && !control.matches(':disabled') && !control.closest('[hidden]');
  }
  function createMirror(control) {
    const label = control.closest('label').cloneNode(true);
    label.removeAttribute('id');
    const mirror = label.querySelector('input,select,textarea');
    mirror.removeAttribute('id');
    mirror.removeAttribute('name'); // Never submit a second copy of a field.
    // The original control owns validation and submission.
    mirror.setAttribute('form','runwell-missing-mirror-no-form');
    mirror.required = false;
    mirror.dataset.proxyFor = control.name;
    mirror.value = control.value;
    mirror.checked = control.checked;
    for (const type of ['input','change']) mirror.addEventListener(type,()=>{
      control.value = mirror.value;
      if (control.type==='checkbox' || control.type==='radio') control.checked = mirror.checked;
      control.dispatchEvent(new control.ownerDocument.defaultView.Event(type,{bubbles:true}));
    });
    list.append(label);
    mirrors.set(control,{label,mirror});
  }
  function refresh() {
    const attention = new Set(revealing ? intake.attentionKeys() : []);
    const missing = [];
    if (revealing) for (const selector of ['#application-fields','#extra','#ai-options','#package-options']) {
      const scope = form.querySelector(selector);
      for (const control of scope.querySelectorAll('label input[name],label select[name],label textarea[name]')) {
        if (applicable(control) && control.willValidate && (attention.has(control.name) || !control.validity.valid))
          missing.push(control);
      }
    }
    const defaults = [...form.querySelectorAll('#applicant-role-field, [data-default-field]')]
      .filter(label=>!label.hidden).map(label=>label.querySelector('input'))
      .filter(control=>control && !control.disabled && !control.matches(':disabled') && control.required && !control.validity.valid);
    const wanted = new Set(missing);
    for (const [control,item] of mirrors) {
      if (!wanted.has(control) && (!applicable(control) || form.ownerDocument.activeElement!==item.mirror)) {
        item.label.remove(); mirrors.delete(control);
      }
    }
    for (const control of wanted) {
      if (!mirrors.has(control)) createMirror(control);
      const mirror = mirrors.get(control).mirror;
      if (form.ownerDocument.activeElement!==mirror) {
        if (mirror.value!==control.value) mirror.value=control.value;
        if (mirror.checked!==control.checked) mirror.checked=control.checked;
      }
    }
    const count = missing.length + defaults.length;
    panel.hidden = mirrors.size===0 && defaultList.children.length===0 && defaults.length===0;
    summary.textContent = count ? '请补充或核对 '+count+' 项资料。' : '资料已补齐。';
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
