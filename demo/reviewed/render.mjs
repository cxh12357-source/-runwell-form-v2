import sax from 'sax';
import { unzipSync, zipSync } from 'fflate';
import { businessCatalog } from './business-catalog.mjs';
import plans from './business-3-metadata.json' with {type:'json'};
import ai from './business-ai-metadata.json' with {type:'json'};
import guarantee from './business-guarantee-metadata.json' with {type:'json'};
import { fillReviewedBusiness3 } from './business-3-bridge.mjs';
import { fillBusinessAi } from './business-ai-bridge.mjs';
import { fillGuarantee } from './business-guarantee.mjs';

const specs={...plans,...ai,...guarantee};
const dependencies={sax,unzipSync,zipSync};
export const reviewedCatalog=businessCatalog.filter(({id})=>Object.hasOwn(specs,id));
export const reviewedLimit=10_000_000;

export async function identifyReviewed(bytes) {
  if(!bytes.length || bytes.length>reviewedLimit) return null;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return reviewedCatalog.find(plan=>specs[plan.id].sha256===hash) || null;
}

export async function renderReviewed(id,bytes,values) {
  if(!Object.hasOwn(specs,id)) throw new Error('请选择已核验的原表。');
  if(!(bytes instanceof Uint8Array) || !bytes.length || bytes.length>reviewedLimit) throw new Error('请选择 10 MB 以内的 Word 原表。');
  if(Object.hasOwn(guarantee,id)){
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==guarantee[id].sha256) throw new Error('原表未通过哈希校验。请选择该版未经修改的空白 Word 原表。');
    return fillGuarantee(bytes,values,dependencies);
  }
  return Object.hasOwn(ai,id)?fillBusinessAi(id,bytes,values,dependencies):fillReviewedBusiness3(id,bytes,values,dependencies);
}
