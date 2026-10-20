# Puptime optional cloud implementation design

> Scope update, October 20: [Cloud accounts and puppy logging: development scope](2026-10-20-cloud-development-reset.md) supersedes conflicting requirements below. Payments/publication and old development-data migration are deferred/removed; shared implementation covers iOS and Android, with iOS runtime verification first. This historical design is not the current milestone checklist.

Date: October 17, 2026. Execution basis: the confirmed discovery decisions and the user's delegation of remaining technical decisions. Technical defaults below are implementation choices, not additional user statements. The discovery roadmap remains the requirements/evidence inventory.

## Purpose and boundaries

Keep quick puppy logging useful immediately, offline and without an account. Offer optional paid backup and synchronization without putting signup or payment in front of the first local log. Preserve existing installations and acknowledged widget writes. Support one puppy in this release with pet-scoped identifiers/constraints that also work for two pets in tests. Household invitations and multi-pet UI follow separately.

The initial web work is desktop-oriented marketing, account management, export/deletion, and telemetry, with responsive support. Put browser puppy logging in a later implementation phase after the native cloud release; it is not required to ship that release. Preserve Learn content. No public URL or sender uses harpapro.com. Domain purchase remains deferred.

Monthly and yearly plans grant identical cloud features. Keep catalog IDs and displayed prices configurable and derive purchase copy from the actual provider catalog. US$1–2/month is provisional planning guidance, not a published price. Do not create a live paid catalog or claim a finalized price yet. Implement a configurable 14-day cloud trial activated explicitly, without collecting payment details or automatic conversion; the user delegated this remaining product/technical default. Free local logging continues after expiry. Retain cloud history while the account exists and allow authenticated manual full export without a paid entitlement. Never implement an expiry-based data purge.

Use free service tiers only. Do not upgrade plans, activate metered paid resources, or incur real payment-test charges. If a required service cannot run within an available free tier, finish the local implementation and report that deployment gate with evidence. Do not weaken data integrity or mislabel sandbox checks to satisfy that limit.

## Established tools and deployment choice

Retain the existing Expo SDK 57 / React Native 0.86 / React 19 app and TypeScript. Use Expo's compatible stable packages, pin resolved dependencies in the lockfile, and verify native build compatibility. Avoid prerelease packages and unnecessary runtime upgrades.

Use Cloudflare Workers with Hono for routing, Zod for external input validation, Better Auth for Apple/Google/email OTP identity, its Expo integration plus SecureStore for native sessions, and its supported D1 database integration. Use Cloudflare D1 for identity and billing/account metadata, and a SQLite-backed Durable Object per account for serialized cloud mutations and WebSocket change notifications. Use platform SQL transactions and indexed tables, not custom authentication, a generic sync framework, or a bespoke database layer. If schema work benefits from Drizzle, use its supported D1 tooling; do not add it solely to wrap a few Durable Object SQL statements.

This updates the earlier proposed Neon stack to respect free-only provisioning: the authenticated direct Neon organization is on Launch, and its free organization is Vercel-managed. Do not create a potentially billable Neon project or repurpose another product's database. Cloudflare's documented D1 and SQLite Durable Object free tiers support this deployment shape. Record usage limits and fail rather than silently upgrading. Revisit Postgres if demonstrated product needs exceed this simple account-scoped workload.

PowerSync was considered: its hosted free projects deactivate after one week of inactivity, while paid production hosting starts at US$49/month. Adding another managed service or self-hosted sync cluster is not justified for this free-tier-first release. Zero is still evolving its React Native integration. Use a small application-specific outbox protocol over established SQLite/HTTP/WebSocket primitives, with transaction and fault tests; do not implement a general-purpose replication engine.

Use Stripe's official SDK and hosted Checkout/Portal for web billing. Use RevenueCat's supported native SDK for store purchase/restore and verified entitlement webhooks if its free-tier/account setup is available; otherwise keep native purchase entry disabled with an explicit release gate rather than implementing receipt validation ourselves. Account/cloud entitlement must be authoritative on the server and shared across platforms; never offer a native purchase that grants access only on its originating device. Check actual store rules at submission; do not insert unsupported external purchase links into native flows.

