import { getAccountStore } from './account-store';

export type AppleRevocation = 'not-linked' | 'revoked' | 'manual';

async function revokeApple(env: Cloudflare.Env, userId: string): Promise<AppleRevocation> {
  // Better Auth's current encryptOAuthTokens setting is false. These credentials
  // stay server-side and must never enter logs, API responses, or browser state.
  const { results } = await env.AUTH_DB.prepare('SELECT refreshToken,accessToken FROM account WHERE userId=? AND providerId=?').bind(userId, 'apple').all<{ refreshToken: string | null; accessToken: string | null }>();
  if (!results.length) return 'not-linked';
  let outcome: AppleRevocation = 'revoked';
  const signal = AbortSignal.timeout(5000);
  for (const account of results) {
    const refresh = account.refreshToken?.trim(), access = account.accessToken?.trim();
    const token = refresh || access;
    if (!token || !env.APPLE_CLIENT_ID || !env.APPLE_CLIENT_SECRET) { outcome = 'manual'; continue; }
    try {
      const response = await fetch('https://appleid.apple.com/auth/revoke', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.APPLE_CLIENT_ID, client_secret: env.APPLE_CLIENT_SECRET, token, token_type_hint: refresh ? 'refresh_token' : 'access_token' }),
      });
      if (response.status !== 200) outcome = 'manual';
      await response.body?.cancel();
    } catch { outcome = 'manual'; }
  }
  // TN3194: unavailable tokens or provider failure must not prevent app-data
  // deletion. The confirmed response tells the person to revoke Apple manually.
  return outcome;
}

export async function retireCloudAccount(env: Cloudflare.Env, user: { id: string; email: string }): Promise<AppleRevocation> {
  // Mark first so another active request cannot begin a new cloud operation.
  // A failed cleanup remains retryable through the confirmed deletion route.
  await env.AUTH_DB.prepare("INSERT INTO cloud_accounts(account_id, state) VALUES (?, 'deleting') ON CONFLICT(account_id) DO UPDATE SET state = 'deleting'").bind(user.id).run();
  // D1 credential triggers fence both new links and already-running callbacks
  // before this snapshot, including writes that try to change the owner.
  const appleRevocation = await revokeApple(env, user.id);
  await getAccountStore(env, user.id).retire();
  const email = user.email.toLowerCase();
  const identifiers = ['sign-in', 'email-verification', 'forget-password', 'change-email'].map((type) => `${type}-otp-${email}`);
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM local_email_previews WHERE email = ?').bind(email),
    env.AUTH_DB.prepare('DELETE FROM verification WHERE identifier IN (?, ?, ?, ?)').bind(...identifiers),
  ]);
  return appleRevocation;
}
