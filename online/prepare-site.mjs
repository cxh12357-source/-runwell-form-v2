// Assemble into a fresh Vinext Sites starter or upgrade its existing Runwell workspace.
import { cp, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { wordFile } from '../backend/modules/forms/preview/store.mjs';
import { tariffs, sampleLabels, sampleMapping } from '../backend/modules/forms/preview/rules.mjs';

const [directory, mode, base, overlayOption, overlay, ...extra] = process.argv.slice(2);
const update = mode === '--update-from';
if (!directory || (mode && !update) || (update && !/^[0-9a-f]{7,40}$/.test(base || '')) ||
    (overlayOption && (overlayOption !== '--overlay' || !overlay)) || extra.length) {
  throw new Error('用法：node online/prepare-site.mjs <站点目录> [--update-from <共同基线提交> [--overlay <已合并文件目录>]]');
}
const online = dirname(fileURLToPath(import.meta.url));
const repo = dirname(online);
const target = resolve(directory);
const read = path => readFile(join(target, path), 'utf8');
const [worker, page, schema, manifestText] = await Promise.all(
  ['worker/index.ts', 'app/page.tsx', 'db/schema.ts', '.openai/hosting.json'].map(read)
);
const manifest = JSON.parse(manifestText);

const serviceImport = "import { handleForms } from '../forms/service.mjs';";
const carrierImport = "import { privateCarrier } from '../forms/word-dom.mjs';";
const legacyCall = 'return handleForms(request, env);';
const newCall = 'return handleForms(request, { ...env, WORD_IMPORT: privateCarrier });';
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('入口已变化，请先核对：' + from);
  return text.replace(from, to);
}

let nextWorker;
if (update) {
  if (!manifest.project_id || manifest.d1 !== 'DB' || manifest.r2 !== 'BUCKET' ||
      !page.includes('/workspace.html#/forms/generate') || !schema.includes("'qa_templates'") ||
      !worker.includes(serviceImport) || !worker.includes("pathname.startsWith('/api/v1/')")) {
    throw new Error('--update-from 只接受已装配的润网私有验收站。');
  }
  if (worker.includes(newCall) && worker.includes(carrierImport)) {
    nextWorker = worker;
  } else {
    nextWorker = replaceOnce(replaceOnce(worker, serviceImport, serviceImport + '\n' + carrierImport), legacyCall, newCall);
  }
} else {
  if (!worker.includes('runWithConnectorBinding') || !page.includes('Your site is taking shape') ||
      !schema.includes('Intentionally empty')) {
    throw new Error('目标必须是新的 Vinext starter；已有润网验收站请指定 --update-from 和共同基线提交。');
  }
  nextWorker = [serviceImport, carrierImport, replaceOnce(worker, '    let binding',
    "    if (new URL(request.url).pathname.startsWith('/api/v1/')) " + newCall + '\n    let binding')].join('\n');
}

