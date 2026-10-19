# iOS account lifecycle

Continue phase 4 after the real Apple/Google sign-in evidence. Preserve free local
use, the existing owner/generation fences, and the single serialized account
controller. Android, widgets, browser logging and hardware-device inventory stay
outside this slice. Better Auth sessions are not a hardware inventory.

## 1. Full cloud export

- [x] Add an Export cloud data action to the existing account screen. It is
  available to a signed-in owner even after cloud sync access expires. The
  activity CSV in Insights remains a separate format and action.
- [x] Reuse the installed Better Auth client and `expo/fetch`. Send the guarded
  same-origin POST `/api/account/export` with `expectedAccount`, rather than a
  naked URL that could download a different browser/native session's account.
  Preserve the SDK's successful-response cookie handling.
- [x] Stream bytes into a unique temporary Expo File. Validate the manifest,
  monotonically ordered revisions using the existing revision schema, and the
  final completion cursor before opening the native share sheet. Bound partial
  line memory, preserve split UTF-8 sequences, reject truncation or trailing
  data, and delete partial/private temporary files on failure or dismissal.
- [x] Run inside the controller's serialized actions. Capture current owner and
  generation, pause sync transport, and recheck the original account before
  sharing. Do not change local events, association, revisions or outbox. A
  duplicate tap cannot open parallel downloads/share sheets.
- [ ] Check valid empty/populated/Unicode/chunked streams, malformed/truncated
  streams, disk/write failure, network stall/cancellation, expired access,
  cookie renewal and account changes. Qualify the native share sheet on a fresh
  task device against local then deployed staging fixtures; retain screenshots
  and actual product video, never credentials.

Implementation boundary: `src/cloud/account-controller.ts`, its tests,
`src/cloud/auth.ios.ts`, `src/cloud/use-cloud.ios.ts`, a small cloud-export stream
helper/native file adapter, `src/screens/AccountScreen.tsx`, and existing locale
entries. Reuse installed Expo modules; no download framework or new queue.

### Export foundation checkpoint

The portable `writeCloudExport` helper is implemented and independently reviewed.
Six local checks and iOS typechecking pass (review text 325). It validates the
complete stream and aborts the destination on failure. The SDK request, temporary
Expo File, controller and UI are now connected; actual native share-sheet and
deployed acceptance remain open. A regression covers cancellation while the
export is still queued, before transport or file creation begins.
SDK 57's native UTF-8 decoder has incomplete fatal/stream support, so the helper
assembles bounded byte lines and verifies decoding by re-encoding each complete
line. Do not use a decoder on arbitrary byte chunks and risk changing a note.

When wiring the native adapter, keep the original SDK response headers on the
small replacement Response returned after stream consumption. The installed
Expo plugin persists renewed cookies in its success hook. Own a timeout for the
entire body: Better Fetch clears its request timer after receiving headers.
Keep partial files in a dedicated cache directory and clear remnants on client
initialization as well as normal failure/share-sheet dismissal, since process
termination cannot run a finally block. Ownership must be rechecked immediately
before sharing; signing out or a changed generation cancels the share.

The server now streams the captured snapshot through one Durable Object RPC,
with one bounded stored revision per pull. This removes the outer Worker's
export-size-dependent paging calls and JSON parsing. The local Workers runtime
check exports 100,000 revisions over 32 MiB, validates every revision and final
cursor, preserves Unicode, excludes concurrent writes, and interrupts retirement
without a success footer. This establishes the local RPC boundary; deployed
Free-plan CPU timing still needs qualification.

The local native fault matrix now passes; see
`docs/cloud-export-verification.md` for commands, recording scope and remaining
deployed/native qualification gates. Visual review also moved download errors
beside Export and kept authentication failures at the account level.

## 2. Deletion and original-owner verification

- [x] Correct Apple upstream token revocation at the shared server deletion
  boundary first. Freeze concurrent credential writes once deleting, retain
  ordinary OTP reauthentication, and report a manual Apple-disconnection step
  honestly if automated revocation is unavailable. Apple requires app data
  deletion even if no usable Apple token remains. See the dedicated server
  correction and its Workers tests; do not test deletion on the retained real
  Google/Apple/email accounts.
- [ ] Expose cloud-account deletion through native account settings with recent
  original-owner authentication and a separate destructive confirmation.
  Preserve the current local puppy. Optional local erasure is a separate,
  explicit choice, not a side effect of cloud deletion.
- [ ] Persist deletion intention in existing SQL metadata before dispatch. Pause
  transport. On an unknown/lost response, retain the original owner boundary
  and pending work; do not recreate an identity, detach, restart enrollment or
  claim success. Recovery verifies the original owner and asks for a new
  confirmation rather than automatically repeating deletion.
- [ ] Use guarded existing-user-only email reauthentication where available;
  separately design a supported provider reauthentication path that cannot
  silently create a replacement account. Apple private-relay email delivery is
  still gated on the deferred verified sender/relay setup. Do not replace this
  with an anonymous sign-in and assume ownership afterward.
- [ ] After acknowledged completion, clear credentials/association using the
  existing transaction boundary while preserving local records and revisions.
  Display any explicit manual Apple-revocation outcome. Account deletion and
  subscription cancellation are separate operations; billing UI follows its
  own implementation and store qualification.
- [ ] Verify fresh/stale/changed owners, cancellation, double taps, storage
  failure before dispatch, deletion in progress, lost response, restart and
  local-data preservation on isolated local/deployed/native fixtures.

## Release boundary

The installed Better Auth 1.7.10 exposes supported server OAuth context and
`user.validateUserInfo` hooks for pinning an already-linked provider subject to
the original owner. A regular `linkSocial` does not refresh session age, and
`requestSignUp: false` alone does not prohibit a new identity under the current
configuration. Provider reauthentication needs its own guarded implementation
and rejection tests before native deletion can rely on it.

Recovery after interrupted deletion has a separate constraint: migration0003
correctly blocks returning-provider credential updates before the SDK creates a
new session. A scoped auth configuration with `account.updateAccountOnSignIn:
false` needs qualification; no safe per-flow selection on the shared callback
has been established. Preserve the database guard. A returning Apple identity
with no email must also resolve only through its verified, already-linked
provider subject. These remain release gates, not implemented recovery paths.

The current store-copy commit describes the candidate and is not a published
listing. Terms, subscription purchase/cancellation, actual provider revocation,
provider backups, distribution and full release checks remain explicit gates.
No live charge, store submission, paid infrastructure or deletion of retained
human test accounts is authorized by a test plan.

Sources inspected for implementation:
- [Expo SDK 57 streaming fetch](https://docs.expo.dev/versions/v57.0.0/sdk/expo/)
  and the installed `expo-file-system` File stream implementations.
- [Better Auth client](https://better-auth.com/docs/concepts/client) and installed
  Expo plugin cookie handling. SDK response hooks accept a replacement Response;
  do not discard authentication response headers after streaming consumption.
- [Apple account-deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
  and [TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).
