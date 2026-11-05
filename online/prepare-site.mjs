// Assemble only in a newly initialized Vinext Sites starter, before generating migrations.
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { wordFile } from '../backend/modules/forms/preview/store.mjs';
import { labels, defaultMapping } from '../backend/modules/forms/preview/rules.mjs';

if(!process.argv[2]) throw new Error('请提供一个全新的 Vinext Sites starter 目录。');
const online=dirname(fileURLToPath(import.meta.url)), repo=dirname(online), target=resolve(process.argv[2]);
const inTarget=(...p)=>join(target,...p);
const read=p=>readFile(inTarget(p),'utf8');
const put=(p,s)=>writeFile(inTarget(p),s);
const worker=await read('worker/index.ts'), page=await read('app/page.tsx'), schema=await read('db/schema.ts');
if(!worker.includes('runWithConnectorBinding') || !page.includes('Your site is taking shape') || !schema.includes('Intentionally empty')){
  throw new Error('目标必须是全新的 Vinext starter，以免覆盖现有业务或迁移。');
}
const manifest=JSON.parse(await read('.openai/hosting.json'));
const require=createRequire(import.meta.url);
const saxFile=require.resolve('sax');
const fflateRoot=dirname(dirname(require.resolve('fflate')));
const sample=await wordFile({labels,mapping:defaultMapping});
for(const dir of ['forms','tests','vendor/qa-sax','vendor/qa-fflate'])await mkdir(inTarget(dir),{recursive:true});
await cp(join(repo,'frontend'),inTarget('public'),{recursive:true,filter:p=>p!==join(repo,'frontend/index.html')});
const html=await readFile(join(repo,'frontend/index.html'),'utf8');
await put('public/workspace.html',html.replace('本地开发预览','线上验收 · 虚构资料'));
await copyFile(join(repo,'backend/modules/forms/preview/rules.mjs'),inTarget('forms/rules.mjs'));
await copyFile(join(repo,'backend/modules/catalog/data.mjs'),inTarget('forms/data.mjs'));
for(const name of ['service.mjs','word.mjs'])await copyFile(join(online,name),inTarget('forms',name));
await put('forms/sample.json',JSON.stringify({file:sample.toString('base64')})+'\n');
await copyFile(saxFile,inTarget('vendor/qa-sax/sax.cjs'));
await copyFile(join(dirname(dirname(saxFile)),'LICENSE.md'),inTarget('vendor/qa-sax/LICENSE.md'));
await copyFile(join(fflateRoot,'esm/browser.js'),inTarget('vendor/qa-fflate/browser.js'));
await copyFile(join(fflateRoot,'LICENSE'),inTarget('vendor/qa-fflate/LICENSE'));
await copyFile(join(online,'schema.ts'),inTarget('db/schema.ts'));
await copyFile(join(online,'hosted.test.mjs'),inTarget('tests/hosted.test.mjs'));
await put('.openai/hosting.json',JSON.stringify({...manifest,d1:'DB',r2:'BUCKET'},null,2)+'\n');
await put('worker/index.ts',"import { handleForms } from '../forms/service.mjs';\n"+worker.replace('    let binding',
  "    if (new URL(request.url).pathname.startsWith('/api/v1/')) return handleForms(request, env);\n    let binding"));
await put('app/page.tsx',"import {redirect} from 'next/navigation';\nexport default function Home(){redirect('/workspace.html#/forms/generate');}\n");
await put('app/layout.tsx',`export const metadata={title:'润网表单验收',description:'商务专线新装表单工作区'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
`);
console.log('验收应用已装配。请在目标项目生成数据库迁移，再运行测试和构建。');
