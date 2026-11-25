# Android software notices

Settings → Licenses and credits presents selectable legal text offline. The Android platform module supplies `src/android-software-notices.json`; iOS/web retain their separately scoped font view. The Android prebuild plugin copies identical JSON bytes into `assets/puptime/android-software-notices.json` in an APK and `base/assets/puptime/android-software-notices.json` in an AAB. The existing font payload stays separate and unchanged.

Current status: **INCOMPLETE**. Source curation covers the actual initial inventory of 320 resolved components (78 npm and 242 Maven), including npm-published Expo AARs. Provenance records exact versions, package integrity, artifact hashes, publisher POMs and full primary-source notice text. Proprietary Google SDK terms are identified separately from their embedded open-source notices; this work accepts no agreements. Named native source vendors include the React Native and Hermes dependencies, Fresco image libraries, Zstandard and the Mozilla Public Suffix List. The configured NDK is a source fact; selected compiler-runtime origin remains unqualified.

Only byte-identical complete notice bodies are deduplicated. Every component/version retains its attribution and source mapping. Google publisher byte indexes identify complete embedded library notices; source checks reconstruct each original concatenated license file exactly and allow only publisher-name headings outside the displayed bodies. Distinct copyrights, conditions and NOTICE text stay separate. The ICU HTML source remains verbatim in the asset, with all visible legal wording and link targets presented as readable native text. A standard virtualized list keeps the large notice collection usable.

Before final qualification, bind the reviewed native/vendor source fingerprints and selected runtime terms to the actual candidate. Run both existing font checks and the software payload check against **both exact archives**, using fresh resolved inputs from that candidate:

```sh
python3 scripts/check-android-software-notices.py candidate.apk --inventory dependency-inventory.json --output qualification/SOFTWARE-NOTICES-APK.json
python3 scripts/check-android-software-notices.py candidate.aab --inventory dependency-inventory.json --output qualification/SOFTWARE-NOTICES-AAB.json
```

The software verifier rejects incomplete source review, changed resolved components/artifacts, missing attributions, altered publisher documents and mismatched archive bytes. Its report explicitly does not qualify native origin or runtime UI; those require their separate exact-candidate receipts. Preserve required notices already bundled upstream. The prepared native screen flow and fresh screenshot remain pending the matching candidate, with Android verification required for the Android-only software sections. No complete rights or release claim follows from this source preparation alone.
