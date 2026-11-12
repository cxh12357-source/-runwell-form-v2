import { bindTariffs, renderTariffs } from './quote-tariffs.js';
import { bindQuoteAdvisor, renderQuoteAdvisor } from './quote-advisor.js';

const businesses = ['商务专线','精品专线','精品专线融合','智能专线','IPMAN','MSTP','MPLS-VPN','OTN','IPRAN','SDH','SD-WAN','沪港专线','旺铺通','旺铺开店宝','酒店完美联盟'];
const rates = {
  '100': {name:'上行100M / 下行500M', month:688, year:6880, twoYears:11880, yearPack:{eight:6600,seven:5780}, addons:['200','300','500']},
  '200': {name:'上行200M / 下行1000M', month:1088, year:10880, twoYears:15910, yearPack:{eight:10450,seven:9140}, addons:['300','500']}
};
const addonPrices = {'200':100,'300':150,'500':200};
const periods = {month:{label:'月付',unit:'月',months:1},year:{label:'年付',unit:'年',months:12},twoYears:{label:'两年付',unit:'2年',months:24}};
const discounts = {standard:{label:'标准资费',percent:100},eight:{label:'8折',percent:80},seven:{label:'7折',percent:70}};
const money = amount => '¥' + amount.toLocaleString('zh-CN',{maximumFractionDigits:2});
const option = (value,label) => '<option value="'+value+'">'+label+'</option>';
const choices = (items,key='label') => Object.entries(items).map(([id,data])=>option(id,data[key])).join('');
const yearPackCycle = {...periods.year,label:'挂年付包'};

export function calculateQuote({business,rate,period,discount,addon,yearPack}) {
  if (business !== '商务专线') return null;
  if (!Object.hasOwn(rates,rate)||!Object.hasOwn(periods,period)) return null;
  const speed=rates[rate];
  const selected=period==='month'&&Object.hasOwn(discounts,discount)?discounts[discount]:discounts.standard;
  const packPrice=period==='month'&&Object.hasOwn(speed.yearPack,discount)?speed.yearPack[discount]:null;
  const hasYearPack=yearPack===true&&packPrice!==null;
  const cycle=hasYearPack?yearPackCycle:periods[period];
  const base=hasYearPack?packPrice:Math.round(speed[period]*selected.percent)/100;
  const addonMonthly=speed.addons.includes(addon)?addonPrices[addon]:0;
  // The legacy table lists monthly and yearly addon charges but no two-year rate.
  const separateAddon=period==='twoYears' && addonMonthly>0;
  const addonFee=separateAddon?0:addonMonthly*cycle.months;
  return {business, speed:speed.name, cycle, discount:selected.label, standard:speed[period], base, hasYearPack, addon:addonMonthly?addon:'',
    addonMonthly, addonFee, separateAddon, recurring:Math.round((base+addonFee)*100)/100, installation:310};
}

export function matchQuoteAdvice({ready,period,budget,budgetUnit,minUp,minDown}) {
  if(!ready)return [];
  const result=[];
  for(const [rate,speed] of Object.entries(rates)){
    if(Number(rate)*5<(minDown||0))continue;
    for(const cycle of (Object.hasOwn(periods,period)?[period]:Object.keys(periods))){
      const addon=Number(rate)>=(minUp||0)?'':speed.addons.find(v=>Number(v)>=minUp);
      if(addon===undefined)continue;
      const selection={business:'商务专线',rate,period:cycle,discount:'standard',addon};
      const quote=calculateQuote(selection);
      if(quote.separateAddon)continue;
      const monthly=quote.recurring/quote.cycle.months;
      if(budget&&(!Object.hasOwn(periods,budgetUnit)||monthly>budget/periods[budgetUnit].months+1e-8))continue;
      result.push({selection,quote,monthly});
    }
  }
  return result.sort((a,b)=>period?a.monthly-b.monthly:a.quote.cycle.months-b.quote.cycle.months||a.monthly-b.monthly).slice(0,2);
}

const escapeWord = value => String(value).replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const wordAmount = (value,unit) => value.toLocaleString('zh-CN',{maximumFractionDigits:2})+(unit?' 元/'+unit:'');

