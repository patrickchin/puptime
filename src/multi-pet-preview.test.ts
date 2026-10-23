import assert from 'node:assert/strict';
import {test} from 'node:test';
import {householdLogs,multiPetFixtures} from './multi-pet-preview.ts';

test('multi-pet preview retains pet identity with colliding event IDs, distinct history and routines',()=>{
  const pets=multiPetFixtures(new Date(2026,9,23,11,45).getTime());
  assert.ok(pets.every(pet=>pet.events.length>100));
  assert.notEqual(pets[0].events.length,pets[1].events.length);
  assert.notDeepEqual(pets[0].schedule,pets[1].schedule);
  pets[1].events[0]={...pets[1].events[0],id:pets[0].events[0].id};
  const all=householdLogs(pets),filtered=householdLogs(pets,pets[1].id);
  assert.equal(all.length,pets.reduce((sum,pet)=>sum+pet.events.length,0));
  assert.equal(filtered.length,pets[1].events.length);
  assert.ok(filtered.every(row=>row.petId===pets[1].id&&row.petName==='Maple'));
  assert.equal(new Set(all.map(row=>`${row.petId}:${row.event.id}`)).size,all.length);
  assert.ok(all.every((row,i)=>i===0||all[i-1].event.at>=row.event.at));
  assert.deepEqual(householdLogs([{id:'pet_new',name:'New dog',detail:'',events:[],schedule:[]}]),[]);
});
