import { getAccountStore } from './account-store';

export async function retireCloudAccount(env: Cloudflare.Env, user: { id: string; email: string }): Promise<void> {
  // Mark first so another active request cannot begin a new cloud operation.
  // A failed cleanup remains retryable through the confirmed deletion route.
  await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id, state) VALUES (?, 'deleting') ON CONFLICT(account_id) DO UPDATE SET state = 'deleting'").bind(user.id).run();
  await getAccountStore(env, user.id).retire();
  const email = user.email.toLowerCase();
  const identifiers = ['sign-in', 'email-verification', 'forget-password', 'change-email'].map((type) => `${type}-otp-${email}`);
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM local_email_previews WHERE email = ?').bind(email),
    env.AUTH_DB.prepare('DELETE FROM verification WHERE identifier IN (?, ?, ?, ?)').bind(...identifiers),
  ]);
}
