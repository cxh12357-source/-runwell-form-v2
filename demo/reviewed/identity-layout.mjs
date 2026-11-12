// Adjust only the generated copy of the eight reviewed embedded originals.
// Other templates must be individually verified before enabling this layout.
const supported = new Set([
  'business-100m-no-voice','business-100m-discount-no-voice','business-100m-voice',
  'business-200m-no-voice','business-200m-discount-no-voice','business-200m-voice',
  'business-ai-v1','business-ai-v2-no-voice'
]);
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const attr=(node,local)=>Object.values(node.attributes).find(a=>a.uri===W && a.local===local)?.value;
const clean=text=>text.replace(/\s/g,'').replace(/^\*/, '');
export const hasWiderIdentityLayout=id=>supported.has(id);

// Collect source offsets for top-level rows/cells, retaining the rest of the
// original document byte-for-byte. All changes are guarded by the caller's
// verified original hash, then by the table's labels and cell grid below.
function tablesIn(xml,sax) {
  const parser=sax.parser(true,{xmlns:true,strictEntities:true,position:true});
  const stack=[], tables=[];
  let table=null,row=null,cell=null,inText=false;
  parser.onopentag=node=>{
    const parent=stack.at(-1), local=node.uri===W?node.local:'';
    const start=xml.lastIndexOf('<',parser.position-1);
    const item={local,start,openEnd:parser.position,node};
    if(local==='tbl') {
      if(table) table.nested=true;
      else {table={rows:[],grid:null,nested:false,token:item};tables.push(table);}
    } else if(table && local==='tblGrid' && parent?.local==='tbl') {
      if(table.grid) table.invalid=true;
      table.grid={token:item,columns:[],other:false};
    } else if(table && parent?.local==='tblGrid' && table.grid) {
      if(local!=='gridCol')table.grid.other=true;
      else table.grid.columns.push(Number(attr(node,'w')));
    } else if(table && local==='tr' && parent?.local==='tbl') {
      row={cells:[],invalid:false,height:null,token:item};table.rows.push(row);
    } else if(row && local==='trHeight' && parent?.local==='trPr') {
      if(row.height)row.invalid=true;
      row.height={token:item,value:Number(attr(node,'val')),rule:attr(node,'hRule')};
    } else if(row && ['gridBefore','gridAfter','hMerge'].includes(local)) row.invalid=true;
    else if(row && local==='tc' && parent?.local==='tr') {
      cell={text:'',span:1,pr:null,width:null,spanToken:null,invalid:false,token:item};row.cells.push(cell);
    } else if(cell && local==='tcPr' && parent?.local==='tc') {
      if(cell.pr)cell.invalid=true;
      cell.pr=item;
    } else if(cell && parent?.local==='tcPr' && local==='gridSpan') {
      if(cell.spanToken)cell.invalid=true;
      cell.span=Number(attr(node,'val'));cell.spanToken=item;
    } else if(cell && parent?.local==='tcPr' && local==='tcW') {
      if(cell.width)cell.invalid=true;
      cell.width={token:item,value:Number(attr(node,'w')),type:attr(node,'type')};
    }
    if(cell && local==='t')inText=true;
    stack.push(item);
  };
  parser.ontext=text=>{if(cell && inText)cell.text+=text;};
  parser.onclosetag=()=>{
    const item=stack.pop();item.end=parser.position;
    if(item.local==='t')inText=false;
    if(cell && item===cell.token)cell=null;
    if(row && item===row.token)row=null;
    if(table && item===table.token){table.end=parser.position;table=null;}
  };
  parser.write(xml).close();
  return tables;
}

function spanTag(xml,token,span) {
  const raw=xml.slice(token.start,token.end);
  if(!/^<w:gridSpan\s+w:val="\d+"\s*\/>$/.test(raw))throw new Error('文档列跨度结构未核验。');
  return span===1?'':raw.replace(/w:val="\d+"/,`w:val="${span}"`);
}
function widthTag(xml,token,width) {
  const raw=xml.slice(token.start,token.end);
  if(!/^<w:tcW\s+[^>]*w:w="\d+"[^>]*\/>$/.test(raw))throw new Error('文档单元格宽度结构未核验。');
  return raw.replace(/w:w="\d+"/,`w:w="${width}"`);
}

