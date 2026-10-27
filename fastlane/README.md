# iOS store candidate

The English listing, native screenshot set, preview video, optional header/search
artwork, capture provenance, and remaining optimization work are documented in
[`docs/app-store-presence.md`](../docs/app-store-presence.md). Run
`npm run check:app-store` before upload. Preview videos and creative artwork
require a separate App Store Connect upload; the metadata lane uploads text and
screenshots only.

The metadata in this directory describes the optional-cloud iOS candidate. It is
source copy, not evidence that an App Store release or paid plan is available.
The old upfront app price is superseded: local features are free and optional
cloud plans remain separately configurable. No final cloud price is approved.

`Fastfile` reads the version from `app.json`; keep `store.config.json` aligned.
Both upload paths leave automatic release off. The `metadata` lane uploads text
and screenshots without submitting a build. The `submit` lane submits the exact
uploaded build identified by `APP_STORE_BUILD_NUMBER`; neither lane is part of
the autonomous staging deployment.

Before a store submission, reconcile this copy and screenshots with the exact
verified build. Supply a working review account and its access instructions for
that build's cloud environment. Public email delivery, production Apple/Google
configuration, distributed sign-in, native account-lifecycle access, purchases,
privacy declarations, and full release qualification still have their own gates
in `docs/cloud-verification.md` and the cloud rollout plan. Do not reuse staging
credentials in App Review instructions or describe an unexecuted gate as passed.

The activity CSV is distinct from a full cloud-account export. Account deletion
removes cloud records and identity; device-local records and previously exported
files require separate removal. Preserve these distinctions in the listing and
review notes.
