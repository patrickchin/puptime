import type { AccountStore } from './account-store';
declare global {
  namespace Cloudflare {
    interface Env { ACCOUNTS: DurableObjectNamespace<AccountStore>; }
  }
}
