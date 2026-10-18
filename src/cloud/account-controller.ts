import { z } from 'zod';
import { CloudApiError,type CloudApi,type CloudAccountSummary,type CloudConfig,type CloudErrorCategory } from './api.ts';
import { createSyncRunner,type RunResult } from './runner.ts';
import type { createLocalRuntime } from '../local/runtime-factory.ts';

type Runtime=Awaited<ReturnType<typeof createLocalRuntime>>;
type SyncStatus=Awaited<ReturnType<Runtime['sync']['status']>>;
export type AccountProblem=CloudErrorCategory|'local-storage'|'confirmation-required'|'pending-confirmation-required'|'account-mismatch'|'trial-unavailable'|'provider-unavailable'|'invalid-email'|'invalid-code'|'code-expired'|'too-many-attempts'|'sign-in-failed'|'sign-out-failed'|'remote-sign-out-unconfirmed';
export type AccountActionResult='ok'|'error'|'cancelled'|'confirmation-required'|'pending-confirmation-required';
type IdentityOutcome={error:{status:number;code?:string}|null};
export type IdentityAdapter={requestEmail:(email:string)=>Promise<IdentityOutcome>;verifyEmail:(email:string,code:string)=>Promise<IdentityOutcome>;signInSocial:(provider:'apple'|'google')=>Promise<IdentityOutcome>;signOut:()=>Promise<IdentityOutcome>;hasCredentials:()=>Promise<boolean>};
type SdkIdentityClient={emailOtp:{sendVerificationOtp:(input:{email:string;type:'sign-in'})=>Promise<IdentityOutcome>};signIn:{emailOtp:(input:{email:string;otp:string})=>Promise<IdentityOutcome>;social:(input:{provider:'apple'|'google';callbackURL:string})=>Promise<IdentityOutcome>};signOut:()=>Promise<IdentityOutcome>;getCookie:()=>Promise<string>};
export function createIdentityAdapter(auth:SdkIdentityClient):IdentityAdapter {
  const result=(value:IdentityOutcome):IdentityOutcome=>({error:value.error?{status:value.error.status,code:value.error.code}:null});
  return {
    requestEmail:email=>auth.emailOtp.sendVerificationOtp({email,type:'sign-in'}).then(result),
    verifyEmail:(email,otp)=>auth.signIn.emailOtp({email,otp}).then(result),
    signInSocial:provider=>auth.signIn.social({provider,callbackURL:'puptime://account'}).then(result),
    signOut:()=>auth.signOut().then(result),
    hasCredentials:async()=>!!(await auth.getCookie()),
  };
}
export type AccountSnapshot={config:CloudConfig|null;account:CloudAccountSummary|null;local:{name:string;eventCount:number}|null;sync:SyncStatus|null;run:RunResult|null;problem:AccountProblem|null;codeSentTo:string|null;busy:boolean;running:boolean;active:boolean;online:boolean;lastSyncedAt:number|null};
const defaultDefer=(fn:()=>void,delay:number)=>{const timer=setTimeout(fn,delay);return()=>clearTimeout(timer);};
export function createAccountController({runtime,api,identity,subscribeLocalWrites,defer=defaultDefer,changed}:{runtime:Runtime;api:CloudApi;identity:IdentityAdapter;subscribeLocalWrites:(fn:()=>void)=>()=>void;defer?:(fn:()=>void,delay:number)=>()=>void;changed:()=>void}) {
  let snapshot:AccountSnapshot={config:null,account:null,local:null,sync:null,run:null,problem:null,codeSentTo:null,busy:false,running:false,active:false,online:true,lastSyncedAt:null};
  const listeners=new Set<()=>void>();
  let disposed=false,suspended=false,signOutUnfinished=false,rerun=false,associationConfirmationNeeded=false;
  let actions:Promise<unknown>=Promise.resolve(),refreshing:Promise<AccountActionResult>|null=null,running:Promise<void>|null=null,aborter:AbortController|null=null,cancelScheduled:(()=>void)|null=null;
  const runner=createSyncRunner({sync:runtime.sync,api,petId:runtime.petId,deviceId:runtime.deviceId,sessionAccountId:()=>snapshot.account?.user.id??null,changed});
  function emit(patch:Partial<AccountSnapshot>) {
    if (disposed) return;snapshot={...snapshot,...patch};
    for(const listener of listeners)try{listener();}catch{/* A view cannot undo an account operation. */}
  }
  function fail(problem:AccountProblem):AccountActionResult {emit({problem});return 'error';}
  async function localState() {
    const [sync,name,count]=await Promise.all([runtime.sync.status(runtime.petId),runtime.storage.loadPuppyName(),runtime.database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM events WHERE pet_id=?',runtime.petId))]);
    emit({sync,local:{name,eventCount:count!.n}});
  }
  function cancelTimer() {cancelScheduled?.();cancelScheduled=null;}
  function eligible() {return !disposed&&!suspended&&!associationConfirmationNeeded&&!snapshot.busy&&snapshot.active&&snapshot.online&&!!snapshot.account?.cloud.canSync&&snapshot.sync?.accountId===snapshot.account?.user.id&&snapshot.sync?.state!=='local';}
  function kick(delay=0,force=false) {
    if (!eligible()) return;
    if (cancelScheduled&&!force) return;cancelTimer();
    cancelScheduled=defer(()=>{cancelScheduled=null;runOnce();},delay);
  }
  function runOnce() {
    if (!eligible()) return;if(running){rerun=true;return;}
    const controller=new AbortController();aborter=controller;rerun=false;emit({running:true});
    let nextDelay:number|null=null,confirmEnrollment=false;
    running=(async()=>{
      try {
        const result=await runner.run(controller.signal);
        if(controller.signal.aborted||disposed)return;
        await localState();
        confirmEnrollment=result.problem==='confirmation-required';
        if(confirmEnrollment){associationConfirmationNeeded=true;cancelTimer();}
        emit({run:result,problem:result.problem,...(result.state==='synced'?{lastSyncedAt:Date.now()}:{}),...(result.state==='auth-required'?{account:null}:{})});
        if(['auth-required','expired','error'].includes(result.state))suspended=true;
        nextDelay=result.retryAfterMs;
      }catch{if(!controller.signal.aborted&&!disposed)fail('local-storage');}
      finally{
        running=null;aborter=null;emit({running:false});
        if(!controller.signal.aborted&&confirmEnrollment&&!disposed){
          // Refresh outside the runner promise: account-change handling may
          // await transport shutdown and must never await its own promise.
          void refresh();
        }else if(!controller.signal.aborted&&(nextDelay!==null||rerun))kick(nextDelay??0);
      }
    })();
  }
  async function pauseTransport() {suspended=true;rerun=false;cancelTimer();aborter?.abort();if(running)await running;}
  function perform(action:()=>Promise<AccountActionResult>):Promise<AccountActionResult> {
    const result=actions.then(async()=>{
      if(disposed)return 'error' as const;emit({busy:true,problem:null});
      try{return await action();}
      catch(error){return fail(error instanceof CloudApiError?error.category:'local-storage');}
      finally{try{await localState();}catch{fail('local-storage');}emit({busy:false});kick();}
    });
    actions=result.catch(()=>undefined);return result;
  }
  async function loadAccount():Promise<boolean> {
    if(disposed)return false;
    if(!snapshot.online){fail('network');return false;}
    try {
      const account=await api.account();
      if(disposed)return false;
      if(snapshot.account&&snapshot.account.user.id!==account.user.id)await pauseTransport();
      emit({account});suspended=signOutUnfinished;
      if(snapshot.sync?.accountId&&snapshot.sync.accountId!==account.user.id)emit({problem:'account-mismatch'});
      return true;
    }catch(error){
      if(error instanceof CloudApiError&&error.category==='auth-required') {await pauseTransport();emit({account:null,run:null,problem:snapshot.sync?.accountId?'auth-required':null});return false;}
      throw error;
    }
  }
  function refresh():Promise<AccountActionResult> {
    if(refreshing)return refreshing;
    refreshing=perform(async()=>{
      if(!snapshot.online)return fail('network');emit({config:await api.config()});await localState();
      const loaded=await loadAccount();
      if(loaded&&associationConfirmationNeeded&&snapshot.account?.pets.length&&snapshot.sync?.state!=='active'
        &&(!snapshot.sync?.accountId||snapshot.sync.accountId===snapshot.account.user.id))emit({problem:'confirmation-required'});
      return 'ok';
    }).finally(()=>{refreshing=null;});
    return refreshing;
  }
  async function outcome(action:()=>Promise<IdentityOutcome>):Promise<IdentityOutcome> {try{return await action();}catch{return {error:{status:0,code:'NETWORK_ERROR'}};}}
  function identityProblem(error:NonNullable<IdentityOutcome['error']>,verifying=false):AccountProblem {
    if(['OTP_EXPIRED','EXPIRED_OTP'].includes(error.code??''))return 'code-expired';
    if(error.status===429||['TOO_MANY_ATTEMPTS','TOO_MANY_REQUESTS'].includes(error.code??''))return 'too-many-attempts';
    if(!error.status)return 'network';if(error.status>=500)return 'server-error';return verifying?'invalid-code':'sign-in-failed';
  }
  async function canSignIn(provider:'apple'|'google'|'email'):Promise<boolean> {
    if(disposed)return false;
    if(!snapshot.online){fail('network');return false;}
    if(!snapshot.config)emit({config:await api.config()});
    if(disposed)return false;
    if(!snapshot.config!.providers[provider]){fail('provider-unavailable');return false;}
    if(snapshot.account){fail('account-mismatch');return false;}
    await pauseTransport();return !disposed;
  }
  const unsubscribe=subscribeLocalWrites(()=>{void localState().then(()=>kick()).catch(()=>fail('local-storage'));});
  return {
    read:()=>snapshot,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    refresh,
    invalidate(){kick(0,true);},
    requestEmail(email:string) {return perform(async()=>{
      const parsed=z.email().max(320).safeParse(email.trim());if(!parsed.success)return fail('invalid-email');
      if(!await canSignIn('email'))return 'error';
      const result=await outcome(()=>identity.requestEmail(parsed.data));if(result.error)return fail(identityProblem(result.error));
      emit({codeSentTo:parsed.data});return 'ok';
    });},
    verifyEmail(email:string,code:string) {return perform(async()=>{
      if(!/^\d{6}$/.test(code)||email!==snapshot.codeSentTo)return fail('invalid-code');
      if(!await canSignIn('email'))return 'error';
      const result=await outcome(()=>identity.verifyEmail(email,code));if(result.error)return fail(identityProblem(result.error,true));
      if(!await loadAccount())return 'error';emit({codeSentTo:null});return 'ok';
    });},
    signInSocial(provider:'apple'|'google') {return perform(async()=>{
      if(!await canSignIn(provider))return 'error';
      const result=await outcome(()=>identity.signInSocial(provider));if(result.error)return fail(identityProblem(result.error));
      if(!await loadAccount()){emit({problem:null});return 'cancelled';}return 'ok';
    });},
    enableCloud({confirmedPetId,mode}:{confirmedPetId?:string;mode?:'combine'|'restore'}) {return perform(async()=>{
      const associationMode=z.enum(['combine','restore']).parse(mode??'combine');
      await pauseTransport();if(!await loadAccount())return 'error';await localState();
      if(disposed)return 'error';
      const account=snapshot.account!,status=snapshot.sync!;
      if(status.accountId&&status.accountId!==account.user.id)return fail('account-mismatch');
      if(status.state!=='local'){
        if(associationConfirmationNeeded){emit({problem:'confirmation-required'});return 'confirmation-required';}
        suspended=false;return 'ok';
      }
      const existing=account.pets[0];
      if((existing&&confirmedPetId!==existing.id)||(!existing&&confirmedPetId)) {emit({problem:'confirmation-required'});return 'confirmation-required';}
      if(associationMode==='restore'&&(!existing||!await runtime.sync.canRestoreSetup(runtime.petId))){emit({problem:'confirmation-required'});return 'confirmation-required';}
      if(!account.cloud.canSync){const trial=await api.startTrial();emit({account:{...account,cloud:trial.cloud}});if(!trial.cloud.canSync)return fail('trial-unavailable');}
      if(disposed)return 'error';
      const operationId=await runtime.database.read(async sql=>(await sql.getFirstAsync<{id:string}>('SELECT lower(hex(randomblob(16))) id'))!.id);
      await runtime.sync.prepareAssociation({accountId:account.user.id,localPetId:runtime.petId,deviceId:runtime.deviceId,mode:associationMode,enrollment:{operationId,deviceId:runtime.deviceId,localPetId:runtime.petId,name:associationMode==='restore'?existing!.name:snapshot.local!.name,...(confirmedPetId?{confirmedPetId}:{})}});
      associationConfirmationNeeded=false;suspended=false;return 'ok';
    });},
    continueLocally({confirmPending=false}:{confirmPending?:boolean}={}) {return perform(async()=>{
      if(!await runtime.storage.loadFirstLaunch())return 'cancelled';
      await pauseTransport();const status=await runtime.sync.status(runtime.petId);
      if(status.pending&&!confirmPending){suspended=signOutUnfinished;emit({problem:'pending-confirmation-required'});return 'pending-confirmation-required';}
      if(status.generation&&status.accountId)await runtime.sync.detach({generation:status.generation,accountId:status.accountId});
      associationConfirmationNeeded=false;suspended=signOutUnfinished;emit({run:null,problem:null});return 'ok';
    });},
    retry() {return perform(async()=>{
      if(associationConfirmationNeeded){emit({problem:'confirmation-required'});return 'confirmation-required';}
      await pauseTransport();if(!await loadAccount())return 'error';suspended=signOutUnfinished;return 'ok';
    });},
    signOut({confirmPending=false}:{confirmPending?:boolean}) {return perform(async()=>{
      const status=await runtime.sync.status(runtime.petId);
      if(status.pending&&!confirmPending){emit({problem:'pending-confirmation-required'});return 'pending-confirmation-required';}
      await pauseTransport();signOutUnfinished=true;
      const result=await outcome(()=>identity.signOut());
      // Expo may clear secure credentials before a failed network response.
      // Check the official SDK rather than preserving stale signed-in UI.
      try{if(await identity.hasCredentials())return fail('sign-out-failed');}catch{return fail('sign-out-failed');}
      emit({account:null,run:null,codeSentTo:null});
      if(status.generation&&status.accountId)await runtime.sync.detach({generation:status.generation,accountId:status.accountId});
      associationConfirmationNeeded=false;signOutUnfinished=false;emit({problem:result.error?'remote-sign-out-unconfirmed':null});return 'ok';
    });},
    setActive(active:boolean) {if(snapshot.active===active)return;emit({active});if(!active){cancelTimer();aborter?.abort();}else if(snapshot.online)void refresh();},
    setOnline(online:boolean) {if(snapshot.online===online)return;emit({online});if(!online){cancelTimer();aborter?.abort();}else if(snapshot.active)void refresh();},
    stop(){if(disposed)return;disposed=true;cancelTimer();aborter?.abort();unsubscribe();listeners.clear();},
  };
}
export type AccountController=ReturnType<typeof createAccountController>;
