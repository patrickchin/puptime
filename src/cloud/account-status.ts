import type { AccountSnapshot } from './account-controller.ts';
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
