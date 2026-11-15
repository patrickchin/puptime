import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {darkTheme,lightTheme} from './theme.ts';
import {starterPoopWindows,puppyAges,starterMealTimes,suggestedMealCount} from './onboarding-preview.ts';
import {DEFAULT_NOTIFICATION_PREFERENCES} from './notification-config.ts';

function guestScreen({effects=false,animated=false,throwingRecorder=false,omitRecorder=false}:{effects?:boolean;animated?:boolean;throwingRecorder?:boolean;omitRecorder?:boolean}={}){
 // Actual component/hook boundary, following native-provider-buttons.test.ts.
 // This deliberately makes no native rendering or provider claim.
 const hooks:any[]=[],snapshot={busy:false,accountActionPending:false,account:null,online:true,problem:null as string|null};let cursor=0,reads=0,finished=0;
 const jsx=(type:unknown,props:any)=>({type,props});
 const diagnostics:any[]=[],pendingEffects:(()=>void)[]=[],frames:(()=>void)[]=[];
 let animation:((result:unknown)=>void)|undefined,stops=0;
 const frame=(callback:()=>void)=>{frames.push(callback);return frames.length;};
 const effect=(run:()=>unknown,deps:unknown[])=>{const index=cursor++,previous=hooks[index];if(effects&&(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i]))))pendingEffects.push(()=>{previous?.cleanup?.();hooks[index]={deps,cleanup:run()};});else hooks[index]??={deps};};
 const modules:Record<string,unknown>={
  '@expo/vector-icons':{MaterialCommunityIcons:'Icon'},'expo-font':{useFonts:()=>[true,null]},'expo-status-bar':{StatusBar:'StatusBar'},
  react:{useEffect:effect,useState:(initial:any)=>{const index=cursor++;hooks[index]??={value:typeof initial==='function'?initial():initial};return [hooks[index].value,(next:any)=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;}];},useRef:(initial:any)=>{const index=cursor++;return hooks[index]??=( {current:initial} );}},
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'react-native':{Platform:{OS:'ios'},StyleSheet:{create:(value:unknown)=>value},Keyboard:{isVisible:()=>false,dismiss:()=>{},addListener:()=>({remove(){}})},Animated:{Value:class{interpolate(){return 0;}setValue(){}stopAnimation(){stops++;animation?.({finished:false});animation=undefined;}},timing:()=>({start:(callback:(result:unknown)=>void)=>{animation=callback;}})},useWindowDimensions:()=>({width:402,height:874,fontScale:1}),...Object.fromEntries(['ActivityIndicator','Image','KeyboardAvoidingView','Linking','Pressable','ScrollView','Text','TextInput','View'].map(name=>[name,name])),AccessibilityInfo:{isReduceMotionEnabled:async()=>!animated,addEventListener:()=>({remove(){}}),sendAccessibilityEvent(){}},BackHandler:{addEventListener:()=>({remove(){}})},Easing:{out:()=>0,cubic:0}},
  'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'../domain':{formatMinutes:()=>'',formatScheduleWindow:()=>''},'../entity-id':{entityId:()=>{throw new Error('Guest navigation must not create a record.');}},
  '../components/DateTimeSelector':{DateTimeSelector:'DateTimeSelector'},'../components/NotificationTimingControls':{NotificationTimingControls:'NotificationTimingControls'},
  '../notification-config':{DEFAULT_NOTIFICATION_PREFERENCES},'../onboarding-preview':{starterPoopWindows,puppyAges,starterMealTimes,suggestedMealCount},'../theme':{darkTheme,lightTheme},
  '../components/OnboardingPlanTimeline':{OnboardingPlanTimeline:'OnboardingPlanTimeline'},'../components/AccountSignIn':{AccountSignIn:'AccountSignIn'},'../cloud/use-account-snapshot':{useAccountSnapshot:()=>snapshot},'../reminders':{ExactReminderAccessError:class extends Error{}},'../localization':{translate:()=>''},
 };
 const source=readFileSync(new URL('./screens/OnboardingDesignPreview.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {OnboardingDesignPreview:(props:unknown)=>any}};
 Function('require','module','exports','requestAnimationFrame','cancelAnimationFrame',compiled)((name:string)=>{if(/\.(png|ttf)$/.test(name))return 'asset';assert.ok(name in modules,name);return modules[name];},module,module.exports,frame,()=>{});
 const nodes=(node:any):any[]=>!node?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
 const render=()=>{cursor=0;const inner=module.exports.OnboardingDesignPreview({cloud:{controller:{read:()=>{reads++;return snapshot;}},...(omitRecorder?{}:{recordOnboardingDiagnostic:(input:unknown)=>{if(throwingRecorder)throw new Error('PRIVATE_RECORDER_ERROR');diagnostics.push(input);}})},onFinish:async()=>{finished++;},onAllowNotifications:async()=>false,onDisableNotifications:async()=>{}});const result=nodes(inner.type(inner.props));while(pendingEffects.length)pendingEffects.shift()!();return result;};
 return {snapshot,render,diagnostics,flushFrames:()=>{while(frames.length)frames.shift()!();},settleAnimation:(result:unknown)=>{const callback=animation;animation=undefined;assert.ok(callback);callback(result);},unmount:()=>{for(const hook of hooks)hook?.cleanup?.();},get stops(){return stops;},get reads(){return reads;},get finished(){return finished;}};
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


test('actual onboarding records touch, live guard and committed screen separately without extra account reads',()=>{
 const h=guestScreen({effects:true});let button=h.render().find(node=>node.props?.testID==='preview.guest');
 assert.deepEqual([...h.diagnostics],[{event:'onboarding',point:'mount',step:'welcome'},{event:'onboarding',point:'screen',step:'welcome',accountActionPending:false}]);
 h.snapshot.busy=true;h.render();assert.equal(h.diagnostics.length,2,'Passive refresh does not create a lock or render breadcrumb.');
 h.snapshot.accountActionPending=true;h.render();assert.deepEqual(h.diagnostics.at(-1),{event:'onboarding',point:'screen',step:'welcome',accountActionPending:true});
 button.props.onPressIn();assert.equal(h.reads,0);assert.equal(h.diagnostics.at(-1).point,'guest-press-in');assert.ok(!h.render().some(node=>node.props?.testID==='preview.profile'));
 button.props.onPress();assert.equal(h.reads,1);assert.deepEqual(h.diagnostics.slice(-2),[{event:'onboarding',point:'guest-handler',step:'welcome',accountActionPending:true},{event:'onboarding',point:'profile-decision',step:'welcome',decision:'account-action-pending'}]);
 assert.ok(!h.render().some(node=>node.props?.testID==='preview.profile'));
 h.snapshot.accountActionPending=false;button=h.render().find(node=>node.props?.testID==='preview.guest');button.props.onPress();
 assert.equal(h.reads,2);assert.equal(h.diagnostics.at(-1).decision,'accepted');assert.ok(!h.diagnostics.some(row=>row.point==='screen'&&row.step==='profile'),'Accepted setState is not reported as committed screen.');
 assert.ok(h.render().some(node=>node.props?.testID==='preview.profile'));assert.deepEqual(h.diagnostics.at(-1),{event:'onboarding',point:'screen',step:'profile',accountActionPending:false});
 assert.equal(h.finished,0);h.unmount();assert.deepEqual(h.diagnostics.at(-1),{event:'onboarding',point:'unmount',step:'profile'});assert.equal(h.stops,1);
});

for(const [result,settlement] of [[{finished:true},'finished'],[{finished:false},'interrupted'],[undefined,'unknown']] as const)test(`actual animated profile transition reports ${settlement} without assuming completion`,async()=>{
 const h=guestScreen({effects:true,animated:true});h.render();await Promise.resolve();const button=h.render().find(node=>node.props?.testID==='preview.guest');
 button.props.onPress();button.props.onPress();assert.equal(h.reads,2);assert.equal(h.diagnostics.at(-1).decision,'transitioning');
 assert.equal(h.diagnostics.filter(row=>row.decision==='accepted').length,1);assert.ok(h.render().some(node=>node.props?.testID==='preview.profile'));
 h.flushFrames();h.settleAnimation(result);assert.deepEqual(h.diagnostics.at(-1),{event:'onboarding',point:'animation-settled',step:'profile',animation:settlement});
 assert.ok(h.render().some(node=>node.props?.testID==='preview.profile'));assert.ok(!h.render().some(node=>node.props?.testID==='preview.welcome'),'Animation callback still removes the outgoing page.');assert.equal(h.finished,0);h.unmount();assert.equal(h.stops,1);
});

test('throwing support recorder cannot prevent guest navigation, animation settlement or existing cleanup',async()=>{
 const h=guestScreen({effects:true,animated:true,throwingRecorder:true});h.render();await Promise.resolve();const button=h.render().find(node=>node.props?.testID==='preview.guest');
 assert.doesNotThrow(()=>{button.props.onPressIn();button.props.onPress();});assert.equal(h.reads,1);assert.ok(h.render().some(node=>node.props?.testID==='preview.profile'));
 h.flushFrames();assert.doesNotThrow(()=>h.settleAnimation({finished:false}));assert.ok(h.render().some(node=>node.props?.testID==='preview.profile'));assert.ok(!h.render().some(node=>node.props?.testID==='preview.welcome'));
 assert.doesNotThrow(()=>h.unmount());assert.equal(h.stops,1);assert.equal(h.finished,0);
});

test('actual lifecycle breadcrumbs do not remount for a rerender, and a fresh flow starts at welcome',()=>{
 const h=guestScreen({effects:true});h.render();h.render();assert.equal(h.diagnostics.filter(row=>row.point==='mount').length,1);h.unmount();
 const next=guestScreen({effects:true});next.render();assert.deepEqual([...h.diagnostics.slice(-1),next.diagnostics[0]],[{event:'onboarding',point:'unmount',step:'welcome'},{event:'onboarding',point:'mount',step:'welcome'}]);
});


test('shared onboarding works without the optional native diagnostic handle',()=>{
 const h=guestScreen({effects:true,omitRecorder:true}),button=h.render().find(node=>node.props?.testID==='preview.guest');
 assert.doesNotThrow(()=>{button.props.onPressIn();button.props.onPress();});assert.ok(h.render().some(node=>node.props?.testID==='preview.profile'));assert.equal(h.reads,1);assert.deepEqual(h.diagnostics,[]);assert.doesNotThrow(()=>h.unmount());assert.equal(h.stops,1);
});
