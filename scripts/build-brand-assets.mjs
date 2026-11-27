// Generate the website and Android assets from the approved app artwork.
import sharp from 'sharp';

const appIcon = 'assets/puptime-icon.png';
const monochromeIcon = 'assets/brand/adaptive-monochrome.svg';

// Clip display marks to transparency. Launchers and touch icons use the full-bleed master.
const displayMask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" rx="200"/></svg>');
const displayIcon = await sharp(appIcon).ensureAlpha()
  .composite([{ input: displayMask, blend: 'dest-in' }])
  .png().toBuffer();

await Promise.all([
  sharp(displayIcon).resize(256, 256).png().toFile('public/brand-icon.png'),
  sharp(appIcon).resize(180, 180).png().toFile('public/apple-touch-icon.png'),
  sharp(appIcon).resize(512, 512).png().toFile('public/social-preview.png'),
  sharp(displayIcon).resize(48, 48).png().toFile('assets/favicon.png'),
  sharp('assets/brand/adaptive-foreground.svg').resize(1024, 1024).png().toFile('assets/android-icon-foreground.png'),
  sharp(monochromeIcon).resize(432, 432).png().toFile('assets/android-icon-monochrome.png'),
  // Match the color layer's launcher padding and retain the clock cutout.
  sharp(monochromeIcon).resize(380, 380).extend({ top: 26, bottom: 26, left: 26, right: 26, background: 'transparent' })
    .png().toFile('assets/android-icon-themed.png'),
]);