export function renderQuoteDocument(quote, details={}, now=new Date()) {
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const field=(label,value)=>'<div style="margin:2px 0">'+label+'：<b>'+escapeWord(value)+'</b></div>';
  const cell='border:1px solid #64748b;padding:4px 8px;';
  const row=(values,{head=false,total=false}={})=>'<tr>'+values.map((value,index)=>{
    const tag=head?'th':'td';
    return '<'+tag+' style="'+cell+(head?'background:#eef2f7;text-align:left;':
      (index===values.length-1?'text-align:right;':'text-align:left;')+(total?'font-weight:700;':''))+'">'+escapeWord(value)+'</'+tag+'>';
  }).join('')+'</tr>';
  const table=(head,body)=>'<table style="border:1px solid #64748b;border-collapse:collapse;width:100%;font-size:12px;border-spacing:0">'+row(head,{head:true})+body+'</table>';
  const section=title=>'<p style="font-size:13px;font-weight:700;margin:10px 0 4px">'+title+'</p>';
  const unit=quote.cycle.unit;
  const addonRow=quote.addon?row(['上行升速'+quote.addon+'M',
    wordAmount(quote.separateAddon?quote.addonMonthly:quote.addonFee,quote.separateAddon?'月':unit),'—',
    quote.separateAddon?'两年付结算待核价':quote.cycle.label,
    quote.separateAddon?'未计入合计':wordAmount(quote.addonFee,unit)]):'';
  const fees=row([quote.speed,wordAmount(quote.standard,quote.hasYearPack?'月':unit),quote.discount==='标准资费'?'—':quote.discount,
    quote.cycle.label,wordAmount(quote.base,unit)])+addonRow+
    row([quote.separateAddon?'合计（仅基础套餐）':'合计（'+quote.cycle.label+'）','','','',wordAmount(quote.recurring,unit)],{total:true});
  return '<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>报价单</title></head>'+
    '<body style="font-family:Microsoft YaHei,sans-serif"><h2 style="text-align:center;letter-spacing:10px;margin:10px 0">报 价 单</h2>'+
    '<div style="font-size:12px">'+field('报价日期',date)+field('运营商','电信')+field('业务名称',quote.business)+
    field('报价有效期','自报价日期起 15 个工作日')+
    [['客户名称','customer'],['安装地址','address'],['联系方式','contact']]
      .map(([label,key])=>details[key]?.trim()?field(label,details[key].trim()):'').join('')+'</div>'+
    section('一次性费用（单位：元）')+table(['项目','金额'],row(['初装费',wordAmount(quote.installation)]))+
    section('使用费')+table(['速率','标准资费','折扣率','付费周期','折后资费'],fees)+
    section('备注')+'<ul style="font-size:12px;margin:0;padding-left:20px">'+[
      '工期：有资源 2-3 个工作日',
      quote.cycle.months===24?'套餐协议期：以运营商合同为准':'套餐协议期：1 年，完工次月 1 日起算',
      '首月资费：以同档次月付套餐资费为基数，完工日起按天计算',
      '付款方式：根据运营商实际账单按时支付',
      '关于发票：如需开具增值税专用发票且未办理过开票手续，请于业务完工当月携带相关手续至营业厅办理'
    ].map(line=>'<li>'+line+'</li>').join('')+'</ul></body></html>';
}

function quoteLines(quote) {
  const {business,speed,cycle,discount,base,addon,addonMonthly,addonFee,separateAddon,installation}=quote;
  return [business+'｜'+speed+'｜'+cycle.label+'｜'+discount,
    '基础套餐：'+money(base)+'/'+cycle.unit,
    ...(addon?['上行升速'+addon+'M：'+(separateAddon?money(addonMonthly)+'/月（两年付结算方式待核价）':money(addonFee)+'/'+cycle.unit)]:[]),
    '一次性初装费：'+money(installation)];
}

