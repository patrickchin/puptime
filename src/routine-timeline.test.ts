import assert from 'node:assert/strict';
import test from 'node:test';
import {routineTimelineTargets} from './routine-timeline.ts';
import type {ScheduleEntry} from './domain.ts';

test('routine chart targets retain every entry in non-overlapping touch areas, including simultaneous and boundary times',()=>{
 const entries:ScheduleEntry[]=[{id:'rtn_last',type:'pee',minutes:1439},{id:'rtn_meal',type:'meal',minutes:390},{id:'rtn_first',type:'pee',minutes:0},{id:'rtn_poop',type:'poop',minutes:390},{id:'rtn_nearby',type:'walk',minutes:391}];
 for(const trackWidth of [320,375,402,688]){
  const targets=routineTimelineTargets(entries,trackWidth);
  assert.deepEqual(targets.flatMap(target=>target.entries.map(entry=>entry.id)),['rtn_first','rtn_meal','rtn_poop','rtn_nearby','rtn_last']);
  for(const [index,target] of targets.entries()){
   assert.ok(target.width>=48);
   assert.ok(target.left>=0&&target.left+target.width<=trackWidth+1e-8);
   if(index)assert.ok(targets[index-1].left+targets[index-1].width<=target.left+1e-8);
   for(const entry of target.entries){
    assert.ok(entries.includes(entry),'retain original entry identity for editing');
    const position=entry.minutes/1440*trackWidth;
    assert.ok(position>=target.left&&position<=target.left+target.width);
   }
  }
  assert.deepEqual(targets.find(target=>target.entries.includes(entries[1]))?.entries,[entries[1],entries[3],entries[4]]);
 }
 assert.deepEqual(routineTimelineTargets(entries,0),[]);
 assert.deepEqual(routineTimelineTargets([],375),[]);
});
