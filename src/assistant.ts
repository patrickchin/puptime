import {z} from 'zod';
import {eventTypes, type PuppyEvent} from './domain.ts';

export const assistantScreens=['log','timeline','insights','schedule','notifications','learn','pets','settings','account'] as const;
const id=z.string().min(1).max(256);
const timestamp=z.number().int().min(0).max(8640000000000000);
export const assistantActionSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('log'),puppyId:id,type:z.enum(eventTypes),at:timestamp,endedAt:timestamp.nullable(),customLabel:z.string().min(1).max(40).nullable(),note:z.string().max(300).nullable()}),
  z.strictObject({kind:z.literal('edit_log'),puppyId:id,eventId:id,at:timestamp.nullable(),endedAt:timestamp.nullable(),note:z.string().max(300).nullable()}),
  z.strictObject({kind:z.literal('navigate'),screen:z.enum(assistantScreens)}),
  z.strictObject({kind:z.literal('set_confirmation'),enabled:z.boolean()}),
]);
export const assistantPlanSchema=z.strictObject({reply:z.string().min(1).max(1000),needsClarification:z.boolean(),actions:z.array(assistantActionSchema).max(20)});
const contextEventSchema=z.strictObject({id,type:z.enum(eventTypes),at:timestamp,endedAt:timestamp.nullable().optional(),customLabel:z.string().max(40).optional(),note:z.string().max(300).optional(),estimated:z.boolean().optional()});
export const assistantRequestSchema=z.strictObject({
  text:z.string().trim().min(1).max(2000),now:timestamp,
  timezone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}),
  locale:z.string().min(1).max(40),puppy:z.strictObject({id,name:z.string().min(1).max(256)}),
  customActivities:z.array(z.string().min(1).max(40)).max(100),
  recentEvents:z.array(contextEventSchema).max(30),confirmBeforeSaving:z.boolean(),
  conversation:z.array(z.strictObject({role:z.enum(['user','assistant']),text:z.string().max(2000)})).max(10),
});
export type AssistantRequest=z.infer<typeof assistantRequestSchema>;
export type AssistantAction=z.infer<typeof assistantActionSchema>;
export type AssistantPlan=z.infer<typeof assistantPlanSchema>;
export type AssistantScreen=typeof assistantScreens[number];
export type AssistantResult={commandId:string;changes:{before:PuppyEvent|null;after:PuppyEvent}[];confirmationBefore:boolean;confirmationAfter:boolean;undone?:boolean};

// Both the server and device validate the proposal. A model never selects an
// arbitrary database record, route, or executable function.
export function validateAssistantPlan(value:unknown,context:AssistantRequest):AssistantPlan {
  const plan=assistantPlanSchema.parse(value);
  if(plan.needsClarification&&plan.actions.length)throw new Error('A clarification cannot contain actions.');
  const edited=new Set<string>();
  for(const action of plan.actions){
    if(action.kind==='log'||action.kind==='edit_log'){
      if(action.puppyId!==context.puppy.id)throw new Error('This puppy is not open in the journal.');
      if(action.at!==null&&action.at>context.now)throw new Error('Activity cannot be logged in the future.');
      if(action.endedAt!==null&&action.endedAt>context.now)throw new Error('Activity cannot end in the future.');
    }
    if(action.kind==='log'){
      if(action.type==='custom'?!action.customLabel:action.customLabel!==null)throw new Error('Invalid custom activity.');
      if(action.type!=='nap'&&action.endedAt!==null)throw new Error('Only naps have an end time.');
      if(action.endedAt!==null&&action.endedAt<action.at)throw new Error('A nap cannot end before it starts.');
    }
    if(action.kind==='edit_log'){
      const original=context.recentEvents.find(event=>event.id===action.eventId);
      if(!original||edited.has(action.eventId))throw new Error('Choose one of the available logs to edit.');
      if(action.at===null&&action.note===null&&action.endedAt===null)throw new Error('The edit has no changes.');
      if(action.endedAt!==null&&original.type!=='nap')throw new Error('Only naps have an end time.');
      const endedAt=action.endedAt??original.endedAt;
      if(typeof endedAt==='number'&&endedAt<(action.at??original.at))throw new Error('A nap cannot end before it starts.');
      edited.add(action.eventId);
    }
  }
  if(plan.actions.filter(action=>action.kind==='set_confirmation').length>1)throw new Error('Choose one confirmation mode.');
  return plan;
}

export function assistantNeedsReview(plan:AssistantPlan,confirmBeforeSaving:boolean){
  return confirmBeforeSaving&&plan.actions.some(action=>action.kind==='log'||action.kind==='edit_log');
}

export function describeAssistantAction(action:AssistantAction,puppyName:string,locale:string):string {
  const time=(at:number)=>new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(at);
  switch(action.kind){
    case 'log':return `${puppyName} · ${action.customLabel??({meal:'Meal',pottyTrip:'Potty trip',pee:'Pee',poop:'Poop',walk:'Walk',nap:'Nap',custom:'Activity'}[action.type])} · ${time(action.at)}${action.endedAt!==null?' – '+time(action.endedAt):action.type==='nap'?' · Start nap':''}${action.note?'\n'+action.note:''}`;
    case 'edit_log':return `Update ${puppyName}’s log${action.at!==null?' · '+time(action.at):''}${action.endedAt!==null?' · End '+time(action.endedAt):''}${action.note!==null?'\n'+(action.note||'Remove note'):''}`;
    case 'navigate':return `Open ${{log:'Log',timeline:'Timeline',insights:'Insights',schedule:'Schedule',notifications:'Notifications',learn:'Puppy care',pets:'My dog',settings:'Settings',account:'Account'}[action.screen]}`;
    case 'set_confirmation':return action.enabled?'Review before saving: on':'Review before saving: off';
  }
}
