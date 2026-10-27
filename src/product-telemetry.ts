// Product events describe UI behavior, never customer records or entered text.
export const telemetryScreens = ['startup', 'log', 'timeline', 'insights', 'schedule', 'pets', 'notifications', 'learn', 'settings', 'account', 'onboarding', 'theme_picker', 'language_picker', 'log_editor', 'log_history', 'routine_editor', 'guide', 'widget_settings', 'backups', 'assistant'] as const;
export type TelemetryScreen = typeof telemetryScreens[number];
export const telemetryActivities = ['pee', 'poop', 'meal', 'pottyTrip', 'walk', 'nap', 'custom'];
export const telemetryActions = ['create', 'update', 'delete', 'undo', 'nap_end', 'custom_activity_create', 'import'];
export type ProductEvent = 'app_foreground' | 'app_screen_view' | 'app_screen_time' | 'app_navigation' | 'app_press' | 'app_log_action';
export type ProductProperties = Record<string, string | number | boolean>;

// Exact static IDs and finite dynamic variants only. Never send raw test IDs:
// several contain dates, custom labels, database IDs or other customer data.
const staticControls = new Set([
  'assistant.open', 'assistant.close', 'assistant.accept', 'assistant.send', 'assistant.voice', 'assistant.speaker',
  'assistant.confirm', 'assistant.cancel', 'assistant.undo', 'assistant.account', 'assistant.retry', 'nav.assistant',
  'assistant.example.0', 'assistant.example.1', 'assistant.example.2',
  "account.apple", "account.back", "account.changeEmail", "account.enable", "account.export", "account.export.cancel",
  "account.google", "account.manage", "account.methods.refresh", "account.open", "account.refresh", "account.resend",
  "account.retry", "account.sendCode", "account.signOut", "account.verify", "account.viewLogs", "activity.retry",
  "appearance.close", "backups.close", "backups.retry", "confirm.cancel", "confirm.delete", "date.nextMonth",
  "date.previousMonth", "editor.close", "editor.history", "editor.shareDeletedDraft", "history.back", "history.cloud.load",
  "history.cloud.more", "history.cloud.retry", "history.cloud.version", "history.confirm.cancel", "history.confirm.restore",
  "history.day", "history.loadMore", "history.local.more", "history.local.retry", "history.local.version", "history.recent.back",
  "history.recent.more", "history.recent.retry", "history.reload", "history.restore", "learn.article", "learn.audio.back",
  "learn.audio.forward", "learn.audio.mute", "learn.audio.play", "learn.audio.speed", "learn.back", "learn.sources.toggle",
  "nav.account", "nav.back", "nav.backdrop", "nav.close", "nav.insights", "nav.learn", "nav.log", "nav.notifications",
  "notifications.timed.remove", "nav.open", "nav.pets", "nav.schedule", "nav.settings", "nav.switch", "nav.timeline", "notifications.timed.add",
  "notifications.timed.close", "notifications.timed.retry", "notifications.timed.save", "notifications.timing.close",
  "onboarding.back", "onboarding.later", "onboarding.notifications.allow", "onboarding.primary", "onboarding.skip",
  "onboarding.spotlight.dismiss", "picker.cancel", "picker.done", "schedule.add", "schedule.editor.close", "schedule.editor.save",
  "schedule.editor.time", "schedule.editor.window", "settings.account.open", "settings.back", "settings.backups.open",
  "settings.export", "settings.guide.open", "settings.history.open", "settings.import", "settings.language", "settings.language.open",
  "settings.notifications.open", "settings.notifications.permission", "settings.notifications.routines", "settings.open",
  "settings.privacy.open", "settings.puppy.name", "settings.puppy.name.cancel", "settings.puppy.name.save", "settings.puppy.photo.retry",
  "settings.theme", "settings.theme.open", "settings.widget.close", "settings.widget.open", "setup.back", "setup.retry",
  "time.mode", "timeline.date", "timeline.details.backdrop", "timeline.details.close", "timeline.gap", "timeline.loadEarlier",
  "timeline.mark.duration", "timeline.mark.point", "timeline.window", "timeline.windows.edit", "timeline.zoom.in",
  "timeline.zoom.out", "timeline.zoom.reset", "toast.edit", "toast.undo",
]);
const activityControls = new Set(telemetryActivities.flatMap(type => [
  `quick.${type}`, `event.${type}.edit`, `event.${type}.delete`, `editor.type.${type}`,
  `schedule.entry.${type}`, `schedule.entry.${type}.remove`, `schedule.editor.type.${type}`, `settings.widget.action.${type}`,
]));
export function telemetryControl(id?: string): string | undefined {
  if (!id) return;
  if (staticControls.has(id) || activityControls.has(id)) return id;
  if (/^learn\.article\.[a-z-]+$/.test(id)) return 'learn.article';
  if (/^appearance\.theme\.(system|light|dark)$/.test(id)) return id;
  if (/^timeline\.filter\.(pee|poop-meal|meal|walk|nap)$/.test(id)) return id;
  if (/^appearance\.language\.(system|en|zh-Hans|es)$/.test(id)) return id;
  if (/^account\.(apple|google)\.(connect|signIn)$/.test(id)) return id;
  if (/^notifications\.timed\.remove\./.test(id)) return 'notifications.timed.remove';
  if (id.startsWith('settings.widget.action.custom:')) return 'settings.widget.action.custom';
  if (/^timeline\.(date|gap|window|mark\.(duration|point))\./.test(id)) return id.startsWith('timeline.mark.') ? id.split('.').slice(0, 3).join('.') : id.split('.').slice(0, 2).join('.');
  if (/^history\.day\./.test(id)) return 'history.day';
  if (/^history\.(local|cloud)\.\d+$/.test(id)) return `history.${id.split('.')[1]}.version`;
  if (/^nav\.view\.(log|timeline)$/.test(id)) return id;
  if (/^editor\.adjust\.(back|forward)\.(5|15|30|60|day)$/.test(id)) return id;
  if (/^learn\.audio\.speed\.(0\.75|1|1\.25|1\.5)$/.test(id)) return id;
}

