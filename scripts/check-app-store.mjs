// Run without native tooling: validates metadata parity, limits and upload image files.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path));
const config=JSON.parse(read('store.config.json')),app=JSON.parse(read('app.json'));
assert.equal(config.apple.version,app.expo.version);
assert.equal(config.apple.release.automaticRelease,false);
const info=config.apple.info['en-US'];
const fields={title:['name',30],subtitle:['subtitle',30],description:['description',4000],keywords:['keywords',100],promoText:['promotional_text',170],releaseNotes:['release_notes',4000],marketingUrl:['marketing_url'],supportUrl:['support_url'],privacyPolicyUrl:['privacy_url']};
for(const [key,[file,limit]] of Object.entries(fields)){
 const value=Array.isArray(info[key])?info[key].join(','):info[key];
 assert.equal(read(`fastlane/metadata/en-US/${file}.txt`).toString().trim(),value,`${key} differs between upload paths`);
 assert.ok(value.length>0&&(!limit||value.length<=limit),`${key} exceeds its limit`);
}
const keywords=info.keywords.map(value=>value.toLowerCase());
assert.equal(new Set(keywords).size,keywords.length);
const visible=`${info.title} ${info.subtitle} ${config.apple.categories.join(' ')}`.toLowerCase().match(/[a-z]+/g);
for(const word of keywords)assert.ok(!visible.includes(word),`Duplicate visible keyword: ${word}`);
const manifest=JSON.parse(read('fastlane/screenshot-manifest.json'));
const files=readdirSync(resolve(root,'fastlane/screenshots/en-US')).sort();
assert.deepEqual(files,manifest.map(item=>item.file).sort(),'Unexpected/missing upload screenshots');
assert.equal(files.length,12);
for(const item of manifest){
 const png=read(`fastlane/screenshots/en-US/${item.file}`);
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],item.dimensions);
 assert.equal(png[25],2,'PNG must be RGB without an alpha channel');
 assert.equal(createHash('sha256').update(png).digest('hex'),item.sha256);
 assert.deepEqual(item.dimensions,item.file.startsWith('iPad')?[2064,2752]:[1206,2622]);
}
for(const [file,size] of [['header',[3840,1646]],['search',[1920,1280]]]){
 const png=read(`fastlane/creative-assets/en-US/${file}.png`);
 assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],size);
 assert.equal(png[25],2,'Creative assets must be opaque RGB');
}
const video=read('fastlane/previews/en-US/iPhone-6.3-preview.mp4');
assert.ok(video.length>0&&video.length<500_000_000);
const edit=JSON.parse(read('fastlane/previews/en-US/edit.json'));
assert.equal(createHash('sha256').update(video).digest('hex'),edit.sha256,'Preview differs from the verified export');
assert.ok(edit.seconds>=15&&edit.seconds<=30);
assert.equal(edit.frozen_padding_seconds,0);
assert.ok(Number.isFinite(edit.transition_seconds)&&edit.transition_seconds>0&&edit.transition_seconds<=.5);
assert.ok(edit.poster_seconds>=0&&edit.poster_seconds<edit.seconds);
assert.equal(edit.step_labels.length,edit.scenes.length,'Each scene needs an animated step label');
for(const [index,label] of edit.step_labels.entries()){
 assert.equal(label.step,index+1);assert.equal(label.screen,edit.scenes[index].screen);
 assert.ok(typeof label.title==='string'&&label.title.length>0&&label.title.length<=28);
 assert.ok(Number.isFinite(label.at)&&Number.isFinite(label.duration)&&label.at>=0&&label.duration>=1.2&&label.at+label.duration<=edit.seconds);
 if(index)assert.ok(edit.step_labels[index-1].at+edit.step_labels[index-1].duration<=label.at,'Step labels must not overlap');
}
assert.ok(Array.isArray(edit.tap_indicators)&&edit.tap_indicators.length>0,'Preview must show touch indicators');
for(const tap of edit.tap_indicators){
 assert.ok(Number.isFinite(tap.at)&&Number.isFinite(tap.duration)&&tap.at>=0&&tap.duration>0&&tap.at+tap.duration<=edit.seconds);
 assert.ok(Number.isFinite(tap.x)&&Number.isFinite(tap.y)&&tap.x>=0&&tap.x<886&&tap.y>=0&&tap.y<1920);
 assert.ok(typeof tap.control==='string'&&tap.control.length>0);
 assert.ok(Number.isFinite(tap.tap_at)&&tap.tap_at-tap.at>=.5&&tap.at+tap.duration-tap.tap_at>=.5,'A tap needs time to anticipate and register');
}
for(const scene of edit.scenes){
 assert.ok(Array.isArray(scene.segments)&&scene.segments.length>0);
 let expected=0,last=scene.raw_start;
 for(const segment of scene.segments){
  assert.ok(Number.isFinite(segment.speed)&&segment.speed>0&&segment.speed<=1);
  assert.ok(last<=segment.raw_start&&segment.raw_start<segment.raw_end&&segment.raw_end<=scene.raw_end);
  expected+=(segment.raw_end-segment.raw_start)/segment.speed;last=segment.raw_end;
 }
 assert.ok(Math.abs(scene.edited_seconds-expected)<.15*scene.segments.length,'A retimed cut differs from its reviewed source ranges');
}
const expectedSeconds=edit.scenes.reduce((sum,scene)=>sum+scene.edited_seconds,0)-edit.transition_seconds*(edit.scenes.length-1);
assert.ok(Math.abs(edit.seconds-expectedSeconds)<.1,'Transition timing differs from the export');
console.log(`PASS metadata, 12 opaque screenshots, 2 creative assets and the verified preview with ${edit.tap_indicators.length} touch indicators and no padded holds.`);
