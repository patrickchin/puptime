import { activityKey, isQuickEventType, type Activity, type ActivityKey } from './domain.ts';
import { eventColors, type Theme } from './theme.ts';

export const activityEmojis = ['🐾', '💧', '💩', '🍎', '🚪', '🐕', '💤', '🎾', '🦴', '🧸', '💊', '🛁', '✂️', '🥣', '🩺', '🚗', '⭐', '❤️'] as const;

export const activityColors = [
  { name: 'Coral', light: '#AD4635', dark: '#FF9D88', softLight: '#FBE8E3', softDark: '#482F2A' },
  { name: 'Orange', light: '#9A5B10', dark: '#F7BD67', softLight: '#F9EEDB', softDark: '#433521' },
  { name: 'Green', light: '#39752F', dark: '#A3DC8A', softLight: '#E8F3E4', softDark: '#2B4029' },
  { name: 'Teal', light: '#126E68', dark: '#79D7CE', softLight: '#DFF2F0', softDark: '#25413E' },
  { name: 'Blue', light: '#276A9F', dark: '#84C8F0', softLight: '#E2F0FA', softDark: '#273E50' },
  { name: 'Purple', light: '#7155A3', dark: '#C3A9F4', softLight: '#EEE9F8', softDark: '#393047' },
  { name: 'Pink', light: '#A64579', dark: '#F1A3CD', softLight: '#F9E8F1', softDark: '#472B3B' },
] as const;

export type ActivityCustomization = { name?: string; emoji?: string; color?: number };
export type ActivityCustomizations = Partial<Record<ActivityKey, ActivityCustomization>>;

export function normalizeActivityCustomizations(value: unknown): ActivityCustomizations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: ActivityCustomizations = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isQuickEventType(key) && !(key.startsWith('custom:') && key.length > 7)) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 40) : '';
    const emoji = activityEmojis.find((option) => option === item.emoji);
    const color = Number.isInteger(item.color) && (item.color as number) >= 0 && (item.color as number) < activityColors.length
      ? item.color as number : undefined;
    if (name || emoji || color !== undefined) next[key as ActivityKey] = {
      ...(name ? { name } : {}),
      ...(emoji ? { emoji } : {}),
      ...(color !== undefined ? { color } : {}),
    };
  }
  return next;
}

export function customizedActivityColors(theme: Theme, customizations: ActivityCustomizations, activity: Activity) {
  const selected = customizations[activityKey(activity)]?.color;
  const option = selected === undefined ? undefined : activityColors[selected];
  return option
    ? { color: theme.isDark ? option.dark : option.light, softColor: theme.isDark ? option.softDark : option.softLight }
    : eventColors(theme, activity.type);
}
