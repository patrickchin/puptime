import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Real screen callbacks with deferred persistence/permission boundaries. Native
// rendering is separately checked in the dedicated simulator.
function fixture(){
 const hooks:any[]=[],effects:Array<()=>void>=[],alerts:unknown[][]=[];let cursor=0,tree:any;
 let save:()=>Promise<void>=async()=>{},permission:()=>Promise<boolean>=async()=>true;
 const react={
  useRef:(value:unknown)=>hooks[cursor++]??={current:value},
  useState:(value:unknown)=>{const index=cursor++;hooks[index]??={value:typeof value==='function'?value():value};return [hooks[index].value,(next:any)=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;}];},
  useCallback:(fn:unknown)=>{cursor++;return fn;},useMemo:(fn:()=>unknown)=>{cursor++;return fn();},
  useEffect:(fn:()=>unknown,deps:unknown[])=>{const index=cursor++,old=hooks[index];if(!old||deps.some((value,i)=>value!==old.deps[i]))effects.push(()=>{old?.cleanup?.();hooks[index]={deps,cleanup:fn()};});},
 };
 const jsx=(type:unknown,props:unknown)=>({type,props}),components=Object.fromEntries(['Alert','Keyboard','Linking','Modal','ScrollView','Switch','Text','TextInput','View'].map(name=>[name,name]));
 const domain={quickEventTypes:['pee','poop','meal'],customActivityKey:(v:string)=>v,formatMinutes:String,formatScheduleWindow:()=>''};
 const modules:Record<string,any>={react,'react/jsx-runtime':{jsx,jsxs:jsx},'@expo/vector-icons':{MaterialCommunityIcons:'Icon'},
  'react-native':{...components,Alert:{alert:(...args:any[])=>alerts.push(args)},Keyboard:{dismiss:()=>{}},StyleSheet:{create:(value:unknown)=>value}},
  '../telemetry':{useTelemetryOverlay:()=>{}},'../components/TelemetryPressable':{Pressable:'Pressable'},
  '../analytics':{scheduleStatusesForDay:()=>[],suggestScheduleFromEvents:()=>({entries:[],daysAnalyzed:0})},
  '../activity-view':{activityWindowBounds:()=>({from:0,until:1}),useActivityWindow:()=>({events:[],loading:false,error:false})},
  '../components/ActivityLoadState':{ActivityLoadState:'ActivityLoadState'},'../components/RoutineTimeline':{RoutineTimeline:'RoutineTimeline',RoutineDayPreview:'RoutineDayPreview'},
  '../components/ActivityIcon':{ActivityIcon:'ActivityIcon'},'../components/ConfirmDialog':{ConfirmDialog:'ConfirmDialog'},'../components/DateTimeSelector':{DateTimeSelector:'DateTimeSelector'},
  '../domain':domain,'../localization-context':{useLocalization:()=>({locale:'en',t:(key:string)=>key,activityColors:()=>({}),activityLabel:()=>''})},
  '../theme':{spacing:{md:16,lg:24,xl:32},surfaceTreatment:()=>({})},'../schedule-editor':{ScheduleEntryDeletedError:class extends Error{}},'../entity-id':{entityId:()=> 'rtn_new'},
 };
 const compiled=ts.transpileModule(readFileSync(new URL('./screens/ScheduleScreen.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {ScheduleScreen:(props:any)=>any}};
 Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in modules,name);return modules[name];},module,module.exports);
 function render(){cursor=0;tree=module.exports.ScheduleScreen({events:[],schedule:[{id:'fixture',type:'pee',minutes:100}],customActivities:[],theme:{presentation:{}},onSaveEntry:()=>save(),onRequestReminderPermission:()=>permission(),onChange:async()=>{},onRemoveEntry:async()=>{}});while(effects.length)effects.shift()!();}
 function find(predicate:(node:any)=>boolean,node=tree):any {if(!node)return;if(Array.isArray(node)){for(const child of node){const result=find(predicate,child);if(result)return result;}return;}return predicate(node)?node:find(predicate,node.props?.children??null);}
 function press(id:string){const element=find(node=>node.props?.testID===id);assert.ok(element,id);return element.props.onPress();}
 function edit(id:string){find(node=>node.type==='RoutineTimeline').props.onEdit({id,type:'pee',minutes:100,reminder:false});render();}
 return {render,press,edit,alerts,find,setSave:(fn:typeof save)=>{save=fn;},setPermission:(fn:typeof permission)=>{permission=fn;},unmount(){for(const hook of hooks)hook?.cleanup?.();}};
}

test('a completed save cannot close a newer editor, including reopening the same routine',async t=>{
 for(const next of ['other','same']){
  const f=fixture();t.after(f.unmount);f.render();f.edit('same');let release!:()=>void;f.setSave(()=>new Promise<void>(resolve=>{release=resolve;}));
  const pending=f.press('schedule.editor.save');f.render();f.press('schedule.editor.close');f.render();f.edit(next);
  release();await pending;f.render();assert.equal(f.find(node=>node.type==='Modal'&&node.props.visible&&node.props.children?.props?.testID==='schedule.editor')?.props.visible,true);
 }
});

test('late permission results cannot enable a replacement routine and saving waits for permission',async t=>{
 const f=fixture();t.after(f.unmount);f.render();f.edit('a');let release!:(value:boolean)=>void;f.setPermission(()=>new Promise(resolve=>{release=resolve;}));
 const pending=f.find(node=>node.props?.testID==='schedule.editor.reminder').props.onValueChange(true);f.render();
 assert.equal(f.find(node=>node.props?.testID==='schedule.editor.save').props.disabled,true);
 f.press('schedule.editor.close');f.render();f.edit('b');release(true);await pending;f.render();
 assert.equal(f.find(node=>node.props?.testID==='schedule.editor.reminder').props.value,false);assert.equal(f.find(node=>node.props?.testID==='schedule.editor.save').props.disabled,false);
});

test('stale failures and unmounted completions cannot announce errors in a later session',async t=>{
 const f=fixture();t.after(f.unmount);f.render();f.edit('a');let reject!:(error:Error)=>void;f.setSave(()=>new Promise((_resolve,fail)=>{reject=fail;}));
 const pending=f.press('schedule.editor.save');f.press('schedule.editor.close');f.render();f.edit('b');reject(new Error('late failure'));await pending;assert.deepEqual(f.alerts,[]);
 let release!:()=>void;f.setSave(()=>new Promise(resolve=>{release=resolve;}));const unmounted=f.press('schedule.editor.save');f.unmount();release();await unmounted;assert.deepEqual(f.alerts,[]);
});
