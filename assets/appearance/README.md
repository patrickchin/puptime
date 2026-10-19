# Playful appearance assets

The mascot is the user-selected scruffy terrier at `../mascots/scruffy-terrier.png`. It replaces the previous beagle illustration. Its generation prompts are retained in `../mascots/README.md`; the transparent PNG is bundled locally.

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
