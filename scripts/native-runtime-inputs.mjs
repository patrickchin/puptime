// Read-only source/native inspection; temporary arm64 slices use the caller's scratch directory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,closeSync,cpSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,readSync,rmSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

// Lifecycle source preparation changes compiled code even at the same package version.
export const nativeHostInputs=['package.json','package-lock.json','app.json','app.config.*','eas.json','.npmrc','plugins','patches','assets','ios','scripts/prepare-sqlite-engine.mjs','src/font-icon-notices.json','src/android-software-notices.json'];

const command=(binary,args)=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const inside=(root,path)=>{const name=relative(root,path);return name===''||name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name);};
const regularFiles=root=>readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>relative(root,join(entry.parentPath??entry.path,entry.name))).sort();

export function historicalSourceFiles(source){
 assert.match(source,/^[a-f0-9]{40}$/);
 return Object.fromEntries(command('git',['ls-tree','-rz',source]).split('\0').filter(Boolean).flatMap(row=>{
  const match=row.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s);assert.ok(match,'Reject unsupported historical source modes.');
  const name=match[3];assert.ok(!isAbsolute(name)&&!name.split('/').includes('..'));
  // Exclude even example dotenv files BEFORE archive extraction, not afterward.
  if(name.split('/').some(part=>part==='owner.env'||part==='.env'||part.startsWith('.env.')))return [];
  return [[name,{mode:match[1],blobSHA1:match[2]}]];
 }));
}
export function archiveHistoricalSource(source,sourceRoot,archive){
 const files=historicalSourceFiles(source);assert.ok(Object.keys(files).length>0);
 mkdirSync(sourceRoot,{mode:0o700});const fd=openSync(archive,'wx',0o600);
 try{execFileSync('git',['--literal-pathspecs','archive','--format=tar',source,'--',...Object.keys(files)],{timeout:120000,stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
 try{command('tar',['-xf',archive,'-C',sourceRoot]);}finally{rmSync(archive,{force:true});}
 chmodSync(sourceRoot,0o700);assertArchivedSource(sourceRoot,files);return files;
}

export function assertRuntimeZip(path,kind){
 assert.ok(['baseline','host','inner'].includes(kind));
 // Validate bounded public CI inputs before either unzip or ditto can write paths.
 command('python3',['-c',String.raw`import pathlib,posixpath,stat,sys,zipfile
path,kind=sys.argv[1:]
assert pathlib.Path(path).stat().st_size<=80*1024*1024
with zipfile.ZipFile(path) as z:
 items=z.infolist();names=[i.filename for i in items]
 assert len(items)<=10000 and len(names)==len(set(names))
 if kind!='inner':
  assert sorted(names)==sorted(['Puptime-iOS-Simulator.zip']+(['upgrade-baseline.json'] if kind=='baseline' else []))
  assert all(i.file_size<=(16384 if i.filename.endswith('.json') else 80*1024*1024) for i in items)
 assert sum(i.file_size for i in items)<=512*1024*1024
 for i in items:
  p=pathlib.PurePosixPath(i.filename);mode=i.external_attr>>16
  assert not p.is_absolute() and '..' not in p.parts and '\\' not in i.filename and not i.flag_bits&1
  assert i.compress_type in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED)
  assert stat.S_IFMT(mode) in (0,stat.S_IFREG,stat.S_IFDIR,stat.S_IFLNK)
  if kind=='inner':
   assert p.parts and p.parts[0] in ('Puptime.app','__MACOSX')
   if stat.S_ISLNK(mode):
    assert i.file_size<=4096
    target=z.read(i).decode('utf8');resolved=pathlib.PurePosixPath(posixpath.normpath(posixpath.join(str(p.parent),target)))
    assert not pathlib.PurePosixPath(target).is_absolute() and '..' not in pathlib.PurePosixPath(target).parts and resolved.parts[0]=='Puptime.app' and '..' not in resolved.parts
  else: assert not stat.S_ISLNK(mode)
 assert z.testzip() is None
`,path,kind]);
}

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
