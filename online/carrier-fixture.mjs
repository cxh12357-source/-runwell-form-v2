import { zipSync, strToU8 } from '../vendor/qa-fflate/browser.js';

// All template data is invented. Paragraph numbers match the two supported carrier layouts.
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const types = 'http://schemas.openxmlformats.org/package/2006/content-types';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/';
const escapeXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = s => '<w:r><w:t xml:space="preserve">' + escapeXml(s) + '</w:t></w:r>';

const labels = {
  1:'智云上海专线基础版（FTTR-B）套餐申请登记表（2026/A）',
  2:'企业全称', 3:'虚构样例企业', 4:'统一社会信用代码', 5:'TESTCOEXAMPLE',
  6:'企业所属行业', 7:'测试业', 8:'企业规模', 9:'■10人以下□10–30人□31–80人□81–200人□200人以上',
  10:'计算机数量', 11:'■5台以下□6–15台□16–40台□41–100台□100台以上',
  12:'安装地址', 13:'样例路一号', 14:'邮编', 15:'000001', 16:'经办人', 17:'样例甲',
  18:'身份证号码', 19:'000000000000000001', 20:'联系电话', 21:'10000000000',
  22:'经办人职务', 24:'E-MAIL', 25:'source@example.invalid', 26:'传真',
  28:'账单地址', 29:'■同公司地址', 30:'其它：', 31:'邮编', 32:'000002',
  33:'付款方式', 34:'托收银行账号：', 35:'■现金', 36:'基础套餐申请信息',
  39:'■拨号100M/100M（688元/月/线）□拨号100M/100M（6880元/年/线）',
  40:'□拨号100M/100M（11880元/2年/线）', 41:'套餐类型', 42:'■纯新装宽带□在用宽带：____',
  44:'□订购主设备', 46:'□订购插件', 49:'□订购1线',
};

const may = {
  71:'□订购收费从设备', 72:'数量：____', 74:'□200M月付□200M年付', 75:'□300M月付□300M年付', 76:'□500M月付□500M年付',
  98:'经办人身份证号码：{{id_number}}', 109:'  年  月  日',
  248:'{{security_name}} {{security_role}} {{security_phone}}', 273:'授权委托书',
  276:'{{company_name}} {{extra_credit_code}} {{service_type}} {{application_type}} {{service_use}} {{contact_name}} {{id_number}}',
  280:'____，____，____，____', 285:'  年  月  日', 294:'  年  月  日',
};

const octoberFields = {
  29:'同公司地址', 35:'现金', 45:'智企硬盘黄金版', 46:'□开通20人/1TB', 73:'商企全光网从设备',
  74:'□订购收费从设备', 75:'数量：____', 76:'上行升速包', 77:'□200M月付□200M年付', 78:'□300M月付□300M年付', 79:'□500M月付□500M年付',
  101:'经办人身份证号码：000000000000000001', 112:'  年  月  日', 255:'信息安全责任人', 256:'姓名  职务  电话：',
  281:'授权委托书', 284:'甲方  信用代码  业务  属性  用途  姓名  身份证  证号',
  287:'____，____，____，____', 292:'  年  月  日', 301:'  年  月  日',
};

const logo = '<w:r><w:drawing><wp:inline><wp:extent cx="100000" cy="100000"/>'
  + '<wp:docPr id="1" name="测试标记"/><a:graphic><a:graphicData uri="' + drawing + 'picture">'
  + '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="标记"/><pic:cNvPicPr/></pic:nvPicPr>'
  + '<pic:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
  + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm>'
  + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvesAAAAASUVORK5CYII='), ch => ch.charCodeAt(0));
const list = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
const section = '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/>'
  + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
const contentTypes = '<Types xmlns="' + types + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
  + Object.entries({document:'document.main', numbering:'numbering', header1:'header', footer1:'footer'}).map(([part,kind]) =>
    '<Override PartName="/word/' + part + '.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + kind + '+xml"/>').join('')
  + '</Types>';
const rel = (id, kind, target) => '<Relationship Id="rId' + id + '" Type="' + office + '/' + kind + '" Target="' + target + '"/>';
const rels = links => '<Relationships xmlns="' + relationships + '">' + links.join('') + '</Relationships>';
const numbering = '<w:numbering xmlns:w="' + word + '"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">'
  + '<w:numFmt w:val="bullet"/><w:lvlText w:val="■"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

export function makeCarrierFixture({october=false, legalNote='虚构条款', image=png}={}) {
  const cells = Object.assign(Array(october ? 303 : 296).fill(''), labels, october ? octoberFields : may, {87:legalNote});
  const numbered = october ? [29,30,34,35] : [30,34];
  const paragraphs = cells.map((value,index) => '<w:p>' + (numbered.includes(index) ? list : '') + (index===0 ? logo : run(value)) + '</w:p>');
  const cell = p => '<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>' + p + '</w:tc>';
  const table = '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>'
    + '<w:tr>' + cell(paragraphs[2]) + cell(paragraphs[3]) + '</w:tr></w:tbl>';
  const body = paragraphs.slice(0,2).join('') + table + paragraphs.slice(4).join('') + section;
  const source = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rels([rel(1,'officeDocument','word/document.xml')]),
    'word/_rels/document.xml.rels': rels([rel(1,'numbering','numbering.xml'), rel(2,'header','header1.xml'), rel(3,'footer','footer1.xml'), rel(4,'image','media/image1.png')]),
    'word/document.xml': '<w:document xmlns:w="' + word + '" xmlns:r="' + office + '" xmlns:a="' + drawing + 'main" xmlns:pic="' + drawing + 'picture" xmlns:wp="'
      + drawing + 'wordprocessingDrawing"><w:body>' + body + '</w:body></w:document>',
    'word/header1.xml': '<w:hdr xmlns:w="' + word + '"><w:p>' + run('虚构样例企业') + '</w:p></w:hdr>',
    'word/footer1.xml': '<w:ftr xmlns:w="' + word + '"><w:p><w:fldSimple w:instr=" PAGE ">' + run('1') + '</w:fldSimple></w:p></w:ftr>',
    'word/numbering.xml': numbering,
  };
  const entries = Object.fromEntries(Object.entries(source).map(([path,xml]) => [path,strToU8(xml)]));
  entries['word/media/image1.png'] = image;
  return zipSync(entries, {level:6});
}
