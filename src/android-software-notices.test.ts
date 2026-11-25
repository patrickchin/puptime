import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root));
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const bytes=read('src/android-software-notices.json');
const payload=JSON.parse(bytes.toString());
const provenance=JSON.parse(read('scripts/android-software-notice-provenance.json').toString());
const sections=new Map<string,any>(payload.map((section:any)=>[section.id,section]));

test('Android notice copies preserve distinct full bodies and every selected component attribution',()=>{
 assert.ok(['INCOMPLETE','REVIEWED_SOURCE'].includes(provenance.status));
 assert.equal(sha(bytes),provenance.payloadSHA256);
 assert.equal(sections.size,payload.length);
 assert.equal(new Set(payload.map((section:any)=>sha(section.body))).size,payload.length,'Only byte-identical documents are deduplicated.');
 const lock=JSON.parse(read('package-lock.json').toString());
 const ids=new Set();
 for(const record of provenance.texts){
  const section=sections.get(record.sectionId);assert.ok(section?.androidOnly);
  assert.equal(sha(section.body),record.sha256);
  assert.ok(section.attributions.length>0);
  if(record.presentationSHA256)assert.equal(sha(section.displayBody),record.presentationSHA256);
 }
 for(const component of provenance.components){
  assert.ok(!ids.has(component.component));ids.add(component.component);
  assert.ok(component.notices.length>0);
  for(const notice of component.notices){
   const referenced=notice.sectionIds??[notice.sectionId];
   for(const id of referenced)assert.ok(sections.get(id)?.attributions.some((text:string)=>text.includes(component.name+' '+component.version)));
   if(notice.sectionId&&notice.sha256)assert.equal(sha(sections.get(notice.sectionId).body),notice.sha256);
  }
  for(const observed of component.observedNotices){
   assert.ok(component.notices.some((notice:any)=>notice.source===observed.source&&notice.sha256===observed.sha256),'An actual bundled notice was dropped.');
  }
  for(const input of component.packageInputs??[]){
   const pkg=read(`${input.packagePath}/package.json`);
   assert.equal(sha(pkg),input.packageJSONSHA256);
   assert.equal(JSON.parse(pkg.toString()).version,component.version);
   assert.equal(lock.packages[input.packagePath].integrity,input.integrity);
  }
 }
 for(const vendor of provenance.nativeVendors){
  assert.ok(vendor.ownerComponents.every((id:string)=>ids.has(id)));
  for(const notice of vendor.notices)assert.equal(sha(sections.get(notice.sectionId).body),notice.sha256);
 }
});

test('publisher-index deduplication reconstructs every original full license file exactly',()=>{
 for(const document of provenance.publisherDocuments){
  const reconstructed=document.pieces.map((piece:any)=>piece.literal??sections.get(piece.sectionId).body).join('');
  assert.equal(sha(reconstructed),document.sourceSHA256,'A copyright, notice, condition or separator changed.');
  const index=payload.find((section:any)=>section.kind==='index'&&sha(section.body)===document.indexSHA256);
  assert.ok(index);
  const names=new Set(Object.keys(JSON.parse(index.body)));
  for(const piece of document.pieces){
   if(piece.literal?.trim())assert.ok(piece.literal.trim().replace(/:$/,'').split(', ').every((name:string)=>names.has(name)),'Only publisher-name headings may sit outside the displayed complete license bodies.');
  }
 }
});

test('the HTML notice presentation keeps all legal words and link targets while preserving its source',()=>{
 const words=(value:string)=>value.match(/[\p{L}\p{N}]+/gu)?.join(' ')??'';
 for(const section of payload.filter((value:any)=>value.presentation==='html-body-text-and-link-targets')){
  const visible=section.body.replace(/^[\s\S]*?<body[^>]*>/i,'').replace(/<\/body>[\s\S]*$/i,'').replace(/<[^>]+>/g,' ')
   .replace(/&copy;/g,'©').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  assert.ok(words(section.displayBody).startsWith(words(visible)),'The readable presentation dropped or changed legal wording.');
  for(const link of section.body.matchAll(/href="(https?:[^\"]+)"/g))assert.ok(section.displayBody.includes(link[1]));
 }
});
