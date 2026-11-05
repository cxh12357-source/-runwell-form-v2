import sax from '../vendor/qa-sax/sax.cjs';
import { unzipSync, zipSync, strToU8 } from '../vendor/qa-fflate/browser.js';
import { FormError, insist } from './rules.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PKG = 'http://schemas.openxmlformats.org/package/2006/';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOC = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const types = '<Types xmlns="'+PKG+'content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="'+DOC+'"/></Types>';
const rels = '<Relationships xmlns="'+PKG+'relationships"><Relationship Id="rId1" Type="'+REL+'" Target="word/document.xml"/></Relationships>';
const parts = new Set(['[Content_Types].xml','_rels/.rels','word/document.xml','docProps/app.xml','docProps/core.xml','word/settings.xml','word/styles.xml','word/stylesWithEffects.xml','word/webSettings.xml','word/fontTable.xml','word/theme/theme1.xml','word/_rels/document.xml.rels','word/numbering.xml']);
const elements = new Set('document body p pPr r rPr t b i u sz szCs rFonts jc spacing ind keepNext keepLines tbl tblPr tblW tblGrid gridCol tr trPr tc tcPr tcW tblBorders top left bottom right insideH insideV tblLayout vAlign gridSpan sectPr pgSz pgMar cols docGrid lang color position noProof qFormat cantSplit trHeight tblCellMar tblInd pBdr'.split(' '));
const xmlEsc = s => s.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const decoder = new TextDecoder('utf-8',{fatal:true});

function parse(bytes) {
  const xml=decoder.decode(bytes).replace(/^\s*<\?xml\s+[^?]*\?>/, '');
  insist(!/<!|<\?/.test(xml), '模板 XML 含有不支持的声明。');
  const parser=sax.parser(true,{xmlns:true,strictEntities:true});
  const stack=[];
  let root, count=0;
  parser.onopentag = tag => {
    insist(++count<=10000 && stack.length<48, '模板结构过大。');
    const node={name:tag.local,uri:tag.uri,attrs:Object.values(tag.attributes),children:[],text:''};
    if(stack.length) stack.at(-1).children.push(node); else root=node;
    stack.push(node);
  };
  parser.ontext = value => { if(stack.length) stack.at(-1).text+=value; };
  parser.onclosetag = () => stack.pop();
  parser.write(xml).close();
  return root;
}
function attribute(node, name) {return node.attrs.find(a=>!a.uri && a.local===name)?.value;}
function bodyXml(node,parent,paragraphs,paragraph,run) {
  insist(node.uri===W && elements.has(node.name), '只支持基本段落、直接格式和简单表格。');
  if(node.name==='p') { insist(!paragraph,'不支持嵌套段落。'); paragraph=[]; paragraphs.push(paragraph); }
  if(node.name==='r') run=parent==='p';
  if(node.name==='t') {
    insist(paragraph && run && parent==='r' && !node.children.length,'Word 文本结构错误。');
    paragraph.push(node);
  } else insist(!node.text.trim(),'文本必须位于 Word 文字单元。');
  node.cleanAttrs=[];
  for(const a of node.attrs) {
    if(a.uri==='http://www.w3.org/2000/xmlns/' || a.uri==='http://schemas.openxmlformats.org/markup-compatibility/2006' && a.local==='Ignorable' ||
      a.uri==='http://schemas.microsoft.com/office/word/2010/wordml' && ['paraId','textId'].includes(a.local)) continue;
    if(a.uri==='http://www.w3.org/XML/1998/namespace' && a.local==='space') continue;
    insist(a.uri===W,'模板含有不支持的属性。');
    node.cleanAttrs.push(' w:'+a.local+'="'+xmlEsc(a.value)+'"');
  }
  for(const child of node.children) bodyXml(child,node.name,paragraphs,paragraph,run);
}
function serialize(node) {
  const attrs=node.cleanAttrs.join('')+(node.name==='document'?' xmlns:w="'+W+'"':'')+(node.name==='t'?' xml:space="preserve"':'');
  return '<w:'+node.name+attrs+'>'+xmlEsc(node.text)+node.children.map(serialize).join('')+'</w:'+node.name+'>';
}

