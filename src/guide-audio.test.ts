import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { audioSeek, audioTime, guideSourceText } from './guide-audio.ts';
import { careArticles } from './puppy-care.ts';
import { guideNarration, guideScripts } from './guide-scripts.ts';
import { guideRecordings } from './guide-recordings.ts';

test('shipping guides do not register the noncommercial narration', () => {
  assert.deepEqual(Object.keys(guideRecordings), []);
});

test('recording source snapshots capture every written section for change detection', () => {
  for (const article of careArticles) {
    const text = guideSourceText(article);
    const parts = [article.title, article.summary, ...article.sections.flatMap((section) => [section.title, ...section.paragraphs])];
    assert.ok(text.startsWith(parts.join('\n\n')));
    assert.ok(text.endsWith('Sources and further reading are available in the written guide.'));
  }
});

test('every guide has a separate spoken adaptation with a source note', () => {
  assert.deepEqual(Object.keys(guideScripts).sort(), careArticles.map((article) => article.id).sort());
  for (const article of careArticles) {
    const script = guideNarration(article);
    assert.notEqual(script, guideSourceText(article));
    assert.ok(script.length > 100 && script.length < 10_000, `${article.id} must fit one Eleven v4 recording`);
    assert.ok(script.endsWith('Your vet can help tailor this advice to your puppy.'));
    assert.doesNotMatch(script, /https?:\/\//);
  }
});

test('preserved noncommercial recordings retain their scripts, source snapshots and attribution', () => {
  const recordings = JSON.parse(readFileSync(new URL('../assets/puppy-care/audio/manifest.json', import.meta.url), 'utf8'));
  const rights = JSON.parse(readFileSync(new URL('../assets/puppy-care/audio/commercial-rights.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.values(recordings).map((item: any) => item.filename).sort(), rights.recordings.map((item: any) => item.filename).sort());
  for (const [id, recording] of Object.entries(recordings) as Array<[string, { script: string; sourceText: string; duration: number; voice: string; model: string; attribution: boolean; filename: string }]>) {
    // Historical recordings must not force regeneration when written guides change.
    assert.ok(recording.script.length > 100 && recording.sourceText.length > 100);
    assert.ok(recording.duration > 0 && recording.voice && recording.model);
    assert.equal(recording.attribution, true);
    assert.match(recording.filename, /^[a-z-]+\.mp3$/);
    const audio = readFileSync(new URL(`../assets/puppy-care/audio/${recording.filename}`, import.meta.url));
    const original = rights.recordings.find((item: any) => item.filename === recording.filename);
    assert.equal(audio.length, original.bytes);
    assert.equal(createHash('sha256').update(audio).digest('hex'), original.sha256);
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
