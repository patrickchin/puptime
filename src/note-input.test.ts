import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the real component callbacks with deferred native events/permissions.
// This is a hook-boundary unit check, not native microphone or rendering proof.
function fixture() {
 const hooks:any[]=[],events=new Map<string,(event?:any)=>void>(),effects:Array<()=>void>=[],announcements:string[]=[];
 let note='Saved note',lastTree:any;
 let cursor=0,starts=0,aborts=0,permission:()=>Promise<{granted:boolean}>=async()=>({granted:true});
 const sdk={isRecognitionAvailable:()=>true,requestPermissionsAsync:()=>permission(),start:()=>{starts++;},abort:()=>{aborts++;},stop:()=>{}};
 const react={
  useRef:(value:unknown)=>{const index=cursor++;return hooks[index]??=( {current:value});},
  useState:(value:unknown)=>{const index=cursor++;hooks[index]??={value};return [hooks[index].value,(next:unknown)=>{hooks[index].value=next;}];},
  useEffect:(effect:()=>void|(()=>void),deps:unknown[])=>{
   const index=cursor++,previous=hooks[index];
   if(!previous||deps.some((value,i)=>value!==previous.deps[i]))effects.push(()=>{previous?.cleanup?.();hooks[index]={deps,cleanup:effect()};});
  },
 };
 const jsx=(type:unknown,props:any)=>({type,props});
 const modules:Record<string,unknown>={
  './TelemetryPressable':{Pressable:'Pressable'},
  react,'react/jsx-runtime':{jsx,jsxs:jsx},'@expo/vector-icons':{MaterialCommunityIcons:'Icon'},
  'expo-speech-recognition':{ExpoSpeechRecognitionModule:sdk,useSpeechRecognitionEvent:(name:string,listener:(event?:any)=>void)=>events.set(name,listener)},
  'react-native':{AccessibilityInfo:{announceForAccessibility:(message:string)=>announcements.push(message)},Alert:{alert:()=>{}},StyleSheet:{create:(value:unknown)=>value},Pressable:'Pressable',View:'View',Text:'Text',TextInput:'TextInput'},
  '../localization-context':{useLocalization:()=>({locale:'en',t:(key:string)=>key})},
 };
 const source=readFileSync(new URL('./components/NoteInput.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {NoteInput:(props:any)=>any}};
 Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in modules,name);return modules[name];},module,module.exports);
 function render(active=true) {
  cursor=0;const tree=module.exports.NoteInput({active,value:note,onChangeText:(value:string)=>{note=value;},theme:{presentation:{}}});
  lastTree=tree;while(effects.length)effects.shift()!();
  function button(node:any):any {if(!node)return;if(Array.isArray(node)){for(const child of node){const found=button(child);if(found)return found;}return;}if(node.type==='Pressable')return node;return button(node.props?.children);}
  return button(tree).props;
 }
 return {render,events,sdk,announcements,get note(){return note;},type(value:string){
  function find(node:any):any {if(!node)return;if(Array.isArray(node)){for(const child of node){const found=find(child);if(found)return found;}return;}return node.type==='TextInput'?node:find(node.props?.children);}
  find(lastTree).props.onChangeText(value);
 },setPermission:(value:typeof permission)=>{permission=value;},get starts(){return starts;},get aborts(){return aborts;}};
}

test('leaving the editor while microphone permission is pending never starts dictation',async()=>{
 const current=fixture();let resolve!:(value:{granted:boolean})=>void;
 current.setPermission(()=>new Promise(done=>{resolve=done;}));
 const pending=current.render().onPress();current.render(false);resolve({granted:true});await pending;
 assert.equal(current.starts,0);
});

test('a delayed native start after History opens is aborted without announcing hidden dictation',async()=>{
 const current=fixture();await current.render().onPress();assert.equal(current.starts,1);
 const delayedStart=current.events.get('start')!;current.render(false);const before=current.aborts;
 delayedStart();assert.equal(current.aborts,before+1);assert.deepEqual(current.announcements,[]);
});

test('returning to the editor does not resume an abandoned permission request',async()=>{
 const current=fixture();let resolve!:(value:{granted:boolean})=>void;
 current.setPermission(()=>new Promise(done=>{resolve=done;}));
 const pending=current.render().onPress();current.render(false);current.render(true);resolve({granted:true});await pending;
 assert.equal(current.starts,0);
});


test('manual corrections invalidate dictation and ignore late native results until the old session ends',async()=>{
 const current=fixture();await current.render().onPress();current.events.get('start')!();
 current.events.get('result')!({results:[{transcript:'first words'}]});assert.equal(current.note,'Saved note first words');
 current.render();current.type('My correction');assert.equal(current.note,'My correction');assert.equal(current.aborts,1);
 current.type('My correction continued');assert.equal(current.aborts,1,'Repeated keystrokes must not queue extra native abort/end events.');
 current.type('My correction');
 current.events.get('result')!({results:[{transcript:'late final words'}]});assert.equal(current.note,'My correction');
 assert.equal(current.render().disabled,true);await current.render().onPress();assert.equal(current.starts,1);
 current.events.get('end')!();await current.render().onPress();assert.equal(current.starts,2);
 current.events.get('start')!();current.events.get('result')!({results:[{transcript:'new session'}]});
 assert.equal(current.note,'My correction new session');
});

test('typing during a permission request cancels it and a rapid repeat press cannot strand the request',async()=>{
 const current=fixture();let resolve!:(value:{granted:boolean})=>void;
 current.setPermission(()=>new Promise(done=>{resolve=done;}));
 const pending=current.render().onPress();await current.render().onPress();current.render();current.type('Typed while waiting');
 resolve({granted:true});await pending;assert.equal(current.starts,0);assert.equal(current.note,'Typed while waiting');assert.equal(current.render().disabled,false);
});

test('stop allows final transcript but forbids restarting until native end',async()=>{
 const current=fixture();await current.render().onPress();current.events.get('start')!();await current.render().onPress();
 current.events.get('result')!({results:[{transcript:'final'}]});assert.equal(current.note,'Saved note final');
 await current.render().onPress();assert.equal(current.starts,1);current.events.get('end')!();assert.equal(current.render().disabled,false);
});
