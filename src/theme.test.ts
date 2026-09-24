import assert from 'node:assert/strict';
import test from 'node:test';

import { EVENT_META } from './domain.ts';
import {
  darkTheme,
  eventColors,
  eventIcon,
  isThemePreference,
  lightTheme,
  namedThemes,
  navigationIcon,
  resolveTheme,
  sunriseTheme,
} from './theme.ts';

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => [1, 3, 5]
    .map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

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
    navigationIcon(theme, 'timeline'),
    navigationIcon(theme, 'insights'),
    navigationIcon(theme, 'schedule'),
  ].join(':'));

  assert.equal(new Set(signatures).size, Object.keys(namedThemes).length);
});

test('activity colors keep accessible contrast in chips and timeline tracks', () => {
  const activities = Object.entries(EVENT_META);
  assert.equal(new Set(activities.map(([, meta]) => meta.color)).size, activities.length);
  assert.equal(new Set(activities.map(([, meta]) => meta.darkColor)).size, activities.length);

  activities.forEach(([type, meta]) => {
    assert.ok(contrastRatio(meta.color, meta.softColor) >= 4.5);
    assert.ok(contrastRatio(meta.darkColor, meta.darkSoftColor) >= 4.5);

    Object.values(namedThemes).forEach((theme) => {
      const { color, softColor } = eventColors(theme, type as keyof typeof EVENT_META);
      assert.equal(softColor, theme.isDark ? meta.darkSoftColor : meta.softColor);
      assert.ok(contrastRatio(color, theme.surface) >= 3);
      assert.ok(contrastRatio(color, theme.primarySoft) >= 3);
    });
  });
});

test('pee, poop, and meals use distinct blue, orange, and green families', () => {
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    const range = high - low;
    if (high === r) return ((g - b) / range + 6) % 6 * 60;
    if (high === g) return ((b - r) / range + 2) * 60;
    return ((r - g) / range + 4) * 60;
  };

  [lightTheme, darkTheme].forEach((theme) => {
    const hues = (['pee', 'poop', 'meal'] as const).map((type) => hue(eventColors(theme, type).color));
    assert.ok(hues[0] >= 180 && hues[0] <= 230);
    assert.ok(hues[1] >= 15 && hues[1] <= 60);
    assert.ok(hues[2] >= 75 && hues[2] <= 170);
    hues.forEach((value, index) => {
      hues.slice(index + 1).forEach((other) => {
        const gap = Math.abs(value - other);
        assert.ok(Math.min(gap, 360 - gap) >= 60);
      });
    });
  });
});
