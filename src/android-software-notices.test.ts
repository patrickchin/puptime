import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root));
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');

test('selected Android license copies retain exact upstream text and package versions',()=>{
 const bytes=read('src/android-software-notices.json');
 const payload=JSON.parse(bytes.toString());
 const provenance=JSON.parse(read('scripts/android-software-notice-provenance.json').toString());
 const lock=JSON.parse(read('package-lock.json').toString());
 assert.ok(['INCOMPLETE','READY'].includes(provenance.status));
 assert.equal(sha(bytes),provenance.payloadSHA256);
 assert.equal(payload.length,provenance.components.length);
 assert.equal(new Set(payload.map((section:{id:string})=>section.id)).size,payload.length);
 for(const component of provenance.components){
  const section=payload.find((value:{id:string})=>value.id===component.sectionId);
  assert.ok(section?.androidOnly);
  assert.equal(sha(section.body),component.sectionSHA256);
  const bodies=component.notices.map((notice:{source:string;sha256:string;upstream:string})=>{
   assert.equal(new URL(notice.upstream).protocol,'https:');
   const bytes=read(notice.source);assert.equal(sha(bytes),notice.sha256);return bytes.toString();
  });
  assert.equal(section.body,bodies.join('\n\n'),'Retain the copyright, permission, conditions and disclaimer verbatim.');
  assert.equal(lock.packages[component.packagePath].version,component.version);
  assert.equal(lock.packages[component.packagePath].integrity,component.integrity);
  const packageBytes=read(`${component.packagePath}/package.json`);
  assert.equal(sha(packageBytes),component.packageJSONSHA256);
  assert.equal(JSON.parse(packageBytes.toString()).name,component.name);
  assert.equal(JSON.parse(packageBytes.toString()).version,component.version);
 }
});