export function adjustFirstPageIdentityLayout(bytes,{unzipSync,zipSync,sax}) {
  const parts=unzipSync(bytes), raw=parts['word/document.xml'];
  if(!raw)throw new Error('原表正文缺失。');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  const matches=tablesIn(xml,sax).filter(t=>t.rows.some(r=>r.cells.length===6 && /^(经办人|联系人)$/.test(clean(r.cells[0].text)) && clean(r.cells[2].text)==='身份证号码') &&
    t.rows.some(r=>r.cells.length===6 && /^(经办人|联系人)职务$/.test(clean(r.cells[0].text)) && clean(r.cells[2].text)==='E-MAIL'));
  if(matches.length!==1)throw new Error('身份证和邮箱栏布局未核验，无法安全调整。');
  const table=matches[0], grid=table.grid;
  if(table.nested || table.invalid || !grid || grid.other || grid.columns.length<1 || grid.columns.some(n=>!Number.isSafeInteger(n)||n<=0))throw new Error('文档网格结构未核验。');
  const edges=[0];for(const width of grid.columns)edges.push(edges.at(-1)+width);
  const targets=table.rows.filter(r=>r.cells.length===6 && ((/^(经办人|联系人)$/.test(clean(r.cells[0].text)) && clean(r.cells[2].text)==='身份证号码') ||
    (/^(经办人|联系人)职务$/.test(clean(r.cells[0].text)) && clean(r.cells[2].text)==='E-MAIL')));
  if(targets.length!==2)throw new Error('身份证和邮箱位置不明确。');
  const rowEdges=[];
  for(const r of table.rows){
    if(r.invalid || !r.cells.length)throw new Error('文档行结构未核验。');
    let index=0;const boundaries=[0];
    for(const c of r.cells){
      if(c.invalid || !c.pr || !c.width || c.width.type!=='dxa' || !Number.isSafeInteger(c.span) || c.span<1 || index+c.span>grid.columns.length)throw new Error('文档单元格结构未核验。');
      index+=c.span;boundaries.push(edges[index]);
    }
    if(index!==grid.columns.length)throw new Error('文档行宽与表格网格不一致。');
    rowEdges.push(boundaries);
  }
  const indexes=targets.map(r=>table.rows.indexOf(r));
  const targetEdges=indexes.map(i=>rowEdges[i]);
  if(targetEdges[0].some((v,i)=>v!==targetEdges[1][i]))throw new Error('身份证和邮箱列未对齐。');
  // Move the identity label left to expand the adjacent value, and move the
  // phone/fax boundary left to give the phone number a little more room.
  const old=targetEdges[0], nameWidth=old[2]-old[1], shift=nameWidth-1050;
  const phoneLabelWidth=1150;
  if(shift<=0 || shift>1100 || old[3]-shift<=old[1]+1050 || old[4]-old[3]<1000 || old[5]-old[4]<=phoneLabelWidth)throw new Error('身份证或联系电话栏宽度未核验。');
  const target=[...old];target[2]-=shift;target[3]-=shift;target[5]=old[4]+phoneLabelWidth;
  const newEdges=[...new Set([...edges,target[2],target[3],target[5]])].sort((a,b)=>a-b);
  const replacements=[];
  // Before widening, example ID/email values wrapped onto two lines. Retain
  // enough row height for the original subsequent-row position in the eight
  // reviewed documents; Word pagination still requires a visual review.
  if(![1930,1438].includes(nameWidth))throw new Error('文档行高未核验。');
  for(const [label,height] of [['身份证号码',nameWidth===1930?915:721],['E-MAIL',nameWidth===1930?549:527]]){
    const row=targets.find(r=>clean(r.cells[2].text)===label), h=row?.height;
    const raw=h && xml.slice(h.token.start,h.token.end);
    if(!h || ![272,366,433].includes(h.value) || h.rule!=='atLeast' || !/^<w:trHeight\s+[^>]*w:val="\d+"[^>]*\/>$/.test(raw))throw new Error('身份证或邮箱行高未核验。');
    replacements.push({start:h.token.start,end:h.token.end,value:raw.replace(/w:val="\d+"/,`w:val="${height}"`)});
  }
  const gridRaw=xml.slice(grid.token.start,grid.token.end);
  if(!/^<w:tblGrid(?:\s[^>]*)?>[\s\S]*<\/w:tblGrid>$/.test(gridRaw))throw new Error('文档网格结构未核验。');
  const gridOpen=xml.slice(grid.token.start,grid.token.openEnd);
  const gridBody=newEdges.slice(1).map((v,i)=>`<w:gridCol w:w="${v-newEdges[i]}"/>`).join('');
  replacements.push({start:grid.token.start,end:grid.token.end,value:gridOpen+gridBody+'</w:tblGrid>'});
  table.rows.forEach((r,rowIndex)=>{
    const boundary=indexes.includes(rowIndex)?target:rowEdges[rowIndex];
    for(let i=0;i<r.cells.length;i++){
      const c=r.cells[i], start=newEdges.indexOf(boundary[i]), end=newEdges.indexOf(boundary[i+1]), span=end-start;
      if(start<0 || end<=start)throw new Error('文档网格位置未核验。');
      if(c.spanToken) replacements.push({start:c.spanToken.start,end:c.spanToken.end,value:spanTag(xml,c.spanToken,span)});
      else if(span>1) replacements.push({start:c.width.token.end,end:c.width.token.end,value:`<w:gridSpan w:val="${span}"/>`});
      if(indexes.includes(rowIndex) && [1,3,4,5].includes(i)) {
        replacements.push({start:c.width.token.start,end:c.width.token.end,value:widthTag(xml,c.width.token,boundary[i+1]-boundary[i])});
      }
    }
  });
  let updated=xml;
  for(const r of replacements.sort((a,b)=>b.start-a.start || b.end-a.end))updated=updated.slice(0,r.start)+r.value+updated.slice(r.end);
  parts['word/document.xml']=new TextEncoder().encode(updated);
  return zipSync(parts,{level:6});
}
