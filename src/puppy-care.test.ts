import assert from 'node:assert/strict';
import test from 'node:test';
import { careArticles, careSources, findCareArticles } from './puppy-care.ts';

test('care guides resolve citations, related articles, and videos without orphaned sources', () => {
  const ids = new Set(careArticles.map((article) => article.id));
  assert.equal(ids.size, careArticles.length);
  const used = new Set<string>();
  for (const article of careArticles) {
    assert.match(article.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(article.sections.length);
    assert.ok(article.shortTitle);
    assert.ok(article.glance.length >= 3);
    const sectionSources = new Set(article.sections.flatMap((section) => section.sources));
    for (const point of article.glance) {
      assert.ok(point.label && point.value && point.detail);
      assert.ok(point.sources.length, `${article.id}: quick advice needs sources`);
      for (const id of point.sources) assert.ok(sectionSources.has(id), `${article.id}: quick advice must cite the detailed guidance`);
    }
    for (const section of article.sections) {
      assert.ok(section.paragraphs.length);
      assert.ok(section.sources.length, `${article.id}: ${section.title} needs sources`);
      for (const id of section.sources) {
        assert.ok(careSources[id], `${article.id}: missing source ${id}`);
        assert.notEqual(careSources[id].kind, 'video');
        used.add(id);
      }
    }
    for (const id of article.related) assert.ok(ids.has(id), `${article.id}: missing related guide ${id}`);
    for (const id of article.videos ?? []) {
      assert.equal(careSources[id]?.kind, 'video');
      used.add(id);
    }
  }
  for (const [id, source] of Object.entries(careSources)) {
    assert.equal(new URL(source.url).protocol, 'https:');
    assert.ok(used.has(id), `unused source ${id}`);
  }
});

test('search finds practical questions in the full guide text and handles empty results', () => {
  assert.deepEqual(findCareArticles('  '), careArticles);
  assert.ok(findCareArticles('  FRESH water ').some((article) => article.id === 'feeding'));
  assert.ok(findCareArticles('overnight').some((article) => article.id === 'toilet-training'));
  assert.ok(findCareArticles('five minutes').some((article) => article.id === 'exercise-and-play'));
  assert.equal(findCareArticles('spaceshipxyz').length, 0);
});
