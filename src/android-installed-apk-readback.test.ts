import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {createHash} from 'node:crypto';
import {constants,createReadStream,existsSync,fstatSync,fchmodSync,lstatSync,mkdirSync,openSync,closeSync,mkdtempSync,readFileSync,readdirSync,writeFileSync,chmodSync,rmSync,symlinkSync,linkSync,truncateSync,appendFileSync,type PathLike,type RmOptions} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Execute the real source functions with only the ADB/process boundary replaced.
const source=readFileSync(new URL('../scripts/verify-android-signing-upgrade.mjs',import.meta.url),'utf8');
const between=(start:string,end:string)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const helper=between('async function installedApkHash(){','\nasync function install(');
const install=between('async function install(','\nfunction snapshot(');
const hashing=between('async function fileHash(','\nfunction validateRun(');
const classifier=between('function installCommandFailure(','\nconst commandFailures=');
const assertionSite=between('function installAssertionSite(','\nfunction finiteFailure(');
const bytes=Buffer.from(Array.from({length:257},(_,i)=>i%256)),digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const remote='/data/app/~~synthetic/com.patrickchin.puptime-test/base.apk';
type Hooks={transfer?:(path:string)=>void;afterChmod?:(path:string)=>void;hashStart?:(path:string,fd?:number)=>void;hashError?:Error;closeError?:Error;cleanupError?:Error;packageOutput?:string};
function fixture(t:TestContext,hooks:Hooks={}){
 const root=mkdtempSync(join(tmpdir(),'puptime-apk-readback-test-'));chmodSync(root,0o700);t.after(()=>rmSync(root,{recursive:true,force:true}));
 const calls:Array<{binary:string;args:string[];options:unknown}>=[],closed:number[]=[],ranges:unknown[]=[];
 const command=(binary:string,args:string[],options?:unknown)=>{
  calls.push({binary,args:[...args],options});assert.equal(binary,'adb');assert.deepEqual(args.slice(0,4),['-s','emulator-5588','pull',remote]);assert.equal(options,undefined);
  const path=args[4];assert.equal(existsSync(path),false,'pull must receive an absent path in a fresh directory');assert.equal(lstatSync(join(path,'..')).mode&0o777,0o700);
  if(hooks.transfer)hooks.transfer(path);else writeFileSync(path,bytes);return 'PRIVATE progress and stderr are not file bytes';
 };
 const bindings={assert,fsConstants:constants,createHash,createReadStream:(path:PathLike,options?:Parameters<typeof createReadStream>[1])=>{
  if(typeof options==='object'&&options?.fd!==undefined)ranges.push({...options});
  hooks.hashStart?.(String(path),typeof options==='object'?options?.fd as number|undefined:undefined);if(hooks.hashError)throw hooks.hashError;return createReadStream(path,options);
 },fstatSync,fchmodSync:(fd:number,mode:number)=>{fchmodSync(fd,mode);hooks.afterChmod?.(calls.at(-1)!.args[4]);},lstatSync,openSync,closeSync:(fd:number)=>{closeSync(fd);closed.push(fd);if(hooks.closeError)throw hooks.closeError;},mkdtempSync,join,root,device:'emulator-5588',app:'com.patrickchin.puptime',command,
  adb:(...args:string[])=>{if(args[0]==='install')return 'Success';assert.deepEqual(args,['shell','pm','path','com.patrickchin.puptime']);return hooks.packageOutput??'package:'+remote+'\n';},
  rmSync:(path:PathLike,options?:RmOptions)=>{if(hooks.cleanupError)throw hooks.cleanupError;rmSync(path,options);}};
 const api=Function(...Object.keys(bindings),hashing+helper+install+'\nreturn {installedApkHash,install};')(...Object.values(bindings)) as {installedApkHash:()=>Promise<string>;install:(path:string,replace?:boolean)=>Promise<void>};
 return {root,calls,closed,ranges,...api};
}

