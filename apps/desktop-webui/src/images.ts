export interface ImageInput { mimeType: 'image/png'|'image/jpeg'|'image/webp'; data: string }
export interface DraftImage { id: string; name: string; url: string; bytes: number; input?: ImageInput; reading: boolean }
export interface HistoryImage { imageIndex: number; mimeType: string; byteSize: number; sha256: string }
export class ImageDrafts {
  private drafts = new Map<string,DraftImage[]>();
  private generation = 0;
  private owners=new Map<string,string>();
  constructor(private changed:()=>void) {}
  get(key:string) { return this.drafts.get(key) ?? []; }
  move(from:string,to:string) { if(from===to)return; const images=this.drafts.get(from); if(images?.length && !this.get(to).length){this.drafts.set(to,images);this.drafts.delete(from);for(const image of images)this.owners.set(image.id,to);} }
  remove(key:string,id:string) { key=this.owners.get(id) ?? key;const images=this.get(key); const image=images.find(i=>i.id===id);if(image)URL.revokeObjectURL(image.url);this.owners.delete(id);this.drafts.set(key,images.filter(i=>i.id!==id));this.changed(); }
  clear() {this.generation++;for(const images of this.drafts.values())for(const image of images)URL.revokeObjectURL(image.url);this.drafts.clear();this.owners.clear();}
  capture(key:string):Array<DraftImage & {input:ImageInput}> {const images=this.get(key);if(images.some(i=>i.reading))throw new Error('Images are still being checked.');return images as Array<DraftImage & {input:ImageInput}>;}
  consume(key:string,snapshot:DraftImage[]) {for(const image of snapshot)if(this.owners.has(image.id))this.remove(key,image.id);}
  async add(key:string,files:File[],current:()=>boolean):Promise<string[]> {
    const errors:string[]=[],generation=this.generation;
    for(const file of files) {
      if(generation!==this.generation || !current())break;
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)){errors.push(`${file.name}: Use PNG, JPEG or WebP.`);continue;}
      const existing=this.get(key);
      if(file.size===0 || file.size>5*1024**2 || existing.length>=4 || existing.reduce((n,i)=>n+i.bytes,0)+file.size>10*1024**2){errors.push(`${file.name}: Up to 4 images, 5 MiB each and 10 MiB total.`);continue;}
      const item:DraftImage={id:crypto.randomUUID(),name:file.name||'Pasted image',bytes:file.size,url:URL.createObjectURL(file),reading:true};
      this.drafts.set(key,[...existing,item]);this.owners.set(item.id,key);this.changed();
      try {
        const buffer=await file.arrayBuffer();
        checkDimensions(file.type,new Uint8Array(buffer));
        const preview=await createImageBitmap(file);preview.close();
        if(generation!==this.generation || !current() || !this.get(this.owners.get(item.id) ?? key).includes(item)){this.remove(key,item.id);continue;}
        let raw='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
        item.input={mimeType:file.type as ImageInput['mimeType'],data:btoa(raw)};item.reading=false;this.changed();
      }catch {this.remove(key,item.id);if(generation===this.generation && current())errors.push(`${item.name}: The image is invalid or exceeds 8192 pixels per side / 40 million pixels.`);}
    }
    return errors;
  }
}
function checkDimensions(mime:string,b:Uint8Array) {
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength);let width=0,height=0;
 if(mime==='image/png' && b.length>=33 && v.getUint32(0)===0x89504e47){width=v.getUint32(16);height=v.getUint32(20);}
 else if(mime==='image/jpeg' && b[0]===255 && b[1]===216){let p=2;while(p+4<=b.length){if(b[p++]!==255)break;while(b[p]===255)p++;const marker=b[p++];const n=v.getUint16(p);if(n<2||p+n>b.length)break;if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=n;}}
 else if(mime==='image/webp' && b.length>=20 && v.getUint32(0)===0x52494646 && v.getUint32(8)===0x57454250){let p=12;while(p+8<=b.length){const tag=v.getUint32(p),n=v.getUint32(p+4,true),d=p+8;if(d+n>b.length)break;if(tag===0x56503820&&n>=10){width=v.getUint16(d+6,true)&16383;height=v.getUint16(d+8,true)&16383;break;}if(tag===0x5650384c&&n>=5){const x=v.getUint32(d+1,true);width=(x&16383)+1;height=((x>>>14)&16383)+1;break;}if(tag===0x56503858&&n===10){width=1+b[d+4]+(b[d+5]<<8)+(b[d+6]<<16);height=1+b[d+7]+(b[d+8]<<8)+(b[d+9]<<16);break;}p=d+n+(n&1);}}
 if(!width||!height||width>8192||height>8192||width*height>40_000_000)throw new Error('Invalid image dimensions');
}
