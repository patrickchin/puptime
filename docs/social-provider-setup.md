# Apple and Google sign-in setup

On iOS, Apple sign-in uses Expo's native Apple authentication sheet and system
button, then passes the identity token through Better Auth 1.7.10's supported
ID-token API. Google and non-iOS Apple keep the existing browser OAuth flow and
Expo return. Both providers still require their complete server credential
pair. See the [Expo Apple SDK](https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/)
and [Better Auth ID-token integration](https://better-auth.com/docs/integrations/expo#idtoken-sign-in).

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
- Store the Services ID as `APPLE_CLIENT_ID` and a client-secret JWT as `APPLE_CLIENT_SECRET`. Creating that JWT requires the Apple team ID, key ID, and Sign in with Apple private key. Keep the private key out of the client and repository; record and rotate the JWT before its maximum six-month expiry. The server uses Better Auth's built-in `audience` option for exactly the configured Services ID and `com.patrickchin.puptime`, retaining its signature, issuer, expiry and nonce verification. It trusts `https://appleid.apple.com` only when Apple is configured. [Better Auth Apple instructions](https://better-auth.com/docs/authentication/apple).

Use the existing authorized accounts and least privilege. Human account access, MFA, provider consent, key creation, capability changes, secret installation, and deployment need coordinated execution. Signing in to a Codex browser does not sign in the simulator's authentication browser.

## Native iOS Apple setup

Expo installed `expo-apple-authentication` 57.0.2 and `expo-crypto` 57.0.4 without
changing Expo or React Native. The latter is a compatible patch within SDK57's
bundled `~57.0.3` range. `app.json` enables `ios.usesAppleSignIn` and the official
Apple plugin; config inspection and an iOS prebuild generate
`com.apple.developer.applesignin = ["Default"]` and mixed-localization support
for the system button.

Each request uses 32 secure random bytes from Expo Crypto, sends its SHA256
nonce to Apple's system sheet, and passes the raw nonce and returned identity
token to the official SDK. Optional name fields use only Better Auth's
`idToken.user.name` shape; the app supplies no invented email or identity.
Explicit **Connect Apple** uses native credentials with authenticated
`linkSocial`. Cancellation stays distinct from success and makes no SDK
authentication request. Missing credentials or nonce generation failures fail
without starting a browser or changing local data. Sync still requires explicit
enrollment after sign-in.

This requires a **fresh native binary** with the two new modules. An existing
Debug shell or Metro refresh cannot add them. Before a signed build, confirm
Sign in with Apple is enabled for the exact Puptime bundle ID and that the
selected signing profile includes the capability. Retain the associated web
Services ID and existing server secrets for browser fallback. Prebuild checks
are not signing, device or provider-login evidence: after review/build, qualify
the native sheet, cancellation, genuine session, cold restart and explicit
linking on a dedicated iOS fixture. Native runtime verification is pending.

## Earlier browser staging checkpoint — October 20, 2026

Both complete credential pairs are installed on the staging Worker. The Google Web client belongs to the dedicated `puptime-512111` project and remains in external Testing. Apple's Services ID is `com.patrickchin.puptime.web`, associated with the existing Puptime primary App ID. Both use the exact callbacks above. The main App Store provisioning profile was regenerated with Sign in with Apple; refreshing a cached EAS profile and verifying a distributed build remain separate work.

The replacement Apple sign-in key is held in macOS Keychain service `com.puptime.apple-staging-sign-in`, account `puptime`. Its JSON stores the private PEM as `privateKeyPemBase64`; the original download was removed only after an exact Keychain round trip. The interactive `security` parser transforms backslash escapes, so do not replace this field with an escaped raw PEM. The private key stays in Keychain. Only the Services ID and generated ES256 client-secret JWT are installed on the Worker. The existing APNs key is unchanged.

The installed Apple client-secret expires **April 17, 2027 at 15:38:41 UTC**. Before expiry, generate a replacement JWT from that Keychain key, verify its signature and issuer/audience/subject/expiry, then replace `APPLE_CLIENT_SECRET` through private standard input. Never print the private key or JWT, pass either in command arguments, or commit them. Repeat the genuine Apple callback/session check after rotation.

Actual deployed HTTPS checks confirm both providers are advertised, authorization starts use PKCE S256 and the exact callbacks, Apple uses `form_post`, invalid state cannot create a session, and anonymous protected account requests return401 with `no-store`. A signed standalone iOS build reaches Google's actual sign-in page and handles cancellation without changing any local SQL rows. Updating the retained genuine email-account installation preserves every application table and shows both explicit Connect controls. These checks do **not** prove a completed real Apple or Google token exchange. Private provider login, return to the app, confirmed session, restart and account-link qualification remain required before public release.

## Preserve existing accounts

`disableImplicitLinking: true` remains enabled. A Google or Apple identity with an existing email must not silently attach itself to that account. Existing users sign in with their original method, then use **Connect Apple** or **Connect Google** in Backup and sync. The controller uses the SDK's authenticated `linkSocial`, checks the same session user and local ownership generation before and after the provider request, and shows Connected only after the server confirms the provider. Connecting never enrolls a puppy or changes pending local work. Different-email linking remains disabled; an Apple Hide My Email address can represent a separate account. Do not use the retained live qualification owner to test linking or deletion. [Account linking](https://better-auth.com/docs/concepts/users-accounts).

For remaining browser flows, the installed Expo SDK resolves its initial OAuth response even after browser cancellation and does not expose callback errors to Puptime. Both completion URLs return to the app. If the expected session or provider cannot be confirmed, show the contextual incomplete-flow message and a retry; do not claim a particular provider error or report Connected from the initial response alone. Native iOS Apple cancellation instead returns the explicit cancelled result.

Apple OAuth itself does not require an email-code delivery. Email recovery to Hide My Email addresses requires an approved sender and Apple relay registration. The current `onboarding@resend.dev` test sender cannot deliver to arbitrary users, so it cannot establish that recovery path. A verified sender domain remains separate deferred work. [Apple relay configuration](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/), [Resend test-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## Evidence and next qualification

`server/auth.test.ts` exercises real Better Auth routes and isolated D1: disabled/half-configured providers, unchanged browser scopes/callbacks, accepted Service ID and native bundle audiences, rejected nonce/issuer/audience/expiry/token/signature, authenticated native ID-token linking and refusal to implicitly link either provider to a genuine local OTP account. Provider network replies and signing keys are synthetic; these tests do not prove real console credentials, consent, or delivery. Client tests exercise fresh nonce binding, quiet cancellation, unavailable/missing-token failures, the official iOS button at the hook boundary, and unchanged local SQL without association/upload; they do not execute the native SDK or system sheet.

`server/social-linking.test.ts` uses the installed client SDK and isolated D1 to qualify authenticated linking, subsequent provider sign-in returning the original user, unchanged profile/identity ownership, different-email and existing-owner rejection, and missing, mismatched or expired authentication state. Only the external token-exchange replies are synthetic. Controller tests separately preserve complete SQL state and pending work through cancellation, concurrent local writes, lost replies, lifecycle changes and delayed responses.

After configuration, qualify each provider with a fresh dedicated fixture: success, cancel, invalid/expired state, app return, restart with the same identity, and the existing-email refusal/explicit-link path. Verify the resulting server session and database ownership. Keep private authentication phases unrecorded and preserve the retained live owner and outbox.
