import { z } from 'zod';
import { CloudApiError,cloudErrorCategory,retryDelay,throwIfAborted,type CloudApi,type CloudAccountSummary,type CloudConfig,type CloudErrorCategory } from './api.ts';
import { createSyncRunner,type RunResult } from './runner.ts';
import type { createLocalRuntime } from '../local/runtime-factory.ts';
import type { AppleIdToken } from './apple-native.ts';
import type { GoogleIdToken } from './google-native.ts';

type Runtime=Awaited<ReturnType<typeof createLocalRuntime>>;
type SyncStatus=Awaited<ReturnType<Runtime['sync']['status']>>;
export type AccountProblem=CloudErrorCategory|'local-storage'|'confirmation-required'|'pending-confirmation-required'|'account-mismatch'|'provider-unavailable'|'invalid-email'|'invalid-code'|'code-expired'|'too-many-attempts'|'sign-in-failed'|'social-incomplete'|'link-incomplete'|'sign-out-failed'|'remote-sign-out-unconfirmed'|'export-failed';
export type AccountActionResult='ok'|'error'|'cancelled'|'confirmation-required'|'pending-confirmation-required';
export type SocialProvider='apple'|'google';
export type CloudExportAction=(expectedAccount:string,ready:()=>Promise<boolean>,signal?:AbortSignal)=>Promise<'shared'|'cancelled'>;
type IdentityOutcome={error:{status:number;code?:string}|null;cancelled?:boolean};
type LinkedIdentity={userId:string;providerId:string};
type IdentityListOutcome=IdentityOutcome&{data:LinkedIdentity[]|null;retryAfterMs?:number|null};
export type IdentityAdapter={requestEmail:(email:string)=>Promise<IdentityOutcome>;verifyEmail:(email:string,code:string)=>Promise<IdentityOutcome>;signInSocial:(provider:SocialProvider)=>Promise<IdentityOutcome>;linkSocial:(provider:SocialProvider)=>Promise<IdentityOutcome>;listAccounts:()=>Promise<IdentityListOutcome>;signOut:()=>Promise<IdentityOutcome>;hasCredentials:()=>Promise<boolean>};
type SocialInput={provider:SocialProvider;callbackURL:string;errorCallbackURL:string;idToken?:AppleIdToken|GoogleIdToken};
type SdkIdentityClient={emailOtp:{sendVerificationOtp:(input:{email:string;type:'sign-in'})=>Promise<IdentityOutcome>};signIn:{emailOtp:(input:{email:string;otp:string})=>Promise<IdentityOutcome>;social:(input:SocialInput)=>Promise<IdentityOutcome>};linkSocial:(input:SocialInput)=>Promise<IdentityOutcome>;listAccounts:(options?:{fetchOptions:{onResponse:(context:{response:Response})=>void}})=>Promise<IdentityOutcome&{data?:unknown}>;signOut:()=>Promise<IdentityOutcome>;getCookie:()=>Promise<string>};
export function createIdentityAdapter(auth:SdkIdentityClient,{appleIdToken,googleIdToken,nativeSignOut}:{appleIdToken?:()=>Promise<AppleIdToken|null>;googleIdToken?:()=>Promise<GoogleIdToken|null>;nativeSignOut?:()=>Promise<void>}={}):IdentityAdapter {
  const result=(value:IdentityOutcome):IdentityOutcome=>({error:value.error?{status:value.error.status,code:value.error.code}:null});
  async function social(provider:SocialProvider,link:boolean):Promise<IdentityOutcome> {
    const input:SocialInput={provider,callbackURL:'puptime://account',errorCallbackURL:'puptime://account'};
    const requestIdToken=provider==='apple'?appleIdToken:googleIdToken;
    if(requestIdToken){
      let credential:AppleIdToken|GoogleIdToken|null;
      try{credential=await requestIdToken();}catch{return {error:{status:400,code:'NATIVE_AUTH_FAILED'}};}
      if(!credential)return {error:null,cancelled:true};
      input.idToken=credential;
    }
    return result(await (link?auth.linkSocial(input):auth.signIn.social(input)));
  }
  return {
    requestEmail:email=>auth.emailOtp.sendVerificationOtp({email,type:'sign-in'}).then(result),
    verifyEmail:(email,otp)=>auth.signIn.emailOtp({email,otp}).then(result),
    signInSocial:provider=>social(provider,false),
    linkSocial:provider=>social(provider,true),
    listAccounts:async()=>{
      let retryAfterMs:number|null=null;
      const response=await auth.listAccounts({fetchOptions:{onResponse:({response})=>{retryAfterMs=retryDelay(response.headers.get('retry-after'));}}});
      if(response.error)return {...result(response),data:null,retryAfterMs};
      const parsed=z.array(z.object({userId:z.string().min(1),providerId:z.string().min(1)})).safeParse(response.data);
      return parsed.success?{data:parsed.data,error:null}:{data:null,error:{status:502,code:'INVALID_RESPONSE'}};
    },
    signOut:async()=>{
      try{await nativeSignOut?.();}catch{return {error:{status:500,code:'NATIVE_SIGN_OUT_FAILED'}};}
      return result(await auth.signOut());
    },
    hasCredentials:async()=>!!(await auth.getCookie()),
  };
}
export type AccountSnapshot={config:CloudConfig|null;account:CloudAccountSummary|null;linkedProviders:SocialProvider[]|null;linkingProvider:SocialProvider|null;local:{name:string;eventCount:number}|null;sync:SyncStatus|null;run:RunResult|null;problem:AccountProblem|null;codeSentTo:string|null;busy:boolean;exporting:boolean;running:boolean;active:boolean;online:boolean;lastSyncedAt:number|null};
const defaultDefer=(fn:()=>void,delay:number)=>{const timer=setTimeout(fn,delay);return()=>clearTimeout(timer);};
// Call only after pausing the owning controller, or when no client exists.
export async function continueFirstLaunchLocally(runtime:Runtime,confirmPending=false):Promise<AccountActionResult> {
  if(!await runtime.storage.loadFirstLaunch())return 'cancelled';
  const status=await runtime.sync.status(runtime.petId);
  if(status.pending&&!confirmPending)return 'pending-confirmation-required';
  if(status.generation&&status.accountId)await runtime.sync.detach({generation:status.generation,accountId:status.accountId});
  return 'ok';
}
export function createAccountController({runtime,api,identity,subscribeLocalWrites,defer=defaultDefer,changed,exportCloud}:{runtime:Runtime;exportCloud?:CloudExportAction;api:CloudApi;identity:IdentityAdapter;subscribeLocalWrites:(fn:()=>void)=>()=>void;defer?:(fn:()=>void,delay:number)=>()=>void;changed:()=>void}) {
  let snapshot:AccountSnapshot={config:null,account:null,linkedProviders:null,linkingProvider:null,local:null,sync:null,run:null,problem:null,codeSentTo:null,busy:false,exporting:false,running:false,active:false,online:true,lastSyncedAt:null};
  const listeners=new Set<()=>void>();
  let disposed=false,suspended=false,signOutUnfinished=false,rerun=false,associationConfirmationNeeded=false;
  let actions:Promise<unknown>=Promise.resolve(),refreshing:Promise<AccountActionResult>|null=null,running:Promise<void>|null=null,aborter:AbortController|null=null,cancelScheduled:(()=>void)|null=null;
  let identityPending:Promise<AccountActionResult>|null=null,exportPending:Promise<AccountActionResult>|null=null;
  let exportAborter:AbortController|null=null;
  let refreshGeneration=0,refreshFailures=0,cancelRefreshScheduled:(()=>void)|null=null;
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
  function cancelRefreshRecovery(reset=true) {cancelRefreshScheduled?.();cancelRefreshScheduled=null;refreshGeneration++;refreshing=null;if(reset)refreshFailures=0;}
  function refreshCurrent(fence?:number) {return !disposed&&(fence===undefined||fence===refreshGeneration);}
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
        emit({run:result,problem:result.problem,...(result.state==='synced'?{lastSyncedAt:Date.now()}:{}),...(result.state==='auth-required'?{account:null,linkedProviders:null}:{})});
        if(['auth-required','error'].includes(result.state))suspended=true;
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
  function perform(action:()=>Promise<AccountActionResult>,refreshFence?:number):Promise<AccountActionResult> {
    if(refreshFence===undefined)cancelRefreshRecovery();
    const result=actions.then(async()=>{
      if(disposed)return 'error' as const;
      if(refreshFence!==undefined&&refreshFence!==refreshGeneration)return 'cancelled' as const;
      emit({busy:true,problem:null});
      try{return await action();}
      catch(error){return fail(error instanceof CloudApiError?error.category:'local-storage');}
      finally{try{await localState();}catch{fail('local-storage');}emit({busy:false});kick();}
    });
    actions=result.catch(()=>undefined);return result;
  }
  function authenticate(action:()=>Promise<AccountActionResult>):Promise<AccountActionResult> {
    if(identityPending)return Promise.resolve('cancelled');
    identityPending=perform(action).finally(()=>{identityPending=null;});return identityPending;
  }
  async function loadAccount(refreshFence?:number):Promise<boolean> {
    if(!refreshCurrent(refreshFence))return false;
    if(!snapshot.online){fail('network');return false;}
    try {
      const account=await api.account();
      if(!refreshCurrent(refreshFence))return false;
      if(snapshot.account&&snapshot.account.user.id!==account.user.id)await pauseTransport();
      if(!refreshCurrent(refreshFence))return false;
      emit({account,...(snapshot.account?.user.id!==account.user.id?{linkedProviders:null}:{})});suspended=signOutUnfinished;
      if(snapshot.sync?.accountId&&snapshot.sync.accountId!==account.user.id)emit({problem:'account-mismatch'});
      return true;
    }catch(error){
      if(!refreshCurrent(refreshFence))return false;
      if(error instanceof CloudApiError&&error.category==='auth-required') {await pauseTransport();if(refreshCurrent(refreshFence))emit({account:null,linkedProviders:null,run:null,problem:snapshot.sync?.accountId?'auth-required':null});return false;}
      throw error;
    }
  }
  type IdentityFence={userId:string;generation:string|null;accountId:string|null};
  async function captureIdentityFence(refreshFence?:number):Promise<IdentityFence|null> {
    if(!refreshCurrent(refreshFence))return null;
    const userId=snapshot.account?.user.id;if(!userId){fail('auth-required');return null;}
    const owner=await runtime.sync.status(runtime.petId);if(!refreshCurrent(refreshFence))return null;
    if(owner.accountId&&owner.accountId!==userId){await pauseTransport();if(refreshCurrent(refreshFence)){emit({linkedProviders:null});fail('account-mismatch');}return null;}
    return {userId,generation:owner.generation,accountId:owner.accountId};
  }
  async function currentIdentity(fence:IdentityFence,refreshFence?:number):Promise<boolean> {
    if(!refreshCurrent(refreshFence))return false;
    if(!snapshot.online){fail('network');return false;}
    const owner=await runtime.sync.status(runtime.petId);if(!refreshCurrent(refreshFence))return false;
    if(snapshot.account?.user.id!==fence.userId||owner.generation!==fence.generation||owner.accountId!==fence.accountId){
      await pauseTransport();if(refreshCurrent(refreshFence)){emit({linkedProviders:null});fail('account-mismatch');}return false;
    }
    return true;
  }
  async function confirmIdentity(fence:IdentityFence):Promise<boolean> {
    if(!await currentIdentity(fence))return false;
    try {
      const account=await api.account();if(!await currentIdentity(fence))return false;
      if(account.user.id!==fence.userId){await pauseTransport();emit({account:null,linkedProviders:null});fail('account-mismatch');return false;}
      emit({account});return true;
    }catch(error){
      if(disposed)return false;
      if(error instanceof CloudApiError&&error.category==='auth-required'){await pauseTransport();emit({account:null,linkedProviders:null});fail('auth-required');return false;}
      throw error;
    }
  }
  async function loadLinkedProviders(fence:IdentityFence,refreshFence?:number):Promise<boolean> {
    if(!refreshCurrent(refreshFence))return false;
    emit({linkedProviders:null});
    let result:IdentityListOutcome;
    try{result=await identity.listAccounts();}catch{if(!refreshCurrent(refreshFence))return false;throw new CloudApiError('network');}
    if(!await currentIdentity(fence,refreshFence)||!refreshCurrent(refreshFence))return false;
    if(result.error){
      const {status,code}=result.error;
      if(refreshFence!==undefined&&code!=='INVALID_RESPONSE'&&(!status||status===429||status>=500))throw new CloudApiError(status?cloudErrorCategory(status):'network',status,result.retryAfterMs??null);
      if(result.error.status===401){await pauseTransport();if(refreshCurrent(refreshFence)){emit({account:null});fail('auth-required');}}
      else fail(result.error.code==='INVALID_RESPONSE'?'invalid-response':identityProblem(result.error));
      return false;
    }
    if(!result.data){fail('invalid-response');return false;}
    if(result.data.some(account=>account.userId!==fence.userId)){await pauseTransport();if(refreshCurrent(refreshFence))fail('account-mismatch');return false;}
    const linkedProviders=[...new Set(result.data.map(account=>account.providerId).filter((provider):provider is SocialProvider=>provider==='apple'||provider==='google'))];
    emit({linkedProviders});return true;
  }
  async function refreshLinkedProviders(refreshFence?:number):Promise<boolean> {
    if(!refreshCurrent(refreshFence))return false;
    if(!snapshot.config){const config=await api.config();if(!refreshCurrent(refreshFence))return false;emit({config});}
    if(!snapshot.config!.providers.apple&&!snapshot.config!.providers.google){emit({linkedProviders:[]});return true;}
    const fence=await captureIdentityFence(refreshFence);return !!fence&&await loadLinkedProviders(fence,refreshFence);
  }
  function refresh():Promise<AccountActionResult> {
    if(refreshing)return refreshing;
    cancelRefreshRecovery(false);const generation=refreshGeneration;
    let failure:CloudApiError|null=null;
    const current=()=>refreshCurrent(generation);
    const request=perform(async()=>{
      try {
        if(!snapshot.online)return fail('network');
        const config=await api.config();if(!current())return 'cancelled';emit({config});await localState();
        if(!current())return 'cancelled';const loaded=await loadAccount(generation);if(!current())return 'cancelled';
        if(loaded){const linked=await refreshLinkedProviders(generation);if(!current())return 'cancelled';if(!linked)return 'error';}
        if(loaded&&associationConfirmationNeeded&&snapshot.account?.pets.length&&snapshot.sync?.state!=='active'
          &&(!snapshot.sync?.accountId||snapshot.sync.accountId===snapshot.account.user.id))emit({problem:'confirmation-required'});
        return 'ok';
      }catch(error){
        if(!current())return 'cancelled';
        if(error instanceof CloudApiError&&['network','rate-limited','server-error'].includes(error.category))failure=error;
        throw error;
      }
    },generation).finally(()=>{
      if(refreshing===request)refreshing=null;
      // Only refresh's own transient failure can recover automatically. An
      // explicit account action invalidates this fence before it is queued.
      if(!current())return;
      if(!failure){refreshFailures=0;return;}
      const retry=failure,ready=()=>current()&&snapshot.active&&snapshot.online&&(snapshot.problem===null||['network','rate-limited','server-error'].includes(snapshot.problem));
      if(!ready())return;
      const delay=Math.max(retry.retryAfterMs??0,Math.min(60000,1000*2**Math.min(refreshFailures++,6)));
      cancelRefreshScheduled=defer(()=>{if(!current())return;cancelRefreshScheduled=null;if(ready())void refresh();},delay);
    });
    refreshing=request;return request;
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
    async eventHistory(eventId:string,beforeRevision?:number,signal?:AbortSignal) {
      throwIfAborted(signal);
      if(disposed||snapshot.busy||identityPending)throw new CloudApiError('conflict');
      const accountId=snapshot.account?.user.id,actionFence=actions;
      if(!accountId)throw new CloudApiError('auth-required',401);
      function currentSession() {
        throwIfAborted(signal);
        if(disposed||snapshot.busy||identityPending||actions!==actionFence||snapshot.account?.user.id!==accountId)throw new CloudApiError('conflict');
        if(!snapshot.online)throw new CloudApiError('network');
      }
      currentSession();
      const {head}=await runtime.history.eventPage(eventId,{limit:1});currentSession();
      if(head.owner?.accountId!==accountId||!head.cloudRecord)throw new CloudApiError('forbidden',403);
      if(!snapshot.account!.cloud.canSync)throw new CloudApiError('forbidden',403);
      const result=await api.history(head.cloudRecord.id,beforeRevision,signal);currentSession();
      const {head:latest}=await runtime.history.eventPage(eventId,{limit:1});currentSession();
      if(latest.owner?.generation!==head.owner.generation||latest.owner?.accountId!==accountId
        ||latest.cloudRecord?.id!==head.cloudRecord.id||latest.cloudRecord?.petId!==head.cloudRecord.petId)throw new CloudApiError('conflict');
      if(!snapshot.account!.cloud.canSync)throw new CloudApiError('forbidden',403);
      return result;
    },
    cancelExport(){exportAborter?.abort();},
    exportData():Promise<AccountActionResult> {
      if(exportPending||identityPending)return Promise.resolve('cancelled');
      const controller=new AbortController();exportAborter=controller;
      exportPending=perform(async()=>{
        if(controller.signal.aborted)return 'cancelled';
        if(!snapshot.online)return fail('network');
        if(!exportCloud)return fail('export-failed');
        const wasSuspended=suspended;await pauseTransport();
        const fence=await captureIdentityFence();if(!fence)return 'error';
        emit({exporting:true});
        try {
          if(controller.signal.aborted)return 'cancelled';
          if(!await confirmIdentity(fence))return 'error';
          if(controller.signal.aborted)return 'cancelled';
          if(!snapshot.account!.cloud.canExport)return fail('forbidden');
          const result=await exportCloud(fence.userId,async()=>{
            if(disposed||controller.signal.aborted)return false;
            if(!await confirmIdentity(fence))return false;
            if(!snapshot.account!.cloud.canExport){fail('forbidden');return false;}
            return true;
          },controller.signal);
          return result==='shared'?'ok':'cancelled';
        }catch(error){
          if(disposed)return 'cancelled';
          if(controller.signal.aborted)return snapshot.online?'cancelled':fail('network');
          if(error instanceof CloudApiError){
            if(error.category==='auth-required')emit({account:null,linkedProviders:null});
            if(['auth-required','account-deleted','forbidden','conflict'].includes(error.category))return fail(error.category);
          }
          return fail('export-failed');
        }finally{
          if(!disposed){
            try {
              const owner=await runtime.sync.status(runtime.petId);
              if(snapshot.account?.user.id===fence.userId&&owner.accountId===fence.accountId&&owner.generation===fence.generation)suspended=wasSuspended||signOutUnfinished;
            }finally{emit({exporting:false});}
          }
        }
      }).finally(()=>{exportAborter=null;exportPending=null;});
      return exportPending;
    },
    invalidate(){kick(0,true);},
    requestEmail(email:string) {return authenticate(async()=>{
      const parsed=z.email().max(320).safeParse(email.trim());if(!parsed.success)return fail('invalid-email');
      if(!await canSignIn('email'))return 'error';
      const result=await outcome(()=>identity.requestEmail(parsed.data));if(result.error)return fail(identityProblem(result.error));
      emit({codeSentTo:parsed.data});return 'ok';
    });},
    verifyEmail(email:string,code:string) {return authenticate(async()=>{
      if(!/^\d{6}$/.test(code)||email!==snapshot.codeSentTo)return fail('invalid-code');
      if(!await canSignIn('email'))return 'error';
      await runtime.checkpoint('account-change');
      if(disposed)return 'cancelled';
      const result=await outcome(()=>identity.verifyEmail(email,code));if(result.error)return fail(identityProblem(result.error,true));
      if(!await loadAccount())return 'error';emit({codeSentTo:null});return await refreshLinkedProviders()?'ok':'error';
    });},
    signInSocial(provider:'apple'|'google') {return authenticate(async()=>{
      if(!await canSignIn(provider))return 'error';
      await runtime.checkpoint('account-change');
      if(disposed)return 'cancelled';
      const result=await outcome(()=>identity.signInSocial(provider));if(result.cancelled)return 'cancelled';if(result.error){const problem=identityProblem(result.error);return fail(problem==='sign-in-failed'?'social-incomplete':problem);}
      if(!await loadAccount())return disposed||snapshot.problem==='network'?'error':fail('social-incomplete');return await refreshLinkedProviders()?'ok':'error';
    });},
    connectProvider(provider:SocialProvider) {return authenticate(async()=>{
      if(!snapshot.online)return fail('network');
      if(!snapshot.config)emit({config:await api.config()});if(disposed)return 'error';
      if(!snapshot.config!.providers[provider])return fail('provider-unavailable');
      await pauseTransport();const fence=await captureIdentityFence();if(!fence)return 'error';
      emit({linkingProvider:provider});
      try {
        if(!await confirmIdentity(fence)||!await loadLinkedProviders(fence))return 'error';
        if(snapshot.linkedProviders!.includes(provider))return 'ok';
        const result=await outcome(()=>identity.linkSocial(provider));
        if(result.cancelled)return 'cancelled';
        if(!await currentIdentity(fence))return 'error';
        if(result.error){
          if(result.error.status===401){emit({account:null,linkedProviders:null});return fail('auth-required');}
          const problem=identityProblem(result.error);return fail(problem==='sign-in-failed'?'link-incomplete':problem);
        }
        // The Expo SDK resolves its initiation response even after browser cancellation.
        if(!await confirmIdentity(fence)||!await loadLinkedProviders(fence))return 'error';
        return snapshot.linkedProviders!.includes(provider)?'ok':fail('link-incomplete');
      }finally{
        if(!disposed){
          const owner=await runtime.sync.status(runtime.petId);
          if(snapshot.account?.user.id===fence.userId&&owner.accountId===fence.accountId&&owner.generation===fence.generation)suspended=signOutUnfinished;
          emit({linkingProvider:null});
        }
      }
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
      if(!account.cloud.canSync)return fail('forbidden');
      if(disposed)return 'error';
      const operationId=await runtime.database.read(async sql=>(await sql.getFirstAsync<{id:string}>("SELECT 'op_' || lower(hex(randomblob(16))) id"))!.id);
      await runtime.sync.prepareAssociation({accountId:account.user.id,localPetId:runtime.petId,deviceId:runtime.deviceId,mode:associationMode,enrollment:{operationId,deviceId:runtime.deviceId,localPetId:runtime.petId,name:associationMode==='restore'?existing!.name:snapshot.local!.name,...(confirmedPetId?{confirmedPetId}:{})}});
      associationConfirmationNeeded=false;suspended=false;return 'ok';
    });},
    continueLocally({confirmPending=false}:{confirmPending?:boolean}={}) {return perform(async()=>{
      if(!await runtime.storage.loadFirstLaunch())return 'cancelled';
      await pauseTransport();const result=await continueFirstLaunchLocally(runtime,confirmPending);
      if(result!=='ok'){suspended=signOutUnfinished;if(result==='pending-confirmation-required')emit({problem:result});return result;}
      associationConfirmationNeeded=false;suspended=signOutUnfinished;emit({run:null,problem:null});return 'ok';
    });},
    retry() {return perform(async()=>{
      if(associationConfirmationNeeded){emit({problem:'confirmation-required'});return 'confirmation-required';}
      await pauseTransport();if(!await loadAccount())return 'error';if(!await refreshLinkedProviders())return 'error';suspended=signOutUnfinished;return 'ok';
    });},
    signOut({confirmPending=false}:{confirmPending?:boolean}) {return perform(async()=>{
      const status=await runtime.sync.status(runtime.petId);
      if(status.pending&&!confirmPending){emit({problem:'pending-confirmation-required'});return 'pending-confirmation-required';}
      await pauseTransport();
      await runtime.checkpoint('account-change');
      if(disposed)return 'cancelled';
      signOutUnfinished=true;
      const result=await outcome(()=>identity.signOut());
      if(result.error?.code==='NATIVE_SIGN_OUT_FAILED')return fail('sign-out-failed');
      // Expo may clear secure credentials before a failed network response.
      // Check the official SDK rather than preserving stale signed-in UI.
      try{if(await identity.hasCredentials())return fail('sign-out-failed');}catch{return fail('sign-out-failed');}
      emit({account:null,linkedProviders:null,run:null,codeSentTo:null});
      if(status.generation&&status.accountId)await runtime.sync.detach({generation:status.generation,accountId:status.accountId});
      associationConfirmationNeeded=false;signOutUnfinished=false;emit({problem:result.error?'remote-sign-out-unconfirmed':null});return 'ok';
    });},
    // The identity action verifies its own browser return; a queued lifecycle
    // refresh would otherwise immediately erase its completion/error state.
    setActive(active:boolean) {if(snapshot.active===active)return;emit({active});if(!active){cancelRefreshRecovery();cancelTimer();aborter?.abort();}else if(snapshot.online&&!identityPending)void refresh();},
    setOnline(online:boolean) {if(snapshot.online===online)return;emit({online});if(!online){cancelRefreshRecovery();cancelTimer();aborter?.abort();exportAborter?.abort();}else if(snapshot.active&&!identityPending)void refresh();},
    stop(){if(disposed)return;disposed=true;cancelRefreshRecovery();cancelTimer();aborter?.abort();exportAborter?.abort();unsubscribe();listeners.clear();},
  };
}
export type AccountController=ReturnType<typeof createAccountController>;