Use official Sentry Expo/native and Cloudflare SDKs. Product analytics begins with a small allowlisted event schema and a first-party ingestion endpoint; select a maintained analytics destination with a verified free tier during the observability task. Use provider tools for ingestion and dashboards rather than building a reporting product. No session replay. Cloudflare Web Analytics can cover anonymous marketing traffic without making customer log contents analytics input.

## Identity, ownership, and namespaces

Better Auth owns verification codes, OAuth state, sessions, account linking, throttling, and provider security. Configure exact public origins and Puptime deep-link schemes, secure native credential storage, and web cookie/CSRF behavior. Disable automatic unverified-email account linking. Display only configured providers. Missing production sender/provider settings fail clearly; local email previews never become production fallbacks or leak codes into telemetry/client responses.

Use random stable account/device/pet/operation identifiers. An authenticated account maps internally to one Durable Object; requests cannot choose another account object. Every pet record includes petId. The initial one-puppy entitlement is enforced in the enrollment API, not by a schema that cannot represent several pets. Account preferences are separate from pet records. Namespace local data by local profile and, after explicit enrollment, account ownership; signing in does not upload history or change its owner.

When the account is empty, explicit cloud activation carries the selected local puppy's full history and settings forward. If cloud already has a puppy, show name and history summary and require confirmation that it is the same puppy. If it is different, preserve local data, offer cancel/sign out/use a different account, and explain that combining different puppies is unavailable in the first release. Do not silently replace or attach data. Imports preserve existing IDs and estimate provenance; do not deduplicate different IDs based on similar times.

## Local persistence and migration

Move app and Android widget writers to the same Expo SQLite database. Use WAL, foreign keys, a bounded busy timeout and retry for lock contention, and exclusive transactions through the provided transaction object. Serialize writes in each runtime and rely on database transactions across runtimes. Do not use an AsyncStorage JSON snapshot as the concurrency boundary.

Keep existing storage function entry points while moving their internals. Tables cover local profile/pets, records, per-log revisions, pending operations, acknowledged server cursor, account association, personal preferences, and device state. Store the durable new state, its local revision, and any enabled-cloud operation in one transaction. Free local edits do not build an upload backlog. Enabling cloud materializes a restartable initial upload and association in a transaction. Every pending operation has a unique ID and exact field patch, not an entire stale record replacement.

Before migration, validate existing activity using the existing validation rules. Snapshot original AsyncStorage entries and keep them intact until migration succeeds and verification has completed. Copy all relevant stores in one restartable versioned migration, preserve IDs and timestamps, and do not turn malformed stored data into an empty database. Migration flags are written only with the successful transaction. New writes read the migrated database. Exercise termination, disk-full, concurrent widget activity, and second-run idempotency. Retained legacy copies must be removed by explicit local-data/account deletion as appropriate, never forgotten outside the deletion inventory.

For iOS widgets, keep the supported app-group transport but acknowledge pending operations by ID only after durable app import. Refreshing a widget snapshot must not remove newer unacknowledged actions. The 100-entry pending limit must reject visibly or use a durable bounded transport without losing acknowledged actions; verify extension behavior natively rather than assuming JavaScript transaction tests cover it.

## Synchronization and revision rules

A versioned mutation contains operationId, deviceId, petId where applicable, recordId, record kind, base revision, intent (create/patch/delete/restore), and only changed fields. Validate sizes, field types, timestamps, and kind-specific constraints on client and server. The server commits record state, revision history, operation result, and monotonic account change sequence atomically. An identical operation retry returns its committed result; reuse of an operation ID with a different payload is rejected.

Independent additions and changes to different fields combine automatically. If two edits change the same field from the same older state, the last server-accepted field value wins. Server order is deliberate and does not pretend to know which offline wall clock was correct. Preserve the old and new versions plus affected fields/source/time in history, marking automatic merges. Delete wins over a stale edit. Recreating a deleted record requires an explicit restore against the current deletion revision; a stale offline write cannot resurrect it. Restoring a previous version creates a new validated revision and pending operation. History is a secondary log-menu destination, not a conflict dialog.

