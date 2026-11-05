import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createCarrier } from './carrier.mjs';

const parser = new DOMParser({
  onError() { throw new Error('Word 文件的 XML 无法读取。'); }
});
const serializer = new XMLSerializer();

export const privateCarrier = createCarrier({
  parse: xml => parser.parseFromString(xml, 'application/xml'),
  serialize: doc => serializer.serializeToString(doc)
});
