import { throwIfAborted,CloudApiError,type CloudApi,type CloudErrorCategory } from './api.ts';
import type { createLocalSync } from '../local/sync-engine.ts';
import type { pushResponseSchema } from './protocol.ts';
import type { z } from 'zod';

type Sync=ReturnType<typeof createLocalSync>;
type PushResult=z.infer<typeof pushResponseSchema>;
export type RunResult={state:'idle'|'synced'|'pending'|'blocked'|'auth-required'|'expired'|'retry'|'error';pending:number;blocked:number;retryAfterMs:number|null;problem:CloudErrorCategory|'local-storage'|'account-mismatch'|'confirmation-required'|null};
class BudgetReached extends Error {}
class OwnerChanged extends Error {}
class EnrollmentRejected extends Error {}
export function createSyncRunner({sync,api,petId,deviceId,sessionAccountId,changed,random=Math.random}:{sync:Sync;api:Pick<CloudApi,'account'|'enroll'|'push'|'pull'>;petId:string;deviceId:string;sessionAccountId:()=>string|null;changed:()=>void;random?:()=>number}) {
  let failures=0;
  return {
    async run(signal:AbortSignal):Promise<RunResult> {
      let requests=0;
      const initial=await sync.status(petId),accountId=sessionAccountId();
      const result=async(state:RunResult['state'],retryAfterMs:number|null=null,problem:RunResult['problem']=null):Promise<RunResult>=>{const status=await sync.status(petId);return {state,pending:status.pending,blocked:status.blocked,retryAfterMs,problem};};
      throwIfAborted(signal);
      if (initial.state==='local') return result('idle');
      if (!accountId) return result('auth-required',null,'auth-required');
      if (initial.accountId!==accountId||!initial.generation) return result('auth-required',null,'account-mismatch');
      const fence={accountId,generation:initial.generation};
      async function guard() {
        throwIfAborted(signal);const current=await sync.status(petId);
        if (sessionAccountId()!==accountId||current.generation!==fence.generation||current.accountId!==accountId) throw new OwnerChanged();
      }
      async function invoke<T>(action:()=>Promise<T>):Promise<T> {
        await guard();if (requests>=20) throw new BudgetReached();requests++;
        const value=await action();await guard();return value;
      }
      async function resumeBaseline() {
        let state=await sync.resyncState();if (!state) throw new Error('Missing resync state.');
        while (!state.baselineComplete) {
          const page=await invoke(()=>api.pull(state!.stagingCursor,signal));
          if (page.resyncRequired) throw new CloudApiError('invalid-response');
          await sync.stageBaseline({...fence,page});state=(await sync.resyncState())!;
        }
        await guard();await sync.finishResync(fence);changed();
      }
      async function resumeEnrollment() {
        let state=await sync.enrollmentState();if (!state) return;
        if (state.request.localPetId!==petId||state.request.deviceId!==deviceId) throw new CloudApiError('invalid-request');
        let enrolled:{petId:string};
        try{enrolled=await invoke(()=>api.enroll(state!.request,signal));}
        catch(error){
          if(error instanceof CloudApiError&&error.category==='conflict'){
            await guard();await sync.cancelEnrollment({...fence,operationId:state.request.operationId});throw new EnrollmentRejected();
          }
          throw error;
        }
        while (!state.baselineComplete) {
          const page=await invoke(()=>api.pull(state!.stagingCursor,signal));
          if (page.resyncRequired) throw new CloudApiError('invalid-response');
          await sync.stageBaseline({...fence,page});state=(await sync.enrollmentState())!;
        }
        await guard();await sync.completeAssociation({...fence,cloudPetId:enrolled.petId});changed();
      }
      async function pull(results?:PushResult) {
        for (;;) {
          const after=(await sync.status(petId)).cursor,page=await invoke(()=>api.pull(after,signal));
          if (page.resyncRequired) {
            await sync.resetBaseline(fence);await resumeBaseline();
            if (results) {await guard();await sync.applySync({...fence,...results,page:{changes:[],cursor:(await sync.status(petId)).cursor,hasMore:false}});}
            return;
          }
          // A conflict's current record may be on a later page. Persist every
          // page first, then recover rejections only after reaching the head.
          await guard();await sync.applySync({...fence,...(!page.hasMore&&results?results:{accepted:[],rejected:[]}),page});
          if (page.changes.length) changed();
          if (!page.hasMore) return;
        }
      }
      try {
        const account=await invoke(()=>api.account(signal));
        if (account.user.id!==accountId) throw new OwnerChanged();
        if (!account.cloud.canSync) return result('expired',null,'expired');
        await resumeEnrollment();if (await sync.resyncState()) await resumeBaseline();
        await pull();
        for (;;) {
          await guard();
          const batch=await sync.nextBatch(fence);
          if (!batch.length) {
            failures=0;const status=await sync.status(petId);
            return result(status.blocked?'blocked':status.pending?'pending':'synced',status.pending>status.blocked?0:null);
          }
          const pushed=await invoke(()=>api.push(batch,signal));
          await pull(pushed);
          if (pushed.rejected.some(item=>item.error==='retry_later')) throw new CloudApiError('server-error',503);
        }
      } catch(error) {
        throwIfAborted(signal);
        if (error instanceof OwnerChanged) return result('auth-required',null,'account-mismatch');
        if (error instanceof EnrollmentRejected) return result('idle',null,'confirmation-required');
        if (error instanceof BudgetReached) return result('pending',0);
        if (!(error instanceof CloudApiError)) return result('error',null,'local-storage');
        if (error.category==='auth-required') return result('auth-required',null,error.category);
        if (error.category==='expired') return result('expired',null,error.category);
        if (['network','rate-limited','server-error'].includes(error.category)) {
          const delay=Math.min(60000,1000*2**Math.min(failures++,16));
          return result('retry',Math.min(60000,Math.max(error.retryAfterMs??0,1000,Math.round(delay*(0.8+0.2*random())))),error.category);
        }
        return result('error',null,error.category);
      }
    },
  };
}