Preserve historical nap records and validate their timing without inventing replacement timestamps. The user clarified that nap-log work should be deferred and revisited later. Leave existing nap controls and history intact; do not introduce inferred nap completion or new nap-specific behavior in this rollout. Preserve existing data through migration and synchronization. Invalid historical timing patches retain the last valid timing fields, record the proposal in revision history, and do not prevent independent operations from synchronizing. User-created estimates stay estimated. Custom-activity deletion keeps historical labels available. Atomic composite preferences (for example ordered widget actions) replace as one field; reminder subfields merge independently.

Push bounded pending batches, then pull changes by opaque/versioned cursor. Acknowledge only accepted operation IDs; pending local edits survive pulls and are rebased on the pulled server state. Commit applied changes, acknowledgments, revisions, and cursor together. Retry transient failures with bounded exponential backoff/jitter; pause on authentication/entitlement failures and show a clear local-save-versus-cloud status. Never report synced while there is pending work.

Trigger on activation, reconnection, local mutation, manual retry, and a change notification from the account Durable Object while the app is active. WebSocket messages contain invalidation/cursor information, not private activity data. Use hibernation and close subscriptions when inactive. Keep record deletion markers for the account lifetime initially so an old offline client can safely rejoin; explicit account deletion clears cloud contents and revokes the account mapping so old devices cannot recreate them. Full-resync uses the same pending-operation preservation rule.

## Preferences and lifecycle

Sync pet profile, events/notes/estimate provenance, routines, custom activities/customizations, and personal appearance/language/widget-action/reminder preferences. Sync Follow system intent, resolving locally. Keep OS permission, widget install/size/placement, local notification IDs, and Notify on this device local. Rebuild reminders after sync without replaying historical alerts. Future caregivers have independent personal settings.

Session expiry pauses cloud work and requests reauthentication when needed; it never blocks free local features. Sign-out keeps the current local history as an explicitly detached local profile after confirming any pending-cloud consequences, clears credentials/account association and subscriptions, and does not erase the cloud copy. Switching accounts repeats the puppy-confirmation safeguard. Full export includes supported puppy/settings/revision data and excludes credentials. Account deletion requires recent authentication, removes identity and cloud records via a retryable deletion workflow, and separately offers local-device data removal. Document provider backup expiry honestly. Do not retain recoverable account content merely because a small tombstone is necessary to block old-client resurrection.

## Onboarding, account UI, and public surfaces

The user clarified that onboarding means the complete first-open setup journey: account creation/sign-in, puppy profile creation or restoration, permission choices, and entry into real use. The interactive feature walkthrough is only one component. The current walkthrough implementation does not complete onboarding, even though its historical plan and source filenames use that word.

Keep the existing Puptime themes, typography, and recognizable screen layouts. Design a cohesive first-launch flow with an optional account path and an equally usable Continue without an account path. Use the configured Apple, Google and email-code methods; handle verification, cancellation, errors and returning accounts within the journey. Signing in alone neither starts paid access nor uploads local data. Offer explicit cloud activation/restore when relevant, with entitlement and puppy-confirmation safeguards; a returning cloud puppy must not become an accidental duplicate of a newly created profile.

Provide actual puppy profile creation or confirmation within setup, using stable pet identity and the existing name-only minimum with Not now / My puppy and later rename. Any additional profile fields require a product decision rather than being invented for the walkthrough. Explain notification value when reminders become relevant and request OS permission only after an explicit action. Denial, deferral or offline use must still allow entry into local logging. OS permission and Notify on this device remain device-specific; do not request unrelated permissions just to complete setup.

Show the skippable preview walkthrough before first logging as one part of this journey; replay from Settings leaves real data and account state alone. Persist setup progress at meaningful committed boundaries so interruption/restart can resume without losing data, repeating completed account actions or creating another puppy. Keep first-launch setup progress separate from walkthrough replay/completion. Existing users retain their profile/history and receive relevant optional-cloud setup rather than a forced repeat of the whole journey.

