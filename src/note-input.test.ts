import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the real component callbacks with deferred native events/permissions.
// This is a hook-boundary unit check, not native microphone or rendering proof.
function fixture() {
 const hooks:any[]=[],events=new Map<string,(event?:any)=>void>(),effects:Array<()=>void>=[],announcements:string[]=[];
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
  cursor=0;const tree=module.exports.NoteInput({active,value:'Saved note',onChangeText:()=>{},theme:{presentation:{}}});
  while(effects.length)effects.shift()!();
  function button(node:any):any {if(!node)return;if(Array.isArray(node)){for(const child of node){const found=button(child);if(found)return found;}return;}if(node.type==='Pressable')return node;return button(node.props?.children);}
  return button(tree).props;
 }
 return {render,events,sdk,announcements,setPermission:(value:typeof permission)=>{permission=value;},get starts(){return starts;},get aborts(){return aborts;}};
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
