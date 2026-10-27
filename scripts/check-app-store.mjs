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
assert.equal(edit.playback_speed,1);
assert.equal(edit.frozen_padding_seconds,0);
for(const scene of edit.scenes)assert.ok(Math.abs(scene.edited_seconds-(scene.raw_end-scene.raw_start))<.1,'A preview cut inherited idle time');
console.log('PASS metadata, 12 opaque screenshots, 2 creative assets and the verified preview without padded holds.');
