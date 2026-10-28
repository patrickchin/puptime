import { widgetActionsForState, type ActivityKey } from '../domain.ts';

export const ANDROID_WIDGET_LAYOUTS = {
  PuptimeQuickLog: 'row',
  PuptimeActions: 'grid',
  PuptimeOverview: 'overview',
  PuptimeSingle: 'single',
  PuptimePair: 'pair',
} as const;
export type WidgetLayout = typeof ANDROID_WIDGET_LAYOUTS[keyof typeof ANDROID_WIDGET_LAYOUTS];

export function widgetLayout(name: string): WidgetLayout {
  return ANDROID_WIDGET_LAYOUTS[name as keyof typeof ANDROID_WIDGET_LAYOUTS] ?? 'row';
}

export function layoutActions(layout: WidgetLayout, configured: readonly ActivityKey[], activeNap: boolean, custom: readonly string[]): ActivityKey[] {
  const selected = widgetActionsForState(configured, layout === 'row' && activeNap, custom);
  if (layout === 'single') return selected.slice(0, 1);
  if (layout === 'pair') return selected.slice(0, 2);
  if (layout === 'grid') {
    const actions = [...new Set<ActivityKey>([...selected, 'pee', 'poop', 'meal', 'pottyTrip', 'walk', 'nap'])].slice(0, 6);
    if (activeNap && !actions.includes('nap')) actions[5] = 'nap';
    return actions;
  }
  return selected;
}
