import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { APIError, addOAuthServerContext, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { Resend } from 'resend';
import { z } from 'zod';
import { consumeReauthIntent, intentBinding, reauthAppleEmail, validateReauthIdentity, type ReauthIntent } from './account-reauth';
import { consumeRecoveryIntent, recoveryAppleEmail, recoveryBinding, recoveryDenied, validateRecoveryIdentity, type RecoveryIntent } from './account-recovery';

function emailSenderAvailable(env: Cloudflare.Env): boolean {
  const sender = z.email().safeParse(env.EMAIL_FROM);
  if (!env.RESEND_API_KEY || !sender.success) return false;
  const domain = sender.data.split('@')[1].toLowerCase();
  return domain !== 'harpapro.com' && !domain.endsWith('.harpapro.com');
}

export function configuredProviders(env: Cloudflare.Env) {
  return {
    apple: !!(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    email: env.ENVIRONMENT === 'local' || emailSenderAvailable(env),
  };
}

export function createAuth(env: Cloudflare.Env, options: { disableEmailSignUp?: boolean; startReauth?: ReauthIntent; callbackReauth?: ReauthIntent; startRecovery?: RecoveryIntent; recovery?: RecoveryIntent } = {}) {
  const baseURL = z.url().parse(env.AUTH_BASE_URL);
  const secret = z.string().min(32).parse(env.AUTH_SECRET);
  const base = new URL(baseURL);
  if ((env.ENVIRONMENT !== 'local' && base.protocol !== 'https:')
    || base.hostname === 'harpapro.com' || base.hostname.endsWith('.harpapro.com')) {
    throw new Error('Puptime authentication requires its own secure public URL.');
  }
  const providers = configuredProviders(env);
  const recovering = !!(options.startRecovery || options.recovery);
  const forbidRecoveryWrite = async () => recoveryDenied();
  return betterAuth({
    appName: 'Puptime', baseURL, secret, database: env.AUTH_DB,
    trustedOrigins: [base.origin, ...(env.WEB_ORIGINS ?? '').split(',').filter(Boolean), 'puptime://*', ...(providers.apple ? ['https://appleid.apple.com'] : [])],
    emailAndPassword: { enabled: false },
    account: { ...(options.callbackReauth || recovering ? { updateAccountOnSignIn: false } : {}), accountLinking: { enabled: !recovering, disableImplicitLinking: true } },
    databaseHooks: {
      session: {
        create: { before: async session => { if (await consumeReauthIntent(env.AUTH_DB, options.callbackReauth, session.userId) === false) return false; await consumeRecoveryIntent(env.AUTH_DB, options.recovery, session.userId); } },
        ...(recovering ? { update: { before: forbidRecoveryWrite }, delete: { before: forbidRecoveryWrite } } : {}),
      },
      ...(recovering ? {
        user: { create: { before: forbidRecoveryWrite }, update: { before: forbidRecoveryWrite }, delete: { before: forbidRecoveryWrite } },
        account: { create: { before: forbidRecoveryWrite }, update: { before: forbidRecoveryWrite }, delete: { before: forbidRecoveryWrite } },
      } : {}),
    },
    user: {
      validateUserInfo: async data => await validateReauthIdentity(env.AUTH_DB, options.callbackReauth, data) ?? await validateRecoveryIdentity(env.AUTH_DB, options.recovery, data),
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, freshAge: 60 * 10, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    logger: { disabled: true },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    hooks: { before: createAuthMiddleware(async (context) => {
      if (context.path === '/sign-in/social' && options.startReauth) {
        await addOAuthServerContext({ puptimeReauth: intentBinding(options.startReauth) });
      }
      if (context.path === '/sign-in/social' && options.startRecovery) await addOAuthServerContext({ puptimeRecovery: recoveryBinding(options.startRecovery) });
      if (!providers.email && (context.path.startsWith('/email-otp/') || context.path === '/sign-in/email-otp')) {
        throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email sign-in is not configured yet.' });
      }
    }) },
    socialProviders: {
      ...(providers.google ? { google: { ...(options.callbackReauth || recovering ? { disableSignUp: true } : {}), clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } } : {}),
      ...(providers.apple ? { apple: { ...(options.callbackReauth || recovering ? { disableSignUp: true } : {}), clientId: env.APPLE_CLIENT_ID!, clientSecret: env.APPLE_CLIENT_SECRET!, mapProfileToUser: async profile => ({ ...await reauthAppleEmail(env.AUTH_DB, options.callbackReauth, profile), ...await recoveryAppleEmail(env.AUTH_DB, options.recovery, profile) }) } } : {}),
    },
    disabledPaths: ['/email-otp/request-password-reset', '/forget-password/email-otp', '/email-otp/reset-password', '/delete-user', '/delete-user/callback'],
    plugins: [expo(), emailOTP({
      expiresIn: 300, allowedAttempts: 3, disableSignUp: recovering || (options.disableEmailSignUp ?? false), storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp }) {
        if (env.ENVIRONMENT === 'local') {
          await env.AUTH_DB.prepare('INSERT INTO local_email_previews(id, email, code, expires_at) VALUES (?, ?, ?, ?)')
            .bind(crypto.randomUUID(), email, otp, Date.now() + 300000).run();
          return;
        }
        if (!emailSenderAvailable(env)) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email sign-in is not configured yet.' });
        const result = await new Resend(env.RESEND_API_KEY).emails.send({
          from: env.EMAIL_FROM!, to: email, subject: 'Your Puptime sign-in code',
          text: `${otp}\n\nThis Puptime sign-in code expires in five minutes. If you did not request it, you can ignore this email.`,
        });
        if (result.error) throw new APIError('SERVICE_UNAVAILABLE', { message: 'The sign-in email could not be delivered. Please try again.' });
      },
    })],
  });
}
