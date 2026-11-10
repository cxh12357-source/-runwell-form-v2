// Keep automatic values linked until the corresponding field is edited.
export function explicitPostcode(address) {
  const matches = [...String(address || '').matchAll(/邮(?:政)?(?:编码|编)\s*[:：]?\s*(\d{6})(?!\d)/g)].map(match => match[1]);
  return new Set(matches).size === 1 ? matches[0] : '';
}

export function todayInShanghai(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function bindDefaults(form) {
  const control = key => form.elements.namedItem(key);
  const linked = new Map();
  const pairs = [
    ['security_name', 'contact_name'], ['security_phone', 'phone'],
    ['security_role', 'applicant_role'], ['job_title', 'applicant_role']
  ];
  let installZipLinked = true, otherZipLinked = true;
  let otherAddress = '', otherZip = '';
  const same = () => control('billing_address_mode').value === 'same';

  function sync() {
    for (const [target, source] of pairs) {
      const field = control(target);
      if (field && linked.get(target) !== false) field.value = control(source)?.value || '';
    }
    const address = control('billing_address');
    const addressLabel = form.querySelector('#billing-address-field');
    addressLabel.hidden = same();
    address.disabled = same();
    if (same()) address.value = control('install_address').value;
    const installZip = control('install_zip');
    const billingZip = control('billing_zip');
    if (installZip && installZipLinked) installZip.value = explicitPostcode(control('install_address').value);
    if (billingZip) {
      const label = billingZip.closest('label');
      if (label) label.hidden = same();
      billingZip.disabled = same();
      if (same()) billingZip.value = installZip?.value || '';
      else if (otherZipLinked) billingZip.value = explicitPostcode(address.value);
    }
  }

  function setMode(value) {
    const mode = control('billing_address_mode');
    if (mode.value === value) return;
    if (!same()) {
      otherAddress = control('billing_address').value;
      otherZip = control('billing_zip')?.value || '';
    }
    mode.value = value;
    if (!same()) {
      control('billing_address').value = otherAddress;
      if (control('billing_zip')) control('billing_zip').value = otherZip;
    }
    sync();
  }

  form.addEventListener('input', event => {
    const name = event.target.name;
    if (pairs.some(([target]) => target === name)) linked.set(name, false);
    if (name === 'install_zip') installZipLinked = false;
    if (name === 'billing_zip') otherZipLinked = false;
    if (name === 'install_address') installZipLinked = true;
    if (name === 'billing_address' && !same()) {
      otherAddress = event.target.value;
      otherZipLinked = true;
    }
    sync();
  });
  form.addEventListener('change', event => {
    if (event.target.name !== 'billing_address_mode') return;
    // A native select has already changed; temporarily restore the old mode
    // so setMode can save and restore the independent address.
    const value = event.target.value;
    event.target.value = value === 'same' ? 'different' : 'same';
    setMode(value);
  });

  return {
    sync,
    sameBilling: same,
    isLinked(key) { return linked.get(key) !== false; },
    setBillingFromReply(value) {
      setMode('different');
      otherAddress = value;
      control('billing_address').value = value;
      sync();
    },
    templateChanged() {
      linked.clear();
      installZipLinked = true;
      otherZipLinked = true;
      const use = control('service_use');
      const date = control('application_date');
      if (use && !use.value) use.value = '公办';
      if (date && !date.value) date.value = todayInShanghai();
      sync();
    }
  };
}
