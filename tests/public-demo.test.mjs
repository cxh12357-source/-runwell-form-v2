import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = resolve(root, 'scripts/build-public-demo.mjs');
const commit = '1234567890abcdef1234567890abcdef12345678';
async function entries(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await entries(join(directory, entry.name), relative + '/'));
    else files.push(relative);
  }
  return files.sort();
}

test('公网展示包仅含白名单界面和测试元数据，不带后台、客户库或凭据', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'runwell-public-demo-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, 'site');
  const result = spawnSync(process.execPath, [script, output], {
    cwd: root, env: { ...process.env, GITHUB_SHA: commit }, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await entries(output), [
    'app.js', 'demo-data.js', 'index.html', 'lib/api.js', 'modules/demo-forms.js',
    'modules/forms/generate.js', 'modules/forms/shared.js', 'modules/forms/templates.js',
    'modules/home.js', 'ship.json', 'styles.css', 'version.json'
  ].sort());
  const texts = await Promise.all((await entries(output)).map(name => readFile(join(output, name), 'utf8')));
  for (const text of texts) assert.doesNotMatch(text, /fetch\s*\(|XMLHttpRequest|Authorization|localStorage|sessionStorage|(?:ship|deploy)-[a-f0-9]{32}/i);
  assert.deepEqual(JSON.parse(await readFile(join(output, 'version.json'), 'utf8')), {
    commit, branch: 'feature/project-skeleton', mode: 'static-demo'
  });
  const { renderForms } = await import(pathToFileURL(join(output, 'modules/demo-forms.js')));
  const generation = renderForms('/forms/generate');
  assert.match(generation, /客户基础信息/);
  assert.match(generation, /name="company_name"[^>]*disabled/);
  assert.doesNotMatch(generation, /id="reply-text"/);
  const templates = renderForms('/forms/templates');
  assert.match(templates, /测试语音套餐/);
  assert.match(templates, /extra_legal_id/);
  assert.doesNotMatch(templates, /href="\/api\//);
  const app = await readFile(join(output, 'app.js'), 'utf8');
  assert.match(app, /1234567/);
  assert.doesNotMatch(app, /notice demo-banner/);
  await writeFile(join(output, 'customer-records.sqlite'), 'test-only unexpected file');
  const rejected = spawnSync(process.execPath, [script, output], {
    cwd: root, env: { ...process.env, GITHUB_SHA: commit }, encoding: 'utf8'
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /展示目录含未批准发布的文件：customer-records\.sqlite/);
});
