const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

export async function get(path) {
  const response = await fetch('/api/v1' + path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('读取失败（' + response.status + '）');
  return response.json();
}