const tabs = [['calculate','报价计算'],['tariffs','资费表查询']];
const draftKey='runwell-quote-draft-v1';
const draftStorage = () => window.localStorage;
const choiceKeys=['business','rate','period','discount','addon','yearPack'];
const detailKeys=['customer','address','contact'];
export function renderQuotes() {
  return '<a class="back" href="#/">← 返回工作台</a><h1>业务报价</h1>'+
    '<nav class="tabs quote-tabs" aria-label="报价子版块">'+tabs.map(([id,label],index)=>
      '<button type="button" data-quote-tab="'+id+'" aria-controls="quote-'+id+'" aria-pressed="'+(!index)+'">'+label+'</button>').join('')+'</nav>'+
    '<section id="quote-calculate" class="quote-calculator" aria-label="报价计算">'+
    '<div class="quote-layout"><div class="panel quote-options"><h2>选择报价方案</h2>'+
    '<form id="quote-form"><div class="field-grid">'+
    '<label>业务名称<select name="business">'+businesses.map(b=>option(b,b)).join('')+'</select></label>'+
    '<label>速率<select name="rate">'+choices(rates,'name')+'</select></label>'+
    '<label>付费周期<select name="period">'+choices(periods)+'</select></label>'+
    '<label>折扣<select name="discount">'+choices(discounts)+'</select></label>'+
    '<label>升速包<select name="addon"></select></label>'+
    '<div data-year-pack hidden><label class="quote-year-pack"><input type="checkbox" name="yearPack" disabled><span>挂年付包</span></label></div></div>'+
    '<details class="quote-customer"><summary>客户资料（选填）</summary>'+
    '<div class="field-grid"><label>客户名称<input name="customer" placeholder="客户名称" maxlength="120"></label>'+
    '<div class="quote-address"><div class="quote-address-heading"><label for="quote-address">安装地址（选填）</label>'+
    '<a data-broadband-link href="https://service.sh.189.cn/service/queryBDResource/index" target="_blank" rel="noopener noreferrer">宽带资源查询入口</a></div>'+
    '<input id="quote-address" name="address" placeholder="安装地址" maxlength="240" aria-describedby="quote-address-status">'+
    '<p class="hint" id="quote-address-status" role="status"></p></div>'+
    '<label>联系方式<input name="contact" placeholder="联系人 / 电话" maxlength="120"></label></div></details></form>'+
    renderQuoteAdvisor()+'</div>'+
    '<section class="panel quote-summary"><h2>实时报价</h2><div class="quote-result" aria-live="polite"></div>'+
    '<div class="quote-actions"><button type="button" class="button" data-quote-generate>生成报价单</button>'+
    '<button type="button" class="button" data-quote-save>保存草稿</button>'+
    '<button type="button" class="button" data-quote-restore hidden>恢复草稿</button></div>'+
    '<p class="hint" role="status" id="quote-status"></p></section></div>'+
    '<section id="quote-preview" class="panel" aria-label="报价单预览" hidden><div class="quote-sheet"></div>'+
    '<div class="quote-actions"><button type="button" class="button" data-quote-download>下载 Word</button>'+
    '<button type="button" class="button" data-quote-close>返回编辑</button></div></section></section>'+
    renderTariffs();
}

