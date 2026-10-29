# Puppy sharing

Owners open **Puppy → Share puppy** or choose sharing at the end of conversational onboarding. Sharing requires the owner's signed-in account and explicit cloud enrollment. Existing local-only use remains available.

## Access

| Mode | Acceptance | Rights | Duration |
| --- | --- | --- | --- |
| Household | Sign in to claim a single-person invitation within seven days | Full puppy log history; create, edit and delete logs and routines | Until the owner removes access |
| Temporary | Open a browser link; optional display name; no account created | Last seven days and routines; view-only or add logs and correct entries created in the same browser session | Owner chooses 24 hours, 3 days, 7 days, or a date/time within 30 days |

Owner invitations are distinct grants. A household invitation can be retried by the same recipient, but cannot be claimed by a second person. Removing one grant does not affect other invitations. The owner controls puppy settings and access; carers cannot manage the owner's account, download account exports, use its integration keys or enroll devices into it.

Household members can use **Puppy → Shared puppies**, **Already invited? Open shared puppies** during onboarding, or **Open in Puptime** after accepting on the website. Sign in using the same account that accepted the invitation. Shared journals use the owner's existing cloud records and mutation engine; they do not copy ownership or merge the owner's account preferences into the recipient's local puppy. They require connectivity and refresh while foregrounded every 15 seconds, on resume, after writes and on explicit refresh. A member's own local puppy remains separate.

Temporary carers use `/care` in their browser. Its session cookie remembers access until the grant ends. A new browser gets a distinct actor and cannot correct another browser's entries. Logging attribution is stored as a `Logged by …` note suffix for compatibility with existing native clients; immutable revision actors enforce authorship. Identity remains linked to the signed-in member or guest session regardless of editable display text.

## Deployment and security

Apply additive D1 migration `server/migrations/0003-puppy-sharing.sql` before deploying the Worker and website. Preserve existing auth and account databases. No device or per-account database migration is needed. Deploy the `/care` static page with the existing Pages API proxy, then release the native client.

Application IDs use `shr_` for grants, `csr_` for guest sessions and retry identities, and `inv_` for random invitation/session secrets. Only SHA-256 hashes of secrets are stored. Invitation secrets are URL fragments and are exchanged through POST bodies, never API URL parameters. Successful acceptance clears the saved invitation from session storage. Guest cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Pending household credentials cannot be used as permanent account sessions.

Sharing checks owner state, puppy scope, account identity, membership, expiry and revocation. The account object rechecks the grant before accessing records, including requests queued before revocation. All writes use the existing revision preconditions and actor-scoped idempotency receipts. Owner deletion fences requests immediately; foreign keys cascade grants and guest sessions when identities are removed.

The care page loads no analytics, uses `no-referrer` and `no-store`, and is excluded from indexing and the sitemap. QR codes are generated locally from the same invitation URL. Raw secrets are shown only for the newly created invitation; create a new invitation if its link is lost.

## Verification

- `npm test`, `npm run test:server`, `npm run test:web`
- `npm run typecheck`, `npm run typecheck:ios`, `npm run typecheck:android`, `npm run typecheck:server`
- `npm run build:web`
- `.maestro/conversational/17-sharing.yaml` covers the optional setup branch; existing completion helpers skip the new sharing step.

The server tests use actual Better Auth, local D1 and SQLite Durable Objects. They cover guest access without account creation, household claim/retry, isolation, revision-safe retries, authorship, view-only access, expiry, revocation and owner deletion fencing. Populated-history reference tests keep unchanged rows stable for memoized care rows.
