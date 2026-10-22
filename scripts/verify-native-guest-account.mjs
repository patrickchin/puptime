// Real native SDK + local Better Auth/D1/DO. No session injection or sync mocks.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer,request} from 'node:http';
import {createServer as secureServer,request as secureRequest} from 'node:https';
import {connect} from 'node:net';
import {cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {eventSqlColumns,eventDataFromSql} from '../src/record-sql.ts';
import {localRecordId} from '../src/cloud/record-identity.ts';

const [platform,device,host,consent,destination='build/guest-account-'+platform]=process.argv.slice(2);
assert.ok(['ios','android'].includes(platform));
const android=platform==='android';
assert.equal(consent,'--replace-synthetic','Use PLATFORM DEVICE HOST --replace-synthetic [OUTPUT].');
const app='com.patrickchin.puptime',output=resolve(destination),front='https://127.0.0.1:8797';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const adb=(...args)=>execFileSync('adb',['-s',device,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if(android){assert.match(adb('emu','avd','name'),/^Puptime_Onboarding_2f17/);assert.ok(existsSync(host),'Supply a debuggable native APK.');}
else{
  const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
  assert.match(devices.find(item=>item.udid===device)?.name??'',/^Puptime (2f17 Onboarding|Onboarding CI)/);
  assert.ok(existsSync(join(host,'Info.plist')),'Supply a current native simulator host.');
  assert.ok(execFileSync('otool',['-arch','arm64','-s','__TEXT','__entitlements',join(host,'Puptime')],{encoding:'utf8'}).includes('Contents of (__TEXT,__entitlements)'),
    'Build the simulator host with CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- so SecureStore has its simulator entitlements.');
}
mkdirSync(output,{recursive:true});
const privateDir=mkdtempSync(join(tmpdir(),'puptime-2f17-account-')),persist=join(privateDir,'state'),configPath=join(privateDir,'wrangler.json');
const config={...JSON.parse(readFileSync('wrangler.jsonc','utf8')),name:'puptime-2f17-account',main:resolve('server/index.ts'),env:undefined,
  vars:{ENVIRONMENT:'local',AUTH_BASE_URL:front,WEB_ORIGINS:front,AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID()}};
config.d1_databases=config.d1_databases.map(db=>({...db,migrations_dir:resolve(db.migrations_dir)}));
writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
let worker,proxy,cookie='',code='',auth;
const requests=new Set(),restoreNative=[];
let certificate;
const codes=new Set(),checks=[];
function run(binary,args,env=process.env,cwd=process.cwd()){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(binary,args,{env,cwd,stdio:['ignore','pipe','pipe']});let raw='';
    child.stdout.on('data',data=>{raw+=data;});child.stderr.on('data',data=>{raw+=data;});
    const timer=setTimeout(()=>child.kill('SIGTERM'),240000);
    child.once('error',reject);child.once('close',status=>{clearTimeout(timer);if(status===0)resolveRun(raw);else{
      for(const value of codes)raw=raw.replaceAll(value,'[REDACTED]');
      writeFileSync(join(output,'failure-redacted.log'),raw,{mode:0o600});reject(new Error(`${binary} failed (${status}); see redacted log.`));
    }});
  });
}
async function flow(name,env={}){
  const startup=join(homedir(),'.maestro/tests'),before=new Set(existsSync(startup)?readdirSync(startup):[]);
  const artifacts=join(privateDir,'maestro-'+name+'-'+Date.now());
  try{
    await run('maestro',['--device',device,'test',...Object.entries({TEST_EMAIL:email,...env}).flatMap(([key,value])=>['-e',`${key}=${value}`]),resolve('.maestro/account-preservation',name+'.yaml'),'--test-output-dir',artifacts],
      {...process.env,MAESTRO_CLI_NO_ANALYTICS:'1',TEST_EMAIL:email,MAESTRO_TEST_CODE:code,...env});
    if(name==='reopen')for(const path of readdirSync(artifacts,{recursive:true}).filter(path=>String(path).endsWith('recovered-account-history.png')))
      cpSync(join(artifacts,path),join(output,'recovered-account-history.png'));
    console.log('PASS native account phase: '+name);
  }finally{
    if(existsSync(startup))for(const directory of readdirSync(startup).filter(value=>!before.has(value))){
      const root=join(startup,directory);
      for(const file of readdirSync(root,{recursive:true}).filter(file=>String(file).endsWith('maestro.log'))){
        const path=join(root,file);let text=readFileSync(path,'utf8');
        if(!text.includes(resolve('.maestro/account-preservation',name+'.yaml')))continue;
        for(const value of codes)text=text.replaceAll(value,'[REDACTED]');writeFileSync(path,text);
      }
    }
    rmSync(artifacts,{recursive:true,force:true});
  }
}
const email='native-'+crypto.randomUUID()+'@example.invalid';
const androidSnapshot=join(privateDir,'android-snapshot');
function sqliteDirectory(){
  if(!android)return join(simctl('get_app_container',device,app,'data'),'Documents/SQLite');
  // Stop the disposable app before copying SQLite/WAL, so the snapshot is stable.
  // Every subsequent UI phase reopens the actual account destination.
  adb('shell','am','force-stop',app);rmSync(androidSnapshot,{recursive:true,force:true});mkdirSync(androidSnapshot);
  try{adb('shell','run-as',app,'test','-f','files/SQLite/puptime-v2.db');}catch{return join(androidSnapshot,'files/SQLite');}
  const archive=execFileSync('adb',['-s',device,'exec-out','run-as',app,'tar','-cf','-','files/SQLite'],{stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
  execFileSync('tar',['-xf','-','-C',androidSnapshot],{input:archive,stdio:['pipe','ignore','pipe']});
  return join(androidSnapshot,'files/SQLite');
}
const database=()=>new DatabaseSync(join(sqliteDirectory(),'puptime-v2.db'),{readOnly:true});
function snapshot(){const db=database();try{return {
  events:db.prepare(`SELECT id,${eventSqlColumns.join(',')} FROM events ORDER BY id`).all().map(row=>({...row})),
  owner:db.prepare('SELECT * FROM local_sync_owner').all(),pending:db.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n,
};}finally{db.close();}}
async function remote(){
  assert.ok(cookie,'Use the actual SDK session observed by the local proxy.');
  const page=await new Promise((resolvePage,reject)=>{
    const req=secureRequest(front+'/api/sync/pull?after=0',{...(certificate?{ca:certificate}:{}),headers:{cookie,origin:front}},response=>{
      let body='';response.on('data',data=>{body+=data;});response.on('end',()=>{try{assert.equal(response.statusCode,200);resolvePage(JSON.parse(body));}catch(error){reject(error);}});
    });req.on('error',reject);req.end();
  });assert.equal(page.hasMore,false);
  return page.changes.filter(record=>record.kind==='event'&&!record.deleted).sort((a,b)=>localRecordId(a)<localRecordId(b)?-1:localRecordId(a)>localRecordId(b)?1:0);
}
async function assertCloud(events){
  const rows=await remote();assert.equal(rows.length,events.length);
  assert.deepEqual(rows.map(record=>({id:localRecordId(record),...record.data})),events.map(row=>({id:row.id,...eventDataFromSql(row)})));
  assert.ok(rows.every(row=>row.revision===1),'Rejoining must not rewrite existing logs.');
  return rows;
}
async function signIn(){
  const before=snapshot();await flow('request');
  code=auth.prepare('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC LIMIT 1').get(email)?.code;
  assert.match(code??'',/^\d{6}$/);codes.add(code);await flow('verify');code='';
  assert.deepEqual(snapshot(),before,'Sign-in itself must preserve every event and wait for explicit backup confirmation.');
}
const childEnv={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'};
try{
  // Own both ports; never attach to another task's backend or account.
  for(const port of [8797,8799])await new Promise((resolveProbe,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolveProbe));});
  if(android){adb('install','-r',resolve(host));adb('shell','run-as',app,'id');}
  else try{simctl('terminate',device,app);}catch{}
  const old=sqliteDirectory();
  if(existsSync(join(old,'puptime-v2.db'))){
    const prior=database();try{assert.equal(prior.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Do not replace another account fixture.');}finally{prior.close();}
    cpSync(old,join(privateDir,'previous-synthetic-sqlite'),{recursive:true});
  }
  await run('npx',['wrangler','d1','migrations','apply','AUTH_DB','--local','--config',configPath,'--persist-to',persist],childEnv);
  worker=spawn('npx',['wrangler','dev','--local','--ip','127.0.0.1','--port','8799','--config',configPath,'--persist-to',persist],{env:childEnv,stdio:['ignore','pipe','pipe'],detached:true});
  worker.stdout.resume();worker.stderr.resume();
  for(let attempt=0;attempt<160;attempt++){try{if((await fetch('http://127.0.0.1:8799/health')).ok)break;}catch{}await new Promise(resolveWait=>setTimeout(resolveWait,250));}
  const keyPath=join(privateDir,'localhost.key'),certPath=join(privateDir,'localhost.crt'),rootPath=join(privateDir,'root.crt'),rootKey=join(privateDir,'root.key'),csr=join(privateDir,'localhost.csr');
  if(!android)simctl('keychain',device,'reset');
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',rootKey,'-out',rootPath,'-days','1','-subj','/CN=Puptime fixture CA','-addext','basicConstraints=critical,CA:TRUE']);
  await run('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',csr,'-subj','/CN=localhost']);
  const extensions=join(privateDir,'server.cnf');writeFileSync(extensions,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n');
  await run('openssl',['x509','-req','-in',csr,'-CA',rootPath,'-CAkey',rootKey,'-CAcreateserial','-out',certPath,'-days','1','-extfile',extensions]);
  certificate=readFileSync(rootPath);if(!android)simctl('keychain',device,'add-root-cert',rootPath);
  const forward=(req,res)=>{
    requests.add(req.url);
    if(req.headers.cookie)cookie=req.headers.cookie;
    const outgoing=request('http://127.0.0.1:8799'+req.url,{method:req.method,headers:req.headers},incoming=>{res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);});
    outgoing.on('error',()=>{res.writeHead(502);res.end();});req.pipe(outgoing);
  };
  proxy=secureServer({key:readFileSync(keyPath),cert:Buffer.concat([readFileSync(certPath),certificate])},forward);
  proxy.on('tlsClientError',error=>writeFileSync(join(output,'fixture-tls-error.txt'),error.message));
  proxy.on('upgrade',(req,socket,head)=>{
    const upstream=connect(8799,'127.0.0.1',()=>{
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([key,value])=>`${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
    });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
  });
  await new Promise(resolveProxy=>proxy.listen(8797,'127.0.0.1',resolveProxy));
  for(const file of readdirSync(join(persist,'v3/d1'),{recursive:true}).filter(file=>String(file).endsWith('.sqlite'))){
    const db=new DatabaseSync(join(persist,'v3/d1',file),{readOnly:true});
    if(db.prepare("SELECT name FROM sqlite_master WHERE name='local_email_previews'").get()){auth=db;break;}db.close();
  }
  assert.ok(auth);
  if(android){
    adb('reverse','tcp:8797','tcp:8797');
    assert.ok(process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT,'Set ANDROID_HOME for the isolated native fixture build.');
    assert.equal(resolve(host),resolve('android/app/build/outputs/apk/debug/app-debug.apk'));
    // Expo's embedded Debug host does not load Metro. Build its normal release JS
    // against HTTPS, trusting only this temporary CA in the Debug source set.
    const manifest=resolve('android/app/src/debug/AndroidManifest.xml'),gradle=resolve('android/app/build.gradle');
    const trust=resolve('android/app/src/debug/res/xml/puptime_fixture_security.xml'),root=resolve('android/app/src/debug/res/raw/puptime_fixture_ca.pem');
    for(const path of [manifest,gradle,trust,root]){
      execFileSync('git',['check-ignore','-q',path]);
      restoreNative.push([path,existsSync(path)?readFileSync(path):null]);
    }
    assert.ok(!readFileSync(manifest,'utf8').includes('networkSecurityConfig'),'Do not replace another native trust configuration.');
    writeFileSync(manifest,readFileSync(manifest,'utf8').replace('<application ','<application android:networkSecurityConfig="@xml/puptime_fixture_security" '));
    mkdirSync(resolve('android/app/src/debug/res/xml'),{recursive:true});mkdirSync(resolve('android/app/src/debug/res/raw'),{recursive:true});
    writeFileSync(trust,'<network-security-config><base-config><trust-anchors><certificates src="system"/><certificates src="@raw/puptime_fixture_ca"/></trust-anchors></base-config></network-security-config>');
    cpSync(rootPath,root);
    if(!/debuggableVariants\s*=\s*\[\s*\]/.test(readFileSync(gradle,'utf8')))
      writeFileSync(gradle,readFileSync(gradle,'utf8').replace('react {','react {\n    debuggableVariants = []'));
    const nativeEnv={...childEnv,EXPO_PUBLIC_CLOUD_API_URL:front};
    const embedded=resolve('android/app/build/generated/assets/react/debug/index.android.bundle');
    await run('node',['node_modules/expo/bin/cli','export:embed','--entry-file','index.ts','--platform','android','--dev','false','--reset-cache','--max-workers','2','--bundle-output',embedded,'--assets-dest',resolve('android/app/build/generated/res/react/debug')],nativeEnv);
    assert.ok(readFileSync(embedded,'utf8').includes(front),'Embed the fixture HTTPS address, never the production API.');
    const init=join(privateDir,'embedded-fixture.gradle');
    writeFileSync(init,"gradle.projectsEvaluated { def app = gradle.rootProject.findProject(':app'); if (app != null) app.tasks.named('createBundleDebugJsAndAssets').configure { onlyIf { false } } }\n");
    await run('./gradlew',[':app:assembleDebug','--init-script',init,'--no-daemon','--stacktrace'],nativeEnv,resolve('android'));
    adb('install','-r',resolve(host));
    console.log('PASS isolated Android HTTPS native build');
  }else{
  const bundle=join(privateDir,'Puptime.app');cpSync(host,bundle,{recursive:true});
  await run('node',['node_modules/expo/bin/cli','export:embed','--entry-file','index.ts','--platform','ios','--dev','false','--bytecode','--max-workers','2','--bundle-output',join(bundle,'main.jsbundle'),'--assets-dest',bundle],
    {...process.env,EXPO_PUBLIC_CLOUD_API_URL:front});
  await run('codesign',['--force','--deep','--sign','-',bundle]);
  simctl('install',device,bundle);
  }
  await flow('prepare');assert.equal(snapshot().events.length,0);
  assert.ok(requests.has('/api/config'),'The real app must reach this isolated backend before any sign-in attempt.');
  await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});const guest=snapshot();assert.equal(guest.events.length,12);assert.equal(guest.owner.length,0);
  assert.ok(guest.events.some(event=>event.note==='Saved before and after sign-in'));
  await signIn();await flow('enable',{EXPECTED_COUNT:'12'});assert.equal(snapshot().pending,0);assert.equal(snapshot().owner.length,1);await assertCloud(guest.events);
  const owner=snapshot().owner[0].account_id;
  checks.push('12 real guest logs keep their IDs and bodies through SDK sign-in and explicit cloud enrollment');
  await flow('add-logs',{BATCHES:'1',EXPECTED_COUNT:'15'});await flow('wait-synced');
  const signed=snapshot();assert.equal(signed.events.length,15);await assertCloud(signed.events);
  await flow('sign-out');assert.deepEqual(snapshot().events,signed.events);assert.equal(snapshot().owner.length,0);
  checks.push('3 signed-in logs automatically sync; sign-out keeps all 15 local and remote logs');
  await flow('add-logs',{BATCHES:'2',EXPECTED_COUNT:'21'});const combined=snapshot();assert.equal(combined.events.length,21);
  await signIn();await flow('enable',{EXPECTED_COUNT:'21'});assert.deepEqual(snapshot().events,combined.events);assert.equal(snapshot().pending,0);
  assert.equal(snapshot().owner[0].account_id,owner);
  const cloudBefore=await assertCloud(combined.events);
  checks.push('6 more guest logs merge into the existing account without duplicates or revisions to the original logs');
  await flow('sign-out');cpSync(sqliteDirectory(),join(privateDir,'source-before-recovery'),{recursive:true});
  await flow('prepare');assert.equal(snapshot().events.length,0,'Recovery starts from an empty local database.');
  await signIn();await flow('enable',{EXPECTED_COUNT:'21'});
  assert.equal(snapshot().owner[0].account_id,owner);
  assert.deepEqual(snapshot().events,combined.events,'Recover every original ID, timestamp, type and optional field.');assert.equal(snapshot().pending,0);
  assert.deepEqual(await remote(),cloudBefore,'Restoring must not mutate the remote event records.');
  await flow('reopen',{EXPECTED_COUNT:'21'});assert.deepEqual(snapshot().events,combined.events);assert.equal(snapshot().pending,0);
  checks.push('all 21 logs restore into an empty database and survive cold restart, with no remote mutation or outbound backlog');
  rmSync(join(output,'failure-redacted.log'),{force:true});
  writeFileSync(join(output,'verification.json'),JSON.stringify({status:'passed',checks,scope:android?'Android Debug native host with normal embedded release JS and isolated local HTTPS Better Auth/D1/SQLite DO; actual native email SDK and Keystore. Its temporary CA is trusted only in the ignored Debug source set, restored after the run. Production onboarding is tested separately in the Release APK. No real email, production account, session injection or mocked sync.':'Release bundle and actual native email SDK with isolated local HTTPS Better Auth/D1/SQLite DO. Simulator trusts the fixture certificate. No real email, production account, session injection or mocked sync.'},null,2)+'\n');
  console.log('PASS guest account preservation and empty-device recovery: '+output);
}finally{
  auth?.close();proxy?.close();for(const child of [worker])if(child?.pid)try{process.kill(-child.pid,'SIGTERM');}catch{}
  if(android)try{adb('reverse','--remove','tcp:8797');}catch{}
  for(const [path,original] of restoreNative.reverse())if(original===null)rmSync(path,{force:true});else writeFileSync(path,original);
  // Retain only isolated synthetic state for failures; no auth data in public evidence.
}