// Vendor the pinned XML and ZIP readers into the Worker, without changing the starter's lockfile.
const require = createRequire(import.meta.url);
const saxFile = require.resolve('sax');
const fflateRoot = dirname(dirname(require.resolve('fflate')));
const xmldomRoot = dirname(dirname(require.resolve('@xmldom/xmldom')));
const [carrier, wordDom] = await Promise.all([
  readFile(join(repo, 'demo/carrier.mjs'), 'utf8'), readFile(join(online, 'word-dom.mjs'), 'utf8')
]);
const packedCarrier = replaceOnce(carrier, "'fflate'", "'../vendor/qa-fflate/browser.js'");
const packedDom = replaceOnce(wordDom, "'@xmldom/xmldom'", "'../vendor/qa-xmldom/lib/index.js'");
async function assemble(stage) {
  const inTarget = (...parts) => join(stage, ...parts);
  const put = (path, content) => writeFile(inTarget(path), content);
  for (const dir of ['forms', 'tests', 'db', 'worker', 'app', '.openai', 'vendor/qa-sax', 'vendor/qa-fflate', 'vendor/qa-xmldom']) {
    await mkdir(inTarget(dir), { recursive: true });
  }
  await cp(join(repo, 'frontend'), inTarget('public'), { recursive: true, filter: p => p !== join(repo, 'frontend/index.html') });
  const html = await readFile(join(repo, 'frontend/index.html'), 'utf8');
  await put('public/workspace.html', html.replace('本地开发预览', '线上验收 · 虚构资料'));
  await copyFile(join(repo, 'backend/modules/forms/preview/rules.mjs'), inTarget('forms/rules.mjs'));
  await copyFile(join(repo, 'backend/modules/catalog/data.mjs'), inTarget('forms/data.mjs'));
  for (const name of ['service.mjs', 'word.mjs']) await copyFile(join(online, name), inTarget('forms', name));
  await put('forms/carrier.mjs', packedCarrier);
  await copyFile(join(repo, 'demo/supplement.mjs'), inTarget('forms/supplement.mjs'));
  await put('forms/word-dom.mjs', packedDom);
  if (!update) {
    const sample = {};
    for (const tariff of tariffs) {
      const bytes = await wordFile({ labels: sampleLabels(tariff), mapping: sampleMapping(tariff) });
      sample[tariff.id] = bytes.toString('base64');
    }
    await put('forms/sample.json', JSON.stringify(sample) + '\n');
  }
  await copyFile(saxFile, inTarget('vendor/qa-sax/sax.cjs'));
  await copyFile(join(dirname(dirname(saxFile)), 'LICENSE.md'), inTarget('vendor/qa-sax/LICENSE.md'));
  await copyFile(join(fflateRoot, 'esm/browser.js'), inTarget('vendor/qa-fflate/browser.js'));
  await copyFile(join(fflateRoot, 'LICENSE'), inTarget('vendor/qa-fflate/LICENSE'));
  const domLib = join(xmldomRoot, 'lib');
  await cp(domLib, inTarget('vendor/qa-xmldom/lib'), { recursive: true, filter: path => path === domLib || path.endsWith('.js') });
  await copyFile(join(xmldomRoot, 'LICENSE'), inTarget('vendor/qa-xmldom/LICENSE'));
  await put('vendor/qa-xmldom/package.json', '{"type":"commonjs"}\n');
  await copyFile(join(online, 'schema.ts'), inTarget('db/schema.ts'));
  if (!update) await copyFile(join(online, 'hosted.test.mjs'), inTarget('tests/hosted.test.mjs'));
  for (const name of ['word-import-hosted.test.mjs', 'carrier-fixture.mjs']) {
    await copyFile(join(online, name), inTarget('tests', name));
  }
  await put('worker/index.ts', nextWorker);
  if (!update) {
    await put('.openai/hosting.json', JSON.stringify({ ...manifest, d1: 'DB', r2: 'BUCKET' }, null, 2) + '\n');
    await put('app/page.tsx', "import {redirect} from 'next/navigation';\nexport default function Home(){redirect('/workspace.html#/forms/generate');}\n");
    await put('app/layout.tsx', `export const metadata={title:'润网表单验收',description:'商务专线新装表单工作区'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
`);
  }
}

async function fileNames(root, directory = '') {
  const names = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) names.push(...await fileNames(root, path));
    else if (entry.isFile()) names.push(path);
    else throw new Error('预期为普通文件：' + path);
  }
  return names;
}
async function optionalBytes(path) {
  try { return await readFile(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function same(a, b) { return a && b ? a.equals(b) : a === b; }

async function installUpdate(stage) {
  const git = (...args) => execFileSync('git', ['-C', target, ...args], { maxBuffer: 8 * 1024 * 1024 });
  git('merge-base', '--is-ancestor', base, 'HEAD');
  const tracked = new Set(git('ls-tree', '-r', '--name-only', '-z', base).toString().split('\0'));
  const planned = [], conflicts = [];
  const approved = new Set(overlay ? await fileNames(resolve(overlay)) : []);
  for (const path of await fileNames(stage)) {
    const current = await optionalBytes(join(target, path));
    let incoming = await readFile(join(stage, path));
    if (approved.delete(path)) {
      incoming = await readFile(join(overlay, path));
    } else if (!same(current, incoming)) {
      const previous = tracked.has(path) ? git('show', base + ':' + path) : null;
      if (same(incoming, previous)) continue;
      if (!same(current, previous) && path !== 'worker/index.ts') { conflicts.push(path); continue; }
    }
    if (!same(current, incoming)) planned.push([path, incoming]);
  }
  // An explicitly merged site-specific module or test may have no public counterpart.
  const siteFiles = new Set(git('ls-tree', '-r', '--name-only', '-z', 'HEAD').toString().split('\0'));
  for (const path of approved) {
    if (!siteFiles.has(path) || !/^(forms|public|tests)\//.test(path)) continue;
    const incoming = await readFile(join(overlay, path));
    if (!same(await optionalBytes(join(target, path)), incoming)) planned.push([path, incoming]);
    approved.delete(path);
  }
  if (approved.size || conflicts.length) {
    throw new Error('站点未写入。请核对冲突并在 --overlay 提供保留双方修改的文件：\n' +
      conflicts.join('\n') + (approved.size ? '\n未知覆盖路径：' + [...approved].join(', ') : ''));
  }
  for (const [path, bytes] of planned) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await writeFile(join(target, path), bytes);
  }
}
const stage = await mkdtemp(join(tmpdir(), 'runwell-site-'));
try {
  await assemble(stage);
  if (update) await installUpdate(stage);
  else await cp(stage, target, { recursive: true });
} finally {
  await rm(stage, { recursive: true, force: true });
}
console.log('验收应用已装配。请在目标项目生成数据库迁移，再运行测试和构建。');
