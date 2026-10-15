import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { audioSeek, audioTime, guideNarration } from './guide-audio.ts';
import { careArticles } from './puppy-care.ts';

test('narration includes every original guide section in order and a source note', () => {
  for (const article of careArticles) {
    const text = guideNarration(article);
    const parts = [article.title, article.summary, ...article.sections.flatMap((section) => [section.title, ...section.paragraphs])];
    assert.ok(text.startsWith(parts.join('\n\n')));
    assert.ok(text.endsWith('Sources and further reading are available in the written guide.'));
    assert.ok(text.length < 5000, `${article.id} must fit one web generation`);
  }
});

test('recordings stay in sync with their written guides and require attribution', () => {
  const recordings = JSON.parse(readFileSync(new URL('../assets/puppy-care/audio/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(recordings).sort(), careArticles.map((article) => article.id).sort(), 'every guide needs a recording');
  for (const [id, recording] of Object.entries(recordings) as Array<[string, { script: string; duration: number; voice: string; model: string; attribution: boolean; filename: string }]>) {
    const article = careArticles.find((item) => item.id === id);
    assert.ok(article, `unknown recorded guide: ${id}`);
    assert.equal(recording.script, guideNarration(article));
    assert.ok(recording.duration > 0 && recording.voice && recording.model);
    assert.equal(recording.attribution, true);
    assert.match(recording.filename, /^[a-z-]+\.mp3$/);
    const audio = readFileSync(new URL(`../assets/puppy-care/audio/${recording.filename}`, import.meta.url));
    assert.ok(audio.length > 1000);
    assert.ok(audio.includes(Buffer.from('elevenlabs.io')), `${id} needs attribution in its audio metadata`);
  }
});

test('audio controls clamp seeks and format unavailable, fractional, and long durations', () => {
  assert.equal(audioSeek(5, -15, 100), 0);
  assert.equal(audioSeek(95, 15, 100), 100);
  assert.equal(audioSeek(30, -15, 100), 15);
  assert.equal(audioTime(61.9), '1:01');
  assert.equal(audioTime(-2), '0:00');
  assert.equal(audioTime(Number.NaN), '0:00');
  assert.equal(audioTime(3601), '60:01');
});
