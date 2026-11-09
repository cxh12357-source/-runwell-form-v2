// Browser transport for the existing acceptance service. No HTTP request leaves this module.
import initSql from 'sql.js';
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';
import { handleForms } from 'runwell:acceptance';
import * as carrier from './carrier.mjs';
import * as reviewed from './reviewed-integration.mjs';

const name = 'runwell-browser-demo-v1';
const limit = 32 * 1024 * 1024;
const schema = `
  CREATE TABLE IF NOT EXISTS demo_settings (tenant TEXT PRIMARY KEY, hide_samples INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS demo_deleted_samples (tenant TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(tenant,id));
  CREATE TABLE IF NOT EXISTS demo_tariffs (tenant TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(tenant,id));
  CREATE TABLE IF NOT EXISTS qa_sessions (hash TEXT PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS qa_templates (tenant TEXT NOT NULL, id TEXT NOT NULL, tariff_id TEXT NOT NULL, name TEXT NOT NULL,
    revision TEXT NOT NULL, active INTEGER NOT NULL, mapping TEXT NOT NULL, object_key TEXT,
    PRIMARY KEY (tenant,id), UNIQUE (tenant,tariff_id,name,revision));
  CREATE TABLE IF NOT EXISTS qa_records (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL, request_id TEXT NOT NULL,
    digest TEXT NOT NULL, snapshot TEXT NOT NULL, object_key TEXT NOT NULL, UNIQUE (tenant,actor,request_id));`;

function database(sql) {
  function prepare(query, args = []) {
    function read(first) {
      const stmt = sql.prepare(query, args);
      try {
        if (first) return stmt.step() ? stmt.getAsObject() : null;
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        return { results };
      } finally { stmt.free(); }
    }
    return {
      bind: (...values) => prepare(query, values), first: () => read(true), all: () => read(false),
      run() { sql.run(query, args); return { meta: { changes: sql.getRowsModified() } }; }
    };
  }
  return { prepare, batch(statements) {
    sql.run('BEGIN');
    try { const results = statements.map(s => s.run()); sql.run('COMMIT'); return results; }
    catch (error) { sql.run('ROLLBACK'); throw error; }
  } };
}

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function snapshot(db, state) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', state ? 'readwrite' : 'readonly');
    const store = tx.objectStore('workspace');
    const request = state ? store.put(state, 'current') : store.get('current');
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
  });
}

let engine;
const clientId = 'browser-demo';
const accountKey='runwell-demo-account';
const demoAccounts=['admin','a','b'];
export function currentDemoAccount() {
  const account=globalThis.sessionStorage?.getItem(accountKey);
  return demoAccounts.includes(account)?account:'admin';
}
export function switchDemoAccount(account) {
  if(demoAccounts.includes(account))globalThis.sessionStorage.setItem(accountKey,account);
}
export async function localFetch(path, options = {}) {
  try {
    const account=currentDemoAccount();
    if (!/^\/api\/v1\//.test(path) || !navigator.locks) throw new Error('Browser storage unavailable');
    engine ??= initSql({ wasmBinary });
    return await navigator.locks.request(name, async () => {
      const SQL = await engine;
      const db = await open();
      let sql;
      try {
        const saved = await snapshot(db);
        sql = new SQL.Database(saved?.sql);
        sql.run(schema);
        if (!sql.exec('PRAGMA table_info(qa_templates)')[0].values.some(column => column[1] === 'imported_at')) {
          sql.run('ALTER TABLE qa_templates ADD COLUMN imported_at TEXT');
        }
        const files = new Map(saved?.files);
        const bucket = {
          get: key => files.has(key) ? new Blob([files.get(key)]) : null,
          put: (key, bytes) => files.set(key, bytes),
          delete: key => files.delete(key)
        };
        let migrated=false;
        const env = { DB: database(sql), BUCKET: bucket, DEMO_IMPORT: {...carrier,...reviewed,markMigrated:()=>{migrated=true;}} };
        const headers = new Headers(options.headers);
        // The marker and demo session live entirely inside the browser; never forward them.
        headers.set('oai-authenticated-user-id', clientId);
        if (path.startsWith('/api/v1/forms/') && path !== '/api/v1/forms/mode') {
          const sessions=saved?.sessions ?? (saved?.session?{admin:saved.session}:{});
          const previousSession=sessions[account];
          let session=previousSession;
          if (!session || session.expires <= Date.now()) {
            const sessionHeaders=new Headers(headers);
            sessionHeaders.set('Content-Type','application/json');
            const response = await handleForms(new Request(new URL('/api/v1/forms/test-session', location.origin), {
              method: 'POST', headers: sessionHeaders,
              body: JSON.stringify({ account })
            }), env);
            if (!response.ok) return response;
            session = { token: (await response.json()).data.token, expires: Date.now() + 7 * 60 * 60 * 1000 };
          }
          headers.set('Authorization', 'Bearer ' + session.token);
          const result = await handleForms(new Request(new URL(path, location.origin), { ...options, headers }), env);
          if (result.ok && (migrated || session !== previousSession || (options.method && options.method !== 'GET'))) {
            const data = sql.export();
            if (data.length + [...files.values()].reduce((sum, file) => sum + file.byteLength, 0) > limit) {
              return Response.json({ error: { message: '演示存储已满。请先下载需要保留的文件，再清理本站浏览器数据。' } }, { status: 507 });
            }
            await snapshot(db, { sql: data, files: [...files], sessions:{...sessions,[account]:session} });
          }
          return result;
        }
        if (path === '/api/v1/forms/mode') return Response.json({ data: { preview: true, hosted: false } });
        return await handleForms(new Request(new URL(path, location.origin), { ...options, headers }), env);
      } finally { sql?.close(); db.close(); }
    });
  } catch {
    return Response.json({ error: { message: '无法使用浏览器存储。请使用新版浏览器并允许本站保存数据。' } }, { status: 503 });
  }
}