export function bindQuotes(root) {
  const form=root.querySelector('#quote-form'), fields=form.elements, result=root.querySelector('.quote-result');
  const generate=root.querySelector('[data-quote-generate]'), status=root.querySelector('#quote-status');
  const save=root.querySelector('[data-quote-save]'), restore=root.querySelector('[data-quote-restore]');
  const preview=root.querySelector('#quote-preview'), sheet=preview.querySelector('.quote-sheet');
  const download=root.querySelector('[data-quote-download]');
  const yearPackField=root.querySelector('[data-year-pack]');
  const yearPackLabel=yearPackField.querySelector('span');
  let quote, generated;
  const readValues=keys=>Object.fromEntries(keys.map(key=>[key,key==='yearPack'?fields.yearPack.checked:fields[key].value]));
  const clearPreview=()=>{generated=null; preview.hidden=true; sheet.replaceChildren();};
  const focusPreview=()=>{
    const title=sheet.querySelector('h2');
    title.tabIndex=-1;
    title.focus({preventScroll:true});
    title.scrollIntoView({block:'start'});
  };
  const update=()=>{
    const supported=fields.business.value==='商务专线', monthly=fields.period.value==='month';
    for(const key of ['rate','period','addon']) fields[key].disabled=!supported;
    const previousDiscount=fields.discount.value;
    fields.discount.innerHTML=monthly?choices(discounts):option('standard','标准资费');
    fields.discount.disabled=!supported||!monthly;
    if(monthly&&Object.hasOwn(discounts,previousDiscount))fields.discount.value=previousDiscount;
    const previousAddon=fields.addon.value;
    const speed=rates[fields.rate.value];
    const addons=speed.addons;
    const packAvailable=supported&&monthly&&Object.hasOwn(speed.yearPack,fields.discount.value);
    fields.yearPack.disabled=!packAvailable;
    yearPackField.hidden=!packAvailable;
    if(packAvailable)yearPackLabel.textContent='挂年付包（'+money(speed.yearPack[fields.discount.value])+'/年）';
    if(!packAvailable)fields.yearPack.checked=false;
    const addonIsAnnual=fields.period.value==='year'||fields.yearPack.checked;
    fields.addon.innerHTML=option('','不选升速包')+addons.map(id=>option(id,
      '上行升速'+id+'M（'+money(addonPrices[id]*(addonIsAnnual?12:1))+(addonIsAnnual?'/年':'/月')+'）')).join('');
    if(addons.includes(previousAddon))fields.addon.value=previousAddon;
    quote=calculateQuote(readValues(choiceKeys));
    const lines=quote?quoteLines(quote):[];
    const detailLines=(lines.length?lines:['该业务的资费尚未接入，请人工核价。']).map(line=>{
      const p=document.createElement('p'); p.textContent=line; return p;
    });
    result.replaceChildren();
    if(quote){
      const caption=document.createElement('p');
      caption.className='quote-total-caption';
      caption.textContent=quote.separateAddon?'周期费用（仅基础套餐）':'周期费用合计';
      const total=document.createElement('p');
      total.className='quote-total';
      total.textContent=money(quote.recurring)+' / '+quote.cycle.unit;
      result.append(caption,total);
    }
    result.append(...detailLines);
    status.textContent='';
    generate.disabled=!quote;
  };
  form.addEventListener('change',event=>{
    if(['rate','business'].includes(event.target.name))fields.yearPack.checked=false;
    clearPreview();
    update();
  });
  form.addEventListener('input',()=>{if(generated)clearPreview();});
  form.addEventListener('submit',event=>event.preventDefault());
  bindQuoteAdvisor(root,matchQuoteAdvice,selection=>{
    for(const key of ['business','rate','period','discount'])fields[key].value=selection[key];
    fields.yearPack.checked=false;
    clearPreview();update();
    fields.addon.value=selection.addon;
    update();
    fields.business.focus();
  });
  const addressStatus=root.querySelector('#quote-address-status');
  fields.address.addEventListener('input',()=>{addressStatus.textContent='';});
  root.querySelector('[data-broadband-link]').addEventListener('click',async()=>{
    const address=fields.address.value.trim();
    if(!address){addressStatus.textContent='未填写安装地址，请在电信查询页手动填写。';return;}
    try{
      await navigator.clipboard.writeText(address);
      addressStatus.textContent='已复制安装地址，请在电信查询页粘贴。';
    }catch{
      fields.address.focus();
      fields.address.select();
      addressStatus.textContent='自动复制失败，请手动复制已选中的地址，再到电信查询页粘贴。';
    }
  });
  let tariffsBound=false;
  for(const button of root.querySelectorAll('[data-quote-tab]'))button.onclick=()=>{
    for(const [id] of tabs){
      const active=id===button.dataset.quoteTab;
      root.querySelector('[data-quote-tab="'+id+'"]').setAttribute('aria-pressed',String(active));
      root.querySelector('#quote-'+id).hidden=!active;
    }
    if(button.dataset.quoteTab==='tariffs'&&!tariffsBound){
      bindTariffs(root);
      tariffsBound=true;
    }
  };
  generate.onclick=()=>{
    if(!quote)return;
    generated={quote,html:renderQuoteDocument(quote,readValues(detailKeys))};
    const doc=new DOMParser().parseFromString(generated.html,'text/html');
    for(const node of doc.body.querySelectorAll('[style]'))node.removeAttribute('style');
    sheet.replaceChildren(...doc.body.children);
    preview.hidden=false;
    status.textContent='报价单预览已生成。';
    form.dispatchEvent(new form.ownerDocument.defaultView.CustomEvent('runwell:quote-generated',{bubbles:true,detail:readValues(detailKeys)}));
    focusPreview();
  };
  download.onclick=()=>{
    if(!generated)return;
    const {quote,html}=generated;
    const blob=new Blob(['\ufeff',html],{type:'application/msword'});
    const url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;
    link.download='报价单_'+quote.business+'_'+quote.speed.replace(/\s*\/\s*/g,'-')+'.doc';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent='报价单已生成，请查看浏览器下载。';
  };
  root.querySelector('[data-quote-close]').onclick=()=>{clearPreview(); generate.focus(); status.textContent='';};
  try {
    const storage=draftStorage();
    save.hidden=!storage;
    restore.hidden=!storage?.getItem(draftKey);
  } catch { restore.hidden=true; }
  save.onclick=()=>{
    try {
      draftStorage().setItem(draftKey,JSON.stringify(readValues([...choiceKeys,...detailKeys])));
      restore.hidden=false;
      status.textContent='草稿已保存在当前浏览器。再次保存会覆盖这份草稿。';
    } catch { status.textContent='当前浏览器无法保存草稿。'; }
  };
  restore.onclick=()=>{
    try {
      const data=JSON.parse(draftStorage().getItem(draftKey));
      if(!data){restore.hidden=true; status.textContent='没有可恢复的草稿。'; return;}
      fields.business.value=businesses.includes(data.business)?data.business:'商务专线';
      fields.rate.value=Object.hasOwn(rates,data.rate)?data.rate:'100';
      fields.period.value=Object.hasOwn(periods,data.period)?data.period:'month';
      for(const key of detailKeys)fields[key].value=typeof data[key]==='string'?data[key].slice(0,fields[key].maxLength):'';
      clearPreview();
      update();
      if(fields.period.value==='month'&&Object.hasOwn(discounts,data.discount))fields.discount.value=data.discount;
      fields.yearPack.checked=data.yearPack===true;
      fields.addon.value=rates[fields.rate.value].addons.includes(data.addon)?data.addon:'';
      update();
      status.textContent='已恢复草稿。';
    } catch { status.textContent='草稿无法读取。'; }
  };
  update();
}
