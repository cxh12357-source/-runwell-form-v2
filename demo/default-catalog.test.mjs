import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { bundleDemo } from './build.mjs';

test('all eight reviewed DOCX files are available in a new browser without sample templates', async () => {
  const bundle=await bundleDemo('demo/runtime.mjs');
  globalThis.location=new URL('https://demo.example.invalid');
  globalThis.indexedDB=new IDBFactory();
  Object.defineProperty(navigator,'locks',{value:{request:(_,fn)=>fn()}});
  const {localFetch}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
  const call=(path,method='GET')=>localFetch('/api/v1/forms'+path,{method});
  async function templates(){
    const r=await call('/templates');
    const data=await r.json();
    assert.equal(r.status,200,JSON.stringify(data));
    return data.data;
  }
  const rows=await templates();
  assert.equal(rows.length,8);
  assert.ok(rows.every(row=>row.active && row.id.startsWith('reviewed-')));
  for(const row of rows){
    const file=await call('/templates/'+row.id+'/file');
    assert.equal(file.status,200);
    assert.equal(new Uint8Array(await file.arrayBuffer()).slice(0,2).join(','),'80,75');
  }
  assert.equal((await call('/templates/'+rows[0].id,'DELETE')).status,200);
  assert.equal((await templates()).length,7);
  globalThis.indexedDB=new IDBFactory();
  assert.equal((await templates()).length,8);
});
