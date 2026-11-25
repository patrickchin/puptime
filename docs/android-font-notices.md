# Android font and icon notice contract

The offline Settings → Font and icon licenses view reads `src/font-icon-notices.json`. It retains verbatim Red Hat, Material Design Icons/Pictogrammers, Apache 2.0 and vector-icon wrapper notices, including the Android Media3 numeric Roboto attribution. License bodies and font/package source hashes are pinned in `scripts/font-icon-provenance.json`; changes require explicit review.

Application imports select only `@expo/vector-icons/MaterialCommunityIcons`. This avoids pulling the all-family barrel into the JavaScript graph and does not replace any glyphs. Old unused font files remain source assets; the exact archive inventory decides which bytes ship.

The Expo Android prebuild plugin copies the **same JSON bytes** into the ordinary native assets directory. This permits an exact check independently of JavaScript/Hermes serialization or a screenshot:

| Archive | Required entry |
| --- | --- |
| APK | `assets/puptime/font-icon-notices.json` |
| AAB | `base/assets/puptime/font-icon-notices.json` |

Run against the actual candidate:

```sh
python3 scripts/check-android-font-notices.py candidate.apk --output qualification/FONT-NOTICES-APK.json
python3 scripts/check-android-font-notices.py candidate.aab --output qualification/FONT-NOTICES-AAB.json
python3 scripts/check-store-audio.py candidate.apk
python3 scripts/check-store-audio.py candidate.aab
```

The font check requires exact payload bytes, reports the archive/payload/font hashes, identifies fonts by header as well as extension, and refuses an unreviewed font or a missing used icon font. It supports renamed Metro assets. The report does not claim every software-library notice, a native UI pass, an audio license, signing or store acceptance.

Before calling the font gate complete, verify the offline view on the candidate, including open, scroll, close/Android Back, readable legal text and supported text scaling. Confirm every observed font has the required notice; if an actual archive adds a font or changes a pinned dependency, review that source and update the payload/provenance before rebuilding. Keep raw runtime output and personal screenshots out of the public PR.
