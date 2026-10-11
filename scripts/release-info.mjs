import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
export function releaseInfoInputHash(base) { const raw=readFileSync(join(base,'internal/releaseinfo/notes.json')); const catalog=JSON.parse(raw); const keys=new Set();
 const text=(value,max)=>typeof value==='string'&&value.trim()&&Buffer.byteLength(value)<=max;
 if(catalog.version!==1 || Object.keys(catalog).sort().join(',')!=='releases,version' || !Array.isArray(catalog.releases))throw new Error('Invalid release notes catalog.');
 for(const entry of catalog.releases){const key=entry.version+':'+entry.component;if(Object.keys(entry).some(key=>!['version','component','title','publishedAt','sections'].includes(key))||keys.has(key)||!text(entry.version,128)||!['core','desktop'].includes(entry.component)||!text(entry.title,256)||entry.publishedAt!==undefined&&(typeof entry.publishedAt!=='string'||Buffer.byteLength(entry.publishedAt)>64)||!Array.isArray(entry.sections)||!entry.sections.length||entry.sections.length>16||Buffer.byteLength(JSON.stringify(entry))>65536||entry.sections.some(section=>Object.keys(section).sort().join(',')!=='items,title'||!text(section.title,256)||!Array.isArray(section.items)||!section.items.length||section.items.length>128||section.items.some(item=>!text(item,8192))))throw new Error('Invalid or duplicate release notes.');keys.add(key);}
 return createHash('sha256').update(raw).digest('hex');
}
