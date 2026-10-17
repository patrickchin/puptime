# Playful appearance assets

`../puppy-journal.png` is a transparent puppy illustration generated with the built-in ImageGen tool for Puppy journal, Soft play, and Day trails. It is bundled locally; the app never fetches it from a server.

Generation prompt:

> Create one production app illustration asset: a single very cute but tasteful small beagle puppy head with front paws peeking over an invisible ledge, on genuinely transparent background. Friendly relaxed expression, closed smiling mouth, asymmetrical floppy tan ears, warm white muzzle, tiny dark nose, simple black dot eyes. Flat hand-drawn ink contour with slight organic wobble, muted tan and offwhite fill, no texture noise or gradients, no shadow, no surrounding objects, no text, no borders, no background. Broad simple silhouette that reads well at 88x64 pixels on a mobile puppy care diary app for adults. Front view, the puppy and two small paws are the entire subject. Tight composition, generous enough padding to avoid clipping. Palette warm tan #C39153, white #FFFDF7, outline #30372F. Avoid photorealism, 3D, stickers, thick white cutout borders, multiple dogs, complex fur.

The display fonts in `../fonts/` are Delius, Lilita One, and Itim from [Google Fonts](https://github.com/google/fonts), bundled under their accompanying SIL Open Font Licenses. Body text uses the device font.


The three activity atlases were generated with the built-in ImageGen tool on October 17, 2026. Each contains pee, poop, and eating artwork in three equal square cells on transparent alpha:

- `journal-activities.png`: watercolor and ink paper stickers.
- `soft-activities.png`: sculpted matte rubber toy pieces.
- `trail-activities.png`: hand-painted wooden trail tokens.

The complete final prompt set is saved in [activity-prompts.json](activity-prompts.json). The original PNGs are bundled without image processing. `ActivityIcon` clips each sprite cell at render time, and explicit user-customized emoji still take precedence.


Combination artwork extends each family with four unified illustrations in a square 2 × 2 atlas:

- `journal-combinations.png`: watercolor combination stickers.
- `soft-combinations.png`: molded rubber combination pieces.
- `trail-combinations.png`: painted wooden combination badges.

Cell order is pee + poop, pee + eating, poop + eating, then all three (left to right, top to bottom). Each cell is a newly drawn single illustration, not a runtime stack of existing activity icons. Repeated logs of one activity retain the single-activity illustration. Count badges still represent the number of logs, and details preserve their exact activity and time.

These transparent PNGs were generated with the built-in ImageGen tool on October 17, 2026, using the existing activity atlases as style references. The complete final prompt set and reference filenames are saved in [combination-prompts.json](combination-prompts.json). The original PNGs are bundled without image processing.
