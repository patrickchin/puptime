import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import notices from '../src/font-icon-notices.json' with {type:'json'};
import {nativeFontNoticeOutcome,readNativeFontNoticeOutcome,recordNativeFontNoticeOutcome} from './native-font-notice-evidence.mjs';

const unknown={status:'UNKNOWN'},secret='secret@example.invalid cookie=private 123456 /private/owner';
const command={status:'FAILED',kind:'scroll',targetId:'fontLicenses.react-native-vector-icons',sequence:23};
const body=id=>notices.find(section=>section.id===id).body;
const node=(id,bounds,children=[],extra={})=>({attributes:{...(id?{'resource-id':id}:{}),bounds,...extra},children});
const tree=(id='expo-vector-icons')=>node('screen.fontLicenses','[0,62][402,874]',[
 node('fontLicenses.body','[0,136][402,874]',[
  node('fontLicenses.'+id,'[16,140][386,168]'),
  node(undefined,'[16,176][386,1200]',[],{text:body(id),accessibilityText:body(id),value:secret,'private-attribute':secret}),
 ])
]);
const children=value=>value.children[0].children;
const privateRoot=()=>mkdtempSync(join(tmpdir(),'puptime-font-evidence-test-'));
const writeHierarchy=(root,value,name='step-024-scrollUntilVisible-fontLicenses.json')=>{
 const dir=join(root,'screen-hierarchy');mkdirSync(dir,{recursive:true});const file=join(dir,name);writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));return file;
};

test('actual static MIT bodies distinguish two identical-looking viewports without retaining text',()=>{
 const paragraph=id=>body(id).slice(body(id).indexOf('Permission is hereby'),body(id).lastIndexOf('SOFTWARE.')+'SOFTWARE.'.length);
 assert.equal(paragraph('expo-vector-icons'),paragraph('react-native-vector-icons'));
 for(const id of ['expo-vector-icons','react-native-vector-icons']){
  const value=nativeFontNoticeOutcome(tree(id));assert.equal(value.status,'KNOWN');assert.equal(value.staticBodySection,id);
  assert.deepEqual(value.controls['fontLicenses.'+id],{count:1,intersection:{x:16,y:140,width:370,height:28}});
  assert.equal(value.controls['fontLicenses.red-hat'],'UNKNOWN');assert.ok(!JSON.stringify(value).includes(secret));assert.ok(!JSON.stringify(value).includes('Permission'));
 }
});

test('geometry is a clipped nonnegative intersection only, never an occlusion or earlier-visibility claim',()=>{
 const value=tree();children(value)[0].attributes.bounds='[16,-10][386,150]';children(value)[1].attributes.bounds='[16,-500][386,1200]';
 const result=nativeFontNoticeOutcome(value);assert.equal(result.staticBodySection,'expo-vector-icons');assert.deepEqual(result.controls['fontLicenses.expo-vector-icons'],{count:1,intersection:{x:16,y:136,width:370,height:14}});
 children(value)[0].attributes.bounds='[16,-50][386,-22]';assert.equal(nativeFontNoticeOutcome(value).controls['fontLicenses.expo-vector-icons'],'UNKNOWN');
 children(value)[1].attributes.text=body('expo-vector-icons').trim();children(value)[1].attributes.accessibilityText=secret;assert.equal(nativeFontNoticeOutcome(value).staticBodySection,'UNKNOWN');
});

test('missing, duplicate, malformed and unsupported structures fail closed without secret-bearing output',()=>{
 const cases=[null,[],{},node('fontLicenses.body','[0,0][402,874]'),tree(),tree(),tree(),tree(),tree(),tree(),tree(),tree()];
 cases[4].children.push(cases[4].children[0]);
 children(cases[5]).push(children(cases[5])[0]);
 children(cases[6]).push(children(cases[6])[1]);
 cases[7].attributes.bounds='[0,0][99999,874]';
 cases[8].children[0].attributes.bounds='[10,10][0,0]';
 children(cases[9])[1].attributes.bounds=secret;
 children(cases[10])[1].attributes.value=body('react-native-vector-icons');
 cases[11].children[0].attributes.enabled=true;
 for(const value of cases)assert.deepEqual(nativeFontNoticeOutcome(value),unknown);
 const deep=tree();let current=deep;for(let n=0;n<65;n++){const child=node(undefined,'[0,0][1,1]');current.children.push(child);current=child;}assert.deepEqual(nativeFontNoticeOutcome(deep),unknown);
 const wide=tree();wide.children.push(...Array.from({length:4096},()=>node(undefined,'[0,0][1,1]')));assert.deepEqual(nativeFontNoticeOutcome(wide),unknown);
 const throwing=tree();Object.defineProperty(throwing,'attributes',{get(){throw new Error(secret);}});assert.deepEqual(nativeFontNoticeOutcome(throwing),unknown);
});

test('reader consumes only the existing exact failed sequence plus one, with strict file and byte bounds',()=>{
 const root=privateRoot();try{
  const file=writeHierarchy(root,tree());assert.equal(readNativeFontNoticeOutcome(root,command).staticBodySection,'expo-vector-icons');
  for(const changed of [{status:'RUNNING'},{kind:'assert'},{targetId:'account.email.input'},{sequence:24},{sequence:-1},{sequence:1000000}])assert.deepEqual(readNativeFontNoticeOutcome(root,{...command,...changed}),unknown);
  writeHierarchy(root,tree(),'step-024-other.json');assert.deepEqual(readNativeFontNoticeOutcome(root,command),unknown);rmSync(join(root,'screen-hierarchy','step-024-other.json'));
  for(const value of ['not JSON '+secret,Buffer.from([0xff]),' '.repeat(2097153)]){writeFileSync(file,value);assert.deepEqual(readNativeFontNoticeOutcome(root,command),unknown);}
  writeFileSync(file,JSON.stringify(tree()).replace('"bounds":"[0,62][402,874]"','"bounds":"[0,62][402,874]","bounds":"[0,62][402,874]"'));assert.deepEqual(readNativeFontNoticeOutcome(root,command),unknown);
  rmSync(file);const target=join(root,'private-target');writeFileSync(target,JSON.stringify(tree()));symlinkSync(target,file);assert.deepEqual(readNativeFontNoticeOutcome(root,command),unknown);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('only font-only view failures write finite outcome receipts; failed persistence remains nonthrowing',()=>{
 const root=privateRoot();try{
  writeHierarchy(root,tree('react-native-vector-icons'));const output=join(root,'output');mkdirSync(output);
  const args={fontNotices:true,name:'rich-notices',env:{NOTICE_ACTION:'view',NOTICE_THEME:'dark'},flowSequence:6,command,artifacts:root,output};
  for(const changed of [{fontNotices:false},{name:'request'},{env:{NOTICE_ACTION:'theme',NOTICE_THEME:'dark'}},{env:{NOTICE_ACTION:'view',NOTICE_THEME:secret}},{flowSequence:0}])recordNativeFontNoticeOutcome({...args,...changed});
  assert.ok(!existsSync(join(output,'font-notice-outcome.json')));recordNativeFontNoticeOutcome(args);
  const text=readFileSync(join(output,'font-notice-outcome.json'),'utf8'),result=JSON.parse(text);assert.equal(result.projection.staticBodySection,'react-native-vector-icons');assert.equal(result.stage,'failure-outcome');assert.ok(!text.includes(secret));assert.ok(!text.includes(root));assert.ok(!text.includes('Permission'));
  assert.doesNotThrow(()=>recordNativeFontNoticeOutcome({...args,output:join(root,'missing/output')}));
 }finally{rmSync(root,{recursive:true,force:true});}
});
