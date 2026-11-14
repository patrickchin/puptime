// Read-only source/native inspection; temporary arm64 slices use the caller's scratch directory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {closeSync,cpSync,lstatSync,openSync,readFileSync,readdirSync,readSync,rmSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

const command=(binary,args)=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const inside=(root,path)=>{const name=relative(root,path);return name===''||name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name);};
const regularFiles=root=>readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>relative(root,join(entry.parentPath??entry.path,entry.name))).sort();

export function assertArchivedSource(root,expected){
 assert.ok(!readdirSync(root,{recursive:true,withFileTypes:true}).some(entry=>entry.isSymbolicLink()),'Historical sources cannot contain unverified symlinks.');
 assert.deepEqual(regularFiles(root),Object.keys(expected).sort(),'Inspect every historical source file, including unexpected additions.');
 for(const [name,value] of Object.entries(expected)){
  assert.ok(inside(root,resolve(root,name)),'Historical paths must stay in their owned source root.');
  const path=join(root,name),bytes=readFileSync(path);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),value.blobSHA1,'Extract the exact Git blob, never a substituted source file.');
  assert.equal(lstatSync(path).mode&0o111? '100755':'100644',value.mode,'Preserve historical executable modes.');
 }
}

export function nativeTextSection(loadCommands,fileBytes,name){
 const section=loadCommands.split('Section').find(value=>/^\s*sectname __text\s*$/m.test(value)&&/^\s*segname __TEXT\s*$/m.test(value));
 assert.ok(section,'Inspect compiled native code in every embedded Mach-O.');
 const size=parseInt(section.match(/^\s*size\s+0x([a-f0-9]+)\s*$/im)?.[1],16),offset=Number(section.match(/^\s*offset\s+(\d+)\s*$/m)?.[1]);
 assert.ok(Number.isSafeInteger(size)&&Number.isSafeInteger(offset)&&offset>=0&&offset+size<=fileBytes,'Native text must stay within the actual arm64 file.');
 // Xcode's two generated preview stubs have an empty section, not executable code.
 const preview=/^PlugIns\/(ExpoWidgetsTarget|PuptimeQuickLogNotification)\.appex\/__preview\.dylib$/.test(name);
 assert.ok(size>0||size===0&&preview,'Only the two known preview stubs may have empty native text.');
 return {size,offset};
}

export function nativeCodeFingerprint(host,scratchDirectory){
 const nativeCode={};
 for(const name of regularFiles(host)){
  const path=join(host,name),header=Buffer.alloc(4),fd=openSync(path,'r');
  try{readSync(fd,header,0,4,0);}finally{closeSync(fd);}
  if(!['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(header.toString('hex')))continue;
  const architecture=command('lipo',['-archs',path]);assert.match(architecture,/\barm64\b/);
  const thin=join(scratchDirectory,'native-'+Object.keys(nativeCode).length+'.arm64');
  if(architecture.trim()==='arm64')cpSync(path,thin);else command('lipo',[path,'-thin','arm64','-output',thin]);
  const bytes=readFileSync(thin),{size,offset}=nativeTextSection(command('otool',['-l',thin]),bytes.length,name);
  nativeCode[name]={fileSHA256:hash(path),arm64TextSHA256:createHash('sha256').update(bytes.subarray(offset,offset+size)).digest('hex'),arm64TextBytes:size,architecture};rmSync(thin);
 }
 return nativeCode;
}
