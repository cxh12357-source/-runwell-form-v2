// Standalone prototype. Dependencies are injected so the same logic runs in Workers
// and test environments; it is deliberately not connected to the upload route.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const utf8 = new TextDecoder('utf-8', {fatal:true});
const escapeXml = value => value.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const fail = message => { throw new Error(message); };

function parseXml(xml, sax, handlers = {}) {
  if (/<!|<\?(?!xml\s)/i.test(xml)) fail('不支持文档声明、注释或处理指令。');
  const parser = sax.parser(true, {xmlns:true, strictEntities:true, position:true});
  parser.onopentag = node => handlers.open?.(node, parser.position);
  parser.onclosetag = name => handlers.close?.(name, parser.position);
  parser.ontext = value => handlers.text?.(value);
  parser.write(xml).close();
}

/**
 * edits: [{part, paragraph, text, expected, start, end, value}].
 * paragraph is the zero-based w:p ordinal in a part; text is the zero-based
 * w:t ordinal within that paragraph. expected is the entire decoded w:t value;
 * start/end are UTF-16 offsets into it, so stale or ambiguous mappings fail.
 * A strictly empty paragraph may instead use {kind:'emptyParagraph', part,
 * paragraph, expectedXml, value, format?:{font,sizeHalfPoints,bold}}. Without
 * format, the run inherits the paragraph's existing default formatting. The
 * expected XML must match the complete original paragraph, including pPr.
 */
