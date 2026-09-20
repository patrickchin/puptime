import assert from 'node:assert/strict';
import test from 'node:test';

import {
  darkTheme,
  eventIcon,
  isThemePreference,
  lightTheme,
  namedThemes,
  navigationIcon,
  resolveTheme,
  sunriseTheme,
} from './theme.ts';

test('resolves system and named themes', () => {
  assert.equal(resolveTheme('system', 'light'), lightTheme);
  assert.equal(resolveTheme('system', 'dark'), darkTheme);
  assert.equal(resolveTheme('meadow', 'dark'), lightTheme);
  assert.equal(resolveTheme('sunrise', 'dark'), sunriseTheme);
  assert.equal(resolveTheme('midnight', 'light'), darkTheme);
  Object.entries(namedThemes).forEach(([preference, theme]) => {
    assert.equal(resolveTheme(preference as keyof typeof namedThemes, 'light'), theme);
  });
});

test('accepts only supported stored theme preferences', () => {
  assert.equal(isThemePreference('system'), true);
  assert.equal(isThemePreference('sunrise'), true);
  assert.equal(isThemePreference('blueprint'), true);
  assert.equal(isThemePreference('contrast'), true);
  assert.equal(isThemePreference('unknown'), false);
  assert.equal(isThemePreference(null), false);
});

test('named themes have distinct presentation systems', () => {
  const themes = Object.values(namedThemes);
  const signatures = themes.map(({ presentation }) => [
    presentation.cardRadius,
    presentation.controlRadius,
    presentation.borderWidth,
    presentation.cardPadding,
    presentation.actionHeight,
    presentation.titleSize,
    presentation.titleWeight,
    presentation.shadowRadius,
    presentation.markIcon,
    presentation.voice,
    presentation.iconProfile,
  ].join(':'));

  assert.equal(themes.length, 10);
  assert.equal(new Set(signatures).size, themes.length);
});

test('every theme has a distinct semantic icon profile', () => {
  const signatures = Object.values(namedThemes).map((theme) => [
    eventIcon(theme, 'pee'),
    eventIcon(theme, 'meal'),
    eventIcon(theme, 'walk'),
    eventIcon(theme, 'nap'),
    navigationIcon(theme, 'log'),
    navigationIcon(theme, 'insights'),
    navigationIcon(theme, 'schedule'),
  ].join(':'));

  assert.equal(new Set(signatures).size, Object.keys(namedThemes).length);
});
