# iOS store candidate

The metadata in this directory describes the optional-cloud iOS candidate. It is
source copy, not evidence that an App Store release or paid plan is available.
The old upfront app price is superseded: local features are free and optional
cloud plans remain separately configurable. No final cloud price is approved.

`Fastfile` reads the version from `app.json`; keep `store.config.json` aligned.
Both upload paths leave automatic release off. The `metadata` lane uploads text
and screenshots without submitting a build. The `submit` lane submits the exact
uploaded build identified by `APP_STORE_BUILD_NUMBER`; neither lane is part of
the autonomous staging deployment.

The submit lane also requires `APP_STORE_IPA_PATH` for that exact candidate. Relative
paths resolve from the repository root; absolute paths also work. The
local Python-stdlib preflight checks the bundle identifier/version/build and
rejects the known noncommercial narration bytes. This is not proof that the
uploaded binary matches, that all other assets are licensed, or that store
declarations are complete. The lane no longer automatically answers “no” to
third-party content or encryption; reconcile those questions in App Store
Connect before a separately authorized submission. See [store readiness](../docs/store-readiness.md).

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

`eas.json` explicitly builds an Android app bundle for the production profile.
It does not establish upload/app signing, a Play app record or an accepted AAB.
No EAS login, cloud build, paid plan or store upload is needed to validate this
metadata locally. A proposed five-household product trial is optional and is
separate from Google's account-specific closed-testing rules.

Local checks (no Fastlane login/submission): `python3 scripts/test_store_audio.py`
and `ruby scripts/test-store-fastlane.rb`. The Ruby check exercises the lane's
Ruby paths from Fastlane's working directory with shell/auth/delivery stubbed.
