export function getFormsResource(path) {
  if (path === '/api/v1/forms/templates' || path === '/api/v1/forms/records') {
    return { data: [], meta: { total: 0, implementation: 'skeleton' } };
  }
  return null;
}
