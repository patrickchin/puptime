import assert from 'node:assert/strict';
import test from 'node:test';
import {notificationActions} from './quiet-status-actions.ts';
import type {NotificationWidgetProps} from './quiet-status-config';

const props:NotificationWidgetProps={events:[],actions:['pee','poop','meal'],customActivities:[],themePreference:'system',petId:'pet_biscuit',scope:'owner',title:'Biscuit'};
test('notification actions preserve widget selection, real event timers and scoped background logging',()=>{
  const actions=notificationActions({...props,events:[
    {id:'evt_poop',type:'poop',at:1000,source:'app'},
    {id:'evt_estimate',type:'poop',at:2000,estimated:true,source:'app'},
  ]});
  assert.deepEqual(actions.map(a=>[a.label,a.emoji,a.lastAt]),[['Pee','💧',null],['Poop','💩',1000],['Ate','🍽️',null]]);
  assert.deepEqual(actions[1].clickActionData,{type:'poop',scope:'owner',source:'notification',petId:'pet_biscuit'});
  const sleeping=notificationActions({...props,events:[{id:'evt_nap',type:'nap',at:1000,endedAt:null,source:'app'}]});
  assert.equal(sleeping[3].label,'End nap');assert.equal(sleeping[3].emoji,'☀️');
  const custom=notificationActions({...props,actions:['pee','custom:medicine'],customActivities:['Medicine']});
  assert.equal(custom[1].label,'Medicine');assert.equal(custom[1].emoji,'🏷️');
});
