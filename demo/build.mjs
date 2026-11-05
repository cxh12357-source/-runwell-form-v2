import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild-wasm';
import { wordFile } from '../backend/modules/forms/preview/store.mjs';
import { tariffs, sampleLabels, sampleMapping } from '../backend/modules/forms/preview/rules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || resolve(root, 'dist/demo-interactive'));
const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('无法确认当前提交，停止发布。');
const require = createRequire(import.meta.url);
const runtime = resolve(root, 'demo/runtime.mjs');
const read = name => readFile(resolve(root, name), 'utf8');
const names = new Set(['index.html', 'styles.css', 'app.js', 'licenses.txt', 'ship.json', 'version.json', 'robots.txt']);
const out = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (out && (!out.isDirectory() || out.isSymbolicLink())) throw new Error('演示输出必须为普通目录。');
if (out) for (const file of await readdir(output, { withFileTypes: true })) {
  if (!file.isFile() || !names.has(file.name)) throw new Error('演示目录含未批准发布的文件：' + file.name);
}

const sample = Object.create(null);
for (const tariff of tariffs) {
  sample[tariff.id] = (await wordFile({ labels: sampleLabels(tariff), mapping: sampleMapping(tariff) })).toString('base64');
}
function replace(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('请同步适配最新版表单：' + from);
  return text.replace(from, to);
}

const demoPlugin = {
  name: 'runwell-demo-assembly',
  setup(b) {
    b.onResolve({ filter: /^runwell:acceptance$/ }, () => ({ path: resolve(root, 'online/service.mjs') }));
    b.onResolve({ filter: /^runwell:local$/ }, () => ({ path: runtime }));
    b.onResolve({ filter: /^\.\/(data\.mjs|rules\.mjs|sample\.json)$/ }, args => {
      if (args.resolveDir !== resolve(root, 'online')) return;
      if (args.path === './sample.json') return { path: 'sample.json', namespace: 'samples' };
      return { path: resolve(root, args.path === './data.mjs' ? 'backend/modules/catalog/data.mjs' : 'backend/modules/forms/preview/rules.mjs') };
    });
    b.onLoad({ filter: /.*/, namespace: 'samples' }, () => ({ contents: JSON.stringify(sample), loader: 'json' }));
    b.onResolve({ filter: /^\.\.\/vendor\/qa-/ }, args => ({ path: args.path.includes('qa-sax') ? require.resolve('sax') :
      resolve(dirname(dirname(require.resolve('fflate'))), 'esm/browser.js') }));
    // sax's optional Node-only stream API is unused; Word rendering uses its string parser.
    b.onResolve({ filter: /^(stream|string_decoder|fs|path|crypto)$/ }, () => ({ path: 'unavailable', namespace: 'node-only' }));
    b.onLoad({ filter: /.*/, namespace: 'node-only' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
    b.onLoad({ filter: /[\\/](api|shared|preview|generate|app)\.js$/ }, async ({ path }) => {
      if (!path.startsWith(resolve(root, 'frontend') + (process.platform === 'win32' ? '\\' : '/'))) return;
      let contents = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
      if (/[\\/](api|shared)\.js$/.test(path)) {
        contents = 'import { localFetch } from "runwell:local";\n' + replace(contents, 'await fetch(', 'await localFetch(');
      } else if (path.endsWith('preview.js')) {
        contents = replace(contents, 'let body = login(hosted);', "let body = '';");
        contents = replace(contents, 'if (hasToken()) {', '{');
        contents = replace(contents, '<p class="hint">当前身份　\' + esc(state.workspace.actor.id) +\n    \'　<button id="forms-exit" type="button">切换账号</button></p>', '<p class="hint">免登录演示</p>');
        contents = replace(contents, '当前账号还没有生成记录。', '当前浏览器还没有生成记录。');
        contents = replace(contents, '仅使用虚构客户资料和测试套餐。', '仅使用虚构资料。模板和生成记录保存在当前浏览器。');
        contents = replace(contents, "  root.querySelector('#forms-exit').onclick = () => { setToken(''); refresh(); };", '');
        contents = replace(contents, "      if (error.status !== 401) throw error;\n      setToken('');", '      throw error;');
      } else if (path.endsWith('generate.js')) {
        contents = replace(contents, '生成成功，文件已保存到此账号的历史记录。', '生成成功，文件已保存到当前浏览器的历史记录。');
      } else {
        contents = replace(contents, '请检查本地服务是否运行，然后重试。', '请使用新版浏览器，确认已允许本站保存数据，然后重试。');
      }
      return { contents, resolveDir: dirname(path), loader: 'js' };
    });
  }
};
export async function bundleDemo(entry = 'frontend/app.js') {
  const result = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2022', legalComments: 'none', minify: true,
    loader: { '.wasm': 'binary' }, plugins: [demoPlugin] });
  return result.outputFiles[0].contents;
}
async function publishFiles() {
  const app = await bundleDemo();
  const policy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
  const html = replace(await read('frontend/index.html'), '<meta charset="UTF-8">',
    '<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="' + policy + '">')
    .replace('本地开发预览', '免登录演示版 · ' + commit.slice(0, 7));
  const licenses = await Promise.all([
    [require.resolve('sql.js'), 'LICENSE'], [require.resolve('fflate'), 'LICENSE'],
    [require.resolve('sax'), 'LICENSE.md']
  ].map(([entry, filename]) => readFile(resolve(dirname(dirname(entry)), filename), 'utf8')));
  const files = {
    'index.html': html, 'styles.css': await read('frontend/styles.css'), 'app.js': app,
    'licenses.txt': licenses.join('\n\n'), 'version.json': JSON.stringify({ commit, branch: 'feature/project-skeleton', mode: 'browser-demo' }),
    'robots.txt': 'User-agent: *\nDisallow: /\n', 'ship.json': JSON.stringify({ headers: [{ source: '/(.*)', headers: [
      { key: 'Cache-Control', value: 'no-cache' }, { key: 'Content-Security-Policy', value: policy },
      { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Content-Type-Options', value: 'nosniff' }
    ] }] })
  };
  await mkdir(output, { recursive: true });
  for (const [file, contents] of Object.entries(files)) await writeFile(resolve(output, file), contents);
  console.log(JSON.stringify({ output, commit, files: [...names] }));
}
if (import.meta.main) await publishFiles();
