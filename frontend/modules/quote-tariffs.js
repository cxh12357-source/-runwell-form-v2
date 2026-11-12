import tariffs from './quote-tariff-data.js';
import { escape as esc } from '../lib/api.js';

const separators=new Set(['title','sec','note']);
const option=(value,label=value)=>'<option value="'+esc(value)+'">'+esc(label)+'</option>';

function tariffBlocks({rows,kinds,merges},rate) {
  const blocks=[];
  let table;
  for(const [i] of rows.entries()){
    if(separators.has(kinds[i])){blocks.push({label:i}); table=null;}
    else {
      if(!table){table={indexes:[]}; blocks.push(table);}
      table.indexes.push(i);
    }
  }
  if(!rate)return blocks;
  const effective=rows.map(row=>row.slice());
  for(const [r,c,end] of merges)
    for(let i=r+1;i<=end;i++)if(effective[i]&&!effective[i][c])effective[i][c]=rows[r][c];
  const matches=i=>effective[i].some(cell=>String(cell??'').includes(rate));
  if(!rows.some((_,i)=>kinds[i]==='data'&&matches(i)))return [];
  for(const block of blocks){
    if(!block.indexes)continue;
    const firstHead=block.indexes.find(i=>kinds[i]==='head');
    if(firstHead===undefined||!rows[firstHead].some(cell=>/速率|带宽/.test(cell)))continue;
    const keep=new Set();
    let heading=firstHead;
    for(const i of block.indexes){
      if(kinds[i]==='head')heading=i;
      else if(matches(i)){keep.add(i); keep.add(heading);}
    }
    if(keep.size)keep.add(firstHead);
    block.indexes=block.indexes.filter(i=>keep.has(i));
  }
  return blocks.filter((b,i)=>b.indexes?b.indexes.length:kinds[b.label]!=='sec'||
    blocks.slice(i+1).find(next=>next.indexes||kinds[next.label]==='sec')?.indexes?.length);
}

export function renderTariffTable(dataset,rate='') {
  const {rows,kinds,merges,notes}=dataset;
  const blocks=tariffBlocks(dataset,rate);
  if(!blocks.length)return '<p>没有符合所选速率的资费记录。</p>';
  const endOf=blocks.map(block=>block.indexes?.at(-1)??block.label);
  const notesByBlock=new Map();
  for(const note of notes){
    const [row]=note;
    const exact=blocks.findIndex(block=>block.indexes?.includes(row)||block.label===row);
    const index=exact>=0?exact:Math.max(0,endOf.findLastIndex(end=>end<row));
    if(!notesByBlock.has(index))notesByBlock.set(index,[]);
    notesByBlock.get(index).push(note);
  }
  return blocks.map((block,index)=>{
    const side=(notesByBlock.get(index)||[]).map(([,text])=>'<p class="tariff-note">'+esc(text)+'</p>').join('');
    if(block.label!==undefined){
      const kind=kinds[block.label], tag=kind==='title'?'h3':kind==='sec'?'h4':'p';
      return '<'+tag+'>'+esc(rows[block.label][0]??'')+'</'+tag+'>'+side;
    }
    const indexes=block.indexes, visible=new Set(indexes), span=new Map(), covered=new Set();
    let width=Math.max(...indexes.map(i=>rows[i].length));
    for(const [r,c,end,last] of merges){
      const members=[];
      for(let i=r;i<=end;i++)if(visible.has(i))members.push(i);
      if(!members.length)continue;
      const first=members[0];
      width=Math.max(width,last+1);
      const values=[...new Set(rows[r].slice(c,last+1).filter(v=>v!==''&&v!=null))];
      span.set(first+':'+c,{height:members.length,width:last-c+1,value:values.join('\n')});
      for(const i of members)for(let j=c;j<=last;j++)if(i!==first||j!==c)covered.add(i+':'+j);
    }
    return '<div class="table-wrap"><table><tbody>'+indexes.map(i=>{
      const tag=kinds[i]==='head'?'th':'td';
      const solo=tag==='th'&&i!==indexes[0]&&rows[i].filter(v=>String(v??'').trim()).length===1&&
        rows[i][0]&&!span.has(i+':0')&&!covered.has(i+':0');
      if(solo)return '<tr><th colspan="'+width+'">'+esc(rows[i][0])+'</th></tr>';
      return '<tr>'+Array.from({length:width},(_,c)=>{
        const key=i+':'+c;
        if(covered.has(key))return '';
        const merge=span.get(key), value=merge?.value??rows[i][c]??'';
        const escaped=esc(value);
        const text=rate?escaped.split(esc(rate)).join('<mark>'+esc(rate)+'</mark>'):escaped;
        return '<'+tag+(merge?' rowspan="'+merge.height+'" colspan="'+merge.width+'"':'')+'>'+text+'</'+tag+'>';
      }).join('')+'</tr>';
    }).join('')+'</tbody></table></div>'+side;
  }).join('');
}

export function renderTariffs() {
  return '<section id="quote-tariffs" class="panel" hidden><h2>资费表查询</h2>'+
    '<div class="field-grid"><label>运营商<select data-tariff-operator>'+option('ct','电信')+option('lt','联通')+'</select></label>'+
    '<label>业务名称<select data-tariff-business></select></label>'+
    '<label>速率<select data-tariff-rate></select></label></div><div class="tariff-sheets" aria-live="polite"></div></section>';
}

export function bindTariffs(root) {
  const operator=root.querySelector('[data-tariff-operator]'), business=root.querySelector('[data-tariff-business]'),
    rate=root.querySelector('[data-tariff-rate]'), output=root.querySelector('.tariff-sheets');
  const current=()=>tariffs[operator.value][business.value];
  const render=()=>{output.innerHTML=renderTariffTable(current(),rate.value);};
  const setRates=()=>{
    const rates=current().rates;
    rate.innerHTML=option('','全部速率')+rates.map(v=>option(v)).join('');
    rate.disabled=!rates.length;
    render();
  };
  const setBusinesses=()=>{
    const previous=business.value, keys=Object.keys(tariffs[operator.value]);
    business.innerHTML=keys.map(v=>option(v)).join('');
    if(keys.includes(previous))business.value=previous;
    setRates();
  };
  operator.onchange=setBusinesses;
  business.onchange=setRates;
  rate.onchange=render;
  setBusinesses();
}
