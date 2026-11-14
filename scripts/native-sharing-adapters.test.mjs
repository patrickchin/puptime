import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createSharingObserver,readSharingSnapshot,runSharingFlow,createSharingActors,readOwnerSharingRecords} from './native-sharing-adapters.mjs';
import {cloudRecordId} from '../src/cloud/record-identity.ts';

const shareId='shr_'+'1'.repeat(32),token='inv_'+'2'.repeat(32);
const emails={owner:'native-sharing-owner@example.invalid',carer:'native-sharing-carer@example.invalid'};
function observer(){return createSharingObserver({ownerEmail:emails.owner,carerEmail:emails.carer,protectSecret:()=>{}});}
function bind(io,actor){
 const ticket=io.begin({method:'GET',url:'/api/account',headers:{cookie:`better-auth.session_token=${actor}-secret`}});
 io.finish(ticket,200,{user:{id:'usr_'+actor,email:emails[actor],name:''}});
}

test('request receipts bind observed SDK sessions, not the active device or a claimed header',()=>{
 const io=observer();bind(io,'owner');bind(io,'carer');
 const ticket=io.begin({method:'GET',url:'/api/account',headers:{cookie:'better-auth.session_token=carer-secret','x-puptime-account':'usr_carer','x-puptime-share':shareId}});
 // A later unrelated exchange cannot relabel the in-flight caregiver request.
 bind(io,'owner');io.finish(ticket,410,{});
 assert.deepEqual(io.responses().at(-1),{actor:'carer',shareId,forwarded:true,method:'GET',path:'/api/account',status:410});
 assert.throws(()=>io.begin({method:'POST',url:'/api/sync/push',headers:{cookie:'better-auth.session_token=owner-secret','x-puptime-account':'usr_carer'}}));
 const unknown=io.begin({method:'GET',url:'/api/account',headers:{cookie:'better-auth.session_token=unknown','x-puptime-account':'usr_owner'}});
 assert.throws(()=>io.finish(unknown,200,{user:{id:'usr_carer',email:emails.carer}}));
 const receipt=JSON.stringify(io.responses());for(const secret of ['owner-secret','carer-secret',emails.owner,emails.carer])assert.ok(!receipt.includes(secret));
});

test('accepted membership and readable actor derive from exact native acceptance and service response',()=>{
 const io=observer();bind(io,'carer');
 const ticket=io.begin({method:'POST',url:'/api/care/accept',headers:{cookie:'better-auth.session_token=carer-secret','x-puptime-account':'usr_carer'}});
 io.requestBody(ticket,{id:shareId,token});io.finish(ticket,200,{id:shareId});
 assert.equal(io.actor('carer').shareId,shareId);
 io.membership({shares:[{id:shareId,petId:'pet_owner',kind:'household',permission:'contribute',label:'Fixture household helper',expiresAt:null,inviteExpiresAt:100,memberName:null,accepted:true,revoked:false,createdAt:1}]});
 assert.equal(io.actor('carer').attribution,'Fixture household helper');
 assert.ok(!JSON.stringify(io.responses()).includes(token));
});

test('care snapshot uses current persisted selection, every actual SQL table and read-only access',async t=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-care-snapshot-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const sqlite=join(root,'Documents/SQLite'),storage=join(root,'Library/Application Support/com.patrickchin.puptime/RCTAsyncLocalStorage_V1');mkdirSync(sqlite,{recursive:true});mkdirSync(storage,{recursive:true});
 for(const [filename,id] of [['puptime-v2.db','evt_personal'],[`puptime-${shareId}-usr_carer.db`,'evt_shared']]){
  const db=await createLocalDatabase(sqliteTestConnection(join(sqlite,filename)));const {petId}=await initializeLocalDatabase(db,()=> 'pet_synthetic');
  await db.write(sql=>sql.runAsync('INSERT INTO events(pet_id,id,type,at,source) VALUES (?,?,?,?,?)',petId,id,'pee',100,'app'));await db.close();
 }
 const selected={id:shareId,accountId:'usr_carer',name:'Synthetic',ownerName:'',petId:'pet_owner',kind:'household',permission:'contribute',expiresAt:null};
 const manifest=join(storage,'manifest.json');writeFileSync(manifest,JSON.stringify({'puptime.active-care':JSON.stringify(selected)}));
 const shared=readSharingSnapshot(root,{care:true,accountId:'usr_carer',shareId});assert.equal(Object.keys(shared.tables).length,14);assert.equal(shared.events[0].id,'evt_shared');
 assert.equal(readSharingSnapshot(root).events[0].id,'evt_personal');
 assert.throws(()=>readSharingSnapshot(root,{care:true,accountId:'usr_owner',shareId}));
 assert.throws(()=>readSharingSnapshot(root,{care:true,accountId:'usr_carer',shareId:'shr_'+'3'.repeat(32)}));
 writeFileSync(manifest,JSON.stringify({'puptime.active-care':null}));writeFileSync(join(storage,createHash('md5').update('puptime.active-care').digest('hex')),JSON.stringify(selected));
 assert.deepEqual(readSharingSnapshot(root,{care:true,accountId:'usr_carer',shareId}),shared);
 assert.deepEqual(readSharingSnapshot(root).events,[{id:'evt_personal',type:'pee',at:100,end_state:0,ended_at:null,custom_label:null,note:null,source:'app',estimated:null}]);
});

