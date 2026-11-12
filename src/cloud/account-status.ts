import type { MessageKey } from '../localization';
import type { AccountProblem, AccountSnapshot } from './account-controller.ts';
export function accountStatus(state:AccountSnapshot|null) {
  if(!state||(!state.account&&!state.sync?.accountId))return 'local';
  if(!state.account){
    if(!state.online||state.problem==='network')return 'offline';
    if(state.problem&&!['auth-required','account-deleted'].includes(state.problem))return 'paused';
    return state.busy?'checking':'auth';
  }
  if(state.sync?.accountId&&state.sync.accountId!==state.account.user.id)return 'mismatch';
  if(!state.sync?.accountId||state.sync.state==='local')return 'notEnabled';
  if(!state.online)return 'offline';
  if(!state.account.cloud.canSync)return 'paused';
  if(state.sync.state==='preparing')return 'preparing';
  if(state.sync.blocked)return 'attention';
  if(state.problem)return 'paused';
  if(state.running||state.busy||state.sync.state==='resyncing')return 'syncing';
  if(state.sync.pending)return 'pending';
  return state.run?.state==='synced'?'synced':'checking';
}

export function accountProblemKey(problem:AccountProblem|null):MessageKey|null {
  if(!problem||['confirmation-required','pending-confirmation-required','auth-required'].includes(problem))return null;
  if(problem==='invalid-request'||problem==='conflict')return 'account.error.sync';
  if(problem==='invalid-email')return 'account.error.email';
  if(problem==='invalid-code')return 'account.error.code';
  if(problem==='code-expired')return 'account.error.expiredCode';
  if(problem==='too-many-attempts'||problem==='rate-limited')return 'account.error.attempts';
  if(problem==='network')return 'account.error.network';
  if(problem==='account-mismatch')return 'account.error.mismatch';
  if(problem==='sign-out-failed')return 'account.error.signOut';
  if(problem==='remote-sign-out-unconfirmed')return 'account.error.remoteSignOut';
  if(problem==='deletion-unconfirmed')return 'account.delete.unconfirmed';
  if(problem==='deletion-failed')return 'account.delete.failed';
  if(problem==='export-failed')return 'account.error.export';
  if(problem==='local-storage')return 'account.error.storage';
  if(problem==='social-incomplete')return 'account.error.socialIncomplete';
  if(problem==='link-incomplete')return 'account.error.linkIncomplete';
  if(problem==='provider-unavailable'||problem==='server-error'||problem==='invalid-response'||problem==='account-deleted'||problem==='forbidden')return 'account.error.service';
  return 'account.error.signIn';
}
