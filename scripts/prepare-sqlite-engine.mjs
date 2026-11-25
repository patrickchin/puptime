// SDK 57 maintenance: official SQLite 3.51.3 with Expo's symbol renaming.
// This minimum fixed-source candidate still needs native/upgrade qualification.
// Source: https://sqlite.org/2026/sqlite-amalgamation-3510300.zip (C SHA3 32d5424f97e0a7fc5ed2f6335afbb58be4e0298bd7117a34e39d345ff13d859e).
// Renamer: expo/expo@968a9dcec304789b2ccc1a41ef5d301938e91478/packages/expo-sqlite/scripts/replace_symbols.ts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

assert.equal(process.argv.length,2,'The SQLite preparer takes no arguments.');
const root=fileURLToPath(new URL('../',import.meta.url));
function regular(name){
 let path=root;
 const parts=name.split('/');
 for(const [index,part] of parts.entries()){
  path=join(path,part);const stat=lstatSync(path);
  assert.ok(index===parts.length-1?stat.isFile():stat.isDirectory(),'Expected a regular SQLite build input: '+name);
 }
 assert.ok(lstatSync(path).size<=12*1024*1024,'SQLite build input exceeds its bound.');
 return path;
}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const sqlite='node_modules/expo-sqlite/';
const pkg=JSON.parse(readFileSync(regular(sqlite+'package.json'),'utf8'));
assert.equal(pkg.name,'expo-sqlite');assert.equal(pkg.version,'57.0.5','Review a new SQLite package before preparing its engine.');
const patch=regular('patches/expo-sqlite-57.0.5-sqlite-3.51.3.patch');
assert.equal(hash(patch),'0d28a6a6ca062445452b3e96c14d99d69b5fdaf71a545862ff9491250d89bd62','SQLite patch bytes changed.');
const files=[
 {name:'sqlite3.c',before:'df16f4f2845488289d416e1d3b928c82ade5256564605b762daf0113fad394c5',after:'abc152fd93810c76628dcf415e66e6cdd3182ce1ede4f45a5ea8c64b83dc1dfe'},
 {name:'sqlite3.h',before:'0d247fd5e5e2fd602f427227bae7bf6349dd3322d6090d9751b21b5b3f51db62',after:'1be81cbb8a2cc6d943cd9f15f48001aa14073bcba750d8b475e0f7892bfca606'},
].map(file=>({...file,path:regular(sqlite+'vendor/sqlite3/'+file.name)}));
const current=files.map(file=>hash(file.path));
if(!files.every((file,index)=>current[index]===file.after)){
 assert.ok(files.every((file,index)=>current[index]===file.before),'SQLite sources are partial or unknown; reinstall the reviewed package before retrying.');
 execFileSync('git',['apply','--whitespace=nowarn','--',patch],{cwd:root,stdio:['ignore','pipe','pipe'],timeout:30000});
 assert.ok(files.every(file=>hash(regular(sqlite+'vendor/sqlite3/'+file.name))===file.after),'Prepared SQLite sources do not match the reviewed engine.');
}
