import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as domain from './domain.ts';
import * as theme from './theme.ts';
import * as notificationConfig from './notification-config.ts';
import * as entityIds from './entity-id.ts';

// Run the real screen callbacks at the hook boundary; this does not claim native UI proof.
function screen(name:string,extra:Record<string,unknown>,props:Record<string,unknown>) {
 const hooks:any[]=[];let cursor=0;
 const jsx=(type:unknown,props:any)=>({type,props});
 const modules:Record<string,unknown>={
  react:{useState:(initial:unknown)=>{const i=cursor++;hooks[i]??={value:initial};return [hooks[i].value,(next:any)=>{hooks[i].value=typeof next==='function'?next(hooks[i].value):next;}];},useRef:(initial:unknown)=>{const i=cursor++;return hooks[i]??={current:initial};},useEffect:()=>{},useCallback:(fn:unknown)=>fn},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@expo/vector-icons':{MaterialCommunityIcons:'Icon'},
  'react-native':{...Object.fromEntries(['View','Text','TextInput','Pressable','Modal','ScrollView','Switch','ActivityIndicator'].map(name=>[name,name])),Platform:{OS:'ios'},StyleSheet:{create:(value:unknown)=>value},Alert:{alert:()=>{}},Keyboard:{dismiss:()=>{}}},
  '../localization-context':{useLocalization:()=>({locale:'en',language:'en',t:(key:string,params:any)=>key==='schedule.usualWindow'?params.range:key,activityColors:()=>({}),activityLabel:()=>''})},
  '../theme':theme,'../domain':domain,'../notification-config':notificationConfig,
  '../entity-id':entityIds,
  ...extra,
 };
 const source=readFileSync(new URL(`./screens/${name}.tsx`,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as Record<string,(props:any)=>any>};
 Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in modules,name);return modules[name];},module,module.exports);
 function nodes(node:any):any[] {return !node?[]:Array.isArray(node)?node.flatMap(nodes):node.props?.visible===false?[]:[node,...nodes(node.props?.children)];}
 return (find:(node:any)=>boolean)=>{cursor=0;const tree=module.exports[name]({theme:theme.lightTheme,...props});const found=nodes(tree).find(find);assert.ok(found,'control exists');return found.props;};
}
const byId=(id:string)=>(node:any)=>node.props?.testID===id;
const byLabel=(label:string)=>(node:any)=>node.props?.accessibilityLabel===label;
const byHandler=(name:string)=>(node:any)=>node.props?.onPress?.name===name;

test('new routine and accepted learned suggestions retain their minted IDs after failed saves',async()=>{
 const saved:any[]=[],accepted:any[]=[];
 const window={events:[],loading:false,error:false};
 let suggestion={entries:[{id:'learned-pee-480',type:'pee',minutes:480}],observedDaysByEntry:{'learned-pee-480':3},daysAnalyzed:3};
 const render=screen('ScheduleScreen',{
  '../analytics':{scheduleStatusesForDay:()=>[],suggestScheduleFromEvents:()=>suggestion},
  '../activity-view':{activityWindowBounds:()=>({}),useActivityWindow:()=>window},
  ...Object.fromEntries(['ActivityLoadState','ActivityIcon','ConfirmDialog','DateTimeSelector'].map(name=>[`../components/${name}`,{[name]:name}])),
  '../schedule-editor':{ScheduleEntryDeletedError:class extends Error{}},
 },{events:[],schedule:[],customActivities:[],onSaveEntry:async(entry:unknown)=>{saved.push(entry);throw Error('SQL write failed');},onChange:async(entries:unknown)=>{accepted.push(entries);throw Error('SQL write failed');}});
 render(byId('schedule.add')).onPress();
 await render(byId('schedule.editor.save')).onPress();
 await render(byId('schedule.editor.save')).onPress();
 assert.match(saved[0].id,/^rtn_[a-f0-9]{32}$/);assert.deepEqual(saved[1],saved[0]);
 render(byId('schedule.editor.close')).onPress();
 render(byLabel('schedule.previewA11y')).onPress();
 window.loading=true;await render(byHandler('applySuggestion')).onPress();assert.equal(accepted.length,0);
 window.loading=false;window.error=true;await render(byHandler('applySuggestion')).onPress();assert.equal(accepted.length,0);
 window.error=false;
 await render(byHandler('applySuggestion')).onPress();
 suggestion={...suggestion,entries:[{id:'learned-pee-495',type:'pee',minutes:495}]};
 const expectedWindow=domain.formatScheduleWindow(accepted[0][0],'en');
 const visible=render(node=>node.type==='View'&&node.props?.accessibilityLabel?.includes(expectedWindow));
 assert.ok(!visible.accessibilityLabel.includes(domain.formatScheduleWindow(suggestion.entries[0] as domain.ScheduleEntry,'en')),'retry displays the proposal that will be saved');
 assert.equal(suggestion.entries[0].id,'learned-pee-495','preview keys stay deterministic');
 suggestion={...suggestion,entries:[]};
 window.loading=true;
 await render(byHandler('applySuggestion')).onPress();
 assert.match(accepted[0][0].id,/^rtn_[a-f0-9]{32}$/);assert.deepEqual(accepted[1],accepted[0]);
});

test('a timed reminder draft retries with the same OS request identity',async()=>{
 const saved:any[]=[];
 const render=screen('NotificationsScreen',{
  'expo-notifications':{},'@expo/ui/community/datetime-picker':{default:'DateTimePicker'},
  '../reminders':{CustomTimedReminderLimitError:class extends Error{},createCustomTimedReminder:async(input:unknown)=>{saved.push(input);throw Error('OS acknowledgement lost');}},
 },{petId:'pet-1',notificationPermission:'granted',notificationDelivery:true,notificationPreferences:notificationConfig.DEFAULT_NOTIFICATION_PREFERENCES});
 render(byId('notifications.timed.add')).onPress();
 render(byId('notifications.timed.label')).onChangeText('Medicine');
 render(byId('notifications.timed.save')).onPress();await new Promise(resolve=>setImmediate(resolve));
 render(byId('notifications.timed.save')).onPress();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(saved.length,2);assert.match(saved[0].id,/^rem_[a-f0-9]{32}$/);assert.deepEqual(saved[1],saved[0]);
});
