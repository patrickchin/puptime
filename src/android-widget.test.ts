import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as domain from './domain.ts';
import * as theme from './theme.ts';

// Execute the production Android widget layout at its native-primitives boundary.
const jsx=(type:unknown,props:Record<string,unknown>)=>({type,props});
const modules:Record<string,unknown>={
 'react/jsx-runtime':{jsx,jsxs:jsx},
 'react-native-android-widget':{FlexWidget:'FlexWidget',SvgWidget:'SvgWidget',TextWidget:'TextWidget'},
 '../domain':domain,'../theme':theme,'./ChronometerWidget.android':{ChronometerWidget:'ChronometerWidget'},
};
const compiled=ts.transpileModule(readFileSync(new URL('./widgets/QuickLogWidget.android.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{} as {QuickLogWidget:(props:Record<string,unknown>)=>unknown}};
Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in modules,name);return modules[name];},module,module.exports);
function actions(props:Record<string,unknown>){
 const output:any[]=[];
 function visit(node:any){if(!node)return;if(Array.isArray(node)){node.forEach(visit);return;}if(node.props?.clickActionData)output.push(node.props);visit(node.props?.children);}
 visit(module.exports.QuickLogWidget(props));return output;
}

test('Android nap-conflict rendering filters after normalization and retains a single configured action',()=>{
 assert.deepEqual(actions({actions:['nap','pee'],napConflict:true,activeNap:true}).map(action=>action.clickActionData.type),['pee']);
 const custom=actions({actions:['nap','custom:training'],customActivities:['Training'],napConflict:true});
 assert.deepEqual(custom.map(action=>action.clickActionData.type),['custom:training']);assert.match(custom[0].accessibilityLabel,/training/);
});

test('ordinary Android widget naps still expose a scoped end action and read-only widgets open the app',()=>{
 const running=actions({actions:['pee','meal'],activeNap:true,scope:'pet_shared'});
 assert.deepEqual(running.map(action=>action.clickActionData.type),['pee','meal','nap']);assert.match(running[2].accessibilityLabel,/End nap/);assert.equal(running[2].clickActionData.scope,'pet_shared');
 assert.ok(actions({canLog:false}).every(action=>action.clickAction==='OPEN_APP'));
});