function replaceTags(paragraph, mapping, values, found) {
  const fragments=paragraph.map(n=>n.text);
  const combined=fragments.join('');
  const pattern=/\{\{([A-Za-z][A-Za-z0-9_]{0,47})\}\}/g;
  insist(!/\{\{|\}\}/.test(combined.replace(pattern,'')),'占位符格式错误。');
  let offset=0;
  const starts=fragments.map(s=>{const n=offset;offset+=s.length;return n;});
  for(const m of [...combined.matchAll(pattern)].reverse()) {
    const key=m[1];
    insist(Object.hasOwn(mapping,key),'占位符未配置映射。');
    found.add(key);
    if(!values) continue;
    for(let i=paragraph.length-1;i>=0;i--){
      const a=Math.max(0,m.index-starts[i]), b=Math.min(fragments[i].length,m.index+m[0].length-starts[i]);
      if(a>=b) continue;
      const old=paragraph[i].text;
      paragraph[i].text=old.slice(0,a)+(a+starts[i]===m.index?values[key]:'')+old.slice(b);
    }
  }
}
export function renderWord(bytes,mapping,values) {
  try {
    insist(bytes.length>0 && bytes.length<=524288,'模板最大 512 KiB。');
    const seen=new Set();let total=0;
    const files=unzipSync(bytes,{filter:f=>{
      total+=f.originalSize;
      insist(parts.has(f.name) && !seen.has(f.name) && f.originalSize>0 && total<=1048576 && [0,8].includes(f.compression),'不支持该 DOCX 部件或展开大小。');
      seen.add(f.name);return true;
    }});
    const ct=parse(files['[Content_Types].xml']);
    insist(ct.name==='Types' && ct.uri===PKG+'content-types' && ct.children.filter(n=>attribute(n,'PartName')==='/word/document.xml' && attribute(n,'ContentType')===DOC).length===1 &&
      ct.children.every(n=>!/macro/i.test(attribute(n,'ContentType')||'')),'Word 内容类型错误。');
    for(const path of ['_rels/.rels','word/_rels/document.xml.rels']){
      if(path!=='_rels/.rels' && !files[path])continue;
      const root=parse(files[path]);const main=[];
      insist(root.name==='Relationships' && root.uri===PKG+'relationships','模板关系错误。');
      for(const link of root.children){
        const target=attribute(link,'Target')||'';
        insist(link.name==='Relationship' && link.uri===root.uri && !attribute(link,'TargetMode') &&
          Object.hasOwn(files,(path.startsWith('word/')?'word/':'')+target),'不接受外链或未知部件。');
        if(attribute(link,'Type')===REL)main.push(target);
      }
      if(path==='_rels/.rels')insist(main.length===1 && main[0]==='word/document.xml','缺少 Word 正文关系。');
    }
    const root=parse(files['word/document.xml']), paragraphs=[], found=new Set();
    insist(root.name==='document' && root.children.length===1 && root.children[0].name==='body','缺少 Word 正文。');
    bodyXml(root,null,paragraphs,null,false);
    for(const p of paragraphs) replaceTags(p,mapping,values,found);
    insist(paragraphs.length && found.size===Object.keys(mapping).length,'模板占位符与映射不一致。');
    const xml=strToU8(serialize(root));
    insist(xml.length<=1048576,'输出文件过大。');
    return zipSync({'[Content_Types].xml':strToU8(types),'_rels/.rels':strToU8(rels),'word/document.xml':xml},{level:6});
  } catch(error) { if(error instanceof FormError) throw error; throw new FormError('Word 模板无效或含有不支持的内容。'); }
}
