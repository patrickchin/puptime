import type { AccountStore } from './account-store';
declare global {
  namespace Cloudflare {
    interface Env {
      ACCOUNTS: DurableObjectNamespace<AccountStore>;
      AUTH_DB: D1Database;
      ENVIRONMENT?: 'local' | 'staging' | 'production';
      AUTH_BASE_URL?: string;
      WEB_ORIGINS?: string;
      AUTH_SECRET?: string;
      CLOUD_TRIAL_DAYS?: string;
      RESEND_API_KEY?: string;
      EMAIL_FROM?: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      APPLE_CLIENT_ID?: string;
      APPLE_CLIENT_SECRET?: string;
    }
  }
}

declare module 'vitest' {
  interface ProvidedContext { migrations: import('@cloudflare/vitest-plugin').D1Migration[]; }
}
