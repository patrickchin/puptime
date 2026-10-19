# Apple and Google sign-in setup

This prepares the existing Better Auth 1.7.10 browser OAuth flow, including its Expo browser return. It does not configure or enable either provider. Both require their complete server credential pair; no new mobile SDK is needed for this flow. See the [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo).

## Coordinate the public auth origin first

The Pages `/api/*` function forwards to `puptime-api-staging`; credentials and `AUTH_BASE_URL` belong to that Worker, not the static website. The checked-in staging `AUTH_BASE_URL` is `https://puptime.pages.dev`. Deploy that configuration and coordinate the native `EXPO_PUBLIC_CLOUD_API_URL`, website client, and provider consoles before installing the provider credentials.

Use these exact values:

| Setting | Value |
| --- | --- |
| Auth base and web origin | `https://puptime.pages.dev` |
| Google authorized redirect URI | `https://puptime.pages.dev/api/auth/callback/google` |
| Apple return URL | `https://puptime.pages.dev/api/auth/callback/apple` |
| Apple website domain | `puptime.pages.dev` |
| Expo completion URL | `puptime://account` |

Merely accessing auth through Pages does not change URLs generated from `AUTH_BASE_URL`; the Worker configuration must also be deployed. Neither a purchased domain nor `harpapro.com` is needed for this staging work. A genuine provider round trip remains a separate qualification gate.

## Configure credentials in the provider consoles

- **Google:** use a Web application OAuth client and the exact canonical callback. Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Worker secrets. Keep the SDK's default `openid email profile` scopes; no Gmail, Drive, or offline-access permission is requested. Configure consent branding/audience and any required test users. [Google provider instructions](https://better-auth.com/docs/authentication/google).
- **Apple:** associate a Services ID with the existing primary App ID for `com.patrickchin.puptime`, with Sign in with Apple enabled. Register the website and return URL above. Apple currently requires no domain verification file. Confirm console access and the App ID before making changes; capability changes can affect signing profiles. [Apple web setup](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).
- Store the Services ID as `APPLE_CLIENT_ID` and a client-secret JWT as `APPLE_CLIENT_SECRET`. Creating that JWT requires the Apple team ID, key ID, and Sign in with Apple private key. Keep the private key out of the client and repository; record and rotate the JWT before its maximum six-month expiry. The server now uses the Services ID as its ID-token audience and trusts `https://appleid.apple.com` only when Apple is configured. A future native Apple ID-token flow would need a deliberately configured bundle audience and separate qualification. [Better Auth Apple instructions](https://better-auth.com/docs/authentication/apple).

Use the existing authorized accounts and least privilege. Human account access, MFA, provider consent, key creation, capability changes, secret installation, and deployment still need coordinated execution; none is performed by this change. Signing in to a Codex browser does not sign in the simulator's authentication browser.

## Preserve existing accounts

`disableImplicitLinking: true` remains enabled. A Google or Apple identity with an existing email must not silently attach itself to that account. Existing users sign in with their original method, then use **Connect Apple** or **Connect Google** in Backup and sync. The controller uses the SDK's authenticated `linkSocial`, checks the same session user and local ownership generation before and after the browser, and shows Connected only after the server confirms the provider. Connecting never enrolls a puppy or changes pending local work. Different-email linking remains disabled; an Apple Hide My Email address can represent a separate account. Do not use the retained live qualification owner to test linking or deletion. [Account linking](https://better-auth.com/docs/concepts/users-accounts).

The installed Expo SDK resolves its initial OAuth response even after browser cancellation and does not expose callback errors to Puptime. Both completion URLs return to the app. If the expected session or provider cannot be confirmed, show the contextual incomplete-flow message and a retry; do not claim a particular provider error or report Connected from the initial response alone.

Apple OAuth itself does not require an email-code delivery. Email recovery to Hide My Email addresses requires an approved sender and Apple relay registration. The current `onboarding@resend.dev` test sender cannot deliver to arbitrary users, so it cannot establish that recovery path. A verified sender domain remains separate deferred work. [Apple relay configuration](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/), [Resend test-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## Evidence and next qualification

`server/auth.test.ts` exercises real Better Auth routes and isolated D1: disabled/half-configured providers, OAuth URL generation for both origins, signed Apple token validation, Apple's form-post callback, and refusal to implicitly link either provider to a genuine local OTP account. Provider network replies and signing keys are synthetic; these tests do not prove real console credentials, consent, or delivery.

`server/social-linking.test.ts` uses the installed client SDK and isolated D1 to qualify authenticated linking, subsequent provider sign-in returning the original user, unchanged profile/identity ownership, different-email and existing-owner rejection, and missing, mismatched or expired authentication state. Only the external token-exchange replies are synthetic. Controller tests separately preserve complete SQL state and pending work through cancellation, concurrent local writes, lost replies, lifecycle changes and delayed responses.

After configuration, qualify each provider with a fresh dedicated fixture: success, cancel, invalid/expired state, app return, restart with the same identity, and the existing-email refusal/explicit-link path. Verify the resulting server session and database ownership. Keep private authentication phases unrecorded and preserve the retained live owner and outbox.
