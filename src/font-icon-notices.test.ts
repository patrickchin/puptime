import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root));
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const provenance=JSON.parse(read('scripts/font-icon-provenance.json').toString());
const notices=(JSON.parse(read('assets/notices/third_party_notices.json').toString()) as {id:string;body:string;androidOnly?:boolean}[])
 .filter(section=>Object.hasOwn(provenance.notices,section.id));

test('font bytes, glyphs, pinned dependencies and verbatim license copies require deliberate notice review on change',()=>{
 const lock=JSON.parse(read('package-lock.json').toString());
 for(const [name,version] of Object.entries(provenance.packages)) {
  assert.equal(lock.packages[`node_modules/${name}`].version,version,`${name} lock changed: review font notices`);
  assert.equal(JSON.parse(read(`node_modules/${name}/package.json`).toString()).version,version,`${name} install differs`);
 }
 for(const [path,expected] of Object.entries(provenance.files))assert.equal(hash(read(path)),expected,`${path}: review font/license provenance`);
 assert.equal(notices.length,Object.keys(provenance.notices).length);
 assert.equal(new Set(notices.map(section=>section.id)).size,notices.length);
 for(const section of notices)assert.equal(hash(section.body),provenance.notices[section.id],`${section.id}: license text changed`);
 const body=(id:string)=>notices.find(section=>section.id===id)!.body;
 assert.equal(body('red-hat'),read('assets/fonts/RedHat-OFL.txt').toString());
 assert.equal(body('expo-vector-icons'),read('node_modules/@expo/vector-icons/LICENSE').toString());
 assert.equal(body('react-native-vector-icons'),read('node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/LICENSE').toString());
 assert.equal(hash(body('material-community-icons')),provenance.upstream.materialCommunityIcons.licenseSha256);
 assert.equal(hash(body('apache-2')),provenance.upstream.androidRoboto.licenseSha256);
 assert.ok(body('roboto').includes(provenance.upstream.androidRoboto.copyright));
 assert.deepEqual(notices.filter(section=>section.androidOnly).map(section=>section.id),['roboto']);
});

test('application imports only the used icon family rather than the all-font barrel',()=>{
 function check(path:string):void {
  for(const entry of readdirSync(new URL(path,root),{withFileTypes:true})) {
   const file=`${path}/${entry.name}`;
   if(entry.isDirectory())check(file);
   else if(/\.tsx?$/.test(file)&&!file.endsWith('.test.ts'))assert.ok(!/['"]@expo\/vector-icons['"]/.test(read(file).toString()),file);
  }
 }
 check('src');
 assert.ok(!/['"]@expo\/vector-icons['"]/.test(read('App.tsx').toString()));
});
