import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountSnapshot } from './account-controller.ts';
import * as statuses from './account-status.ts';
const state:AccountSnapshot={config:null,linkedProviders:null,linkingProvider:null,account:{user:{id:'one',email:'person@example.com',name:'Person'},cloud:{canSync:true,canExport:true,source:'trial',expiresAt:9999999999999},pets:[]},local:null,sync:{state:'active',generation:'generation',accountId:'one',pending:0,blocked:0,cursor:10},run:{state:'synced',pending:0,blocked:0,retryAfterMs:null,problem:null},problem:null,codeSentTo:null,busy:false,exporting:false,enabling:false,deletion:null,deletionNotice:null,running:false,active:true,online:true,lastSyncedAt:100};
function status(input:AccountSnapshot|null){assert.equal(typeof statuses.accountStatus,'function');return statuses.accountStatus(input);}

test('a previous successful sync never hides new pending or blocked local changes',()=>{
 assert.equal(status(state),'synced');
 assert.equal(status({...state,sync:{...state.sync!,pending:2}}),'pending');
 assert.equal(status({...state,sync:{...state.sync!,pending:2,blocked:1}}),'attention');
 assert.equal(status({...state,run:null}),'checking');
});
test('local-only and signed-in unenrolled use do not show irrelevant offline sync errors',()=>{
 assert.equal(status(null),'local');assert.equal(status({...state,account:null,sync:null,online:false}),'local');
 assert.equal(status({...state,sync:{...state.sync!,state:'local',accountId:null,generation:null},online:false}),'notEnabled');
 assert.equal(status({...state,online:false}),'offline');
});
test('owner mismatch, expiry and lost authentication have priority over a stale success',()=>{
 assert.equal(status({...state,account:null}),'auth');assert.equal(status({...state,sync:{...state.sync!,accountId:'other'}}),'mismatch');
 assert.equal(status({...state,account:{...state.account!,cloud:{canSync:false,canExport:true,source:'none',expiresAt:null}}}),'expired');
 assert.equal(status({...state,problem:'expired'}),'expired');assert.equal(status({...state,problem:'sign-out-failed'}),'paused');
});
test('an unavailable cloud after cold start does not claim authentication expired',()=>{
 assert.equal(status({...state,account:null,problem:'network'}),'offline');
 assert.equal(status({...state,account:null,problem:'server-error'}),'paused');
 assert.equal(status({...state,account:null,busy:true,run:null}),'checking');
 assert.equal(status({...state,account:null,problem:'auth-required'}),'auth');
});