Onboarding acceptance includes fresh local setup, new-account verification, returning-account restore, account cancellation/failure, local-data association when cloud is explicitly enabled, profile save failure/retry, permission allow/deny/defer, interrupted setup/restart and the first real saved log. Record the complete first-open paths and their important failure branches on iOS; a walkthrough video alone is not onboarding evidence. Provider delivery and distributed-build checks remain explicit gates until actually verified.

Offer cloud from a dedicated Settings entry or a deliberately chosen cloud action. Explain data upload, trial/price, and local history handling at enrollment. Separate sign-in, entitlement activation, and explicit history association. Provide readable offline/pending/failure/synced state and recovery. Never put checkout in front of the first local log or show repeated unsolicited upgrade dialogs.

Web account management provides configured sign-in methods, subscription status/portal, export, deletion, and sign-out. Marketing reflects actual release availability and configurable catalog prices. Draft privacy/terms/listings alongside implementation but publish collection claims and cloud availability only with the corresponding deployed release. Browser logging is a later phase using the same authenticated APIs and ownership rules.

## Telemetry and operations

Use explicit allowlists for events and properties: walkthrough steps/completion, first successful log, cloud enrollment stages, entitlement outcomes, sync outcome/backlog-age buckets, marketing calls to action, and operational failures. No note text, pet names, email/code/token, raw request bodies, or revision contents in telemetry. Keep user identifiers pseudonymous where needed and scrub on both client and ingestion boundary. Default optional product analytics off until a clear opt-in; operational diagnostics have a visible control and accurate policy. Select vendor region and documented retention before production ingestion; do not imply legal/country readiness without checking the actual launch configuration.

Keep source maps/native debug files and release/environment attribution in CI. Verify deliberate JavaScript/native/API errors actually arrive and are readable. Record provider delivery/usage and alert routing; use free-tier limits with sampling and bounded alerts. A hard free-tier limit produces a clear operational issue, never a silent paid upgrade.

## Verification and release criteria

The discovery roadmap's failure matrix and service inventory are mandatory acceptance requirements. Add implementation-specific tests for transactions, malformed requests, authorization, idempotency, conflict history, interrupted migrations, app/widget races, account changes, and entitlement transitions. Use the existing Node test runner for pure/domain tests, Cloudflare's supported local runtime for deployed API/database integration tests, Maestro on dedicated task-named iOS/Android devices, and browser automation for web flows.

Test both happy paths and edge cases locally, against deployed staging, and with the production service and distributed app using isolated synthetic accounts. Record build/environment/provider mode and downstream evidence. Sandbox payments are not live payments; email previews are not real delivery; a configured DSN is not proof of Sentry ingestion. Physical-device/store-controlled/provider-required checks are explicit gates where automation cannot prove behavior. No real charges without an agreed amount/account. Domain and native provider/store configuration cannot be claimed complete while unavailable.

Use populated Android history and prove detail/editor state changes do not redraw unchanged rows. Show fresh screenshots for UI changes. Test account-level recovery and infrastructure restore in isolation without disrupting users. Do not claim comprehensive production coverage when a gate remains unverified.

Deliver PR-sized phases with checks and review, merging only through GitHub PRs. No direct main pushes. Public app-store submission and any real-charge verification remain concrete final release actions after the candidate and evidence are reviewable; implementation can continue independently of those external gates.

## Primary tool references checked October 17, 2026

- https://docs.expo.dev/versions/latest/sdk/sqlite/
- https://better-auth.com/docs/integrations/expo
- https://better-auth.com/docs/concepts/database
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://powersync.com/pricing
- https://www.revenuecat.com/pricing
- https://neon.com/pricing

References establish current capabilities, not proof of this app's integration. Verify pinned versions and real deployment behavior in implementation.

Builder check: a fresh reviewer found no important unanswered product questions. Their invalid-nap reconciliation concern was resolved by the explicit preserve-valid-timing rule above. A later user clarification defers nap-log changes, leaves existing controls intact, and removes inferred nap completion from the implementation scope.
