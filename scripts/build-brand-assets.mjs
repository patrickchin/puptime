// Size-only derivatives of the approved app artwork; Android layers are editable SVGs.
import sharp from 'sharp';

await Promise.all([
  sharp('assets/puptime-icon.png').resize(256, 256).png().toFile('public/brand-icon.png'),
  sharp('assets/puptime-icon.png').resize(512, 512).png().toFile('public/social-preview.png'),
  sharp('assets/puptime-icon.png').resize(48, 48).png().toFile('assets/favicon.png'),
  sharp('assets/brand/adaptive-foreground.svg').resize(1024, 1024).png().toFile('assets/android-icon-foreground.png'),
  sharp('assets/brand/adaptive-monochrome.svg').resize(432, 432).png().toFile('assets/android-icon-monochrome.png'),
]);
