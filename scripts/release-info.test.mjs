import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {releaseInfoInputHash} from './release-info.mjs';
test('embedded release notes change the source input and invalid or duplicate entries fail locally',t=>{
 const base=mkdtempSync(join(tmpdir(),'piwork-release-notes-'));t.after(()=>rmSync(base,{recursive:true,force:true}));mkdirSync(join(base,'internal/releaseinfo'),{recursive:true});const path=join(base,'internal/releaseinfo/notes.json');const notes={version:'Unreleased',component:'core',title:'Changes',sections:[{title:'Fixes',items:['A fixed issue']}]};
 const write=value=>writeFileSync(path,JSON.stringify(value));write({version:1,releases:[notes]});const hash=releaseInfoInputHash(base);write({version:1,releases:[{...notes,title:'More changes'}]});assert.notEqual(releaseInfoInputHash(base),hash);
 for(const releases of [[notes,notes],[{...notes,sections:[]}],[{...notes,sections:[{title:'Fixes',items:['']}]}],[{...notes,component:'console'}],[{...notes,unknown:true}]]){write({version:1,releases});assert.throws(()=>releaseInfoInputHash(base));}
});