test('secret native flows discard local and global artifacts on both outcomes without raw errors',async t=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-secret-driver-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const startup=join(root,'startup'),output=join(root,'output');mkdirSync(startup);mkdirSync(join(startup,'preexisting'));
 let artifacts;
 await assert.rejects(runSharingFlow({device:'synthetic',name:'create-invitation',secret:true,output,startup,execute:async(_binary,args)=>{
  artifacts=args.at(-1);writeFileSync(join(artifacts,'failure.png'),token);mkdirSync(join(startup,'owned'));writeFileSync(join(startup,'owned','maestro.log'),token);throw new Error(token);
 }}),error=>!String(error).includes(token)&&/phase failed/.test(String(error)));
 assert.equal(existsSync(artifacts),false);assert.deepEqual(readdirSync(startup),['preexisting']);assert.equal(existsSync(output),false);
 await runSharingFlow({device:'synthetic',name:'create-invitation',secret:true,output,startup,execute:async(_binary,args)=>{
  artifacts=args.at(-1);writeFileSync(join(artifacts,'native-owner-attribution-detail.png'),token);mkdirSync(join(startup,'owned'));writeFileSync(join(startup,'owned','maestro.log'),token);
 }});
 assert.equal(existsSync(artifacts),false);assert.deepEqual(readdirSync(startup),['preexisting']);assert.equal(existsSync(output),false);
 await assert.rejects(runSharingFlow({device:'synthetic',name:'create-invitation',output,startup,execute:()=>assert.fail()}),/suppress every/);
});

test('actor switching serializes devices and clipboard clears even after a read failure',async()=>{
 const io=observer(),calls=[];let release;
 const bridge={activate:async value=>{calls.push(value);await new Promise(done=>release=done);},simctl:async args=>{calls.push(args);if(args[0]==='pbpaste')throw new Error(token);}};
 const actors=createSharingActors({devices:{owner:'owned-A',carer:'owned-B'},emails,observer:io,bridge,output:'/unused',protectSecret:()=>{}});
 const pending=actors.activate(actors.owner);await assert.rejects(actors.activate(actors.carer),/serial/);release();await pending;
 await assert.rejects(actors.owner.nativeShareCopy(),error=>!String(error).includes(token));assert.deepEqual(calls.at(-1),['pbcopy','owned-A']);
 const next=actors.activate(actors.carer);release();await next;assert.equal(calls.findLast(value=>value.device)?.previous,'owned-A');
});

test('registered interruption cleanup removes secret artifacts before exit and is idempotent',async t=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-sharing-interrupt-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const startup=join(root,'startup'),output=join(root,'output');mkdirSync(startup);let cleanup,artifacts,released=false;
 await assert.rejects(runSharingFlow({device:'synthetic',name:'create-invitation',secret:true,output,startup,
  registerCleanup:owned=>{cleanup=owned;return ()=>released=true;},execute:async(_binary,args)=>{
   artifacts=args.at(-1);writeFileSync(join(artifacts,'failure.png'),token);mkdirSync(join(startup,'owned'));writeFileSync(join(startup,'owned','maestro.log'),token);
   cleanup();assert.equal(existsSync(artifacts),false);assert.deepEqual(readdirSync(startup),[]);
   mkdirSync(join(startup,'later-unrelated'));cleanup();assert.ok(existsSync(join(startup,'later-unrelated')));throw new Error('interrupted');
  }}));
 assert.equal(released,true);assert.equal(existsSync(output),false);assert.equal(existsSync(artifacts),false);
});

test('a failed non-secret attribution phase retains only explicit bounded glyph images',async t=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-sharing-red-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const startup=join(root,'startup'),output=join(root,'output');mkdirSync(startup);let artifacts;
 await assert.rejects(runSharingFlow({device:'synthetic',name:'owner-attribution',output,startup,execute:async(_binary,args)=>{
  artifacts=args.at(-1);writeFileSync(join(artifacts,'native-owner-attribution-detail.png'),'synthetic visible note');writeFileSync(join(artifacts,'failure.png'),token);writeFileSync(join(artifacts,'hierarchy.json'),token);throw new Error(token);
 }}),error=>!String(error).includes(token));
 assert.deepEqual(readdirSync(output),['native-owner-attribution-detail.png']);assert.equal(existsSync(artifacts),false);
});

test('owner inspection paginates independently, retains latest records and requires forward progress',async()=>{
 const event={id:cloudRecordId('event','pet_owner','evt_shared'),petId:'pet_owner',kind:'event',data:{type:'walk',at:100,source:'app',note:'Synthetic'},revision:1,sequence:2,deleted:false,updatedAt:100};
 const puppy={id:'pet_owner',petId:'pet_owner',kind:'puppy',data:{name:'Synthetic'},revision:1,sequence:1,deleted:false,updatedAt:100};
 const revision={recordId:event.id,revision:1,sequence:2,operationId:'op_synthetic',deviceId:'usr_carer',acceptedAt:100,baseRevision:0,intent:'create',proposal:event.data,before:null,after:event,reason:'created'};
 const calls=[],memberships=[],get=async path=>{calls.push(path);if(path==='/api/sync/pull?after=0')return {changes:[puppy],cursor:1,hasMore:true};if(path==='/api/sync/pull?after=1')return {changes:[event],cursor:2,hasMore:false};if(path.startsWith('/api/sharing?'))return {shares:[]};return {revisions:[revision]};};
 const value=await readOwnerSharingRecords({get,historyFor:['evt_shared'],observer:{membership:body=>memberships.push(body)}});
 assert.equal(value.records.length,2);assert.deepEqual(value.revisions,[revision]);assert.deepEqual(memberships,[{shares:[]}]);assert.ok(calls.some(path=>path.includes(encodeURIComponent(event.id))));
 await assert.rejects(readOwnerSharingRecords({get:async()=>({changes:[puppy],cursor:1,hasMore:true}),observer:{membership:()=>{}}}),/forward-only/);
});
