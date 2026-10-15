# Puppy guide narration

These English recordings adapt Puptime’s original care summaries for listening, with conversational transitions and a closing source note. They preserve the guidance and its caveats rather than reading each heading and paragraph verbatim. Linked articles and videos remain in the written guides. They were generated on 15 October 2026 using ElevenLabs v4 and “Joanna - Warm & upbeat” (voice ID `dVoi15NNDJligFBwnVO0`). The owner approved a short sample before the full set was generated.

The account was on the Free plan at generation. The owner explicitly chose noncommercial use with attribution. These audio files are **not covered by the repository’s MIT license**. Keep `elevenlabs.io` in each published audio title, including file metadata, the player, and lock-screen controls. A later paid subscription does not retroactively grant commercial rights to these recordings. Regenerate under an appropriate paid plan before commercial use.

- [ElevenLabs publication and commercial-use guidance](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)
- [ElevenLabs terms](https://elevenlabs.io/terms-of-use)
- [Model and credit-rate guidance](https://help.elevenlabs.io/hc/en-us/articles/21811236079505-How-do-I-find-the-model-ID)

`src/guide-scripts.ts` contains the spoken adaptations. `manifest.json` records the actual spoken script, a snapshot of the written source, voice, model, generation reference, duration, and settings. `src/guide-recordings.ts` supplies static asset references for native and web builds. Recordings are bundled once; listening makes no ElevenLabs requests and uses no generation credits. No API credentials belong in the app, exported website, manifest, or repository.

When care guidance changes, review the spoken adaptation against the written article. Generate its audio from `guideNarration` in `src/guide-scripts.ts`, review the result, replace the MP3, and update its manifest entry. Preserve the current written-source snapshot from `guideSourceText` in `src/guide-audio.ts`. The player hides recordings when the written source changes; tests also require every recording to match its spoken script before release. Native playback continues with the screen locked and stops when leaving the guide.

On the website, playback lives in a full-width bar below the independently scrolling article, with a seek slider, skip buttons, speed selection, and mute/volume controls. On small screens the controls wrap, with mute still available. The native app retains its in-article player.
