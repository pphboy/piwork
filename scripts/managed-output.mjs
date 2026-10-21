// Transactional replacement of build-owned directories. Never remove arbitrary
// output paths or follow a symlink, including symlinked ancestors.
import {existsSync,lstatSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import {dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export function managedOutput(target,base=process.cwd()) {
 const root=resolve(base,'dist');target=resolve(base,target);
 const name=relative(root,target);
 if(!name || name.startsWith('..'+sep) || name==='..' || !['go','release','cli'].includes(name)) throw new Error('Output must be dist/go, dist/cli or dist/release');
 for(let path=target;path!==dirname(path);path=dirname(path)) {
  if(lstatSync(path,{throwIfNoEntry:false})?.isSymbolicLink())throw new Error('Output ancestors must not be symlinks');
 }
 mkdirSync(root,{recursive:true});
 return target;
}
export function recoverOutput(target) {
 const backup=target+'.previous';
 if(lstatSync(backup,{throwIfNoEntry:false})) {
  if(lstatSync(backup).isSymbolicLink())throw new Error('Unsafe output backup');
  if(existsSync(target))rmSync(backup,{recursive:true});else renameSync(backup,target);
 }
}
export function commitOutput(stage,target) {
 if(dirname(stage)!==dirname(target)||!stage.startsWith(target+'.stage-')||lstatSync(stage).isSymbolicLink())throw new Error('Invalid staging directory');
 recoverOutput(target);
 const backup=target+'.previous';
 if(existsSync(target))renameSync(target,backup);
 try {renameSync(stage,target);} catch(error) {if(existsSync(backup))renameSync(backup,target);throw error;}
 if(existsSync(backup))rmSync(backup,{recursive:true});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [action,output,stage]=process.argv.slice(2);
 const target=managedOutput(output);
 if(action==='prepare') {recoverOutput(target);process.stdout.write(target);}
 else if(action==='commit')commitOutput(resolve(stage),target);
 else throw new Error('Unknown managed output action');
}
