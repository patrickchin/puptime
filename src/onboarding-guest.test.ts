import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {darkTheme,lightTheme} from './theme.ts';
import {starterPoopWindows,puppyAges,starterMealTimes,suggestedMealCount} from './onboarding-preview.ts';
import {DEFAULT_NOTIFICATION_PREFERENCES} from './notification-config.ts';

function guestScreen(){
 // Actual component/hook boundary, following native-provider-buttons.test.ts.
 // This deliberately makes no native rendering or provider claim.
 const hooks:any[]=[],snapshot={busy:false,accountActionPending:false,account:null,online:true,problem:null as string|null};let cursor=0,reads=0,finished=0;
 const jsx=(type:unknown,props:any)=>({type,props});
 const modules:Record<string,unknown>={
  '@expo/vector-icons/MaterialCommunityIcons':{default:'Icon'},'expo-font':{useFonts:()=>[true,null]},'expo-status-bar':{StatusBar:'StatusBar'},
  react:{useEffect:()=>{},useState:(initial:any)=>{const index=cursor++;hooks[index]??={value:typeof initial==='function'?initial():initial};return [hooks[index].value,(next:any)=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;}];},useRef:(initial:any)=>{const index=cursor++;return hooks[index]??=( {current:initial} );}},
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'react-native':{Platform:{OS:'ios'},StyleSheet:{create:(value:unknown)=>value},Keyboard:{isVisible:()=>false,dismiss:()=>{}},Animated:{Value:class{interpolate(){return 0;}}},useWindowDimensions:()=>({width:402,height:874,fontScale:1}),...Object.fromEntries(['AccessibilityInfo','ActivityIndicator','BackHandler','Easing','Image','KeyboardAvoidingView','Linking','Pressable','ScrollView','Text','TextInput','View'].map(name=>[name,name]))},
  'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'../domain':{formatMinutes:()=>'',formatScheduleWindow:()=>''},'../entity-id':{entityId:()=>{throw new Error('Guest navigation must not create a record.');}},
  '../components/DateTimeSelector':{DateTimeSelector:'DateTimeSelector'},'../components/NotificationTimingControls':{NotificationTimingControls:'NotificationTimingControls'},
  '../notification-config':{DEFAULT_NOTIFICATION_PREFERENCES},'../onboarding-preview':{starterPoopWindows,puppyAges,starterMealTimes,suggestedMealCount},'../theme':{darkTheme,lightTheme},
  '../components/OnboardingPlanTimeline':{OnboardingPlanTimeline:'OnboardingPlanTimeline'},'../components/AccountSignIn':{AccountSignIn:'AccountSignIn'},'../cloud/use-account-snapshot':{useAccountSnapshot:()=>snapshot},'../reminders':{ExactReminderAccessError:class extends Error{}},'../localization':{translate:()=>''},
 };
 const source=readFileSync(new URL('./screens/OnboardingDesignPreview.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {OnboardingDesignPreview:(props:unknown)=>any}};
 Function('require','module','exports',compiled)((name:string)=>{if(/\.(png|ttf)$/.test(name))return 'asset';assert.ok(name in modules,name);return modules[name];},module,module.exports);
 const nodes=(node:any):any[]=>!node?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
 const render=()=>{cursor=0;const inner=module.exports.OnboardingDesignPreview({cloud:{controller:{read:()=>{reads++;return snapshot;}}},onFinish:async()=>{finished++;},onAllowNotifications:async()=>false,onDisableNotifications:async()=>{}});return nodes(inner.type(inner.props));};
 return {snapshot,render,get reads(){return reads;},get finished(){return finished;}};
}

for(const screen of ['welcome','account'])test(`actual ${screen} guest navigation stays available during passive query/retry/offline state`,()=>{
 for(const state of [{busy:true,online:true,problem:null},{busy:false,online:true,problem:'network'},{busy:true,online:true,problem:'network'},{busy:false,online:false,problem:'network'}]){
  const h=guestScreen();if(screen==='account')h.render().find(node=>node.type==='AccountSignIn').props.onEmailPress();
  Object.assign(h.snapshot,state);const button=h.render().find(node=>node.props?.testID==='preview.guest');
  assert.equal(button.props.disabled,false);assert.equal(button.props.accessibilityState.disabled,false);button.props.onPress();
  assert.ok(h.render().some(node=>node.props?.testID==='preview.profile'));assert.equal(h.reads,1);assert.equal(h.finished,0);
 }
});

for(const screen of ['welcome','account'])test(`actual ${screen} guest handler rechecks newly queued account actions before navigating`,()=>{
 const h=guestScreen();if(screen==='account')h.render().find(node=>node.type==='AccountSignIn').props.onEmailPress();
 const oldButton=h.render().find(node=>node.props?.testID==='preview.guest');h.snapshot.accountActionPending=true;h.snapshot.busy=true;
 const locked=h.render().find(node=>node.props?.testID==='preview.guest');assert.equal(locked.props.disabled,true);assert.equal(locked.props.accessibilityState.disabled,true);
 oldButton.props.onPress();assert.ok(!h.render().some(node=>node.props?.testID==='preview.profile'));assert.equal(h.finished,0);
 h.snapshot.accountActionPending=false;oldButton.props.onPress();assert.ok(h.render().some(node=>node.props?.testID==='preview.profile'));assert.equal(h.reads,2);assert.equal(h.finished,0);
});
