# Puptime paw-clock

The app and website use the same large-paw mark. The website supplies its forest,
cream and ochre colour direction; the established app icon supplies its shape,
proportions and restrained paper finish. App interface/theme colours are separate.

`../puptime-icon.png` is the opaque 1024 px master. Its colour-only revision was
made with the built-in ImageGen tool on November 13, 2026, using the previous app
icon as the edit target. Final prompt:

> Preserve the existing silhouette, large paw-pad proportions, four toe shapes,
> positions and spacing, clock hand shape, 45-degree angle, round hub, layout,
> subtle paper-like finish and edge quality. Keep the square canvas and rounded
> square format. Change only palette: green field to forest green anchored at
> #234B3B, paw and outer corners to cream anchored at #FFF1D6, red hand and hub to
> ochre anchored at #EBAD43. Keep subtle shading within those colour families.
> No added shapes, text, teal, coral, red, blue, outlines, drop shadows or 3D depth.

The website header, favicon and social preview are size-only master derivatives.
The two editable SVGs provide clean Android layers with matching paw proportions.
The monochrome clock is a transparent knockout, so a single system tint retains
the clock. Artwork stays within Android's central 66/108 safe zone; Android supplies
the forest background and launcher mask rather than receiving a pre-masked tile.
See [Android adaptive-icon guidance](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).

Regenerate derivatives with `node scripts/build-brand-assets.mjs`, using the
existing Expo image pipeline's installed Sharp dependency. This sizes the master
and renders the SVG layers; it does not generate or recolour artwork.
