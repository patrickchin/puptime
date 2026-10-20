// Isolated static website + genuine local Better Auth OTP/D1/DO acceptance.
// Private OTP entry is never recorded. Only external provider NAVIGATION is
// simulated; real provider callbacks are independently covered by Worker tests.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync,createReadStream,realpathSync,statSync} from 'node:fs';
import {join,resolve,extname,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PUPTIME_PLAYWRIGHT_MODULE??'playwright');
const root=realpathSync(process.cwd());
assert.equal(root,realpathSync(fileURLToPath(new URL('..',import.meta.url))),'Run from this script’s Puptime checkout root.');
assert.equal(JSON.parse(readFileSync('package.json','utf8')).name,'puptime');
const modes=process.argv.slice(2);assert.ok(modes.length<=1&&modes.every(value=>['--apple-deletion','--core-accounts'].includes(value)),'Use --apple-deletion or --core-accounts, or omit the mode for historical full qualification. No remote target is accepted.');
const appleDeletionOnly=modes.includes('--apple-deletion'),coreAccountsOnly=modes.includes('--core-accounts');
const front='http://127.0.0.1:8898',back='http://127.0.0.1:8798',directory=mkdtempSync(join(tmpdir(),'puptime-web-account-local-'));
const output=resolve(coreAccountsOnly?join('output/playwright/core-accounts',new Date().toISOString().replace(/[:.]/g,'-')):appleDeletionOnly?join('output/playwright/apple-deletion',new Date().toISOString().replace(/[:.]/g,'-')):'output/playwright/web-accounts');mkdirSync(output,{recursive:true});
const persist=join(directory,'persist'),configPath=join(directory,'wrangler.json');
const config={...JSON.parse(readFileSync('wrangler.jsonc','utf8')),name:'puptime-web-accounts-local',main:resolve('server/index.ts'),env:undefined,vars:{ENVIRONMENT:'local',AUTH_BASE_URL:front,WEB_ORIGINS:front,AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID(),GOOGLE_CLIENT_ID:'synthetic-google-client',GOOGLE_CLIENT_SECRET:'synthetic-google-secret',APPLE_CLIENT_ID:'synthetic-apple-client',APPLE_CLIENT_SECRET:'synthetic-apple-secret'}};
config.d1_databases=config.d1_databases.map(db=>({...db,migrations_dir:resolve(db.migrations_dir)}));writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
const childEnv={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'};
const cli=args=>execFileSync('npx',['wrangler',...args],{env:childEnv,stdio:['ignore','pipe','pipe']});
const summary=[],apiCalls=[],telemetry=[],privateCodes=new Set();let worker,browser,server,authPath,reviewPage,ip=20;
function sql(query){const path=join(directory,'private.sql');writeFileSync(path,query,{mode:0o600});try{cli(['d1','execute','AUTH_DB','--local','--config',configPath,'--persist-to',persist,'--file',path,'--json']);}finally{rmSync(path,{force:true});}}
function read(query,...params){const db=new DatabaseSync(authPath,{readOnly:true});try{return db.prepare(query).all(...params);}finally{db.close();}}
const code=email=>{const value=read('SELECT code FROM local_email_previews WHERE email=? ORDER BY expires_at DESC',email)[0]?.code;if(value)privateCodes.add(value);return value;};
const pass=value=>{summary.push(value);console.log('PASS',value);};
async function waitServer(){for(let count=0;count<160;count++){try{if((await fetch(back+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw new Error('Isolated Worker did not start.');}
async function context({analytics=false,...options}={}){
 // PostHog intentionally drops HeadlessChrome as a bot; use a normal desktop
 // UA and nonautomation navigator only for the isolated consent acceptance
 // case. Product SDK bot filtering remains enabled; no live ingestion is used.
 const value=await browser.newContext({...(analytics?{userAgent:`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`}:{}),extraHTTPHeaders:{'x-puptime-test-client':`198.51.100.${++ip}`},...options});
 if(analytics)await value.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));
 if(!analytics)await value.addInitScript(()=>localStorage.setItem('puptime.website.analytics','no'));
 await value.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==front){await route.abort();return;}
  if(url.pathname.startsWith('/telemetry/')){
   let body=route.request().postDataBuffer();if(body?.length){if(body[0]===31&&body[1]===139)body=gunzipSync(body);let raw=body.toString();if(raw.startsWith('data='))raw=Buffer.from(new URLSearchParams(raw).get('data'),'base64').toString();const data=JSON.parse(raw);telemetry.push(...(Array.isArray(data)?data:data.batch??[data]));}
   await route.fulfill({status:200,contentType:'application/json',body:'{"status":1}'});return;
  }await route.continue();
 });return value;
}
async function waitFor(check){for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(check(),'Expected local analytics request was not received.');}

async function signIn(page,email,wrongCode=false){
 await page.goto(front+'/account');await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByRole('button',{name:'Email me a code',exact:true}).click();
 await page.getByLabel('Email code',{exact:true}).waitFor();const privateCode=code(email);assert.match(privateCode??'',/^\d{6}$/);
 if(wrongCode){await page.getByLabel('Email code',{exact:true}).fill(privateCode==='000000'?'111111':'000000');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('alert').filter({hasText:'That code didn’t work'}).waitFor();assert.equal(await page.getByRole('button',{name:'Sign out',exact:true}).count(),0);pass('An invalid email code keeps the visitor signed out and allows correction.');}
 await page.getByLabel('Email code',{exact:true}).fill(privateCode);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
}

function coreSourceSnapshot(){
 const digest=value=>createHash('sha256').update(value).digest('hex'),bundleRoot='dist-web/_expo/static/js/web';
 const bundles=readdirSync(bundleRoot).filter(path=>path.endsWith('.js')).map(path=>join(bundleRoot,path));assert.ok(bundles.length>0);
 const bundleText=bundles.map(path=>readFileSync(path,'utf8')).join('\n');
 assert.ok(bundleText.includes('Cloud access')&&bundleText.includes('Available'),'Build the current development account status before qualification.');
 assert.ok(!bundleText.includes('trialDays')&&!bundleText.includes('pricingFinalized'),'The served bundle must use the current no-trial contract.');
 const frontend=['src/web/AccountPage.tsx','src/web/account-client.ts','src/cloud/api.ts'],builtAt=Math.max(...bundles.map(path=>statSync(path).mtimeMs));
 for(const path of frontend)assert.ok(statSync(path).mtimeMs<=builtAt,`${path} changed after the web build; rebuild before qualification.`);
 const paths=[...frontend,'server/auth.ts','server/cloud-access.ts','server/account-routes.ts','server/account-store.ts','server/migrations/0001-auth.sql','scripts/verify-web-accounts.mjs'];
 return {head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:Object.fromEntries(paths.map(path=>[path,digest(readFileSync(path))])),bundles:Object.fromEntries(bundles.map(path=>[path,digest(readFileSync(path))]))};
}
async function qualifyCoreAccounts(source){
 const wrong=await context(),wrongPage=await wrong.newPage();
 await signIn(wrongPage,`core-wrong-${crypto.randomUUID()}@example.invalid`,true);await wrong.close();
 const auth=await context({viewport:{width:1440,height:1000}}),page=await auth.newPage(),email=`core-account-${crypto.randomUUID()}@example.invalid`;
 const screenshot=async name=>{assert.equal(await page.getByLabel('Email code',{exact:true}).count(),0,'Never capture private OTP entry.');await page.screenshot({path:join(output,name+'.png'),fullPage:true});};
 const signedIn=async()=>{await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();await page.locator('.account-status').getByText('Available',{exact:true}).waitFor();assert.match(await page.locator('.account-status').innerText(),/Cloud access\s+Available/);};
 const noProductWrites=()=>assert.deepEqual(apiCalls.filter(call=>!call.fixture&&/\/api\/(cloud\/(trial|enroll)|sync\/push)/.test(call.path)),[]);
 function cloudRows(){
  const files=readdirSync(join(persist,'v3/do'),{recursive:true}).filter(path=>String(path).endsWith('.sqlite'));
  return Object.fromEntries(files.map(path=>{
   const db=new DatabaseSync(join(persist,'v3/do',path),{readOnly:true});
   try{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name).filter(name=>!name.startsWith('sqlite_')&&!name.startsWith('__cf_')&&!name.startsWith('_cf_'));
    return [path,Object.fromEntries(tables.map(name=>{
     const table='\"'+name.replaceAll('\"','\"\"')+'\"',columns=db.prepare(`PRAGMA table_info(${table})`).all().map(row=>'\"'+row.name.replaceAll('\"','\"\"')+'\"');
     return [name,db.prepare(`SELECT * FROM ${table} ORDER BY ${columns.join(',')}`).all()];
    }))];
   }finally{db.close();}
  }));
 }
 await page.goto(front+'/account');await page.getByLabel('Email address',{exact:true}).waitFor();reviewPage=page;await screenshot('core-account-sign-in');
 reviewPage=null;await signIn(page,email);reviewPage=page;await signedIn();
 const accountResponse=await auth.request.get(front+'/api/account');assert.equal(accountResponse.status(),200);const account=await accountResponse.json(),uid=account.user.id;
 assert.deepEqual(account.cloud,{canSync:true,canExport:true});assert.deepEqual(account.pets,[]);noProductWrites();
 pass('Genuine UI OTP grants immediate cloud access while leaving puppy enrollment and uploads explicit.');
 await page.reload();await signedIn();assert.equal((await(await auth.request.get(front+'/api/account')).json()).user.id,uid);noProductWrites();
 pass('Reload preserves the real browser session and displays Cloud access Available without an activation request.');
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByLabel('Email address',{exact:true}).waitFor();
 assert.equal((await auth.request.get(front+'/api/account')).status(),401);assert.equal(read('SELECT id FROM user WHERE id=? AND email=?',uid,email).length,1);noProductWrites();
 pass('Sign out ends authentication and retains the same account identity.');
 reviewPage=null;await signIn(page,email);reviewPage=page;await signedIn();assert.equal((await(await auth.request.get(front+'/api/account')).json()).user.id,uid);
 // Seed through an explicitly marked independent HTTP fixture. The browser UI
 // remains account management only and must never enroll or upload on its own.
 const fixtureHeaders={'x-puptime-fixture':'true'},pet='core-pet-'+crypto.randomUUID(),device='core-http-fixture';
 const enrolled=await auth.request.post(front+'/api/cloud/enroll',{headers:fixtureHeaders,data:{operationId:crypto.randomUUID(),deviceId:device,localPetId:pet,name:'Core puppy'}});assert.equal(enrolled.status(),200);
 const mutation={protocolVersion:1,operationId:crypto.randomUUID(),deviceId:device,recordId:cloudRecordId('event',pet,'core-log'),petId:pet,kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:1000000,source:'app',note:'Synthetic core session retention'}};
 const pushed=await auth.request.post(front+'/api/sync/push',{headers:fixtureHeaders,data:{mutations:[mutation]}});assert.equal(pushed.status(),200);assert.deepEqual((await pushed.json()).rejected,[]);
 const cloudResponse=await auth.request.get(front+'/api/sync/pull');assert.equal(cloudResponse.status(),200);const beforeCloud=await cloudResponse.json(),beforeSql=cloudRows();
 assert.ok(beforeCloud.changes.some(record=>record.kind==='event'&&record.data.note==='Synthetic core session retention'));assert.ok(Object.keys(beforeSql).length>0);
 const oldSessions=read('SELECT id FROM session WHERE userId=?',uid).map(row=>row.id);assert.ok(oldSessions.length>0);
 sql(`UPDATE session SET expiresAt='${new Date(0).toISOString()}' WHERE userId='${uid}'`);
 assert.ok(read('SELECT expiresAt FROM session WHERE userId=?',uid).every(row=>Date.parse(row.expiresAt)===0));
 await page.reload();await page.getByLabel('Email address',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Sign out',exact:true}).count(),0);
 assert.equal((await auth.request.get(front+'/api/account')).status(),401);assert.equal((await auth.request.get(front+'/api/account/export')).status(),401);
 assert.equal(read('SELECT id FROM user WHERE id=? AND email=?',uid,email).length,1);assert.deepEqual(cloudRows(),beforeSql);await screenshot('core-account-expired-session');
 pass('Actual ISO session expiry returns to sign-in, refuses private access, and preserves identity plus populated cloud SQL exactly.');
 reviewPage=null;await signIn(page,email);reviewPage=page;await signedIn();
 const recovered=await(await auth.request.get(front+'/api/account')).json();assert.equal(recovered.user.id,uid);assert.deepEqual(recovered.cloud,{canSync:true,canExport:true});assert.equal(recovered.pets[0].eventCount,1);
 assert.ok(read('SELECT id,createdAt,expiresAt FROM session WHERE userId=?',uid).some(row=>!oldSessions.includes(row.id)&&Date.parse(row.expiresAt)>Date.now()&&Date.now()-Date.parse(row.createdAt)<600000));
 const restored=await auth.request.get(front+'/api/sync/pull');assert.equal(restored.status(),200);assert.deepEqual(await restored.json(),beforeCloud);assert.deepEqual(cloudRows(),beforeSql);noProductWrites();
 pass('Fresh genuine UI OTP reuses the same owner and cloud copy with a new recent session, without repeated enrollment or upload.');
 await screenshot('core-account-desktop');await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await screenshot('core-account-mobile');
 pass('Fresh desktop and mobile account screenshots show the current Available status; this core mode records no videos.');
 assert.equal(apiCalls.some(call=>call.method==='DELETE'),false);assert.deepEqual(coreSourceSnapshot(),source,'Qualified source or served bundles changed during the core account run.');
 await auth.close();reviewPage=null;
 const media=readdirSync(output).filter(path=>path.endsWith('.png')).map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(output,path))).digest('hex')}));
 writeFileSync(join(output,'verification.json'),JSON.stringify({passed:summary,source,scope:'Isolated local website + genuine Better Auth UI OTP, SDK-managed sessions, D1 and populated SQL Durable Object. Only the independent marked HTTP fixture creates a puppy/log. No native, external provider, live service or telemetry ingestion claim.',privateAuthRecorded:false,videosRecorded:false,media},null,2));
 console.log('Core account evidence:',output);
}

