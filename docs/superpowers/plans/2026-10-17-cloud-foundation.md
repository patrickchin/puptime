# Cloud Record Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide validated, durable, deterministic account-scoped record synchronization and history, ready for authenticated routing and native persistence.

**Architecture:** Shared Zod contracts and pure reconciliation functions; a SQLite-backed Durable Object commits each accepted mutation, history, and change sequence atomically. HTTP requests reach account data only through later authenticated routing; this phase's public Worker exposes only a minimal health response.

**Tech Stack:** Existing TypeScript/Node test runner, Zod stable, Cloudflare Workers/Durable Objects SQLite, Wrangler local runtime, Cloudflare Vitest integration for platform tests.

**Spec:** `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`

## Global Constraints

- Free local use without accounts remains unchanged by this phase.
- Use free service tiers only; never activate paid infrastructure.
- Every record has a pet/account boundary; first-release UI supports one puppy while domain fixtures support two.
- Automatic reconciliation preserves revision history and estimate provenance; ordinary stale edits cannot resurrect a deletion.
- All mutations are validated; identical retries do not create duplicate revisions; a reused ID with different content fails.
- No secrets or customer log contents in test artifacts or telemetry.
- All changes through a GitHub PR; never push directly to main.

## Review Focus

- Unknown fields/prototype-like keys cannot bypass validation or mutate server ownership metadata: Task 1 strict schemas.
- Invalid concurrent nap timing cannot invent care history: Task 2 keep valid timing/rejected proposal evidence.
- Reusing an operation ID with another payload cannot hide a lost edit: Task 3 exact normalized payload comparison.
- Pagination cannot skip state when several writes arrive between reads: Task 3 monotonic per-revision changes and bounded cursor tests.
- Cross-pet updates and restores cannot move existing records or alter another pet's running nap: Tasks 2 and 3 ownership checks.

### Task 1: Versioned mutation contracts

**Files:** Create `src/cloud/protocol.ts`, `src/cloud/protocol.test.ts`; modify `package.json`, `package-lock.json`, `tsconfig.json` only as required.

**Interfaces:** Produces `mutationSchema`, `eventDataSchema`, `recordDataSchema`, `Mutation`, `CloudRecord`, `RecordData`, `RecordKind`, `Revision`, `MutationResult`, `PullPage`. A mutation carries `protocolVersion: 1`, operation/device/record IDs, nullable petId for account preferences, kind, nonnegative baseRevision, intent, and a typed patch. CloudRecord includes server revision/deleted/sequence metadata. Revision retains before/after/proposed fields and reconciliation reasons. No session credentials appear in these types.

- [ ] Write Node tests accepting legacy event IDs and valid event/puppy/routine/customization/preference data, and rejecting unknown fields, oversized strings, malformed timestamps, invalid nap timing, wrong kind/patch combinations, missing pet ownership, and unsafe operation identifiers.
- [ ] Run `node --test src/cloud/protocol.test.ts`; expected FAIL because protocol exports do not yet exist.
- [ ] Add stable Zod, implement strict versioned discriminated schemas and exported inferred types. Preserve existing domain field semantics. Keep field patches partial but require complete valid data for creation in reconciliation.
- [ ] Re-run protocol tests and `npm run typecheck`; expected PASS.
- [ ] Commit the contracts and meaningful tests.

### Task 2: Deterministic reconciliation

**Files:** Create `src/cloud/reconcile.ts`, `src/cloud/reconcile.test.ts`.

**Interfaces:** Consumes Task 1 contracts. Produces `reconcileMutation(current: CloudRecord | null, mutation: Mutation, now: number): { record: CloudRecord; reason: Revision['reason'] }` and typed `ReconciliationError` for invalid identity/base/restore actions. Server supplies the accepted revision/sequence separately. Pure reconciliation never reads another account's state.

- [ ] Write failing tests for independent-field merging, same-field last acceptance, stale deletion protection, explicit restore requiring current deletion revision, identity/kind/pet mismatch, future revision rejection, invalid create, estimated provenance, and invalid nap timing retaining the last valid timing while preserving independently valid changed fields.
- [ ] Run `node --test src/cloud/reconcile.test.ts`; expected FAIL for missing implementation.
- [ ] Implement validation and pure rules. Preserve deletion against stale edits; restore is a new valid mutation. Keep all proposal/reconciliation information available for history without putting it in telemetry.
- [ ] Re-run protocol/reconciliation tests and typecheck; expected PASS.
- [ ] Commit reconciliation.

### Task 3: Transactional account store and platform checks

**Files:** Create `server/account-store.ts`, `server/index.ts`, `server/account-store.test.ts`, `server/tsconfig.json`, `server/vitest.config.ts`, `wrangler.jsonc`; modify package scripts/lockfile and root tsconfig exclusion for server-only modules.

**Interfaces:** The internal Durable Object exposes `apply(mutation: Mutation): MutationResult`, `pull(after: number, limit?: number): PullPage`, `history(recordId: string, beforeRevision?: number): Revision[]`. `apply` uses a SQLite synchronous transaction to atomically save normalized operation payload/result, record, revision, and sequence. Identical operation retries return the stored result; changed-payload retries throw. `pull` returns ordered immutable revision results (including deletion markers), a next cursor, and hasMore. The public Worker exposes `/health` only until authenticated routing is implemented.

- [ ] Write platform integration tests that call a real local Durable Object binding: create/patch/delete/restore, duplicate/change-payload retry, two pets, competing naps, paginated pulls, history order, malformed operations, and object isolation. Assert no partial record/history changes on failure.
- [ ] Run the configured server test command; expected FAIL for missing implementation.
- [ ] Install supported stable Wrangler/Cloudflare types/test runtime dependencies. Implement parameter-bound SQL, migrations, indexed record/revision/operation tables, synchronous transactional commits, bounded page sizes, and complete domain invariants. Concurrent naps close only within the same pet and mark inferred completion estimated in its own revision. Do not expose an account-selector endpoint on the public Worker.
- [ ] Run Node tests, platform integration tests, and both client/server typechecks; expected PASS. Run local Worker `/health` and confirm public account paths are unavailable. Production deployment waits for authenticated routing.
- [ ] Record exact versions, checks and runtime limitations in the ledger; commit foundation.

### Task 4: Review and handoff to identity phase

**Files:** Update rollout status/design only when evidence supports completion; add next identity plan against the actual Task 3 interfaces.

- [ ] Run the repository checks and bundle exports affected by added shared dependencies. Expected PASS, with existing app behavior retained.
- [ ] Dispatch the single fresh whole-branch reviewer required by executing-plans; fix material findings with a failing regression test followed by green tests.
- [ ] Push this branch, attach/update the GitHub PR, wait for applicable CI checks, and merge through the PR when green and review findings are addressed.
- [ ] Continue to identity/entitlements, using this phase's interfaces. Do not claim cloud UI or production service verification from these foundation tests.
