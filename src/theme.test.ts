import assert from 'node:assert/strict';
import test from 'node:test';

import { darkTheme, isThemePreference, lightTheme, resolveTheme, sunriseTheme } from './theme.ts';

test('resolves system and named themes', () => {
  assert.equal(resolveTheme('system', 'light'), lightTheme);
  assert.equal(resolveTheme('system', 'dark'), darkTheme);
  assert.equal(resolveTheme('meadow', 'dark'), lightTheme);
  assert.equal(resolveTheme('sunrise', 'dark'), sunriseTheme);
  assert.equal(resolveTheme('midnight', 'light'), darkTheme);
});

test('accepts only supported stored theme preferences', () => {
  assert.equal(isThemePreference('system'), true);
  assert.equal(isThemePreference('sunrise'), true);
  assert.equal(isThemePreference('unknown'), false);
  assert.equal(isThemePreference(null), false);
});
