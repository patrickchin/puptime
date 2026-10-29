import assert from 'node:assert/strict';
import test from 'node:test';
import {createShareSchema,reuseCareRows,sharingUrl,careEditPatch,type CareRow} from './sharing.ts';

test('shared history retains unchanged rows with populated history, and replaces edits or permission changes',()=>{
 const rows:CareRow[]=Array.from({length:500},(_,i)=>({localId:`entry-${i}`,canEdit:true,record:{id:JSON.stringify(['event','pet_123',`entry-${i}`]),petId:'pet_123',kind:'event',revision:1,sequence:i+1,deleted:false,updatedAt:100,data:{type:'walk',at:100,source:'app'}}}));
 const refreshed=rows.map(row=>structuredClone(row));refreshed[42].record.revision=2;refreshed[43].canEdit=false;
 const next=reuseCareRows(rows,refreshed);
 assert.equal(next.length,500);assert.equal(next.filter((row,i)=>row===rows[i]).length,498);
 assert.notEqual(next[42],rows[42]);assert.notEqual(next[43],rows[43]);
});
test('shared edits preserve untouched timing, source, estimate provenance and long notes',()=>{
 const row:CareRow={localId:'evt_one',canEdit:true,record:{id:'one',petId:'pet_one',kind:'event',revision:1,sequence:1,deleted:false,updatedAt:100,data:{type:'nap',at:100,source:'widget',estimated:true,note:'x'.repeat(16384)}}};
 assert.deepEqual(careEditPatch(row,{type:'nap',at:100,source:'app',endedAt:null,note:'x'.repeat(16384)}),{});
 assert.deepEqual(careEditPatch(row,{type:'nap',at:100,source:'app',endedAt:null,note:'Updated'}),{note:'Updated'});
});
test('invitation credentials stay in the URL fragment and household access has no end time',()=>{
 const id='shr_'+'a'.repeat(32),token='inv_'+'b'.repeat(32),url=new URL(sharingUrl('https://puptime.test',id,token));
 assert.equal(url.searchParams.get('invite'),id);assert.equal(url.hash,'#'+token);assert.ok(!url.pathname.includes(token)&&!url.search.includes(token));
 const input={id,token,petId:'pet_123',kind:'household',permission:'contribute',expiresAt:null,label:'Alex'};
 assert.ok(createShareSchema.safeParse(input).success);
 assert.ok(!createShareSchema.safeParse({...input,expiresAt:100}).success);
 assert.ok(!createShareSchema.safeParse({...input,permission:'view'}).success);
});
