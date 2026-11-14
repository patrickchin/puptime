// Local/private owner handoff only. This never starts authentication itself.
// Instrumented aacd JS on an explicitly attested original or compatible host.
// Neither mode qualifies an unmodified or current release.
// Private0600 JSON: {origin,provider,email,protectedEmails,protectedAccountIds:[]}.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {closeSync,cpSync,existsSync,mkdirSync,openSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {nativeSnapshot} from './native-account-evidence.mjs';
import {createProductionAuthFence} from './production-auth-fence.mjs';

const source='aacd58fd0a7102a629b92dbf8813496870aec21c',digest='2e889cd3b6eea1b0ce5b878665a8d259af002a68f54e1f77a3bdf7cf13003865',app='com.patrickchin.puptime';
const [mode,configFile,hostInput,proofInput,destination]=process.argv.slice(2),compatible=mode==='--prepare-compatible-private';
assert.ok(['--prepare-private','--prepare-compatible-private'].includes(mode),'Usage: MODE PRIVATE_CONFIG [ORIGINAL_NEWER_OUTER_ZIP INSPECTION_JSON | COMPATIBLE_HOST BUILD_MANIFEST] FRESH_PRIVATE_DIRECTORY');
assert.ok(configFile&&hostInput&&proofInput&&destination);assert.notEqual(process.env.GITHUB_ACTIONS,'true','Production owner handoff must never run in public CI.');
const command=(binary,args,options={})=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:[options.input===undefined?'ignore':'pipe','pipe','pipe'],...options}).trim();
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const simctl=(...args)=>command('xcrun',['simctl',...args]);
const plist=path=>JSON.parse(command('plutil',['-convert','json','-o','-',path]));
assert.equal(statSync(configFile).mode&0o077,0,'Private identity configuration must be0600.');
const config=JSON.parse(readFileSync(configFile,'utf8'));createProductionAuthFence(config);
assert.equal(config.origin,'https://puptime.pages.dev','Use the existing deployed app service, with no custom auth origin.');
const output=resolve(destination);assert.ok(!existsSync(output),'Use a new private output directory.');mkdirSync(output,{recursive:true,mode:0o700});
assert.equal(statSync(output).mode&0o077,0);assert.ok(!output.startsWith(resolve('.')+'/'),'Keep private configuration, bundle and inventory outside the repository.');
let device,server,timer,settled=false,before,ready=false,configReads=0,overlayHost,phase='host-attestation';
let finish;const completion=new Promise(resolveCompletion=>{finish=resolveCompletion;});
const fail=()=>{if(settled)return;settled=true;save(join(output,'result.json'),{status:'failed',phase,scope:'Private instrumented production-auth inventory; see private local evidence only.'});finish(false);};
process.on('SIGINT',fail);process.on('SIGTERM',fail);
async function main(){
 assert.equal(command('git',['status','--porcelain','--','scripts/production-auth-fence.mjs','scripts/prepare-ios-production-auth-inventory.mjs']),'','Freeze the exact test source before preparing owner handoff.');
 let original,provenance;
 if(compatible){
  const manifest=JSON.parse(readFileSync(proofInput,'utf8')),cut='160c02ebce322e82df39d2c74a7e8f0748426891';
  assert.equal(manifest.runtimeCut,cut);assert.equal(manifest.buildComplete,true);original=resolve(hostInput);
  assert.equal(manifest.hostBinarySha256,'6ffa697d93f1b1ae2f838e1b7cc59f8e3bb20f81d7883fc30640237ec3d1df52');
  assert.equal(hash(join(original,'Puptime.debug.dylib')),manifest.hostBinarySha256);
  assert.equal(command('git',['diff','--name-only',cut,source,'--','package.json','package-lock.json','plugins','patches','src/cloud/auth.native.ts','src/cloud/google-native.ts','src/cloud/apple-native.ts']),'','Compatible host requires identical packages/plugins/auth SDK adapters.');
  const nativeConfig=revision=>{const value=JSON.parse(command('git',['show',revision+':app.json']));delete value.expo.android;delete value.expo.web;for(const plugin of value.expo.plugins??[])if(Array.isArray(plugin)&&plugin[0]==='expo-notifications')delete plugin[1].color;return value;};
  assert.deepEqual(nativeConfig(cut),nativeConfig(source),'No other iOS/native configuration delta is permitted.');
  const symbols=command('nm',['-U',join(original,'Puptime.debug.dylib')],{maxBuffer:128*1024*1024});
  for(const module of ['RNGoogleSignin','ExpoSecureStore','ExpoAppleAuthentication','ExpoCrypto','ExpoSQLite'])assert.ok(symbols.includes(module));
  provenance={mode:'compatible160-native-host',runtimeSource:cut,clientSource:source,manifestSHA256:hash(proofInput),nativeImplementationSHA256:hash(join(original,'Puptime.debug.dylib')),nativeExecutableSHA256:hash(join(original,'Puptime')),javaScriptSHA256:existsSync(join(original,'main.jsbundle'))?hash(join(original,'main.jsbundle')):null,limits:'Local Debug SDK host with old icon/resources; explicitly not original aacd, store build, current audio-free candidate or release qualification.'};
 }else{
  const inspection=JSON.parse(readFileSync(proofInput,'utf8'));
  assert.equal(inspection.status,'passed');assert.equal(inspection.stage,'archive-inspection');assert.equal(inspection.upgradeExecuted,false);
  provenance=inspection.runtimes.find(cut=>cut.runHeadSource===source);assert.ok(provenance);
  assert.equal(provenance.artifact,14029395865);assert.equal(provenance.run,43383649287);assert.equal(provenance.outerSHA256,digest);
  assert.equal(provenance.actualCheckoutSource,source);assert.equal(provenance.runEvent,'push');assert.equal(provenance.runBranch,'main');
  assert.equal(hash(hostInput),digest,'Use exact original archived app bytes.');
  const extracted=join(output,'original');mkdirSync(extracted,{mode:0o700});command('unzip',['-q',resolve(hostInput),'-d',extracted]);
  const inner=join(extracted,'Puptime-iOS-Simulator.zip');assert.equal(hash(inner),provenance.innerSHA256);command('ditto',['-x','-k',inner,join(extracted,'host')]);original=join(extracted,'host/Puptime.app');
 }
 const info=plist(join(original,'Info.plist')),binary=join(original,info.CFBundleExecutable);
 command('codesign',['--verify','--deep','--strict',original]);assert.equal(info.CFBundleIdentifier,app);assert.equal(info.CFBundleShortVersionString,'1.12.0');assert.equal(info.CFBundleVersion,'1');
 assert.equal(hash(binary),provenance.nativeExecutableSHA256);if(provenance.javaScriptSHA256)assert.equal(hash(join(original,'main.jsbundle')),provenance.javaScriptSHA256);
 assert.match(command('lipo',['-archs',binary]),/\barm64\b/);assert.match(command('xcrun',['vtool','-show-build',binary]),/platform\s+IOSSIMULATOR/);
 const slices=new Map(),arm64=path=>{if(command('lipo',['-archs',path])==='arm64')return path;if(!slices.has(path)){const thin=join(output,'arm64-'+hash(path));command('lipo',[path,'-thin','arm64','-output',thin]);assert.equal(command('lipo',['-archs',thin]),'arm64');slices.set(path,thin);}return slices.get(path);};
 const sectionBytes=(path,section)=>{const thin=arm64(path),metadata=command('otool',['-l',thin]).split('Section').find(value=>new RegExp('sectname\\s+'+section+'\\s').test(value)&&/segname\s+__TEXT\s/.test(value));assert.ok(metadata);const size=parseInt(metadata.match(/\bsize\s+0x([a-f0-9]+)/i)[1],16),offset=Number(metadata.match(/\boffset\s+(\d+)/)[1]),bytes=readFileSync(thin);assert.ok(size>0&&offset+size<=bytes.length);return bytes.subarray(offset,offset+size);};
 const nativeSection=(path,section)=>createHash('sha256').update(sectionBytes(path,section)).digest('hex');
 const capabilities=JSON.parse(command('plutil',['-convert','json','-o','-','-'],{input:sectionBytes(binary,'__entitlements').toString('utf8').replace(/\0+$/,'')}));
 if(compatible)assert.equal(capabilities['application-identifier'],'FAKETEAMID.'+app);else assert.deepEqual(capabilities,provenance.entitlements.embedded);
 assert.ok(capabilities['application-identifier'].endsWith('.'+app));assert.deepEqual(capabilities['com.apple.security.application-groups'],['group.'+app]);assert.equal(info.ExpoWidgetsAppGroupIdentifier,'group.'+app);
 const googleSource=command('git',['show',source+':src/cloud/google-native.ts']),googleClient=googleSource.match(/iosClientId:'([^']+)'/)[1];assert.ok(info.CFBundleURLTypes.some(entry=>entry.CFBundleURLSchemes.includes(googleClient.split('.').reverse().join('.'))));
 const codeFile=compatible?'Puptime.debug.dylib':info.CFBundleExecutable,textSHA=nativeSection(join(original,codeFile),'__text'),capabilitySHA=nativeSection(binary,'__entitlements'),checkout=join(output,'source');mkdirSync(checkout,{mode:0o700});
 command('git',['archive','--format=tar','--output='+join(output,'source.tar'),source]);command('tar',['-xf',join(output,'source.tar'),'-C',checkout]);
 const authPath=join(checkout,'src/cloud/auth.native.ts'),authOriginal=readFileSync(authPath,'utf8');
 assert.ok(readFileSync(join(checkout,'.env'),'utf8').includes('EXPO_PUBLIC_CLOUD_API_URL='+config.origin));
 const nonce=randomBytes(32).toString('hex');
 function snapshot(){
  const data=simctl('get_app_container',device,app,'data'),db=new DatabaseSync(join(data,'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{db.exec('BEGIN');const rows=nativeSnapshot(db);assert.deepEqual(rows.events,[]);assert.deepEqual(rows.local_sync_owner,[]);assert.deepEqual(rows.local_sync_outbox,[]);db.exec('COMMIT');return rows;}finally{db.close();}
 }
 server=createServer(async(req,res)=>{
  try{
   if(compatible&&req.method==='GET'&&req.url==='/status'){res.end('packager-status:running');return;}
   if(compatible&&req.method==='GET'&&req.url?.split('?')[0]==='/.expo/.virtual-metro-entry.bundle'&&overlayHost){res.setHeader('content-type','application/javascript');res.end(readFileSync(join(overlayHost,'main.jsbundle')));return;}
   if(compatible&&req.method==='GET'&&req.url?.startsWith('/assets/')&&overlayHost){const path=resolve(overlayHost,'.'+decodeURIComponent(req.url.split('?')[0]));if(path.startsWith(overlayHost+'/assets/')&&existsSync(path)&&statSync(path).isFile()){res.end(readFileSync(path));return;}}
   if(req.url!==('/'+nonce+'/config')&&req.url!==('/'+nonce+'/receipt')){res.writeHead(404);res.end();return;}
   if(req.method==='GET'&&req.url.endsWith('/config')){configReads++;res.setHeader('content-type','application/json');res.end(JSON.stringify(config));return;}
   if(req.method!=='POST'||!req.url.endsWith('/receipt')){res.writeHead(405);res.end();return;}
   let body='';for await(const part of req){body+=part;if(body.length>65536)throw new Error('Bound private receipt.');}
   const receipt=JSON.parse(body);save(join(output,'auth-inventory-private.json'),receipt);res.end('{}');
   if(receipt.blocked||receipt.failure){fail();return;}
   if(receipt.inventory&&!settled){
    assert.ok(ready,'No authentication during preparation.');settled=true;
    setTimeout(()=>{try{simctl('terminate',device,app);assert.deepEqual(snapshot(),before,'Authentication must preserve every native row exactly.');save(join(output,'result.json'),{status:'passed',scope:'Instrumented aacd full-app JS on '+(compatible?'compatible160 Debug native host':'original aacd native host')+' against production; authentication and account-summary inventory only. Every identity/count/detail remains private; no activity writes or destructive testing authorized.',inventoryStatus:receipt.inventory.status,nativeTablesPreserved:true,cloudDataMutationAllowed:false,provider:config.provider});finish(true);}catch{settled=false;fail();}},50);
   }
  }catch{if(!res.headersSent)res.writeHead(400);res.end();fail();}
 });
 await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
 const callback='http://127.0.0.1:'+server.address().port+'/'+nonce;
 cpSync(resolve('scripts/production-auth-fence.mjs'),join(checkout,'src/cloud/qa-production-fence.mjs'));
 writeFileSync(join(checkout,'src/cloud/qa-production-auth.ts'),`import {fetch as rawFetch} from 'expo/fetch';
import {createProductionAuthFence} from './qa-production-fence.mjs';
const base=${JSON.stringify(callback)};
const fence=rawFetch(base+'/config').then(response=>response.json()).then(config=>createProductionAuthFence(config));
const report=async value=>{await rawFetch(base+'/receipt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value.receipt())});};
export async function inventoryFetch(input,options){const value=await fence;let request;
 try{request=value.authorize(input,options);}catch{await report(value);throw new Error('Production inventory request blocked.');}
 let response;try{response=await rawFetch(input,{...options,redirect:'error',credentials:'omit'});}catch{value.observe(request,0,null);await report(value);throw new Error('Production authentication transport failed.');}
 let payload;try{payload=await response.clone().json();}catch{value.nonJson(request,response.status);await report(value);throw new Error('Production inventory response rejected.');}
 try{value.observe(request,response.status,payload);}catch{await report(value);throw new Error('Production inventory identity rejected.');}
 await report(value);if(value.receipt().failure||value.receipt().inventory)throw new Error('Production inventory stopped; awaiting private verification.');return response;}
export function fencedGoogle(sdk){return {configure:options=>sdk.configure(options),signIn:async()=>{const value=await fence;try{value.beforeGoogle();}catch{await report(value);throw new Error('Production provider selection rejected.');}let response;try{response=await sdk.signIn();}catch{value.providerFailure();await report(value);throw new Error('Production native provider did not complete.');}try{value.googleNative(response);}catch{await report(value);throw new Error('Production identity selection rejected.');}await report(value);return response;}};}
export function denyNativeAction(){void fence.then(async value=>{try{value.denySocket();}catch{}await report(value);}).catch(()=>{});throw new Error('Production native action blocked.');}
`,{mode:0o600});
 const replacements=[
  ["import { fetch as expoFetch } from 'expo/fetch';","import {inventoryFetch as expoFetch,fencedGoogle,denyNativeAction} from './qa-production-auth';"],
  ["createGoogleIdTokenRequest(GoogleSignin)","createGoogleIdTokenRequest(fencedGoogle(GoogleSignin))"],
  ["new NativeSocket(url,[],options)","denyNativeAction()"],
  ["signIn:nonce=>AppleAuthentication.signInAsync(","signIn:nonce=>denyNativeAction("],
 ];
 let patched=authOriginal;for(const [from,to]of replacements){assert.equal(patched.split(from).length,2,'Overlay must match exact original source once.');patched=patched.replace(from,to);}writeFileSync(authPath,patched,{mode:0o600});
 const env={...process.env,CI:'1',EXPO_NO_DOTENV:'1',EXPO_PUBLIC_CLOUD_API_URL:config.origin};for(const key of Object.keys(env))if(key.startsWith('EXPO_PUBLIC_')&&key!=='EXPO_PUBLIC_CLOUD_API_URL')delete env[key];
 phase='dependency-install';command('npm',['ci'],{cwd:checkout,env,timeout:600000,maxBuffer:5*1024*1024});
 const host=join(output,'instrumented/Puptime.app');overlayHost=host;mkdirSync(join(output,'instrumented'),{mode:0o700});cpSync(original,host,{recursive:true});
 phase='bundle-export';command('node',['node_modules/expo/bin/cli','export:embed','--entry-file','index.ts','--platform','ios','--dev','false','--bytecode','--reset-cache','--max-workers','2','--bundle-output',join(host,'main.jsbundle'),'--assets-dest',host],{cwd:checkout,env,timeout:600000,maxBuffer:5*1024*1024});
 command('codesign',['--force','--deep','--sign','-',host]);command('codesign',['--verify','--deep','--strict',host]);
 assert.equal(nativeSection(join(host,codeFile),'__text'),textSHA,'The overlay changes JS/signing only, never native compiled code.');
 assert.equal(nativeSection(join(host,info.CFBundleExecutable),'__entitlements'),capabilitySHA,'Keep original embedded native capabilities.');assert.deepEqual(plist(join(host,'Info.plist')),info);
 const runtime=JSON.parse(simctl('list','runtimes','-j')).runtimes.filter(value=>value.isAvailable&&value.identifier.includes('iOS-26')).at(-1);assert.ok(runtime);
 phase='native-install';assert.ok(!settled,'Preparation was cancelled.');device=simctl('create','Puptime Private Auth Inventory '+Date.now(),'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',runtime.identifier);
 simctl('boot',device);command('xcrun',['simctl','bootstatus',device,'-b'],{timeout:300000});simctl('install',device,host);
 const flow=join(output,'prepare-guest.yaml');writeFileSync(flow,`appId: ${app}\n---\n- launchApp:\n${compatible?'    arguments:\n      RCT_jsLocation: '+JSON.stringify('127.0.0.1:'+server.address().port)+'\n':''}    permissions:\n      notifications: deny\n- runFlow: ${JSON.stringify(join(checkout,'.maestro/helpers/skip-onboarding.yaml'))}\n- assertVisible:\n    id: screen.today\n- runFlow: ${JSON.stringify(join(checkout,'.maestro/helpers/open-account.yaml'))}\n- assertVisible:\n    id: account.google\n`,{mode:0o600});
 assert.ok(command('git',['show',source+':src/components/AccountSignIn.tsx']).includes('testID="account.google"'));
 // Keep the event loop free: the owned app must read its private gate config
 // from this process while Maestro navigates the unauthenticated guest UI.
 phase='guest-navigation';await new Promise((resolveDriver,reject)=>{
  const fd=openSync(join(output,'guest-setup-private.log'),'wx',0o600),child=spawn(process.env.MAESTRO_BIN??'maestro',['--device',device,'test',flow,'--test-output-dir',join(output,'guest-setup')],{stdio:['ignore',fd,fd],env:{...env,MAESTRO_CLI_NO_ANALYTICS:'1',MAESTRO_DRIVER_STARTUP_TIMEOUT:'180000'}});
  const bound=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Guest setup exceeded its bound.'));},600000);
  let driverError;child.once('error',error=>{driverError=error;});child.once('close',code=>{clearTimeout(bound);closeSync(fd);code===0&&!driverError?resolveDriver():reject(new Error('Guest setup failed.'));});
 });
 assert.ok(!settled,'No authentication or rejected operation is permitted during preparation.');assert.ok(configReads>0,'Prove the owned app loaded this exact hard-fenced overlay before handoff.');before=snapshot();save(join(output,'native-before-private.json'),before);ready=true;phase='private-owner-handoff';
 save(join(output,'ready-private.json'),{status:'ready-awaiting-private-owner-handoff',device,source,driverSource:command('git',['rev-parse','HEAD']),nativeHost:provenance,capabilities,googleClient,originalAuthSourceSHA256:createHash('sha256').update(authOriginal).digest('hex'),overlayAuthSourceSHA256:hash(authPath),fenceSourceSHA256:hash(resolve('scripts/production-auth-fence.mjs')),originalJavaScriptSHA256:provenance.javaScriptSHA256,overlayJavaScriptSHA256:hash(join(host,'main.jsbundle')),nativeTextSHA256:textSHA,nativeCapabilitySHA256:capabilitySHA,scope:'Instrumented aacd full app; no authentication started; not original/current release qualification.'});
 console.log('Prepared dedicated simulator and Account view for private owner handoff. No authentication was started.');
 timer=setTimeout(fail,30*60*1000);return await completion;
}
let passed=false;try{passed=await main();}catch{fail();}finally{clearTimeout(timer);server?.closeAllConnections();server?.close();if(device)try{simctl('delete',device);}catch{/* Only this fresh owned device. */}}
if(!passed){console.error('Private production inventory did not complete; no public auth details were recorded.');process.exitCode=1;}