test('installed APK pull hashes the file descriptor, ignores progress, and removes only its fresh directory',async t=>{
 let descriptor:number|undefined;const f=fixture(t,{hashStart:(_path,fd)=>{descriptor=fd;}}),input=join(f.root,'original-input.bin');writeFileSync(input,bytes);
 const stale=join(f.root,'apk-readback-stale');mkdirSync(stale);writeFileSync(join(stale,'keep'),'unchanged');
 assert.equal(await f.installedApkHash(),digest(bytes));assert.equal(f.calls.length,1);assert.equal(typeof descriptor,'number');assert.deepEqual(f.closed,[descriptor]);
 assert.deepEqual(f.ranges,[{fd:descriptor,autoClose:false,start:0,end:bytes.length-1}]);
 assert.throws(()=>fstatSync(descriptor!));assert.deepEqual(readFileSync(input),bytes);assert.equal(readFileSync(join(stale,'keep'),'utf8'),'unchanged');
 assert.deepEqual(readdirSync(f.root).sort(),['apk-readback-stale','original-input.bin']);
});

test('both actual installed-APK callers preserve strict digest equality and never retry a mismatch',async t=>{
 const f=fixture(t),input=join(f.root,'input.bin');writeFileSync(input,bytes);await f.install(input);await f.install(input,true);assert.equal(f.calls.length,2);
 const control='assert.equal(await installedApkHash(),oldSHA);';assert.equal(source.split(control).length,2);
 await (Object.getPrototypeOf(async function(){}).constructor)('assert','installedApkHash','oldSHA',control)(assert,f.installedApkHash,digest(bytes));
 const wrong=fixture(t,{transfer:path=>writeFileSync(path,Buffer.from('wrong generated bytes'))});let caught:unknown;
 try{await wrong.install(input);}catch(error){caught=error;}
 assert.ok(caught instanceof assert.AssertionError);assert.equal(caught.actual,digest(Buffer.from('wrong generated bytes')));assert.equal(caught.expected,digest(bytes));assert.equal(wrong.calls.length,1);
 const site=Function('regexpSource','regexpFlags','utilTypes',assertionSite+'return installAssertionSite;')(Object.getOwnPropertyDescriptor(RegExp.prototype,'source')!.get,[],{}) as (fields:PropertyDescriptorMap)=>string;
 assert.equal(site(Object.getOwnPropertyDescriptors(caught)),'installed-byte-hash');assert.equal(existsSync(wrong.calls[0].args[4]),false);assert.deepEqual(readFileSync(input),bytes);
});

test('the unchanged owned-root cleanup handles a partial transfer without replacing its original error',async t=>{
 for(const code of ['EIO','ETIMEDOUT']){
  const original=Object.assign(new Error('Synthetic transfer failure'),{code}),f=fixture(t,{transfer:path=>{writeFileSync(path,'partial generated bytes');throw original;}});
  await assert.rejects(f.installedApkHash(),error=>error===original);assert.equal(f.calls.length,1);assert.equal(existsSync(f.calls[0].args[4]),true);assert.deepEqual(f.closed,[]);
  const cleanup='if(stopped){rmSync(folder,{recursive:true});state.privateMaterialRemoved=true;}else state.privateMaterialRemoved=false;';assert.equal(source.split(cleanup).length,2);
  const state:{privateMaterialRemoved?:boolean}={};Function('stopped','rmSync','folder','state',cleanup)(false,rmSync,f.root,state);assert.equal(state.privateMaterialRemoved,false);assert.equal(existsSync(f.root),true);
  Function('stopped','rmSync','folder','state',cleanup)(true,rmSync,f.root,state);assert.equal(state.privateMaterialRemoved,true);assert.equal(existsSync(f.root),false);
 }
});

