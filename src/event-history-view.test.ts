import assert from 'node:assert/strict';
import test from 'node:test';
import * as view from './event-history-view.ts';
import type {EventHistoryHead} from './event-history.ts';
import type {PuppyEvent} from './domain.ts';

const event:PuppyEvent={id:'one',type:'custom',customLabel:'Training',at:1000,note:'First',source:'widget'};
const head:EventHistoryHead={sequence:2,owner:null,event:{...event,note:'Second',estimated:true},cloudRecord:null};

test('history preview keeps estimated provenance and compares the values that will actually be restored',()=>{
 const result=view.historyRestorePreview(event,head,{...head.event!});
 assert.deepEqual(result,{event:{...event,estimated:true},problem:null});
 assert.deepEqual(view.historyRestorePreview({...event,note:'Second'},head,head.event),{event:{...event,note:'Second',estimated:true},problem:'identical'});
 assert.deepEqual(view.historyChangedFields({...event,note:'Second',estimated:true},{...event,estimated:true}),['note']);
});

test('history preview keeps deleted and nap versions readable without offering unsafe restoration',()=>{
 assert.equal(view.historyRestorePreview(null,head,head.event).problem,'deleted');
 assert.equal(view.historyRestorePreview({...event,type:'nap'},head,head.event).problem,'unsupported');
 assert.equal(view.historyRestorePreview(event,{...head,event:null},{...event,type:'nap'}).problem,'unsupported');
 assert.equal(view.historyRestorePreview(event,{...head,event:null},head.event).event?.estimated,true);
 assert.deepEqual(view.historyChangedFields(event,null),['deleted']);
 assert.deepEqual(view.historyChangedFields(null,event),['created']);
 assert.deepEqual(view.historyChangedFields(event,{...event,at:2000,source:'app',estimated:true,note:''}),['at','note','source','estimated']);
});
