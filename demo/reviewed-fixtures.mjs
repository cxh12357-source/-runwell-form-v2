import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import plans from './reviewed/business-3-metadata.json' with {type:'json'};
import ai from './reviewed/business-ai-metadata.json' with {type:'json'};
import guarantee from './reviewed/business-guarantee-metadata.json' with {type:'json'};

export async function loadReviewedFixtures(folder) {
  const found=new Map(), hashes=new Map(Object.entries({...plans,...ai,...guarantee}).map(([k,v])=>[v.sha256,k]));
  for (const file of await readdir(folder,{recursive:true,withFileTypes:true})){
    if(!file.isFile() || !file.name.endsWith('.docx') || file.name.startsWith('~')) continue;
    const bytes=await readFile(join(file.parentPath,file.name));
    const key=hashes.get(createHash('sha256').update(bytes).digest('hex'));
    if(key)found.set(key,bytes);
  }
  return found;
}