test('hash failure wins over secondary descriptor-close failure; success cleanup failures cannot return a digest',async t=>{
 const first=new Error('Synthetic hash failure'),secondary=new Error('Synthetic close failure'),failed=fixture(t,{hashError:first,closeError:secondary});
 await assert.rejects(failed.installedApkHash(),error=>error===first);assert.equal(failed.closed.length,1);assert.equal(existsSync(failed.calls[0].args[4]),true);
 for(const kind of ['close','remove'] as const){const error=new Error('Synthetic cleanup failure'),f=fixture(t,kind==='close'?{closeError:error}:{cleanupError:error});await assert.rejects(f.installedApkHash(),actual=>actual===error);assert.equal(f.closed.length,1);assert.equal(existsSync(f.calls[0].args[4]),true);}
});

test('missing, nonregular, linked and oversized output is refused before hashing or altering another file',async t=>{
 for(const kind of ['missing','directory','symlink','hardlink','oversized'] as const){
  let hashes=0,target='';const f=fixture(t,{hashStart:()=>{hashes++;},transfer:path=>{
   target=join(f.root,'unrelated.bin');writeFileSync(target,'unchanged');chmodSync(target,0o640);
   if(kind==='directory')mkdirSync(path);else if(kind==='symlink')symlinkSync(target,path);else if(kind==='hardlink')linkSync(target,path);else if(kind==='oversized'){writeFileSync(path,'');truncateSync(path,256*1024*1024+1);}
  }});
  await assert.rejects(f.installedApkHash());assert.equal(hashes,0);assert.equal(f.calls.length,1);assert.equal(readFileSync(target,'utf8'),'unchanged');assert.equal(lstatSync(target).mode&0o777,0o640);
 }
});

test('actual path and content changes during descriptor hashing fail closed',async t=>{
 for(const kind of ['chmod','append','replace','unlink'] as const){
  let once=false;const f=fixture(t,{afterChmod:path=>{if(kind==='chmod')appendFileSync(path,'changed');},hashStart:path=>{if(once)return;once=true;if(kind==='append')appendFileSync(path,'changed');else if(kind!=='chmod'){rmSync(path);if(kind==='replace')writeFileSync(path,bytes);}}});
  await assert.rejects(f.installedApkHash());assert.equal(f.calls.length,1);assert.equal(f.closed.length,1);
  if(kind==='chmod')assert.equal(once,false);
 }
});

test('invalid package-path output stops before directory allocation or transfer',async t=>{
 for(const output of ['', 'package:/private/base.apk', 'package:'+remote+'\npackage:'+remote]){const f=fixture(t,{packageOutput:output});await assert.rejects(f.installedApkHash());assert.deepEqual(f.calls,[]);assert.deepEqual(readdirSync(f.root),[]);}
});

test('the existing finite command kind recognizes only the new exact owned pull shape',()=>{
 const classify=Function('join','app',classifier+'return installCommandFailure;')(join,'com.patrickchin.puptime') as (binary:string,args:string[],result:unknown,phase:string,root:string)=>unknown;
 const root='/private/qa',path=join(root,'apk-readback-ABC123/base.apk'),args=['-s','emulator-5588','pull',remote,path],expected={commandKind:'installed-apk-readback',installCodeDecline:'not-install-command'};
 assert.deepEqual(classify('adb',args,{},'original-install',root),expected);
 for(const changed of [['-s','other','pull',remote,path],['-s','emulator-5588','exec-out','cat',remote],args.concat('extra'),args.slice(0,4).concat('/outside/base.apk'),args.slice(0,4).concat(path+'\n'),args.slice(0,4).concat(root+'/apk-readback-ABC123/../base.apk')])assert.deepEqual(classify('adb',changed,{},'original-install',root),{commandKind:'unrecognized',installCodeDecline:'not-install-command'});
 assert.equal(classify('adb',args,{},'permission-control-preservation',root),undefined);
 assert.ok(source.includes("timeout=120000,maxBuffer=256*1024*1024"));assert.equal(source.includes("hash(command('adb',['-s',device,'exec-out','cat',installed.slice(8)]"),false);
});
