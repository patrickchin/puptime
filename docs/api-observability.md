# API error monitoring

This branch adds optional error monitoring with the official stable `@sentry/cloudflare` SDK. Its public `wrapRequestHandler` wraps the existing Hono `fetch` handler without instrumenting or changing the D1/RPC bindings; it does not add a Hono adapter or change the API's error responses. The API and Durable Object use the same configuration. Missing or invalid `SENTRY_DSN` disables reporting, including after an earlier enabled invocation in the same isolate. No deployed Sentry project, DSN or ingestion is claimed by the local tests.

## Data boundary

The only accepted destination is an HTTPS Sentry ingestion host. HTTP loopback is accepted only with `ENVIRONMENT=local` for tests. `SENTRY_RELEASE`, when set, must be a full lowercase Git SHA; it becomes `puptime-api@<sha>`.

Every outgoing SDK envelope is rebuilt from an allowlist. It may contain an error ID, timestamp, fixed SDK/surface metadata, configured environment, validated release, built-in exception type, the fixed message `Unexpected Puptime API error`, and line/column locations for owned source filenames. Valid source-map debug IDs may accompany those filenames. Expected HTTP4xx, validation and reconciliation errors are excluded. Unhandled API failures retain their existing generic503 response. Capturing at the HTTP boundary also covers a failing Durable Object RPC; an export stream that fails after that boundary uses the SDK's official isolated request lifecycle.

The boundary excludes account/device/pet identifiers, email, codes, tokens, cookies, headers, URLs/query strings, request bodies, notes, SQL statements/bindings, source context, variables, raw error messages, breadcrumbs and arbitrary scope fields. It drops attachments and all non-error envelope items. Tracing, trace propagation, replay, profiling, logs, metrics, check-ins and SDK client reports are disabled or discarded. The SDK owns its bounded transport queue and background flushing; no custom retry service is added. Operational server diagnostics do not enable native analytics or native crash capture.

## Local acceptance

Run `npm run typecheck:server`, `npm run test:observability` and `npm run test:server`. The observability project starts a real loopback HTTP ingestion sink and uses the actual SDK transport, Cloudflare runtime, D1 and Durable Object. It checks:

- One real SDK envelope for an unexpected API503, with unchanged safe response.
- Missing/invalid configuration, isolate reuse, normal requests and expected failures without uploads; unavailable ingestion cannot change API responses or trigger a request retry.
- Poison values placed in auth headers, bodies, user/scope fields, SQL/context and envelope headers cannot reach the sink.
- Attachments and sessions, transactions, profiles, replay, check-ins, logs, metrics and spans cannot cross the final envelope boundary.
- Concurrent requests remain isolated. A genuine SQL-backed Durable Object failure returns503 and uploads exactly once. A late failed export stream uploads an error and still rejects without a completion footer.

The existing server suite covers the stateful RPC, deletion, HTTP/WebSocket and100,000-record streaming behavior. These are local tests, not evidence of Sentry ingestion, source-map symbolication, standalone caught RPC/alarm/WebSocket diagnostics or deployed-service acceptance.

## Enablement gates still open

A dedicated Puptime project, region, free-tier limits/retention and alert routing must be agreed and configured before deployment. Store the DSN in the Worker configuration; keep upload credentials in the existing private Keychain/CI secret. Do not place authentication tokens in source. A CLI token existing or a DSN being configured does not prove ingestion.

For the exact deployed Worker bundle, use the maintained Sentry CLI to inject/upload its source maps and debug IDs, associate the exact Git release, then send one deliberate synthetic error. Inspect the received event and downloaded envelope for the allowlist, readable owned frames, release/debug-ID association and correct project/environment. Verify alert receipt and missing-DSN rollback; repeat against actual deployed API/DO and stream failures. A DSN or upload command alone is insufficient. No deployment or source-map upload is part of this slice.

Native consent, withdrawal without flushing queued data, offline cache/restart behavior, native crashes, dSYM/JS map uploads and distributed iOS Release acceptance remain a separate implementation. Native Sentry must not be initialized merely because API monitoring is enabled.

References: [official Cloudflare wrapper](https://docs.sentry.io/platforms/javascript/guides/cloudflare/install/wrangler/), [configuration](https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/options/), [source maps](https://docs.sentry.io/platforms/javascript/guides/cloudflare/sourcemaps/).
