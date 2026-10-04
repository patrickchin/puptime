import assert from 'node:assert/strict';
import test from 'node:test';

import { isLanguagePreference, localizedElapsedTime, localizedRelativeTime, resolveLanguage, translate } from './localization.ts';

test('shows precise localized relative time', () => {
  const now = 48 * 60 * 60_000;
  assert.equal(localizedRelativeTime('en', now - 110 * 60_000, now), '1h 50m ago');
  assert.equal(localizedRelativeTime('zh-Hans', now - 110 * 60_000, now), '1 小时 50 分钟前');
  assert.equal(localizedRelativeTime('es', now - (24 * 60 + 30) * 60_000, now), 'hace 1 d 30 min');
  assert.equal(localizedRelativeTime('en', now - (26 * 60 + 30) * 60_000, now), '1d 2h 30m ago');
  assert.equal(localizedElapsedTime('en', now - 110 * 60_000, now), '1h 50m');
  assert.equal(localizedElapsedTime('zh-Hans', now - (26 * 60 + 30) * 60_000, now), '1 天 2 小时 30 分钟');
});

test('resolves supported device languages with an English fallback', () => {
  assert.equal(resolveLanguage('system', 'zh-CN'), 'zh-Hans');
  assert.equal(resolveLanguage('system', 'es-MX'), 'es');
  assert.equal(resolveLanguage('system', 'fr-FR'), 'en');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(isLanguagePreference('system'), true);
  assert.equal(isLanguagePreference('zh-Hans'), true);
  assert.equal(isLanguagePreference('fr'), false);
});

test('interpolates localized copy', () => {
  assert.equal(translate('zh-Hans', 'time.ago', { time: '5 分钟' }), '5 分钟前');
  assert.equal(translate('es', 'routine.inHoursMinutes', { hours: 2, minutes: 15 }), 'en 2 h 15 min');
});
