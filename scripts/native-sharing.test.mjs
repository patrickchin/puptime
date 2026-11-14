import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addedEvent,assertVisibleAttribution,copiedInvitation} from './verify-native-sharing.mjs';

const origin='https://127.0.0.1:8799',id='shr_'+'1'.repeat(32),token='inv_'+'2'.repeat(32);
const link=`${origin}/care?invite=${id}#${token}`;

test('native handoff accepts only the exact local service and shipped invitation contract',()=>{
  assert.deepEqual(copiedInvitation(link,origin),{id,token,url:`puptime://care?invite=${id}#${token}`});
  for(const bad of [link.replace(origin,'https://puptime.pages.dev'),link.replace('/care?','/care/extra?'),
    link.replace('?invite=','?other=x&invite='),link+'&extra',link.replace(token,'invalid'),
    link.replace('https://','https://user:pass@'),link+'#trailing',link.replace(id,'shr_bad')]){
    assert.throws(()=>copiedInvitation(bad,origin),error=>!String(error).includes(token)&&!String(error).includes(bad));
  }
  assert.throws(()=>copiedInvitation(link,'https://puptime.pages.dev'),/isolated HTTPS loopback/);
  assert.throws(()=>copiedInvitation(token,origin),error=>!String(error).includes(token));
});

test('equal counts or one new row cannot conceal an overwritten original payload',()=>{
  const original={id:'evt_original',note:'Keep this exact value',at:1};
  assert.deepEqual(addedEvent([original],[original,{id:'evt_new',at:2}]),{id:'evt_new',at:2});
  assert.throws(()=>addedEvent([original],[{...original,note:'Changed'},{id:'evt_new',at:2}]));
  assert.throws(()=>addedEvent([original],[{id:'evt_new',at:2}]));
  assert.throws(()=>addedEvent([original],[original,{id:'evt_new',at:2},{id:'evt_extra',at:3}]));
});

test('service actor IDs are insufficient without the edited note and readable attribution',()=>{
  const note='Edited household entry',actor='Fixture household helper';
  assertVisibleAttribution({data:{note:`${note}\n\nLogged by ${actor}`}},note,actor);
  for(const saved of [note,`${note}\n\nLogged by Someone Else`,'Old text\n\nLogged by '+actor]){
    assert.throws(()=>assertVisibleAttribution({data:{note:saved},deviceId:'usr_carer'},note,actor));
  }
});
