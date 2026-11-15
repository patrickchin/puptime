import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {parseAllDocuments} from 'yaml';

type ProfileAgeState={profile:boolean;age:boolean;enabled?:boolean};
type ProfileAgeHooks={beforeTap?:(state:ProfileAgeState)=>void;afterTap?:(state:ProfileAgeState,count:number)=>void;afterAnimation?:(state:ProfileAgeState)=>void};

// Interpret only this parsed transition guard; no native runtime is simulated.
function profileAgeModel(state:ProfileAgeState,{beforeTap=()=>{},afterTap=()=>{},afterAnimation=()=>{}}:ProfileAgeHooks={}){
 const commands=parseAllDocuments(readFileSync(new URL('../.maestro/helpers/conversational/to-reminders.yaml',import.meta.url),'utf8'))[1].toJS();
 const profileIndex=commands.findIndex((command:any)=>command?.assertVisible?.id==='preview.profile'),guard=commands[profileIndex+1]?.retry;
 assert.equal(guard?.maxRetries,2);assert.deepEqual(commands[profileIndex+2],{assertVisible:{id:'preview.prompt',text:'How old is your pup?'}});
 const expectedButton='I’ll add their name later',ageHeading='How old is your pup?';let profileActions=0,ageActions=0,tapLookups=0,attempts=0;
 const visible=(selector:any)=>selector?.id==='preview.profile'?state.profile:selector?.id==='preview.prompt'&&selector.text===ageHeading?state.age:false;
 function execute(list:any[]){for(const command of list){
  if(command==='waitForAnimationToEnd'){afterAnimation(state);continue;}
  if(command.runFlow){const {when,commands}=command.runFlow;if(when.visible&&!visible(when.visible)||when.notVisible&&visible(when.notVisible))continue;execute(commands);}
  else if(command.assertVisible)assert.ok(visible(command.assertVisible),'Required transition predicate is absent.');
  else if(command.tapOn){
   tapLookups++;beforeTap(state);const selector=command.tapOn,label=state.profile?expectedButton:state.age?'I’m not sure yet':'';
   assert.equal(selector.id,'preview.skip');assert.equal(selector.enabled,true);assert.equal(selector.text,'^'+expectedButton+'$');
   assert.ok(label&&new RegExp(selector.text).test(label)&&state.enabled!==false,'Only the enabled profile action may be delivered.');
   if(state.profile)profileActions++;else if(state.age)ageActions++;afterTap(state,profileActions);
  }else assert.fail('Unexpected command in the narrowly modeled guard.');
 }}
 let error:unknown;for(;attempts<=guard.maxRetries;){attempts++;try{execute(guard.commands);error=undefined;break;}catch(value){error=value;}}
 return {profileActions,ageActions,tapLookups,attempts,error};
}

test('profile→age guard handles retained source and stops actions after the destination',()=>{
 const state={profile:true,age:false};const result=profileAgeModel(state,{afterTap:(state,count)=>{if(count===2){state.profile=false;state.age=true;}}});
 assert.equal(result.error,undefined);assert.equal(result.profileActions,2);assert.equal(result.ageActions,0);assert.equal(result.attempts,2);
 const again=profileAgeModel(state);assert.equal(again.error,undefined);assert.equal(again.profileActions,0);assert.equal(again.ageActions,0);assert.equal(again.tapLookups,0);assert.equal(again.attempts,1);
 const retained=profileAgeModel({profile:true,age:false});assert.ok(retained.error);assert.equal(retained.profileActions,3);assert.equal(retained.attempts,3);
});

test('profile→age guard handles late destination arrival and never delivers the reused age Skip',()=>{
 for(const hook of ['afterAnimation','beforeTap'] as const){
  const state={profile:true,age:false},result=profileAgeModel(state,{[hook]:(state:ProfileAgeState)=>{state.profile=false;state.age=true;}});
  assert.equal(result.error,undefined);assert.equal(result.profileActions,0);assert.equal(result.ageActions,0);assert.ok(result.attempts<=2);
 }
 // Even if an outgoing profile is still reported, an already present target wins.
 const arrived=profileAgeModel({profile:true,age:true});assert.equal(arrived.error,undefined);assert.equal(arrived.profileActions,0);assert.equal(arrived.ageActions,0);assert.equal(arrived.tapLookups,0);
});

test('profile→age guard fails boundedly without tapping when both source and destination are absent',()=>{
 const result=profileAgeModel({profile:false,age:false});assert.ok(result.error);assert.equal(result.profileActions,0);assert.equal(result.ageActions,0);assert.equal(result.tapLookups,0);assert.equal(result.attempts,3);
 const source=readFileSync(new URL('./screens/OnboardingDesignPreview.tsx',import.meta.url),'utf8');assert.ok(source.includes("'I’ll add their name later',()=>{setName('');go('age');}"));
});