export function sanitizeProductEvent(event: string, input: Record<string, unknown>): ProductProperties | null {
  if (!['app_foreground', 'app_screen_view', 'app_screen_time', 'app_navigation', 'app_press', 'app_log_action'].includes(event)) return null;
  const screen = (value: unknown) => telemetryScreens.includes(value as TelemetryScreen);
  if (!screen(input.screen)) return null;
  const result: ProductProperties = { screen: input.screen as string, schema_version: 1 };
  if (event === 'app_navigation') {
    if (!screen(input.from_screen) || !screen(input.to_screen)) return null;
    result.from_screen = input.from_screen as string; result.to_screen = input.to_screen as string;
  }
  if (event === 'app_press') {
    const control = telemetryControl(typeof input.control === 'string' ? input.control : undefined);
    if (!control) return null;
    result.control = control;
    if (typeof input.long_press === 'boolean') result.long_press = input.long_press;
  }
  if (event === 'app_log_action') {
    if (!telemetryActions.includes(String(input.action))) return null;
    result.action = String(input.action);
    if (telemetryActivities.includes(String(input.activity_type))) result.activity_type = String(input.activity_type);
    if (['app', 'widget'].includes(String(input.source))) result.source = String(input.source);
    if (['success', 'error'].includes(String(input.result))) result.result = String(input.result);
  }
  for (const key of ['duration_ms', 'press_duration_ms', 'count']) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = Math.min(Math.round(value), key === 'count' ? 100_000 : 86_400_000);
  }
  if (['navigation', 'background', 'checkpoint'].includes(String(input.reason))) result.reason = String(input.reason);
  if (typeof input.resumed === 'boolean') result.resumed = input.resumed;
  return result;
}

export function createProductTelemetry(send: (event: ProductEvent, properties: ProductProperties) => void, now = () => performance.now()) {
  let enabled = false, foreground = false, base: TelemetryScreen = 'log';
  let started: number | undefined, dwell = 0;
  const overlays: { screen: TelemetryScreen }[] = [];
  const current = () => overlays.at(-1)?.screen ?? base;
  function capture(event: ProductEvent, properties: Record<string, unknown> = {}) {
    if (!enabled || !foreground) return;
    const safe = sanitizeProductEvent(event, { screen: current(), ...properties });
    if (safe) { try { send(event, safe); } catch { /* Analytics never breaks an action. */ } }
  }
  function checkpoint(reason: 'navigation' | 'background' | 'checkpoint') {
    if (started === undefined) return;
    const end = now(), duration = Math.max(0, end - started);
    dwell += duration;
    capture('app_screen_time', { duration_ms: duration, reason });
    started = end;
  }
  function change(update: () => void) {
    const from = current();
    // Close the interval before changing the screen attached to it.
    checkpoint('navigation');
    update();
    if (current() !== from) {
      capture('app_navigation', { from_screen: from, to_screen: current(), duration_ms: dwell });
      capture('app_screen_view', { resumed: false });
      dwell = 0;
    }
  }
  return {
    capture, checkpoint,
    setEnabled(value: boolean) {
      if (enabled === value) return;
      enabled = value; dwell = 0;
      started = enabled && foreground ? now() : undefined;
      if (enabled && foreground) { capture('app_foreground'); capture('app_screen_view', { resumed: false }); }
    },
    setForeground(value: boolean) {
      if (value === foreground) return;
      if (!value) checkpoint('background');
      foreground = value;
      started = enabled && foreground ? now() : undefined;
      if (value) { capture('app_foreground'); capture('app_screen_view', { resumed: true }); }
    },
    setScreen(screen: TelemetryScreen) { if (base !== screen) change(() => { base = screen; }); },
    overlay(screen: TelemetryScreen) {
      const item = { screen }; change(() => { overlays.push(item); });
      return () => { if (overlays.includes(item)) change(() => { overlays.splice(overlays.indexOf(item), 1); }); };
    },
  };
}
