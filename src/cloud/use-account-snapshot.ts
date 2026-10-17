import { useSyncExternalStore } from 'react';
import type { AccountController } from './account-controller';
const noSubscription=()=>()=>{};
const emptySnapshot=()=>null;
export function useAccountSnapshot(controller:AccountController|null) {
  return useSyncExternalStore(controller?.subscribe??noSubscription,controller?.read??emptySnapshot,emptySnapshot);
}
