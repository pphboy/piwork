import {readFile,writeFile,copyFile,mkdir,cp} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),out=dirname(fileURLToPath(import.meta.url));
await mkdir(out+'/public',{recursive:true});
const files=['apps/ui-shared/tokens.css','apps/ui-shared/controls.css','apps/desktop-webui/public/style.css'];
let css='';const sources=[];
for(const file of files){const data=await readFile(resolve(root,file));css+=data+'\n';sources.push({file,sha256:createHash('sha256').update(data).digest('hex')});}
await writeFile(out+'/public/style.css',css);
await copyFile(resolve('apps/ui-shared/assets/piwork-logo.png'),out+'/public/piwork-logo.png');
for(const name of ['browser-crypto.js','i18n.js','boot.js','read-deadline.js','notices.js','feedback-primitives.js','startup-shell.js'])await copyFile(resolve('apps/ui-shared',name),out+'/browser/'+name);
await cp(resolve('apps/desktop-webui/src/i18n'),out+'/browser/i18n',{recursive:true});
const marked=resolve('node_modules/marked/lib/marked.esm.js');
await copyFile(marked,out+'/browser/marked.js');
await copyFile(out+'/browser/app.js',out+'/browser/app-original.js');
await writeFile(out+'/sources.json',JSON.stringify({purpose:'Temporary prototype; real Desktop frontend plus synthetic API; no Core connection',revision:11,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources},null,2));
console.log('Prepared exact shared styles and current compiled Desktop modules in ignored dist.');
