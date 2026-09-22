import assert from 'node:assert/strict';
import test from 'node:test';

import { isLanguagePreference, resolveLanguage, translate } from './localization.ts';

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
  assert.equal(translate('zh-Hans', 'time.minutesAgo', { count: 5 }), '5 分钟前');
  assert.equal(translate('es', 'routine.inHoursMinutes', { hours: 2, minutes: 15 }), 'en 2 h 15 min');
});