async function qualifyAppleDeletion(){
 const sourceFiles=['server/auth.ts','server/account-lifecycle.ts','server/account-routes.ts','server/migrations/0001-auth.sql','src/web/account-client.ts','src/web/AccountPage.tsx','scripts/verify-web-accounts.mjs'];
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const source={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:Object.fromEntries(sourceFiles.map(path=>[path,digest(readFileSync(path))])),bundles:Object.fromEntries(readdirSync('dist-web/_expo/static/js/web').filter(path=>path.endsWith('.js')).map(path=>[path,digest(readFileSync(join('dist-web/_expo/static/js/web',path)))]))};
 const fixtureHeaders={'x-puptime-fixture':'true'};
 async function owner(){
  const auth=await context(),page=await auth.newPage(),email=`apple-delete-${crypto.randomUUID()}@example.invalid`;
  await signIn(page,email);
  const response=await auth.request.get(front+'/api/account');assert.equal(response.status(),200);
  const uid=(await response.json()).user.id;assert.match(uid,/^[A-Za-z0-9._:-]+$/);
  const pet='apple-review-'+crypto.randomUUID();
  assert.equal((await auth.request.post(front+'/api/cloud/enroll',{headers:fixtureHeaders,data:{operationId:crypto.randomUUID(),deviceId:'apple-review-device',localPetId:pet,name:'Synthetic puppy'}})).status(),200);
  const mutation={protocolVersion:1,operationId:crypto.randomUUID(),deviceId:'apple-review-device',recordId:cloudRecordId('event',pet,'synthetic-event'),petId:pet,kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:1000000,source:'app',note:'Synthetic deletion acceptance 犬'}};
  const pushed=await auth.request.post(front+'/api/sync/push',{headers:fixtureHeaders,data:{mutations:[mutation]}});assert.equal(pushed.status(),200);assert.deepEqual((await pushed.json()).rejected,[]);
  return {auth,page,email,uid,pet};
 }
 const target=await owner(),other=await owner();
 const credential=crypto.randomUUID();
 sql(`INSERT INTO account(id,accountId,providerId,userId,refreshToken,accessToken,createdAt,updatedAt) VALUES ('${credential}','${credential}','apple','${target.uid}',NULL,NULL,'${new Date().toISOString()}','${new Date().toISOString()}')`);
 assert.equal(read("SELECT id FROM account WHERE id=? AND userId=? AND providerId='apple' AND refreshToken IS NULL AND accessToken IS NULL",credential,target.uid).length,1);
 assert.ok(read("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'account_reject_%_while_deleting'").length===2);
 pass('Two disposable accounts use genuine local UI OTP, explicit fixture enrollment and real persisted cloud events; only the deletion owner receives a tokenless synthetic Apple credential.');
 const authSnapshot=uid=>Object.fromEntries(['user','session','account','cloud_accounts'].map(table=>[table,read(`SELECT * FROM ${table} WHERE ${table==='user'?'id':table==='cloud_accounts'?'account_id':'userId'}=? ORDER BY ${table==='cloud_accounts'?'account_id':'id'}`,uid)]));
 const objectFiles=readdirSync(join(persist,'v3/do'),{recursive:true}).filter(path=>String(path).endsWith('.sqlite')).map(path=>join(persist,'v3/do',path));
 function objectFor(pet){
  const matches=objectFiles.filter(path=>{const db=new DatabaseSync(path,{readOnly:true});try{return !!db.prepare("SELECT name FROM sqlite_master WHERE name='pets'").get()&&!!db.prepare('SELECT id FROM pets WHERE id=?').get(pet);}finally{db.close();}});
  assert.equal(matches.length,1);return matches[0];
 }
 const targetObject=objectFor(target.pet),otherObject=objectFor(other.pet);
 const contentTables=['records','record_events','record_routines','revisions','operations','pets','enrollments','enrolled_devices'];
 function objectSnapshot(path){assert.ok(path.startsWith(persist+'/'));const db=new DatabaseSync(path,{readOnly:true});try{return Object.fromEntries([...contentTables,'account_state','schema_metadata'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}finally{db.close();}}
 const unrelatedAuth=authSnapshot(other.uid),unrelatedContent=objectSnapshot(otherObject);
 assert.equal(objectSnapshot(targetObject).revisions.length,1);
 await target.page.reload();await target.page.getByText('✓ Apple connected',{exact:true}).waitFor();
 const recorded=await context({storageState:await target.auth.storageState(),recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}},viewport:{width:1440,height:1000}}),page=await recorded.newPage();
 reviewPage=page;
 await page.goto(front+'/account');await page.getByText('✓ Apple connected',{exact:true}).waitFor();
 await page.waitForTimeout(1800);
 await page.getByRole('button',{name:'Delete cloud account',exact:true}).click();await page.getByRole('dialog',{name:'Delete cloud account?'}).waitFor();
 await page.screenshot({path:join(output,'327-apple-delete-confirmation-desktop.png'),fullPage:true});
 await page.waitForTimeout(1800);
 await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(authSnapshot(target.uid).user.length,1);assert.equal(objectSnapshot(targetObject).revisions.length,1);
 pass('Cancel closes the real confirmation without deleting identity or cloud history.');
 await page.getByRole('button',{name:'Delete cloud account',exact:true}).click();await page.getByRole('dialog').waitFor();
 const deleted=page.waitForResponse(response=>response.request().method()==='DELETE'&&new URL(response.url()).pathname==='/api/account');
 await page.getByRole('dialog').getByRole('button',{name:'Delete cloud account',exact:true}).click();
 const response=await deleted;assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'no-store');
 assert.deepEqual(await response.json(),{success:true,message:'User deleted',appleRevocation:'manual'});
 await page.getByRole('status').filter({hasText:'Cloud account deleted'}).waitFor();
 const instruction=page.getByText('Apple access wasn’t confirmed as revoked.',{exact:false});await instruction.waitFor();
 const appleLink=page.getByRole('link',{name:'your Apple Account',exact:true});assert.equal(await appleLink.getAttribute('href'),'https://account.apple.com/');
 await page.getByLabel('Email address',{exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').isVisible(),false);
 assert.equal((await recorded.request.get(front+'/api/account')).status(),401);
 assert.equal((await target.auth.request.get(front+'/api/account')).status(),401);
 for(const rows of Object.values(authSnapshot(target.uid)))assert.equal(rows.length,0);
 assert.equal(read('SELECT id FROM local_email_previews WHERE email=?',target.email).length,0);
 const retired=objectSnapshot(targetObject);for(const table of contentTables)assert.equal(retired[table].length,0);
 assert.deepEqual(retired.account_state.map(row=>({...row})),[{key:'retired',value:1}]);
 assert.deepEqual(authSnapshot(other.uid),unrelatedAuth);assert.deepEqual(objectSnapshot(otherObject),unrelatedContent);
 assert.equal((await other.auth.request.get(front+'/api/account')).status(),200);
 pass('Confirmed DELETE returns manual Apple guidance, clears the real SDK browser session, removes target identity/credentials/live cloud data and retains a non-content retirement fence; the unrelated owner’s auth and complete object rows are unchanged.');
 await page.screenshot({path:join(output,'327-apple-delete-manual-desktop.png'),fullPage:true});await page.waitForTimeout(2600);
 await page.setViewportSize({width:390,height:844});
 await instruction.waitFor();await appleLink.scrollIntoViewIfNeeded();assert.equal(await appleLink.isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.screenshot({path:join(output,'327-apple-delete-manual-mobile.png'),fullPage:true});await page.waitForTimeout(2600);
 const video=page.video();await recorded.close();assert.ok(video);
 const videoPath=join(output,'327-apple-account-deletion.mp4');
 execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-i',await video.path(),'-an','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',videoPath],{stdio:['ignore','pipe','pipe']});
 pass('Fresh desktop/mobile product screenshots and a seekable H.264 MP4 show the actual post-authentication confirmation, cancellation, deletion and manual Apple link; no code entry is recorded.');
 assert.deepEqual(source.files,Object.fromEntries(sourceFiles.map(path=>[path,digest(readFileSync(path))])),'Reviewed source changed during qualification.');
 assert.deepEqual(apiCalls.filter(call=>!call.fixture&&/\/api\/(cloud\/(trial|enroll)|sync\/push)/.test(call.path)),[]);
 await target.auth.close();await other.auth.close();
 const evidence={passed:summary,source,scope:'Isolated local real Better Auth email OTP + D1/SQLite DO + browser confirmation. The Apple credential is a synthetic tokenless row, not a real Apple login. No upstream Apple call is made; real revocation HTTP200/400/network/timeout behavior is separately mocked in Workers tests.',privateAuthRecorded:false,liveServicesUsed:false,manualLink:'https://account.apple.com/',unrelatedOwnerPreserved:true,media:readdirSync(output).filter(path=>/\.(png|mp4)$/.test(path)).map(path=>({path,sha256:digest(readFileSync(join(output,path)))}))};
 writeFileSync(join(output,'326-apple-deletion-local.json'),JSON.stringify(evidence,null,2));
 writeFileSync(join(output,'326-apple-deletion-local.log'),summary.map(value=>'PASS '+value).join('\n')+'\n'+evidence.scope+'\n');
 console.log('Apple deletion evidence:',output);
}
try{
 assert.ok(existsSync('dist-web/account.html'),'Build the static website first.');
 const coreSource=coreAccountsOnly?coreSourceSnapshot():null;
 // Refuse another local service before spawning or issuing any fixture request.
 for(const port of [8798,8898])await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
 cli(['d1','migrations','apply','AUTH_DB','--local','--config',configPath,'--persist-to',persist]);
 worker=spawn('npx',['wrangler','dev','--local','--ip','127.0.0.1','--port','8798','--config',configPath,'--persist-to',persist],{env:childEnv,stdio:['ignore','pipe','pipe'],detached:true});
 worker.stdout.resume();worker.stderr.resume();await waitServer();
 authPath=readdirSync(join(persist,'v3/d1'),{recursive:true}).filter(path=>String(path).endsWith('.sqlite')).map(path=>join(persist,'v3/d1',path)).find(path=>{const db=new DatabaseSync(path,{readOnly:true});try{return !!db.prepare("SELECT name FROM sqlite_master WHERE name='local_email_previews'").get();}finally{db.close();}});assert.ok(authPath);
 server=createServer((req,res)=>{
  if(req.url.startsWith('/api/')){
   apiCalls.push({path:req.url,method:req.method,fixture:req.headers['x-puptime-fixture']==='true'});
   const headers={...req.headers};delete headers['x-puptime-test-client'];delete headers['x-puptime-fixture'];
   const client=req.headers['x-puptime-test-client'];if(/^198\.51\.100\.\d+$/.test(client??''))headers['cf-connecting-ip']=client;
   const proxy=httpRequest(back+req.url,{method:req.method,headers},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});proxy.on('error',()=>{res.writeHead(503);res.end();});req.pipe(proxy);return;
  }
  const path=decodeURIComponent(new URL(req.url,front).pathname),base=resolve('dist-web');let file=resolve(base,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(base+'/')){res.writeHead(404);res.end();return;}if(!extname(file))file+='.html';
  if(!existsSync(file)){res.writeHead(404);res.end('Not found');return;}
  const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf','.svg':'image/svg+xml','.json':'application/json'};
  res.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream','cache-control':'no-store'});createReadStream(file).pipe(res);
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8898,'127.0.0.1',resolve);});
 browser=await chromium.launch({headless:true,executablePath:process.env.PUPTIME_CHROMIUM_EXECUTABLE??chromium.executablePath()});
 if(appleDeletionOnly){await qualifyAppleDeletion();}else if(coreAccountsOnly){await qualifyCoreAccounts(coreSource);}else{
 const privateContext=await context(),page=await privateContext.newPage(),email=`web-review-${crypto.randomUUID().slice(0,8)}@example.invalid`;
 await page.goto(front+'/account');await page.getByLabel('Email address',{exact:true}).waitFor();assert.equal(await page.locator('meta[name=robots]').getAttribute('content'),'noindex, nofollow');
 await page.screenshot({path:join(output,'300-web-account-sign-in.png'),fullPage:true});
 const invalidContext=await context(),invalidPage=await invalidContext.newPage();await signIn(invalidPage,`web-code-${crypto.randomUUID().slice(0,8)}@example.invalid`,true);await invalidContext.close();
 await signIn(page,email);const account=await (await privateContext.request.get(front+'/api/account')).json(),uid=account.user.id;
 assert.deepEqual(account.cloud,{canSync:true,canExport:true});assert.deepEqual(account.pets,[]);
 pass('Genuine UI email OTP signs in with immediate development cloud access, without puppy enrollment or cloud writes.');
 // A queued handler can still have uncertain=null while another operation's durable marker exists.
 const staleContext=await context(),stalePage=await staleContext.newPage(),staleEmail=`web-stale-tab-${crypto.randomUUID().slice(0,8)}@example.invalid`;await signIn(stalePage,staleEmail);const staleUid=(await(await staleContext.request.get(front+'/api/account')).json()).user.id;await stalePage.getByRole('button',{name:'Delete cloud account',exact:true}).click();await stalePage.getByRole('dialog').waitFor();const otherAttempt=String(Date.now()-1000);await stalePage.evaluate(({id,at})=>localStorage.setItem('puptime.account.deletion.'+id,at),{id:staleUid,at:otherAttempt});sql(`UPDATE session SET createdAt='${new Date(0).toISOString()}' WHERE userId='${staleUid}'`);let staleDeletes=0;stalePage.on('request',request=>{if(request.method()==='DELETE'&&new URL(request.url()).pathname==='/api/account')staleDeletes++;});await stalePage.getByRole('dialog').getByRole('button',{name:'Delete cloud account',exact:true}).click();await stalePage.getByRole('heading',{name:'Confirm it’s you',exact:true}).waitFor();assert.equal(await stalePage.evaluate(id=>localStorage.getItem('puptime.account.deletion.'+id),staleUid),otherAttempt,'Stale preflight must preserve the other unresolved attempt.');assert.equal(staleDeletes,0);assert.equal(await stalePage.getByRole('button',{name:'Verify with Google',exact:true}).count(),0);await stalePage.screenshot({path:join(output,'316-web-stale-guard-reauth.png'),fullPage:true});await staleContext.close();pass('A stale React preflight preserves another durable deletion marker and sends no DELETE.');
 if(process.env.PUPTIME_WEB_REVIEW_GUARDS_ONLY==='1'){writeFileSync(join(output,'verification-guard-followups.json'),JSON.stringify({passed:summary,scope:'Focused stale-React guard regression using genuine local OTP/D1; no live services or credentials recorded.',privateAuthRecorded:false},null,2));console.log('Focused guard evidence:',output);}else{
 // Hold an actual successful DELETE acknowledgment while the page reloads.
 const inflightAuth=await context(),inflightPrivate=await inflightAuth.newPage(),inflightEmail=`web-inflight-${crypto.randomUUID().slice(0,8)}@example.invalid`;await signIn(inflightPrivate,inflightEmail);const inflightUid=(await(await inflightAuth.request.get(front+'/api/account')).json()).user.id;const inflightContext=await context({storageState:await inflightAuth.storageState(),recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}},viewport:{width:1440,height:1000}}),inflightPage=await inflightContext.newPage();await inflightPage.goto(front+'/account');await inflightPage.getByRole('button',{name:'Sign out',exact:true}).waitFor();await inflightPage.waitForTimeout(2000);
 await inflightPage.getByRole('button',{name:'Delete cloud account',exact:true}).click();await inflightPage.getByRole('dialog').waitFor();await inflightPage.waitForTimeout(2000);let startDelete,deleteArrived,commitDelete,releaseDelete;const deleteDispatch=new Promise(resolve=>{startDelete=resolve;}),deleteEntered=new Promise(resolve=>{deleteArrived=resolve;}),deleteCommitted=new Promise(resolve=>{commitDelete=resolve;}),deleteReply=new Promise(resolve=>{releaseDelete=resolve;});
 await inflightPage.route('**/api/account',async route=>{if(route.request().method()!=='DELETE'){await route.continue();return;}deleteArrived();await deleteDispatch;const response=await route.fetch();assert.equal(response.status(),200);commitDelete();await deleteReply;try{await route.abort('failed');}catch{/* Reload may already have cancelled this held request. */}});
 await inflightPage.getByRole('dialog').getByRole('button',{name:'Delete cloud account',exact:true}).click();await deleteEntered;const persisted=await inflightPage.evaluate(id=>localStorage.getItem('puptime.account.deletion.'+id),inflightUid);assert.ok(persisted,'Expected unresolved deletion to be saved before dispatch.');startDelete();await deleteCommitted;await inflightPage.reload();await inflightPage.getByRole('alert').filter({hasText:'response was lost'}).waitFor();assert.equal(await inflightPage.getByLabel('Email address',{exact:true}).isVisible(),false);await inflightPage.screenshot({path:join(output,'313-web-inflight-deletion.png'),fullPage:true});await inflightPage.waitForTimeout(2600);releaseDelete();const inflightVideo=inflightPage.video();await inflightPage.close();const reopened=await inflightContext.newPage();await reopened.goto(front+'/account');await reopened.getByRole('alert').filter({hasText:'response was lost'}).waitFor();assert.equal(await reopened.getByLabel('Email address',{exact:true}).isVisible(),false);assert.equal(read('SELECT id FROM user WHERE email=?',inflightEmail).length,0);await inflightContext.close();if(inflightVideo)writeFileSync(join(output,'313-video-source.txt'),await inflightVideo.path());await inflightAuth.close();pass('Pre-dispatch deletion intent survives an in-flight reload and closed-tab reopening without signup or a false acknowledgment.');
 const fixtureHeaders={'x-puptime-fixture':'true'};
 const pet='web-review-pet';assert.equal((await privateContext.request.post(front+'/api/cloud/enroll',{headers:fixtureHeaders,data:{operationId:crypto.randomUUID(),deviceId:'web-review-seed',localPetId:pet,name:'Biscuit'}})).status(),200);
 for(let start=0;start<1000;start+=50){const mutations=Array.from({length:50},(_,offset)=>({protocolVersion:1,operationId:crypto.randomUUID(),deviceId:'web-review-seed',recordId:cloudRecordId('event',pet,'event-'+(start+offset)),petId:pet,kind:'event',baseRevision:0,intent:'create',patch:{type:'pee',at:1000000+start+offset,source:'app',note:'Synthetic review log 犬 '+(start+offset)}}));const result=await privateContext.request.post(front+'/api/sync/push',{headers:fixtureHeaders,data:{mutations}});assert.equal(result.status(),200);assert.deepEqual((await result.json()).rejected,[]);}
 // Synthetic browser auth is inherited in memory only after genuine OTP UI.
 const originalAuth=await privateContext.storageState();
 const recorded=await context({storageState:originalAuth,recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}},viewport:{width:1440,height:1000}}),review=await recorded.newPage();
 reviewPage=review;review.on('pageerror',error=>console.error('Public review runtime error:',error.name,error.message.slice(0,700)));await review.goto(front+'/account');await review.getByRole('button',{name:'Download cloud data',exact:true}).waitFor();await review.screenshot({path:join(output,'301-web-account-desktop.png'),fullPage:true});await review.waitForTimeout(2400);
 await review.getByRole('button',{name:'Delete cloud account',exact:true}).click();await review.getByRole('dialog').waitFor();await review.screenshot({path:join(output,'304-web-account-delete-confirmation.png'),fullPage:true});await review.waitForTimeout(2400);await review.getByRole('button',{name:'Cancel',exact:true}).click();
 const downloadWait=review.waitForEvent('download');await review.getByRole('button',{name:'Download cloud data',exact:true}).click();const download=await downloadWait;assert.equal(await download.failure(),null);const file=join(output,'private-export.ndjson');await download.saveAs(file);
 const rows=readFileSync(file,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows[0].type,'manifest');assert.equal(rows.at(-1).type,'complete');assert.equal(rows.filter(row=>row.type==='revision').length,1000);rmSync(file);
 pass('Standard browser download contains all1000 actual cloud revisions and a final completion marker.');
 await review.setViewportSize({width:390,height:844});await review.screenshot({path:join(output,'302-web-account-mobile.png'),fullPage:true});await review.waitForTimeout(2400);assert.equal(await review.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await review.emulateMedia({colorScheme:'dark'});await review.screenshot({path:join(output,'303-web-account-dark.png'),fullPage:true});await review.waitForTimeout(2400);await review.emulateMedia({colorScheme:'light'});await review.setViewportSize({width:1440,height:1000});
 // Simulate external provider cancellation without making any live call.
 await review.route('https://accounts.google.com/**',route=>route.fulfill({status:302,headers:{location:front+'/account?error=access_denied'},body:''}));
 await review.getByRole('button',{name:'Connect Google',exact:true}).click();await review.getByRole('button',{name:'Connect Google',exact:true}).waitFor();await review.getByRole('alert').filter({hasText:'The sign-in method wasn’t connected'}).waitFor();await review.waitForURL(url=>url.pathname==='/account'&&!url.search);
 assert.equal(read("SELECT * FROM account WHERE userId=? AND providerId='google'",uid).length,0);pass('Real link initiation + simulated external cancel returns safely, sanitizes URL and never reports Connected.');
 await review.waitForTimeout(2600);const video=review.video();await recorded.close();if(video)writeFileSync(join(output,'306-video-source.txt'),await video.path());
 // Reauthentication is deliberately performed in the unrecorded context.
 sql(`UPDATE session SET createdAt='${new Date(0).toISOString()}' WHERE userId='${uid}'`);await page.reload();await page.getByRole('button',{name:'Delete cloud account',exact:true}).click();await page.getByRole('heading',{name:'Confirm it’s you'}).waitFor();assert.equal(await page.getByRole('dialog').isVisible(),false);await page.screenshot({path:join(output,'305-web-account-reauthentication.png'),fullPage:true});
 sql(`INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES ('review-google','review-google','google','${uid}','${new Date().toISOString()}','${new Date().toISOString()}')`);await page.reload();await page.getByRole('button',{name:'Delete cloud account',exact:true}).click();await page.getByRole('heading',{name:'Confirm it’s you'}).waitFor();
 await page.route('https://accounts.google.com/**',route=>route.fulfill({status:302,headers:{location:front+'/account?error=access_denied'},body:''}));await page.getByRole('button',{name:'Verify with Google',exact:true}).click();await page.getByRole('heading',{name:'Confirm it’s you'}).waitFor();await page.getByRole('alert').filter({hasText:'Sign-in wasn’t completed'}).waitFor();assert.equal(await page.getByRole('status').filter({hasText:'Signed in again'}).count(),0);assert.equal(await page.getByRole('dialog').isVisible(),false);pass('Cancelled provider reauthentication retains the stale-session gate and never claims success.');
 await page.getByRole('button',{name:'Email me a code',exact:true}).click();await page.getByLabel('Email code',{exact:true}).waitFor();await page.getByLabel('Email code',{exact:true}).fill(code(email));await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('status').filter({hasText:'Signed in again'}).waitFor();assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal((await (await privateContext.request.get(front+'/api/account')).json()).user.id,uid);pass('Stale deletion requires genuine same-account OTP reauthentication and a new confirmation.');
 const freshOriginalAuth=await privateContext.storageState();
 const otherEmail=`web-other-${crypto.randomUUID().slice(0,8)}@example.invalid`;const otherContext=await context(),other=await otherContext.newPage();await signIn(other,otherEmail);const otherUid=(await (await otherContext.request.get(front+'/api/account')).json()).user.id;
 // The displayed owner stays A while a genuine second login switches the cookie to B.
 const exportContext=await context({storageState:freshOriginalAuth,recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}},viewport:{width:1440,height:1000}}),exportPage=await exportContext.newPage();await exportPage.goto(front+'/account');await exportPage.getByRole('button',{name:'Download cloud data',exact:true}).waitFor();await exportPage.waitForTimeout(2200);
 assert.equal((await exportContext.request.post(front+'/api/auth/email-otp/send-verification-otp',{headers:{origin:front},data:{email:otherEmail,type:'sign-in'}})).status(),200);assert.equal((await exportContext.request.post(front+'/api/auth/sign-in/email-otp',{headers:{origin:front},data:{email:otherEmail,otp:code(otherEmail)}})).status(),200);assert.equal(await exportPage.locator('.account-email').textContent(),email);let wrongDownloads=0;exportPage.on('download',()=>wrongDownloads++);const rejectedExport=exportPage.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/account/export');await exportPage.getByRole('button',{name:'Download cloud data',exact:true}).click();const rejectedResponse=await rejectedExport;assert.equal(rejectedResponse.status(),409);assert.equal(rejectedResponse.headers()['content-disposition'],undefined);await exportPage.getByRole('heading',{name:'Account changed',exact:true}).waitFor();assert.equal(wrongDownloads,0);assert.ok(!(await exportPage.locator('body').innerText()).includes(otherUid));await exportPage.screenshot({path:join(output,'315-web-export-account-changed.png'),fullPage:true});await exportPage.waitForTimeout(3000);const exportVideo=exportPage.video();await exportContext.close();if(exportVideo)writeFileSync(join(output,'315-video-source.txt'),await exportVideo.path());pass('POST streaming export rejects a displayed-owner/cookie-owner switch before any download or cloud-data bytes.');
 // Switch the browser's real cookie after the immutable pre-check response was
 // produced, before DELETE is sent. The guarded server must reject the race.
 await page.getByRole('button',{name:'Delete cloud account',exact:true}).click();await page.getByRole('dialog').waitFor();let release,entered;const blocked=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});let hold=true;
 await page.route('**/api/auth/get-session?**',async route=>{if(!hold){await route.continue();return;}hold=false;const response=await route.fetch();entered();await resume;await route.fulfill({response});});
 await page.getByRole('dialog').getByRole('button',{name:'Delete cloud account',exact:true}).click();await blocked;
 const sent=await privateContext.request.post(front+'/api/auth/email-otp/send-verification-otp',{headers:{origin:front},data:{email:otherEmail,type:'sign-in'}});assert.equal(sent.status(),200);
 const switched=await privateContext.request.post(front+'/api/auth/sign-in/email-otp',{headers:{origin:front},data:{email:otherEmail,otp:code(otherEmail)}});assert.equal(switched.status(),200);release();await page.getByRole('alert').filter({hasText:'different account'}).waitFor();
 assert.equal(read('SELECT id FROM user WHERE id IN (?,?)',uid,otherUid).length,2);pass('Cross-tab cookie switch between fresh-user check and DELETE is rejected; both users survive.');
 await page.unroute('**/api/auth/get-session?**');
 assert.ok(await page.evaluate(id=>localStorage.getItem('puptime.account.deletion.'+id),uid),'A refused attempt conservatively preserves the displayed owner guard.');
 const uncertainContext=await context({storageState:await otherContext.storageState(),recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}},viewport:{width:1440,height:1000}}),uncertainPage=await uncertainContext.newPage();await uncertainPage.goto(front+'/account');await uncertainPage.getByRole('button',{name:'Sign out',exact:true}).waitFor();await uncertainPage.waitForTimeout(2000);await uncertainPage.getByRole('button',{name:'Delete cloud account',exact:true}).click();await uncertainPage.getByRole('dialog').waitFor();await uncertainPage.waitForTimeout(2200);
 await uncertainPage.route('**/api/account',async route=>{if(route.request().method()!=='DELETE'){await route.continue();return;}const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'synthetic_lost_ack'})});});
 await uncertainPage.getByRole('dialog').getByRole('button',{name:'Delete cloud account',exact:true}).click();await uncertainPage.getByRole('alert').filter({hasText:'response was lost'}).waitFor();assert.equal(await uncertainPage.getByLabel('Email address',{exact:true}).isVisible(),false);await uncertainPage.screenshot({path:join(output,'308-web-account-deletion-unconfirmed.png'),fullPage:true});
 await uncertainPage.reload();await uncertainPage.getByRole('alert').filter({hasText:'response was lost'}).waitFor();assert.equal(await uncertainPage.getByLabel('Email address',{exact:true}).isVisible(),false);
 assert.equal(read('SELECT id FROM user WHERE id=?',otherUid).length,0);assert.equal(read('SELECT id FROM user WHERE id=?',uid).length,1);pass('Lost actual deletion acknowledgment, including a substituted503 reply, stays unconfirmed after reload without recreating an account.');
 await uncertainPage.waitForTimeout(3000);const uncertainVideo=uncertainPage.video();await uncertainContext.close();if(uncertainVideo)writeFileSync(join(output,'309-video-source.txt'),await uncertainVideo.path());
 const preserved=await context({storageState:originalAuth});const finalExport=await preserved.request.get(front+'/api/account/export');assert.equal(finalExport.status(),200);const finalRows=(await finalExport.text()).trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(finalRows.filter(row=>row.type==='revision'),rows.filter(row=>row.type==='revision'));await preserved.close();pass('All1000 original cloud revisions remain unchanged after cancelled linking, reauthentication and other-owner deletion.');
 const finalContext=await context(),finalPage=await finalContext.newPage(),finalEmail=`web-delete-${crypto.randomUUID().slice(0,8)}@example.invalid`;await signIn(finalPage,finalEmail);const finalUid=(await (await finalContext.request.get(front+'/api/account')).json()).user.id;await finalPage.getByRole('button',{name:'Sign out',exact:true}).click();await finalPage.getByLabel('Email address',{exact:true}).waitFor();assert.equal((await finalContext.request.get(front+'/api/account')).status(),401);assert.equal(read('SELECT id FROM user WHERE id=?',finalUid).length,1);pass('Sign out ends the browser session while retaining the account.');
 await signIn(finalPage,finalEmail);const deletionContext=await context({storageState:await finalContext.storageState(),recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}},viewport:{width:1440,height:1000}}),deletionPage=await deletionContext.newPage();await deletionPage.goto(front+'/account');await deletionPage.getByRole('button',{name:'Sign out',exact:true}).waitFor();await deletionPage.waitForTimeout(2200);await deletionPage.getByRole('button',{name:'Delete cloud account',exact:true}).click();await deletionPage.getByRole('dialog',{name:'Delete cloud account?'}).waitFor();await deletionPage.waitForTimeout(2400);let deletions=0;await deletionPage.route('**/api/account',async route=>{if(route.request().method()==='DELETE')deletions++;await route.continue();});await deletionPage.getByRole('dialog').getByRole('button',{name:'Delete cloud account',exact:true}).evaluate(button=>{button.click();button.click();});await deletionPage.getByRole('status').filter({hasText:'Cloud account deleted'}).waitFor();await deletionPage.getByLabel('Email address',{exact:true}).waitFor();assert.equal(deletions,1);assert.equal(read('SELECT id FROM user WHERE id=?',finalUid).length,0);assert.equal(read('SELECT id FROM user WHERE id=?',uid).length,1);await deletionPage.waitForTimeout(3000);const deletionVideo=deletionPage.video();await deletionContext.close();if(deletionVideo)writeFileSync(join(output,'310-video-source.txt'),await deletionVideo.path());await finalContext.close();pass('Explicit confirmed deletion succeeds once despite duplicate clicks and retains the unrelated original owner.');
 if(process.env.PUPTIME_EXPECT_TELEMETRY==='1'){
  const telemetryAuth={...freshOriginalAuth,origins:freshOriginalAuth.origins.map(value=>({...value,localStorage:value.localStorage.filter(item=>item.name!=='puptime.website.analytics')}))};
  const analyticsContext=await context({analytics:true,storageState:telemetryAuth}),analyticsPage=await analyticsContext.newPage();await analyticsPage.goto(front+'/account?email=private-query#private-fragment');await analyticsPage.getByRole('button',{name:'Allow analytics',exact:true}).waitFor();await analyticsPage.getByRole('button',{name:'Delete cloud account',exact:true}).click();await analyticsPage.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await analyticsPage.waitForTimeout(1000);assert.equal(telemetry.length,0);await analyticsPage.screenshot({path:join(output,'307-web-account-analytics-consent.png'),fullPage:true});
  await analyticsPage.getByRole('button',{name:'Allow analytics',exact:true}).click();await waitFor(()=>telemetry.some(event=>event.event==='website_page_view'));await analyticsPage.getByRole('button',{name:'Delete cloud account',exact:true}).click();await analyticsPage.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await waitFor(()=>telemetry.some(event=>event.event==='website_account'&&event.properties?.action==='delete'&&event.properties?.result==='cancelled'));
  const allowed=['page','$current_url','$pathname','$process_person_profile','distinct_id','$device_id','$session_id','$window_id','$lib','$lib_version','token','action','result'];for(const event of telemetry){assert.ok(['website_page_view','website_account'].includes(event.event));assert.equal(event.properties.page,'/account');assert.equal(event.properties.$current_url,'https://puptime.pages.dev/account');assert.deepEqual(Object.keys(event.properties).filter(key=>!allowed.includes(key)),[]);assert.ok(!JSON.stringify(event).includes(email)&&!JSON.stringify(event).includes(uid)&&!JSON.stringify(event).includes('private-query')&&!JSON.stringify(event).includes('private-fragment'));}
  await analyticsPage.getByRole('button',{name:'Analytics settings',exact:true}).click();await analyticsPage.getByRole('button',{name:'Decline analytics',exact:true}).click();const stopped=telemetry.length;await analyticsPage.getByRole('button',{name:'Delete cloud account',exact:true}).click();await analyticsPage.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await analyticsPage.waitForTimeout(4000);assert.equal(telemetry.length,stopped);await analyticsContext.close();
  const privacyContext=await context({analytics:true});await privacyContext.addInitScript(()=>Object.defineProperty(navigator,'doNotTrack',{get:()=> '1'}));const privacyPage=await privacyContext.newPage();await privacyPage.goto(front+'/account');await privacyPage.getByRole('button',{name:'Analytics settings',exact:true}).click();assert.equal(await privacyPage.getByRole('button',{name:'Allow analytics',exact:true}).isDisabled(),true);await privacyPage.waitForTimeout(1000);assert.equal(telemetry.length,stopped);await privacyContext.close();pass('Installed PostHog SDK sends only coarse anonymous events to a local mock after consent; withdrawal and Do Not Track stop capture.');
 }
 // A service refusal without deletion must remain recoverable after auth becomes stale.
 const recoveryContext=await context(),recoveryPage=await recoveryContext.newPage(),recoveryEmail=`web-recovery-${crypto.randomUUID().slice(0,8)}@example.invalid`;await signIn(recoveryPage,recoveryEmail);const recoveryUid=(await(await recoveryContext.request.get(front+'/api/account')).json()).user.id;let recoveryDeletes=0;
 await recoveryPage.route('**/api/account',async route=>{if(route.request().method()!=='DELETE'){await route.continue();return;}recoveryDeletes++;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'synthetic_service_refusal'})});});await recoveryPage.getByRole('button',{name:'Delete cloud account',exact:true}).click();await recoveryPage.getByRole('dialog').getByRole('button',{name:'Delete cloud account',exact:true}).click();await recoveryPage.getByRole('alert').filter({hasText:'response was lost'}).waitFor();sql(`UPDATE session SET createdAt='${new Date(0).toISOString()}' WHERE userId='${recoveryUid}'`);await recoveryPage.reload();await recoveryPage.getByRole('button',{name:'Retry deletion',exact:true}).click();await recoveryPage.getByRole('heading',{name:'Confirm it’s you',exact:true}).waitFor();assert.equal(await recoveryPage.getByRole('button',{name:'Verify with Google',exact:true}).count(),0);assert.equal(await recoveryPage.getByRole('dialog').isVisible(),false);assert.equal(await recoveryPage.getByLabel('Email address',{exact:true}).count(),0);
 await recoveryPage.getByRole('button',{name:'Email me a code',exact:true}).click();await recoveryPage.getByLabel('Email code',{exact:true}).waitFor();await recoveryPage.getByLabel('Email code',{exact:true}).fill(code(recoveryEmail));await recoveryPage.getByRole('button',{name:'Continue',exact:true}).click();await recoveryPage.getByRole('status').filter({hasText:'Signed in again'}).waitFor();assert.equal(recoveryDeletes,1);assert.equal(read('SELECT id FROM user WHERE id=?',recoveryUid).length,1);assert.equal((await(await recoveryContext.request.get(front+'/api/account')).json()).user.id,recoveryUid);assert.ok(await recoveryPage.evaluate(id=>localStorage.getItem('puptime.account.deletion.'+id),recoveryUid));
 const recoveryRecorded=await context({storageState:await recoveryContext.storageState(),recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}},viewport:{width:1440,height:1000}}),recoveryReview=await recoveryRecorded.newPage();await recoveryReview.goto(front+'/account');await recoveryReview.getByRole('button',{name:'Retry deletion',exact:true}).waitFor();await recoveryReview.waitForTimeout(2200);await recoveryReview.getByRole('button',{name:'Retry deletion',exact:true}).click();await recoveryReview.getByRole('dialog',{name:'Delete cloud account?'}).waitFor();await recoveryReview.screenshot({path:join(output,'314-web-deletion-recovery-confirmation.png'),fullPage:true});await recoveryReview.waitForTimeout(2200);await recoveryReview.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(read('SELECT id FROM user WHERE id=?',recoveryUid).length,1);await recoveryReview.getByRole('button',{name:'Retry deletion',exact:true}).click();await recoveryReview.getByRole('dialog').getByRole('button',{name:'Delete cloud account',exact:true}).click();await recoveryReview.getByRole('status').filter({hasText:'Cloud account deleted'}).waitFor();assert.equal(read('SELECT id FROM user WHERE id=?',recoveryUid).length,0);assert.equal(await recoveryReview.evaluate(id=>localStorage.getItem('puptime.account.deletion.'+id),recoveryUid),null);await recoveryReview.waitForTimeout(2600);const recoveryVideo=recoveryReview.video();await recoveryRecorded.close();if(recoveryVideo)writeFileSync(join(output,'314-video-source.txt'),await recoveryVideo.path());await recoveryContext.close();pass('Uncertain deletion survives stale auth, verifies the same owner without signup, and requires a new cancellable confirmation before retry.');
 const marketingContext=await context(),marketing=await marketingContext.newPage();await marketing.goto(front+'/');await marketing.getByRole('heading',{level:1,name:'Puppy log',exact:true}).waitFor();await marketing.screenshot({path:join(output,'311-web-marketing-desktop.png'),fullPage:true});await marketing.setViewportSize({width:390,height:844});await marketing.screenshot({path:join(output,'312-web-marketing-mobile.png'),fullPage:true});assert.equal(await marketing.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await marketing.close();await marketingContext.close();pass('The marketing homepage renders at desktop and phone widths with account navigation and iPhone-first claims.');
 const forbidden=apiCalls.filter(call=>!call.fixture&&/\/api\/(cloud\/(trial|enroll)|sync\/push)/.test(call.path));assert.deepEqual(forbidden,[]);
 await otherContext.close();await privateContext.close();
 writeFileSync(join(output,'verification.json'),JSON.stringify({passed:summary,scope:'Local genuine OTP/D1/DO + simulated external provider cancellation; no live provider or telemetry ingestion claim; optional analytics uses an isolated local mock.',privateAuthRecorded:false},null,2));
 console.log('Review evidence:',output);
 }
 }
}catch(error){if(reviewPage&&!reviewPage.isClosed())await reviewPage.screenshot({path:join(output,coreAccountsOnly?'core-public-review-failure.png':appleDeletionOnly?'327-public-review-failure.png':'319-public-review-failure.png'),fullPage:true}).catch(()=>{});let message=error?.message??'unknown failure';for(const secret of privateCodes)message=message.replaceAll(secret,'[REDACTED]');console.error('FAIL isolated web acceptance:',message);process.exitCode=1;}
finally{
 rmSync(join(output,'private-export.ndjson'),{force:true});
 await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
 if(worker?.pid){try{process.kill(-worker.pid,'SIGTERM');}catch{}}
 assert.ok(directory.startsWith(join(tmpdir(),'puptime-web-account-local-')));rmSync(directory,{recursive:true,force:true});
}
