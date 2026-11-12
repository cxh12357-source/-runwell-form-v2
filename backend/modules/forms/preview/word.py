"""Small, deliberately restricted DOCX interchange for synthetic local fixtures."""
import base64
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
XML = "http://www.w3.org/XML/1998/namespace"
ET.register_namespace("w", W)
TAG = re.compile(r"\{\{([A-Za-z][A-Za-z0-9_]{0,47})\}\}")
TYPES = f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
RELS = f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="{OFFICE}" Target="word/document.xml"/></Relationships>'
REQUIRED = {"[Content_Types].xml", "_rels/.rels", "word/document.xml"}
# Office editors may add metadata and defaults during a round trip. Only the
# validated document body is exported; ancillary parts are never forwarded.
OPTIONAL = {"docProps/app.xml", "docProps/core.xml", "word/settings.xml", "word/styles.xml",
            "word/stylesWithEffects.xml", "word/webSettings.xml", "word/fontTable.xml",
            "word/theme/theme1.xml", "word/_rels/document.xml.rels", "word/numbering.xml"}
MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
ALLOWED = set("document body p pPr r rPr t b i u sz szCs rFonts jc spacing ind keepNext keepLines tbl tblPr tblW tblGrid gridCol tr trPr tc tcPr tcW tblBorders top left bottom right insideH insideV tblLayout vAlign gridSpan sectPr pgSz pgMar cols docGrid lang color position noProof qFormat cantSplit trHeight tblCellMar tblInd pBdr".split())


def require(ok, message):
    if not ok:
        raise ValueError(message)


def word(tag):
    return f"{{{W}}}{tag}"


def put(parent, tag, **attrs):
    return ET.SubElement(parent, word(tag), {word(k): str(v) for k, v in attrs.items()})


def paragraph(parent, text, size=22, bold=False):
    p = put(parent, "p")
    put(put(p, "pPr"), "spacing", after=100)
    r = put(p, "r")
    style = put(r, "rPr")
    put(style, "rFonts", ascii="Arial", eastAsia="宋体")
    if bold:
        put(style, "b")
    put(style, "sz", val=size)
    put(r, "t").text = text


def sample(labels):
    root = ET.Element(word("document"))
    body = put(root, "body")
    paragraph(body, "商务专线新装申请表", 36, True)
    paragraph(body, "联调样表　仅用于虚构资料验收", 20)
    for key, label in labels.items():
        if key in ("cash_mark", "collection_mark"):
            continue
        paragraph(body, label + "　{{" + key + "}}")
    paragraph(body, "付款方式　{{cash_mark}} 现金　　 {{collection_mark}} 托收")
    section = put(body, "sectPr")
    put(section, "pgSz", w=11906, h=16838)
    put(section, "pgMar", top=1200, bottom=1200, left=1440, right=1440)
    return root


def parse_xml(raw):
    data = raw.decode("utf-8-sig")
    content = re.sub(r"^\s*<\?xml\s+[^?]*\?>", "", data, count=1)
    require("<!" not in content and "<?" not in content, "不支持此 XML 声明或内容。")
    return ET.fromstring(data)


