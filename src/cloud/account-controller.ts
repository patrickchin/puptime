import { z } from 'zod';
import { CloudApiError,throwIfAborted,type CloudApi,type CloudAccountSummary,type CloudConfig,type CloudErrorCategory } from './api.ts';
import { createSyncRunner,type RunResult } from './runner.ts';
import type { createLocalRuntime } from '../local/runtime-factory.ts';
import type {AccountLifecycle,LifecycleIdentity} from './account-lifecycle.ts';
import type {AccountDeletionIntent,AccountDeletionNotice} from '../local/account-deletion.ts';

type Runtime=Awaited<ReturnType<typeof createLocalRuntime>>;
type SyncStatus=Awaited<ReturnType<Runtime['sync']['status']>>;
export type AccountProblem=CloudErrorCategory|'local-storage'|'confirmation-required'|'pending-confirmation-required'|'account-mismatch'|'trial-unavailable'|'provider-unavailable'|'invalid-email'|'invalid-code'|'code-expired'|'too-many-attempts'|'sign-in-failed'|'social-incomplete'|'link-incomplete'|'sign-out-failed'|'remote-sign-out-unconfirmed'|'export-failed'|'deletion-pending'|'reauth-incomplete';
export type AccountActionResult='ok'|'error'|'cancelled'|'confirmation-required'|'pending-confirmation-required';
export type SocialProvider='apple'|'google';
export type CloudExportAction=(expectedAccount:string,ready:()=>Promise<boolean>,signal?:AbortSignal)=>Promise<'shared'|'cancelled'>;
type IdentityOutcome={error:{status:number;code?:string}|null};
type LinkedIdentity={userId:string;providerId:string};
type IdentityListOutcome=IdentityOutcome&{data:LinkedIdentity[]|null};
export type IdentityAdapter={requestEmail:(email:string)=>Promise<IdentityOutcome>;verifyEmail:(email:string,code:string)=>Promise<IdentityOutcome>;signInSocial:(provider:SocialProvider)=>Promise<IdentityOutcome>;linkSocial:(provider:SocialProvider)=>Promise<IdentityOutcome>;listAccounts:()=>Promise<IdentityListOutcome>;signOut:()=>Promise<IdentityOutcome>;hasCredentials:()=>Promise<boolean>};
type SocialInput={provider:SocialProvider;callbackURL:string;errorCallbackURL:string};
type SdkIdentityClient={emailOtp:{sendVerificationOtp:(input:{email:string;type:'sign-in'})=>Promise<IdentityOutcome>};signIn:{emailOtp:(input:{email:string;otp:string})=>Promise<IdentityOutcome>;social:(input:SocialInput)=>Promise<IdentityOutcome>};linkSocial:(input:SocialInput)=>Promise<IdentityOutcome>;listAccounts:()=>Promise<IdentityOutcome&{data?:unknown}>;signOut:()=>Promise<IdentityOutcome>;getCookie:()=>Promise<string>};
export function createIdentityAdapter(auth:SdkIdentityClient):IdentityAdapter {
  const result=(value:IdentityOutcome):IdentityOutcome=>({error:value.error?{status:value.error.status,code:value.error.code}:null});
  return {
    requestEmail:email=>auth.emailOtp.sendVerificationOtp({email,type:'sign-in'}).then(result),
    verifyEmail:(email,otp)=>auth.signIn.emailOtp({email,otp}).then(result),
    signInSocial:provider=>auth.signIn.social({provider,callbackURL:'puptime://account',errorCallbackURL:'puptime://account'}).then(result),
    linkSocial:provider=>auth.linkSocial({provider,callbackURL:'puptime://account',errorCallbackURL:'puptime://account'}).then(result),
    listAccounts:async()=>{
      const response=await auth.listAccounts();if(response.error)return {...result(response),data:null};
      const parsed=z.array(z.object({userId:z.string().min(1),providerId:z.string().min(1)})).safeParse(response.data);
      return parsed.success?{data:parsed.data,error:null}:{data:null,error:{status:502,code:'INVALID_RESPONSE'}};
    },
    signOut:()=>auth.signOut().then(result),
    hasCredentials:async()=>!!(await auth.getCookie()),
  };
}
export type DeletionView={stage:'verify'|'code'|'ready'|'pending'|'cleanup';email:string|null;provider:SocialProvider|null;status:'not-started'|'pending'|'unknown'|null;canCancel:boolean;recovery?:boolean};
export type AccountSnapshot={config:CloudConfig|null;account:CloudAccountSummary|null;linkedProviders:SocialProvider[]|null;linkingProvider:SocialProvider|null;local:{name:string;eventCount:number}|null;sync:SyncStatus|null;run:RunResult|null;problem:AccountProblem|null;codeSentTo:string|null;busy:boolean;exporting:boolean;enabling:boolean;deletion:DeletionView|null;deletionNotice:AccountDeletionNotice|null;running:boolean;active:boolean;online:boolean;lastSyncedAt:number|null};
const defaultDefer=(fn:()=>void,delay:number)=>{const timer=setTimeout(fn,delay);return()=>clearTimeout(timer);};
// Call only after pausing the owning controller, or when no client exists.
export async function continueFirstLaunchLocally(runtime:Runtime,confirmPending=false):Promise<AccountActionResult> {
  if(!await runtime.storage.loadFirstLaunch())return 'cancelled';
  const status=await runtime.sync.status(runtime.petId);
  if(status.pending&&!confirmPending)return 'pending-confirmation-required';
  if(status.generation&&status.accountId)await runtime.sync.detach({generation:status.generation,accountId:status.accountId});
  return 'ok';
}
export function createAccountController({runtime,api,identity,subscribeLocalWrites,defer=defaultDefer,changed,exportCloud,lifecycle}:{runtime:Runtime;exportCloud?:CloudExportAction;lifecycle?:AccountLifecycle;api:CloudApi;identity:IdentityAdapter;subscribeLocalWrites:(fn:()=>void)=>()=>void;defer?:(fn:()=>void,delay:number)=>()=>void;changed:()=>void}) {
  let snapshot:AccountSnapshot={config:null,account:null,linkedProviders:null,linkingProvider:null,local:null,sync:null,run:null,problem:null,codeSentTo:null,busy:false,exporting:false,enabling:false,deletion:null,deletionNotice:null,running:false,active:false,online:true,lastSyncedAt:null};
  const listeners=new Set<()=>void>();
  let disposed=false,suspended=false,signOutUnfinished=false,rerun=false,associationConfirmationNeeded=false;
  let actions:Promise<unknown>=Promise.resolve(),refreshing:Promise<AccountActionResult>|null=null,running:Promise<void>|null=null,aborter:AbortController|null=null,cancelScheduled:(()=>void)|null=null;
  let identityPending:Promise<AccountActionResult>|null=null,exportPending:Promise<AccountActionResult>|null=null;
  let exportAborter:AbortController|null=null;
  type DeletionSetup={epoch:number;accountId:string;generation:string|null;sessionId:string|null;reauthIntentId:string|null;recoveryReceipt:string|null};
  let deletionIntent:AccountDeletionIntent|null=null,deletionSetup:DeletionSetup|null=null,deletionEpoch=0,deletionCommitted=false;
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
  function eligible() {return !disposed&&!suspended&&!deletionIntent&&!deletionSetup&&!deletionCommitted&&!associationConfirmationNeeded&&!snapshot.busy&&snapshot.active&&snapshot.online&&!!snapshot.account?.cloud.canSync&&snapshot.sync?.accountId===snapshot.account?.user.id&&snapshot.sync?.state!=='local';}
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
  function perform(action:()=>Promise<AccountActionResult>,kind:'standard'|'deletion'|'refresh'|'enable'='standard'):Promise<AccountActionResult> {
    const result=actions.then(async()=>{
      if(disposed)return 'error' as const;
      try{deletionIntent=await runtime.deletion.read();}catch{return fail('local-storage');}
      if(deletionIntent){await pauseTransport();if(!deletionSetup&&!snapshot.deletion)emit({deletion:pendingDeletionView()});}
      if(kind!=='deletion'&&kind!=='refresh'&&(deletionIntent||deletionSetup||deletionCommitted))return fail('deletion-pending');
      emit({busy:true,enabling:kind==='enable',problem:null});
      try{return await action();}
      catch(error){return fail(error instanceof CloudApiError?error.category:'local-storage');}
      finally{try{await localState();}catch{fail('local-storage');}emit({busy:false,enabling:false});kick();}
    });
    actions=result.catch(()=>undefined);return result;
  }
  function authenticate(action:()=>Promise<AccountActionResult>,kind:'standard'|'deletion'='standard'):Promise<AccountActionResult> {
    if(identityPending)return Promise.resolve('cancelled');
    identityPending=perform(action,kind).finally(()=>{identityPending=null;});return identityPending;
  }
  async function loadAccount():Promise<boolean> {
    if(disposed)return false;
    if(!snapshot.online){fail('network');return false;}
    try {
      const account=await api.account();
      if(disposed)return false;
      if(snapshot.account&&snapshot.account.user.id!==account.user.id)await pauseTransport();
      emit({account,...(snapshot.account?.user.id!==account.user.id?{linkedProviders:null}:{})});suspended=signOutUnfinished;
      if(snapshot.sync?.accountId&&snapshot.sync.accountId!==account.user.id)emit({problem:'account-mismatch'});
      return true;
    }catch(error){
      if(error instanceof CloudApiError&&error.category==='auth-required') {await pauseTransport();emit({account:null,linkedProviders:null,run:null,problem:snapshot.sync?.accountId?'auth-required':null});return false;}
      throw error;
    }
  }
  type IdentityFence={userId:string;generation:string|null;accountId:string|null};
  async function captureIdentityFence():Promise<IdentityFence|null> {
    if(disposed)return null;
    const userId=snapshot.account?.user.id;if(!userId){fail('auth-required');return null;}
    const owner=await runtime.sync.status(runtime.petId);if(disposed)return null;
    if(owner.accountId&&owner.accountId!==userId){await pauseTransport();emit({linkedProviders:null});fail('account-mismatch');return null;}
    return {userId,generation:owner.generation,accountId:owner.accountId};
  }
  async function currentIdentity(fence:IdentityFence):Promise<boolean> {
    if(disposed)return false;
    if(!snapshot.online){fail('network');return false;}
    const owner=await runtime.sync.status(runtime.petId);if(disposed)return false;
    if(snapshot.account?.user.id!==fence.userId||owner.generation!==fence.generation||owner.accountId!==fence.accountId){
      await pauseTransport();emit({linkedProviders:null});fail('account-mismatch');return false;
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
  async function loadLinkedProviders(fence:IdentityFence):Promise<boolean> {
    emit({linkedProviders:null});
    let result:IdentityListOutcome;
    try{result=await identity.listAccounts();}catch{throw new CloudApiError('network');}
    if(!await currentIdentity(fence))return false;
    if(result.error){
      if(result.error.status===401){await pauseTransport();emit({account:null});fail('auth-required');}
      else fail(result.error.code==='INVALID_RESPONSE'?'invalid-response':identityProblem(result.error));
      return false;
    }
    if(!result.data){fail('invalid-response');return false;}
    if(result.data.some(account=>account.userId!==fence.userId)){await pauseTransport();fail('account-mismatch');return false;}
    const linkedProviders=[...new Set(result.data.map(account=>account.providerId).filter((provider):provider is SocialProvider=>provider==='apple'||provider==='google'))];
    emit({linkedProviders});return true;
  }
  async function refreshLinkedProviders():Promise<boolean> {
    if(disposed)return false;
    if(!snapshot.config)emit({config:await api.config()});if(disposed)return false;
    if(!snapshot.config!.providers.apple&&!snapshot.config!.providers.google){emit({linkedProviders:[]});return true;}
    const fence=await captureIdentityFence();return !!fence&&await loadLinkedProviders(fence);
  }
  function pendingDeletionView():DeletionView {
    return {stage:deletionIntent?.phase==='acknowledged'?'cleanup':'pending',email:null,provider:null,status:deletionIntent?.phase==='prepared'?'not-started':null,canCancel:deletionIntent?.phase==='prepared'};
  }
  async function sameDeletionOwner(fence:{accountId:string;generation:string|null}):Promise<boolean> {
    const owner=await runtime.deletion.owner();
    if(fence.generation===null?owner!==null:owner?.accountId!==fence.accountId||owner.generation!==fence.generation){fail('account-mismatch');return false;}
    return true;
  }
  async function deletionIdentity(setup:DeletionSetup):Promise<LifecycleIdentity|null> {
    if(disposed||deletionSetup!==setup||setup.epoch!==deletionEpoch)return null;
    if(setup.recoveryReceipt&&deletionIntent?.receipt!==setup.recoveryReceipt){fail('deletion-pending');return null;}
    if(!snapshot.online){fail('network');return null;}
    if(!await sameDeletionOwner(setup))return null;
    const current=await lifecycle!.identity();
    if(disposed||deletionSetup!==setup||setup.epoch!==deletionEpoch)return null;
    if(!await sameDeletionOwner(setup))return null;
    if(!current){fail('auth-required');return null;}
    if(current.user.id!==setup.accountId){emit({account:null,linkedProviders:null});fail('account-mismatch');return null;}
    if(disposed||deletionSetup!==setup||setup.epoch!==deletionEpoch)return null;
    return current;
  }
  async function beforeDeletionProof(setup:DeletionSetup):Promise<boolean> {
    if(snapshot.deletion?.status==='unknown'){fail('deletion-pending');return false;}
    if(!setup.recoveryReceipt)return !!await deletionIdentity(setup);
    if(disposed||deletionSetup!==setup||setup.epoch!==deletionEpoch)return false;
    if(!snapshot.online){fail('network');return false;}
    if(deletionIntent?.receipt!==setup.recoveryReceipt||!await sameDeletionOwner(setup))return false;
    if(disposed||deletionSetup!==setup||setup.epoch!==deletionEpoch)return false;
    const current=await lifecycle!.identity();
    if(disposed||deletionSetup!==setup||setup.epoch!==deletionEpoch)return false;
    if(!await sameDeletionOwner(setup))return false;
    if(disposed||deletionSetup!==setup||setup.epoch!==deletionEpoch)return false;
    if(!snapshot.online){fail('network');return false;}
    if(current&&current.user.id!==setup.accountId){fail('account-mismatch');return false;}
    // If a session appeared before this proof, it must also be replaced.
    if(current)setup.sessionId=current.session.id;
    return true;
  }
  function cancelDeletionProof(setup:DeletionSetup,intentId:string) {
    return setup.recoveryReceipt?lifecycle!.cancelRecovery(setup.accountId,setup.recoveryReceipt,intentId):lifecycle!.cancelReauthentication(setup.accountId,intentId);
  }
  async function cancelDeletion(){
    if(deletionCommitted)return;
    const setup=deletionSetup,epoch=++deletionEpoch;deletionSetup=null;
    if(setup?.reauthIntentId)void cancelDeletionProof(setup,setup.reauthIntentId).catch(()=>{});
    emit({deletion:deletionIntent?pendingDeletionView():null,problem:null});
    if(!deletionIntent||deletionIntent.phase!=='prepared'){suspended=!!deletionIntent||signOutUnfinished;kick();return;}
    try{
      const intent=await runtime.deletion.read();if(epoch!==deletionEpoch)return;
      if(intent?.phase==='prepared')await runtime.deletion.cancelPrepared(intent.receipt);
      if(epoch!==deletionEpoch)return;
      deletionIntent=intent?.phase==='prepared'?null:intent;
      suspended=!!deletionIntent||signOutUnfinished;
      emit({deletion:deletionIntent?pendingDeletionView():null});kick();
    }catch{await pauseTransport();fail('local-storage');}
  }
  async function finishDeletion():Promise<AccountActionResult> {
    const intent=deletionIntent;
    if(!intent||intent.phase!=='acknowledged'||!lifecycle)return fail('deletion-pending');
    emit({deletion:pendingDeletionView()});
    if(!await sameDeletionOwner(intent))return 'error';
    // A completed receipt belongs to the old account. Never clear a different
    // owner's credentials merely because that old account finished deletion.
    const current=await lifecycle.identity();
    if(current&&current.user.id!==intent.accountId)return fail('account-mismatch');
    if(await identity.hasCredentials()) {
      const latest=await lifecycle.identity();
      if(latest&&latest.user.id!==intent.accountId)return fail('account-mismatch');
      if(!await sameDeletionOwner(intent))return 'error';
      await outcome(()=>identity.signOut());
      if(await identity.hasCredentials())return fail('sign-out-failed');
    }
    await runtime.deletion.complete(intent.receipt);
    deletionIntent=null;deletionSetup=null;deletionCommitted=false;deletionEpoch++;
    associationConfirmationNeeded=false;signOutUnfinished=false;suspended=false;
    emit({account:null,linkedProviders:null,run:null,codeSentTo:null,deletion:null,deletionNotice:await runtime.deletion.readNotice(),problem:null});
    changed();return 'ok';
  }
  async function checkDeletion():Promise<AccountActionResult> {
    deletionIntent=await runtime.deletion.read();
    emit({deletionNotice:await runtime.deletion.readNotice()});
    if(!deletionIntent)return 'ok';
    await pauseTransport();emit({deletion:pendingDeletionView()});
    if(!lifecycle)return fail('deletion-pending');
    if(deletionIntent.phase==='acknowledged')return finishDeletion();
    if(!snapshot.online)return fail('network');
    const receipt=deletionIntent.receipt,result=await lifecycle.status(receipt);
    if(result.status!=='deleted'){emit({deletion:{...pendingDeletionView(),status:result.status}});return 'ok';}
    // Status can acknowledge an uncertain request; it can never authorize one.
    if(deletionIntent.phase==='prepared')return fail('invalid-response');
    await runtime.deletion.acknowledge(receipt,result.appleRevocation);
    deletionIntent=await runtime.deletion.read();return finishDeletion();
  }
  async function reauthenticationFinished(setup:DeletionSetup):Promise<AccountActionResult> {
    const current=await deletionIdentity(setup);
    if(!current)return setup.epoch===deletionEpoch?'error':'cancelled';
    if(current.session.id===setup.sessionId)return fail('reauth-incomplete');
    emit({deletion:{stage:'ready',email:current.user.email,provider:null,status:null,canCancel:true}});return 'ok';
  }
  function refresh():Promise<AccountActionResult> {
    if(refreshing)return refreshing;
    refreshing=perform(async()=>{
      if(deletionIntent)return checkDeletion();
      emit({deletionNotice:await runtime.deletion.readNotice()});
      if(deletionSetup||deletionCommitted)return 'ok';
      if(!snapshot.online)return fail('network');emit({config:await api.config()});await localState();
      const loaded=await loadAccount();
      if(loaded&&!await refreshLinkedProviders())return 'error';
      if(loaded&&associationConfirmationNeeded&&snapshot.account?.pets.length&&snapshot.sync?.state!=='active'
        &&(!snapshot.sync?.accountId||snapshot.sync.accountId===snapshot.account.user.id))emit({problem:'confirmation-required'});
      return 'ok';
    },'refresh').finally(()=>{refreshing=null;});
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
    beginDeletion(){return authenticate(async()=>{
      if(!lifecycle)return fail('provider-unavailable');
      if(deletionCommitted)return fail('deletion-pending');
      const epoch=++deletionEpoch;
      await pauseTransport();
      if(deletionIntent?.phase==='acknowledged')return finishDeletion();
      if(deletionIntent){
        const result=await checkDeletion();
        if(disposed||epoch!==deletionEpoch)return deletionIntent?'cancelled':result;
        if(result!=='ok'||!deletionIntent)return result;
        if(snapshot.deletion?.status==='unknown')return fail('deletion-pending');
      }
      const accountId=deletionIntent?.accountId??snapshot.account?.user.id;
      if(!accountId)return fail('auth-required');
      const owner=await runtime.deletion.owner();
      if(owner&&owner.accountId!==accountId)return fail('account-mismatch');
      const generation=deletionIntent?deletionIntent.generation:owner?.generation??null;
      if(!await sameDeletionOwner({accountId,generation}))return 'error';
      if(!snapshot.online)return fail('network');
      const current=await lifecycle.identity();
      if(disposed||epoch!==deletionEpoch)return 'cancelled';
      if(!current&&!deletionIntent)return fail('auth-required');
      if(current&&current.user.id!==accountId)return fail('account-mismatch');
      if(!await sameDeletionOwner({accountId,generation}))return 'error';
      if(disposed||epoch!==deletionEpoch)return 'cancelled';
      const setup:DeletionSetup={epoch,accountId,generation,sessionId:current?.session.id??null,reauthIntentId:null,recoveryReceipt:current?null:deletionIntent!.receipt};deletionSetup=setup;
      emit({deletion:{stage:'verify',email:current?.user.email??null,provider:null,status:null,canCancel:true,recovery:!!setup.recoveryReceipt},...(!current?{account:null,linkedProviders:null}:{})});
      if(!snapshot.config)emit({config:await api.config()});
      if(setup.recoveryReceipt)return await beforeDeletionProof(setup)?'ok':epoch===deletionEpoch?'error':'cancelled';
      if(!await deletionIdentity(setup))return epoch===deletionEpoch?'error':'cancelled';
      if(snapshot.config!.providers.apple||snapshot.config!.providers.google){
        const methods=await identity.listAccounts();
        if(!await deletionIdentity(setup))return epoch===deletionEpoch?'error':'cancelled';
        if(methods.error)return fail(identityProblem(methods.error));
        if(!methods.data)return fail('invalid-response');
        if(methods.data.some(method=>method.userId!==accountId))return fail('account-mismatch');
        emit({linkedProviders:[...new Set(methods.data.map(method=>method.providerId).filter((provider):provider is SocialProvider=>provider==='apple'||provider==='google'))]});
      }else emit({linkedProviders:[]});
      return 'ok';
    },'deletion');},
    requestDeletionCode(){return authenticate(async()=>{
      const setup=deletionSetup;if(!setup||!lifecycle)return fail('reauth-incomplete');
      if(!await beforeDeletionProof(setup))return 'error';
      try{
        if(setup.recoveryReceipt){
          const {recoveryIntentId}=await lifecycle.requestRecoveryEmail(setup.accountId,setup.recoveryReceipt);
          if(deletionSetup!==setup||setup.epoch!==deletionEpoch){void cancelDeletionProof(setup,recoveryIntentId).catch(()=>{});return 'cancelled';}
          setup.reauthIntentId=recoveryIntentId;
        }else await lifecycle.requestEmail(setup.accountId);
      }catch(error){if(deletionSetup!==setup||setup.epoch!==deletionEpoch)return 'cancelled';throw error;}
      if(deletionSetup!==setup||setup.epoch!==deletionEpoch)return 'cancelled';
      emit({deletion:{...snapshot.deletion!,stage:'code',provider:null}});return 'ok';
    },'deletion');},
    verifyDeletionCode(code:string){return authenticate(async()=>{
      const setup=deletionSetup;if(!setup||!lifecycle||snapshot.deletion?.stage!=='code')return fail('reauth-incomplete');
      if(!/^\d{6}$/.test(code))return fail('invalid-code');
      if(!await beforeDeletionProof(setup))return 'error';
      try{
        if(setup.recoveryReceipt){if(!setup.reauthIntentId)return fail('reauth-incomplete');await lifecycle.verifyRecoveryEmail(setup.accountId,setup.recoveryReceipt,setup.reauthIntentId,code);}
        else await lifecycle.verifyEmail(setup.accountId,code);
      }catch(error){
        if(deletionSetup!==setup||setup.epoch!==deletionEpoch)return 'cancelled';
        if(error instanceof CloudApiError&&error.status===400)return fail('invalid-code');throw error;
      }
      return reauthenticationFinished(setup);
    },'deletion');},
    reauthenticateDeletion(provider:SocialProvider){return authenticate(async()=>{
      const setup=deletionSetup;if(!setup||!lifecycle)return fail('reauth-incomplete');
      if(!snapshot.config?.providers[provider]||!setup.recoveryReceipt&&!snapshot.linkedProviders?.includes(provider))return fail('provider-unavailable');
      if(!await beforeDeletionProof(setup))return 'error';
      emit({deletion:{...snapshot.deletion!,provider}});
      try{
        const started=(intentId:string)=>{
          setup.reauthIntentId=intentId;
          if(deletionSetup!==setup||setup.epoch!==deletionEpoch){void cancelDeletionProof(setup,intentId).catch(()=>{});return false;}return true;
        };
        if(setup.recoveryReceipt)await lifecycle.recoverSocial(setup.accountId,setup.recoveryReceipt,provider,started);
        else await lifecycle.reauthenticate(setup.accountId,provider,started);
        return reauthenticationFinished(setup);
      }catch(error){if(deletionSetup!==setup||setup.epoch!==deletionEpoch)return 'cancelled';throw error;
      }finally{if(deletionSetup===setup&&snapshot.deletion)emit({deletion:{...snapshot.deletion,provider:null}});}
    },'deletion');},
    cancelDeletion,
    deleteCloudAccount({confirmed=false}:{confirmed?:boolean}={}){return authenticate(async()=>{
      const setup=deletionSetup;
      if(!confirmed)return fail('confirmation-required');
      if(!setup||!lifecycle||snapshot.deletion?.stage!=='ready')return fail('reauth-incomplete');
      const current=await deletionIdentity(setup);
      if(!current)return setup.epoch===deletionEpoch?'error':'cancelled';
      if(current.session.id===setup.sessionId)return fail('reauth-incomplete');
      // From this point closing the screen cannot pretend to cancel deletion.
      deletionCommitted=true;emit({deletion:{stage:'pending',email:null,provider:null,status:null,canCancel:false}});
      try{
        // Started proof stays bound while the original server user exists,
        // even beyond its unused-reference expiry. Never discard it by age.
        if(!deletionIntent){
          const prepared=await lifecycle.prepare(setup.accountId);
          if(!await sameDeletionOwner(setup))return 'error';
          deletionIntent=await runtime.deletion.save({...prepared,accountId:setup.accountId,generation:setup.generation},null);
        }
        if(!await sameDeletionOwner(setup))return 'error';
        const receipt=deletionIntent.receipt;
        await runtime.deletion.markDispatched(receipt);
        deletionIntent=await runtime.deletion.read();
        if(!deletionIntent||deletionIntent.receipt!==receipt||deletionIntent.accountId!==setup.accountId)return fail('deletion-pending');
        if(!await sameDeletionOwner(setup))return 'error';
        const result=await lifecycle.remove(setup.accountId,receipt);
        await runtime.deletion.acknowledge(receipt,result.appleRevocation);
        deletionIntent=await runtime.deletion.read();return finishDeletion();
      }finally{
        deletionCommitted=false;deletionSetup=null;
        deletionIntent=await runtime.deletion.read();
        if(deletionIntent)emit({deletion:pendingDeletionView()});
        else if(snapshot.deletion)emit({deletion:null});
      }
    },'deletion');},
    checkDeletion(){return perform(checkDeletion,'deletion');},
    dismissDeletionNotice(){return perform(async()=>{await runtime.deletion.dismissNotice();emit({deletionNotice:null});return 'ok';},'deletion');},
    async eventHistory(eventId:string,beforeRevision?:number,signal?:AbortSignal) {
      throwIfAborted(signal);
      if(disposed||snapshot.busy||identityPending||deletionIntent||deletionSetup||deletionCommitted)throw new CloudApiError('conflict');
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
      if(!snapshot.account!.cloud.canSync)throw new CloudApiError('expired',402);
      const result=await api.history(head.cloudRecord.id,beforeRevision,signal);currentSession();
      const {head:latest}=await runtime.history.eventPage(eventId,{limit:1});currentSession();
      if(latest.owner?.generation!==head.owner.generation||latest.owner?.accountId!==accountId
        ||latest.cloudRecord?.id!==head.cloudRecord.id||latest.cloudRecord?.petId!==head.cloudRecord.petId)throw new CloudApiError('conflict');
      if(!snapshot.account!.cloud.canSync)throw new CloudApiError('expired',402);
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
      const result=await outcome(()=>identity.verifyEmail(email,code));if(result.error)return fail(identityProblem(result.error,true));
      if(!await loadAccount())return 'error';emit({codeSentTo:null});return await refreshLinkedProviders()?'ok':'error';
    });},
    signInSocial(provider:'apple'|'google') {return authenticate(async()=>{
      if(!await canSignIn(provider))return 'error';
      const result=await outcome(()=>identity.signInSocial(provider));if(result.error){const problem=identityProblem(result.error);return fail(problem==='sign-in-failed'?'social-incomplete':problem);}
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
      if(!account.cloud.canSync){const trial=await api.startTrial();emit({account:{...account,cloud:trial.cloud}});if(!trial.cloud.canSync)return fail('trial-unavailable');}
      if(disposed)return 'error';
      const operationId=await runtime.database.read(async sql=>(await sql.getFirstAsync<{id:string}>('SELECT lower(hex(randomblob(16))) id'))!.id);
      await runtime.sync.prepareAssociation({accountId:account.user.id,localPetId:runtime.petId,deviceId:runtime.deviceId,mode:associationMode,enrollment:{operationId,deviceId:runtime.deviceId,localPetId:runtime.petId,name:associationMode==='restore'?existing!.name:snapshot.local!.name,...(confirmedPetId?{confirmedPetId}:{})}});
      associationConfirmationNeeded=false;suspended=false;return 'ok';
    },'enable');},
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
      await pauseTransport();signOutUnfinished=true;
      const result=await outcome(()=>identity.signOut());
      // Expo may clear secure credentials before a failed network response.
      // Check the official SDK rather than preserving stale signed-in UI.
      try{if(await identity.hasCredentials())return fail('sign-out-failed');}catch{return fail('sign-out-failed');}
      emit({account:null,linkedProviders:null,run:null,codeSentTo:null});
      if(status.generation&&status.accountId)await runtime.sync.detach({generation:status.generation,accountId:status.accountId});
      associationConfirmationNeeded=false;signOutUnfinished=false;emit({problem:result.error?'remote-sign-out-unconfirmed':null});return 'ok';
    });},
    // The identity action verifies its own browser return; a queued lifecycle
    // refresh would otherwise immediately erase its completion/error state.
    setActive(active:boolean) {if(snapshot.active===active)return;emit({active});if(!active){cancelTimer();aborter?.abort();}else if(snapshot.online&&!identityPending)void refresh();},
    setOnline(online:boolean) {if(snapshot.online===online)return;emit({online});if(!online){cancelTimer();aborter?.abort();exportAborter?.abort();}else if(snapshot.active&&!identityPending)void refresh();},
    stop(){if(disposed)return;void cancelDeletion();disposed=true;cancelTimer();aborter?.abort();exportAborter?.abort();unsubscribe();listeners.clear();},
  };
}
export type AccountController=ReturnType<typeof createAccountController>;
