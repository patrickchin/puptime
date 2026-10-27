import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {lightTheme} from './theme.ts';

test('the real iOS sign-in component uses official Apple and Google controls and guards disabled activation',async()=>{
 // Component/hook boundary only; this does not claim an actual system button or sheet.
 const hooks:any[]=[],effects:Array<()=>void>=[],calls:string[]=[];let cursor=0;
 const state={account:null,config:{providers:{apple:true,google:true,email:false}},busy:false,online:true,problem:null};
 const jsx=(type:unknown,props:any)=>({type,props}),nativeButton=Symbol('AppleAuthenticationButton'),googleButton=Object.assign(()=>{}, {Size:{Wide:2},Color:{Dark:'dark',Light:'light'}});
 const modules:Record<string,unknown>={
  './TelemetryPressable':{Pressable:'Pressable'},
  react:{useState:(value:unknown)=>{const i=cursor++;hooks[i]??={value};return [hooks[i].value,(next:unknown)=>{hooks[i].value=next;}];},useEffect:(effect:()=>void)=>{const i=cursor++;if(!hooks[i]){hooks[i]=true;effects.push(effect);}}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'@expo/vector-icons':{MaterialCommunityIcons:'Icon'},
  'react-native':{Platform:{OS:'ios'},StyleSheet:{create:(value:unknown)=>value},Keyboard:{dismiss:()=>{}},...Object.fromEntries(['ActivityIndicator','Pressable','Text','TextInput','View'].map(value=>[value,value]))},
  'expo-apple-authentication':{isAvailableAsync:async()=>true,AppleAuthenticationButton:nativeButton,AppleAuthenticationButtonType:{CONTINUE:1},AppleAuthenticationButtonStyle:{BLACK:2,WHITE:0}},
  '@react-native-google-signin/google-signin':{GoogleSigninButton:googleButton},
  '../cloud/use-account-snapshot':{useAccountSnapshot:()=>state},'../localization-context':{useLocalization:()=>({t:(key:string)=>key})},
 };
 const source=readFileSync(new URL('./components/AccountSignIn.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {AccountSignIn:(props:unknown)=>any}};
 Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in modules,name);return modules[name];},module,module.exports);
 const nodes=(node:any):any[]=>!node?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
 const render=()=>{cursor=0;return nodes(module.exports.AccountSignIn({theme:lightTheme,cloud:{controller:{signInSocial:async(provider:string)=>{calls.push(provider);}}}}));};
 assert.ok(!render().some(node=>node.props?.testID==='account.apple'));
 for(const effect of effects)effect();await Promise.resolve();
 const button=render().find(node=>node.props?.testID==='account.apple');assert.ok(button);assert.equal(button.type,nativeButton);assert.equal(button.props.buttonType,1);assert.equal(button.props.style.height,52);
 button.props.onPress();assert.deepEqual(calls,['apple']);
 state.busy=true;const busy=render().find(node=>node.props?.testID==='account.apple');assert.equal(busy.props.accessibilityState.disabled,true);assert.equal(busy.props.pointerEvents,'none');busy.props.onPress();assert.equal(calls.length,1);
 state.busy=false;state.online=false;render().find(node=>node.props?.testID==='account.apple').props.onPress();assert.equal(calls.length,1);
 state.online=true;const google=render().find(node=>node.props?.testID==='account.google');assert.equal(google.type,googleButton);assert.equal(google.props.size,2);google.props.onPress();assert.deepEqual(calls,['apple','google']);
 state.busy=true;const busyGoogle=render().find(node=>node.props?.testID==='account.google');assert.equal(busyGoogle.props.disabled,true);busyGoogle.props.onPress();assert.equal(calls.length,2);
 state.busy=false;state.online=false;render().find(node=>node.props?.testID==='account.google').props.onPress();assert.equal(calls.length,2);
});
