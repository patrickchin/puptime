import assert from 'node:assert/strict';
import test from 'node:test';

import { activityColors } from './activity-customization.ts';
import { EVENT_META } from './domain.ts';
import {
  darkTheme,
  eventColors,
  isThemePreference,
  lightTheme,
  resolveTheme,
  themeChoices,
} from './theme.ts';

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => [1, 3, 5]
    .map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test('resolves default light and dark modes, with an optional device setting', () => {
  assert.deepEqual(themeChoices, ['system', 'light', 'dark']);
  for (const scheme of ['light', 'dark', 'unspecified', null, undefined] as const) {
    assert.equal(resolveTheme('light', scheme), lightTheme);
    assert.equal(resolveTheme('dark', scheme), darkTheme);
    assert.equal(resolveTheme('system', scheme), scheme === 'dark' ? darkTheme : lightTheme);
  }
});

test('accepts supported preferences and rejects removed themes', () => {
  for (const value of themeChoices) assert.equal(isThemePreference(value), true);
  for (const value of ['puppy-journal', 'soft-play', 'day-trails', 'meadow', 'sunrise', 'midnight', 'paper', 'bubblegum', 'blueprint', 'trail', 'tide', 'plum', 'contrast', 'unknown', null]) {
    assert.equal(isThemePreference(value), false);
  }
});

test('activity colors keep accessible contrast in chips and timeline tracks', () => {
  const activities = Object.entries(EVENT_META);
  assert.equal(new Set(activities.map(([, meta]) => meta.color)).size, activities.length);
  assert.equal(new Set(activities.map(([, meta]) => meta.darkColor)).size, activities.length);

  activities.forEach(([type, meta]) => {
    assert.ok(contrastRatio(meta.color, meta.softColor) >= 4.5);
    assert.ok(contrastRatio(meta.darkColor, meta.darkSoftColor) >= 4.5);

    [lightTheme, darkTheme].forEach((theme) => {
      const { color, softColor } = eventColors(theme, type as keyof typeof EVENT_META);
      assert.equal(softColor, theme.isDark ? meta.darkSoftColor : meta.softColor);
      assert.ok(contrastRatio(color, theme.surface) >= 3);
      assert.ok(contrastRatio(color, theme.primarySoft) >= 3);
    });
  });
});

test('custom activity colors remain legible in light and dark themes', () => {
  activityColors.forEach((option) => {
    assert.ok(contrastRatio(option.light, option.softLight) >= 4.5, option.name);
    assert.ok(contrastRatio(option.dark, option.softDark) >= 4.5, option.name);
    [lightTheme, darkTheme].forEach((theme) => {
      const color = theme.isDark ? option.dark : option.light;
      assert.ok(contrastRatio(color, theme.surface) >= 3, `${option.name} on ${theme.isDark ? 'dark' : 'light'}`);
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

// The canvas and its paper cards have separate foregrounds in both appearances.
test('canvas and content foregrounds retain accessible contrast', () => {
  for (const theme of [lightTheme, darkTheme]) {
    for (const foreground of [theme.onCanvas, theme.onCanvasMuted]) {
      assert.ok(contrastRatio(foreground, theme.canvas) >= 4.5);
    }
    for (const surface of [theme.surface, theme.surfaceRaised]) {
      for (const foreground of [theme.text, theme.textMuted, theme.primary]) {
        assert.ok(contrastRatio(foreground, surface) >= 4.5);
      }
    }
  }
});
