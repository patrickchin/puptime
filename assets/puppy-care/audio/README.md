# Puppy guide narration

These English recordings narrate Puptime’s original care summaries, including every written section and a closing source note. Linked articles and videos remain in the written guides. They were generated on 15 October 2026 using ElevenLabs Turbo v2.5 and “Alice - British Female” (voice ID `9rh371MqHF5jaDZ7VPvk`), with a slightly brisker pace and more variable delivery.

The account was on the Free plan at generation. The owner explicitly chose noncommercial use with attribution. These audio files are **not covered by the repository’s MIT license**. Keep `elevenlabs.io` in each published audio title, including file metadata, the player, and lock-screen controls. A later paid subscription does not retroactively grant commercial rights to these recordings. Regenerate under an appropriate paid plan before commercial use.

- [ElevenLabs publication and commercial-use guidance](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)
- [ElevenLabs terms](https://elevenlabs.io/terms-of-use)
- [Model and credit-rate guidance](https://help.elevenlabs.io/hc/en-us/articles/21811236079505-How-do-I-find-the-model-ID)

`manifest.json` records the spoken script, voice, model, generation reference, duration, and settings. `src/guide-recordings.ts` supplies static asset references for native and web builds. Recordings are bundled once; listening makes no ElevenLabs requests and uses no generation credits. No API credentials belong in the app, exported website, manifest, or repository.

When guide text changes, regenerate its full script from `guideNarration` in `src/guide-audio.ts`, review the result, replace the MP3, and update its manifest entry. The player hides recordings whose scripts no longer match their written guide, and tests require full coverage and matching scripts before release. Native playback continues with the screen locked and stops when leaving the guide.
