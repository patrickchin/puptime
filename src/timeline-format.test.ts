/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { timelineFormatters } from './timeline-format.ts';

test('reuses timeline formatters across activities and tab mounts in every app language', () => {
  for (const language of ['en', 'zh-Hans', 'es'] as const) {
    const cached = timelineFormatters(language);
    const reference = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' });
    for (let bucket = 0; bucket <= 96; bucket += 1) {
      const date = new Date(2000, 0, 1, 0, bucket * 15);
      assert.equal(timelineFormatters(language), cached);
      assert.equal(cached.time.format(date), reference.format(date));
    }
    const date = new Date(2026, 9, 12);
    assert.equal(cached.fullDate.format(date), new Intl.DateTimeFormat(language, {
      weekday: 'long', month: 'long', day: 'numeric',
    }).format(date));
  }
  assert.notEqual(timelineFormatters('en'), timelineFormatters('zh-Hans'));
  assert.notEqual(timelineFormatters('en'), timelineFormatters('es'));
});
