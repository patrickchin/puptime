import type { MessageKey } from './localization';

const settingsSearchKeys = {
  appearance: ['settings.theme', 'settings.themeDetail', 'settings.preferences', 'settings.personalization'],
  language: ['settings.language'],
  notifications: ['notifications.title', 'settings.notificationsDetail', 'settings.notificationPermission', 'settings.deviceDelivery', 'settings.pottyNudges', 'settings.routineReminders', 'settings.reminderTiming'],
  widget: ['settings.widgetTitle', 'settings.widgetDetail', 'settings.widgetConfirmations'],
  backups: ['backup.title', 'backup.detail', 'settings.data'],
  csv: ['insights.exportButton', 'insights.importButton', 'settings.data'],
  history: ['history.recentTitle', 'history.recentDetail', 'settings.data'],
  analytics: ['telemetry.title', 'settings.helpPrivacy'],
  guide: ['settings.guide', 'settings.guideDetail', 'settings.helpPrivacy'],
  privacy: ['account.privacy', 'settings.privacyDetail', 'settings.helpPrivacy'],
  account: ['account.title', 'account.signIn'],
} as const satisfies Record<string, readonly MessageKey[]>;

export type SettingSearchId = keyof typeof settingsSearchKeys;

const words = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// One edit (including a transposition) forgives typos without making short queries noisy.
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1)
      || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export function findSettings(
  query: string,
  t: (key: MessageKey) => string,
  available: readonly SettingSearchId[],
): Set<SettingSearchId> {
  const tokens = words(query);
  return new Set(available.filter(id => {
    const terms = words([...settingsSearchKeys[id].map(key => t(key)), t(`settings.search.${id}`)].join(' '));
    return tokens.every(token => terms.some(term => term.includes(token)
      || (token.length >= 4 && /^[a-z]+$/.test(token) && (oneEditApart(token, term) || oneEditApart(token, term.slice(0, token.length))))));
  }));
}