def read_doc(encoded):
    raw = base64.b64decode(encoded, validate=True)
    require(0 < len(raw) <= 524288, "模板文件须小于等于 512 KiB。")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        names = {e.filename for e in entries}
        require(len(names) == len(entries) and REQUIRED <= names <= REQUIRED | OPTIONAL,
                "只支持基础 DOCX，请移除图片、宏、附件和其他扩展部件。")
        require(sum(e.file_size for e in entries) <= 1048576 and
                all(not e.flag_bits & 1 and e.compress_type in (0, 8) for e in entries),
                "模板展开过大、加密或压缩格式不支持。")
        types = parse_xml(archive.read("[Content_Types].xml"))
        require(types.tag == f"{{{CT}}}Types" and
                [n.get("ContentType") for n in types if n.get("PartName") == "/word/document.xml"] == [MIME]
                and all("macro" not in n.get("ContentType", "").lower() for n in types),
                "不支持此 Word 内容类型。")
        office_links = []
        for path in ("_rels/.rels", "word/_rels/document.xml.rels"):
            if path not in names:
                continue
            rels = parse_xml(archive.read(path))
            require(rels.tag == f"{{{REL}}}Relationships", "模板关系不合法。")
            for link in rels:
                target = link.get("Target", "")
                require(link.tag == f"{{{REL}}}Relationship" and not link.get("TargetMode") and
                        target and ":" not in target and target.lstrip("/") in
                        {part.removeprefix("word/") if path.startswith("word/") else part for part in names},
                        "不接受外链或未知部件。")
                if path == "_rels/.rels" and link.get("Type") == OFFICE:
                    office_links.append(target)
        require(office_links == ["word/document.xml"], "模板缺少主文档关系。")
        root = parse_xml(archive.read("word/document.xml"))
    require(root.tag == word("document") and len(root) == 1 and root[0].tag == word("body"), "缺少 Word 正文。")
    nodes = list(root.iter())
    require(len(nodes) <= 10000, "模板结构过大。")
    paragraphs = set(root.iter(word("p")))
    text_nodes = set(root.iter(word("t")))
    require(paragraphs and {t for p in paragraphs for r in p.findall(word("r")) for t in r.findall(word("t"))}
            == text_nodes, "文本只能出现在受支持的段落和文字单元。")
    for n in nodes:
        for key in list(n.attrib):
            if key in {"{http://schemas.openxmlformats.org/markup-compatibility/2006}Ignorable",
                       "{http://schemas.microsoft.com/office/word/2010/wordml}paraId",
                       "{http://schemas.microsoft.com/office/word/2010/wordml}textId"}:
                del n.attrib[key]
        require(n.tag.startswith("{" + W + "}") and n.tag.split("}")[1] in ALLOWED and
                all(k.startswith("{" + W + "}") or k == f"{{{XML}}}space" for k in n.attrib),
                "模板含有不支持的内容。")
        if n.tag == word("t"):
            require(not len(n), "文本节点格式错误。")
        else:
            require(not (n.text or "").strip(), "请将文字放在 Word 文本节点。")
        require(not (n.tail or "").strip(), "模板含有不支持的正文。")
    return root


def fill(root, mapping, values):
    found = set()
    # Work at paragraph level so Word may split a placeholder across text runs.
    for p in root.iter(word("p")):
        nodes = list(p.iter(word("t")))
        fragments = [n.text or "" for n in nodes]
        combined = "".join(fragments)
        matches = list(TAG.finditer(combined))
        remainder = TAG.sub("", combined)
        require("{{" not in remainder and "}}" not in remainder, "占位符格式错误。")
        starts = []
        total = 0
        for fragment in fragments:
            starts.append(total)
            total += len(fragment)
        for m in reversed(matches):
            key = m.group(1)
            require(key in mapping, "占位符没有配置映射。")
            found.add(key)
            if values is None:
                continue
            for i in range(len(nodes) - 1, -1, -1):
                a, b = max(0, m.start() - starts[i]), min(len(fragments[i]), m.end() - starts[i])
                if a < b:
                    old = nodes[i].text or ""
                    insert = values[key] if starts[i] + a == m.start() else ""
                    nodes[i].text = old[:a] + insert + old[b:]
                    nodes[i].set(f"{{{XML}}}space", "preserve")
    require(found == set(mapping), "Word 占位符与字段映射不一致。")


def pack(root):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as doc:
        doc.writestr("[Content_Types].xml", TYPES)
        doc.writestr("_rels/.rels", RELS)
        doc.writestr("word/document.xml", ET.tostring(root, encoding="utf-8", xml_declaration=True))
    return base64.b64encode(stream.getvalue()).decode("ascii")


def main():
    args = json.load(sys.stdin.buffer)
    root = read_doc(args["file"]) if "file" in args else sample(args["labels"])
    fill(root, args["mapping"], args.get("values"))
    print(json.dumps({"file": pack(root)}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, UnicodeError, ET.ParseError, OSError, RuntimeError,
            zipfile.BadZipFile, RecursionError, OverflowError) as err:
        message = str(err) if isinstance(err, ValueError) and any(ord(c) > 127 for c in str(err)) else "Word 模板无效或含有不支持的内容。"
        print(json.dumps({"error": message}))
