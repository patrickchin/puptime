import assert from 'node:assert/strict';
import {join} from 'node:path';
import {entityId} from '../src/entity-id.ts';
import {cloudRecordId} from '../src/cloud/record-identity.ts';
export async function qualifyWebSharing({context,signIn,code,sql,front,output,pass,apiCalls,telemetry,privateCodes}){
 const owner=await context(),ownerPage=await owner.newPage();
 await signIn(ownerPage,`sharing-owner-${entityId('usr')}@example.invalid`);
 const accounts=new WeakMap();
 async function call(client,path,body,expected=200){
  if(path.startsWith('sharing')&&!accounts.has(client))accounts.set(client,(await (await client.request.get(front+'/api/account')).json()).user.id);
  const headers={origin:front,...(accounts.has(client)?{'x-puptime-account':accounts.get(client)}:{})};
  const response=body?await client.request.post(front+'/api/'+path,{headers,data:body}):await client.request.get(front+'/api/'+path,{headers});
  assert.equal(response.status(),expected,path);return response.ok()?response.json():null;
 }
 const petId=entityId('pet');await call(owner,'cloud/enroll',{operationId:entityId('csr'),deviceId:'sharing-web',localPetId:petId,name:'Biscuit'});
 const mutations=Array.from({length:61},(_,i)=>({protocolVersion:1,operationId:entityId('csr'),deviceId:'sharing-web',petId,recordId:cloudRecordId('event',petId,entityId('evt')),kind:'event',baseRevision:0,intent:'create',patch:{type:'meal',at:Date.now()-i*3600000,source:'app',note:`Owner meal ${i}`}}));
 mutations.push({...mutations[0],operationId:entityId('csr'),recordId:cloudRecordId('routine',petId,entityId('rtn')),kind:'routine',patch:{type:'meal',minutes:480}});
 for(let start=0;start<mutations.length;start+=50){const result=await call(owner,'sync/push',{mutations:mutations.slice(start,start+50)});assert.equal(result.rejected.length,0);}
 async function invitation(kind,permission='contribute'){
  const input={id:entityId('shr'),token:entityId('inv'),petId,kind,permission,label:'Browser qualification',expiresAt:kind==='temporary'?Date.now()+86400000:null};
  privateCodes.add(input.token);await call(owner,'sharing',input,201);return input;
 }
 async function accept(share){
  const recipient=await context({viewport:{width:390,height:844}}),page=await recipient.newPage();
  await page.goto(`${front}/care?invite=${share.id}#${share.token}`);
  await page.getByRole('heading',{name:'You’re looking after Biscuit.',exact:true}).waitFor();
  await page.waitForURL(url=>!url.hash);assert.equal(await page.getByRole('button',{name:'Accept invitation',exact:true}).isEnabled(),false);
  const email=`sharing-member-${entityId('usr')}@example.invalid`;
  await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByRole('button',{name:'Email me a code',exact:true}).click();
  await page.getByLabel('Email code',{exact:true}).waitFor();
  await page.getByLabel('Email code',{exact:true}).fill(code(email));await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Accept invitation',exact:true}).click();await page.getByRole('heading',{name:'Biscuit',exact:true}).waitFor();
  assert.equal(await page.evaluate(id=>sessionStorage.getItem(`puptime.care.invite.${id}`),share.id),null);
  assert.equal((await call(recipient,'account')).pets.length,0);
  return {recipient,page};
 }
 const temporary=await invitation('temporary'),{recipient,page}=await accept(temporary);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.mouse.move(190,500);await page.mouse.wheel(0,500);
 await page.waitForFunction(()=>window.scrollY>100,{},{timeout:5000});
 assert.equal(await page.locator('[data-record]').count(),51); // 50 logs and one routine.
 await page.getByRole('button',{name:'Load more logs',exact:true}).click();
 await page.locator('[data-record]').nth(61).waitFor();
 assert.equal(await page.locator('[data-record]').count(),62);
 assert.equal(await page.getByRole('button',{name:'Edit',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Add routine',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(output,'sharing-web-temporary.png'),fullPage:true});
 pass('Temporary invitation previews without auth, strips its fragment, accepts through genuine browser OTP, clears the stored secret, and scrolls/pages all 61 logs plus routine on a phone viewport.');
 // Commit the real request, then lose only its acknowledgment. Retrying the UI must replay one identity.
 const writePath=`**/api/care/${temporary.id}/logs`;
 await page.route(writePath,async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
 await page.getByRole('button',{name:'Log an activity',exact:true}).click();await page.getByLabel('Note',{exact:false}).fill('Browser carer walk');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Couldn’t reach Puptime'}).waitFor();
 assert.equal(await page.getByLabel('Note',{exact:false}).inputValue(),'Browser carer walk');
 await page.unroute(writePath);await page.getByRole('button',{name:'Save',exact:true}).click();
 const row=page.locator('[data-record]').filter({hasText:'Browser carer walk'});await row.waitFor();
 await row.getByRole('button',{name:'Edit',exact:true}).click();await row.getByLabel('Note',{exact:false}).fill('Browser corrected walk');await row.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByText('Browser corrected walk',{exact:false}).waitFor();
 let data=await call(recipient,`care/${temporary.id}`);const saved=data.records.find(row=>row.record.data.note?.includes('Browser corrected walk'));assert.ok(saved);assert.equal(saved.record.revision,2);
 const memberAccount=(await call(recipient,'account')).user.id;
 const ownerHistory=await call(owner,`records/${encodeURIComponent(saved.record.id)}/history`);assert.equal(ownerHistory.revisions.length,2);
 assert.ok(ownerHistory.revisions.every(row=>row.deviceId===memberAccount));
 await page.reload();await page.getByText('Browser corrected walk',{exact:false}).waitFor();
 assert.equal((await call(recipient,`care/${temporary.id}`)).records.filter(row=>row.record.data.note?.includes('Browser corrected walk')).length,1);
 pass('Browser carer retries a lost create acknowledgment without duplication, edits its own log, the owner sees two correctly attributed revisions, and the result survives reload. Owner logs and routines expose no edit controls.');
 const stale=page.locator('[data-record]').filter({hasText:'Browser corrected walk'});
 await stale.getByRole('button',{name:'Edit',exact:true}).click();await stale.getByLabel('Note',{exact:false}).fill('Stale browser draft');
 const changed=await call(owner,'sync/push',{mutations:[{...mutations[0],operationId:entityId('csr'),recordId:saved.record.id,baseRevision:2,intent:'patch',patch:{note:'Independent owner correction'}}]});assert.equal(changed.accepted.length,1);
 await stale.getByRole('button',{name:'Save',exact:true}).click();await stale.getByRole('alert').filter({hasText:'This entry changed'}).waitFor();
 assert.equal(await stale.getByLabel('Note',{exact:false}).inputValue(),'Stale browser draft');
 assert.equal((await call(recipient,`care/${temporary.id}`)).records.find(row=>row.record.id===saved.record.id).record.data.note,'Independent owner correction');
 await stale.getByRole('button',{name:'Cancel',exact:true}).first().click();await page.getByRole('button',{name:'Refresh logs',exact:true}).click();await page.getByText('Independent owner correction',{exact:true}).waitFor();
 pass('A stale browser edit preserves its draft, reports the conflict, and cannot overwrite an independent owner correction.');
 // A different normal account must not claim a previously accepted invitation.
 const stranger=await context(),strangerPage=await stranger.newPage();await signIn(strangerPage,`sharing-other-${entityId('usr')}@example.invalid`);
 await call(stranger,'care/accept',{id:temporary.id,token:temporary.token},409);
 await call(recipient,'care/accept',{id:temporary.id,token:temporary.token});
 pass('Acceptance is retry-safe for its member and rejects another signed-in claimant.');
 const household=await invitation('household'),house=await accept(household);
 assert.ok(await house.page.getByRole('button',{name:'Edit',exact:true}).count()>0);
 await house.page.getByRole('button',{name:'Add routine',exact:true}).click();await house.page.getByLabel('Time',{exact:true}).fill('09:30');await house.page.getByRole('button',{name:'Save',exact:true}).click();await house.page.locator('.care-editor').waitFor({state:'detached'});
 data=await call(house.recipient,`care/${household.id}?kind=routine`);assert.equal(data.records.length,2);
 // Invitation deadline does not terminate an accepted household membership.
 sql(`UPDATE puppy_shares SET invite_expires_at=0 WHERE id='${household.id}'`);
 await house.page.reload();await house.page.getByRole('heading',{name:'Biscuit',exact:true}).waitFor();
 pass('Household UI permits shared log/routine management and accepted membership survives its invitation deadline.');
 const viewerShare=await invitation('temporary','view'),viewer=await accept(viewerShare);
 await viewer.page.getByText('View only',{exact:true}).waitFor();
 assert.equal(await viewer.page.getByRole('button',{name:'Log an activity',exact:true}).count(),0);assert.equal(await viewer.page.getByRole('button',{name:'Edit',exact:true}).count(),0);
 await viewer.page.emulateMedia({colorScheme:'dark'});
 const darkBounds=await viewer.page.evaluate(()=>({page:document.querySelector('.care-page').getBoundingClientRect().bottom,content:document.querySelector('.care-page main').getBoundingClientRect().bottom}));
 assert.ok(darkBounds.page>=darkBounds.content,'The page background must cover the entire long history, including below the viewport.');
 await viewer.page.screenshot({path:join(output,'sharing-web-view-only-dark-full.png'),fullPage:true});
 await viewer.page.screenshot({path:join(output,'sharing-web-view-only-dark.png')});
 await call(owner,`sharing/${viewerShare.id}/revoke`,{});await viewer.page.getByRole('button',{name:'Refresh logs',exact:true}).click();await viewer.page.getByRole('heading',{name:'Access unavailable',exact:true}).waitFor();
 assert.equal(await viewer.page.locator('[data-record]').count(),0);
 pass('View-only UI disables all writes; refreshing after owner revocation removes protected rows and presents Access unavailable.');
 sql(`UPDATE puppy_shares SET expires_at=0 WHERE id='${temporary.id}'`);
 await page.getByRole('button',{name:'Refresh logs',exact:true}).click();await page.getByRole('heading',{name:'Access unavailable',exact:true}).waitFor();await page.screenshot({path:join(output,'sharing-web-access-ended.png'),fullPage:true});
 const invalid=await context(),invalidPage=await invalid.newPage();await invalidPage.goto(front+'/care?invite=bad');await invalidPage.getByRole('alert').filter({hasText:'This invitation link is invalid'}).waitFor();
 assert.ok(apiCalls.every(call=>!call.path.includes('inv_')));assert.equal(telemetry.length,0);
 assert.equal(await page.locator('meta[name=robots]').getAttribute('content'),'noindex, nofollow');assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'),'no-referrer');
 pass('Expiry and malformed invitations fail closed. Care requests never put invitation secrets in URLs; care pages send no telemetry and declare noindex/no-referrer.');
 for(const client of [owner,recipient,stranger,house.recipient,viewer.recipient,invalid])await client.close();
}