export function fillOriginalDocx(bytes, edits, {unzipSync, zipSync, sax}) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 10_000_000) fail('文档大小无效。');
  if (!Array.isArray(edits) || !edits.length || edits.length > 200) fail('字段映射无效。');
  const names = new Set(); let total = 0;
  const files = unzipSync(bytes, {filter: f => {
    const name = f.name;
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(p => p==='..' || p==='.') || names.has(name)) fail('文档部件路径无效。');
    if (/^(word\/(?:embeddings|activeX|externalLinks)|customUI)(?:\/|$)|vbaProject|\.bin$|\.exe$|\.svg$/i.test(name)) fail('文档包含不支持的活动内容。');
    total += f.originalSize;
    if (names.size >= 1000 || f.originalSize > 20_000_000 || total > 40_000_000 || ![0,8].includes(f.compression)) fail('文档展开大小或压缩格式无效。');
    names.add(name); return true;
  }});
  if (!files['[Content_Types].xml'] || !files['_rels/.rels'] || !files['word/document.xml']) fail('文档缺少必要部件。');
  const ct=utf8.decode(files['[Content_Types].xml']);
  if (/macroEnabled|vbaProject|activeX|oleObject|externalLink/i.test(ct)) fail('文档包含不支持的活动内容。');
  let mainType=false;
  parseXml(ct,sax,{open:node=>{
    const attrs=Object.values(node.attributes), get=key=>attrs.find(a=>!a.uri && a.local===key)?.value || '';
    if(node.local==='Override' && get('PartName')==='/word/document.xml' && get('ContentType')==='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') mainType=true;
  }});
  if(!mainType) fail('文档不是受支持的 DOCX。');
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith('.rels')) continue;
    let depth=0;
    parseXml(utf8.decode(data),sax,{open: node => {
      depth++;
      if (node.uri !== REL || (depth===1 ? node.local!=='Relationships' : depth!==2 || node.local!=='Relationship')) fail('文档关系结构无效。');
      if (depth===1) return;
      const attrs=Object.values(node.attributes);
      const get = key => attrs.find(a=>!a.uri && a.local===key)?.value || '';
      if (!get('Id') || !get('Type') || !get('Target')) fail('文档关系结构无效。');
      if ((get('TargetMode') && get('TargetMode').toLowerCase()!=='internal') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(get('Target')) || /vbaProject|activeX|oleObject|externalLink|attachedTemplate|aFChunk/i.test(get('Type'))) fail('文档包含外部链接或活动内容。');
    },close:()=>{depth--;}});
  }
  // Field instructions may execute external references even without a .rels entry.
  for (const [name,data] of Object.entries(files)) {
    if (!/^word\/.*\.xml$/i.test(name)) continue;
    let instruction='', inInstruction=false;
    parseXml(utf8.decode(data),sax,{
      open:n=>{
        if(n.uri===W && ['altChunk','object','control','subDoc','binData'].includes(n.local)) fail('文档包含不支持的活动内容。');
        if(n.uri===W && n.local==='instrText')inInstruction=true;
      },
      text:t=>{if(inInstruction)instruction+=t;},
      close:()=>{inInstruction=false;}
    });
    if (/\b(?:DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|LINK|DATABASE|HYPERLINK)\b/i.test(instruction)) fail('文档包含不支持的外部字段。');
  }
  const grouped=new Map();
  for (const edit of edits) {
    const {part,paragraph,text,expected,start,end,value,kind,expectedXml,format,fitTextTwips}=edit;
    if (!/^word\/(?:document|header\d+|footer\d+)\.xml$/.test(part) || !files[part] || !Number.isInteger(paragraph) || paragraph<0 || typeof value!=='string' || !value.isWellFormed() || /[\x00-\x1f\ufffe\uffff]/u.test(value)) fail('字段定位或内容无效。');
    if(kind==='emptyParagraph') {
      if(typeof expectedXml!=='string' || (fitTextTwips!==undefined && (!Number.isInteger(fitTextTwips) || fitTextTwips<1 || fitTextTwips>10000)) || (format!==undefined && (!format || typeof format!=='object' || Object.keys(format).some(k=>!['font','sizeHalfPoints','bold'].includes(k)) || typeof format.font!=='string' || !/^[\p{L}\p{N} ._-]{1,50}$/u.test(format.font) || !Number.isInteger(format.sizeHalfPoints) || format.sizeHalfPoints<8 || format.sizeHalfPoints>144 || typeof format.bold!=='boolean'))) fail('空段落的格式配置无效。');
    } else if(kind!==undefined || !Number.isInteger(text) || text<0 || typeof expected!=='string' || !Number.isInteger(start) || !Number.isInteger(end) || start<0 || end<start || end>expected.length) fail('字段定位或内容无效。');
    if (!grouped.has(part)) grouped.set(part,[]); grouped.get(part).push(edit);
  }
  for (const [part, targets] of grouped) {
    const xml=utf8.decode(files[part]), stack=[], locations=new Map(), paragraphs=new Map(); let paragraph=-1, text=-1, current=null, currentParagraph=null;
    parseXml(xml,sax,{
      open:(node,pos)=>{
        if (node.uri===W && node.local==='p') { if(stack.some(n=>n==='p')) fail('不支持嵌套段落。'); paragraph++; text=-1; currentParagraph={start:xml.lastIndexOf('<',pos-1),empty:true,prefix:node.prefix || '',selfClosing:node.isSelfClosing}; }
        else if(currentParagraph && stack.at(-1)==='p' && !(node.uri===W && node.local==='pPr')) currentParagraph.empty=false;
        if (node.uri===W && node.local==='t') {
          if (!stack.includes('p') || current) fail('不支持的文字节点。');
          text++; current={paragraph,text,start:pos,value:'',selfClosing:node.isSelfClosing};
        } else if(current) fail('文字节点中存在嵌套内容。');
        stack.push(node.uri===W ? node.local : '');
      },
      text:value=>{if(current)current.value+=value;else if(currentParagraph && value.trim())currentParagraph.empty=false;},
      close:(_,pos)=>{
        const node=stack.pop();
        if(node==='t') { current.end=xml.lastIndexOf('<',pos-1); locations.set(`${current.paragraph}:${current.text}`,current); current=null; }
        if(node==='p') { currentParagraph.insertAt=xml.lastIndexOf('<',pos-1); currentParagraph.end=pos; paragraphs.set(paragraph,currentParagraph); currentParagraph=null; }
      }
    });
    const changed=[], insertions=[];
    for(const edit of targets) {
      if(edit.kind==='emptyParagraph') {
        const p=paragraphs.get(edit.paragraph);
        if(!p || p.selfClosing || !p.empty || xml.slice(p.start,p.end)!==edit.expectedXml || insertions.some(x=>x.start===p.insertAt)) fail('空段落与映射不一致，请重新核对。');
        const q=p.prefix ? p.prefix+':' : '', f=edit.format;
        const font=f ? `<${q}rFonts ${q}ascii="${escapeXml(f.font)}" ${q}hAnsi="${escapeXml(f.font)}" ${q}eastAsia="${escapeXml(f.font)}"/><${q}sz ${q}val="${f.sizeHalfPoints}"/>${f.bold?`<${q}b/>`:''}` : '';
        const fit=edit.fitTextTwips!==undefined ? `<${q}fitText ${q}val="${edit.fitTextTwips}" ${q}id="${100000+edit.paragraph}"/>` : '';
        const properties=font || fit ? `<${q}rPr>${font}${fit}</${q}rPr>` : '';
        const run=`<${q}r>${properties}<${q}t xml:space="preserve">${escapeXml(edit.value)}</${q}t></${q}r>`;
        insertions.push({start:p.insertAt,end:p.insertAt,replacement:run}); continue;
      }
      const node=locations.get(`${edit.paragraph}:${edit.text}`);
      if (!node || node.selfClosing || node.value!==edit.expected) fail('模板文字与映射不一致，请重新核对。');
      const key=`${edit.paragraph}:${edit.text}`;
      let group=changed.find(x=>x.key===key);
      if(!group){group={key,node,edits:[]};changed.push(group);}
      group.edits.push(edit);
    }
    for(const group of changed) {
      let value=group.node.value, previous=value.length, previousStart=-1;
      for(const edit of group.edits.sort((a,b)=>b.start-a.start || b.end-a.end)) {
        if(edit.end>previous || edit.start===previousStart) fail('字段映射范围重叠。');
        value=value.slice(0,edit.start)+edit.value+value.slice(edit.end); previous=edit.start; previousStart=edit.start;
      }
      if(!value.isWellFormed()) fail('字段定位拆分了字符。');
      const tagStart=xml.lastIndexOf('<',group.node.start-1);
      const openTag=xml.slice(tagStart,group.node.start);
      if (/^\s|\s$/.test(value) && !/\bxml:space\s*=\s*(['"])preserve\1/.test(openTag)) fail('空白字符需要模板启用 xml:space。');
      group.replacement=escapeXml(value);
    }
    let output=xml;
    const replacements=[...changed.map(group=>({start:group.node.start,end:group.node.end,replacement:group.replacement})),...insertions];
    for(const item of replacements.sort((a,b)=>b.start-a.start)) output=output.slice(0,item.start)+item.replacement+output.slice(item.end);
    files[part]=new TextEncoder().encode(output);
  }
  return zipSync(files,{level:6});
}
