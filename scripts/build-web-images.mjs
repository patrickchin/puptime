// Generate the website's WebP image derivatives. The source artwork stays untouched for the app and store.
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const out = 'assets/web';
// Widths cover each image's largest rendered CSS width at 1x and 2x.
const images = [
  { source: 'assets/mascots/scruffy-terrier.png', name: 'scruffy-terrier', widths: [520, 760, 1040], quality: 82 },
  { source: 'assets/screenshots/today.png', name: 'today', widths: [360, 720] },
  { source: 'assets/screenshots/activity.png', name: 'activity', widths: [360, 720] },
  { source: 'assets/screenshots/insights-summary.png', name: 'insights-summary', widths: [360, 720] },
  { source: 'assets/screenshots/schedule-poop-eat.png', name: 'schedule-poop-eat', widths: [360, 720] },
  { source: 'assets/screenshots/timeline-poop-eat.png', name: 'timeline-poop-eat', widths: [360, 720] },
  { source: 'assets/puppy-care/potty.jpg', name: 'potty', widths: [512] },
];

await mkdir(out, { recursive: true });
await Promise.all(images.flatMap(({ source, name, widths, quality = 85 }) => widths.map(width =>
  sharp(source).resize({ width, withoutEnlargement: true })
    .webp({ quality, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toFile(`${out}/${name}-${width}.webp`))));
