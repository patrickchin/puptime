'use no memo';

import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import {
  DEFAULT_WIDGET_ACTIONS,
  customActivityKey,
  EVENT_META,
  relativeTime,
  widgetActionsForState,
  type QuickEventTimes,
  type ActivityKey,
  type QuickEventType,
} from '../domain';
import { resolveTheme, type ThemePreference } from '../theme';

type ActionButton = {
  type: QuickEventType;
  label: string;
};

const buttons = [
  { type: 'pee', label: 'Pee' },
  { type: 'poop', label: 'Poop' },
  { type: 'meal', label: 'Ate' },
  { type: 'pottyTrip', label: 'Out' },
  { type: 'walk', label: 'Walk' },
  { type: 'nap', label: 'Nap' },
] as const satisfies readonly ActionButton[];

const iconPaths: Record<QuickEventType | 'custom' | 'stop' | 'check', string> = {
  pee: '<path d="M12 3.2S6.9 9.1 6.9 13.4a5.1 5.1 0 0 0 10.2 0C17.1 9.1 12 3.2 12 3.2Z"/><path d="M9.4 14.1a2.8 2.8 0 0 0 2.7 2.2"/>',
  poop: '<path d="M8.7 10.2c-.2-2.2 1.7-2.6 2.5-3.5.7-.8.2-1.8-.3-2.5 2.3.2 3.7 1.7 3.3 3.7 1.9.1 3 1.3 2.8 3.1 1.7.3 2.7 1.6 2.4 3.4H4.7c-.3-1.9 1.1-3.5 4-4.2Z"/><path d="M4.5 14.4h15a2.8 2.8 0 0 1-2.8 3.4H7.3a2.8 2.8 0 0 1-2.8-3.4Z"/>',
  meal: '<path d="M4.5 10.5h15a7.5 7.5 0 0 1-15 0Z"/><path d="M3.5 10.5h17M7.2 18.2h9.6M8.5 6.5c.4-1.1 1.4-1.7 2.5-1.7M14 6.5c.4-1.1 1.4-1.7 2.5-1.7"/>',
  pottyTrip: '<path d="M5 20V4h10v16M5 20h10"/><path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5"/><path d="M8.2 12h.1"/>',
  walk: '<circle cx="7" cy="8" r="2"/><circle cx="11" cy="5.5" r="2"/><circle cx="16" cy="6.5" r="2"/><circle cx="18.5" cy="10.5" r="2"/><path d="M7.7 15.4c.7-3 2.3-4.5 4.7-4.5 2.6 0 4.7 2 4.7 4.4 0 2-1.5 3.2-3.5 2.3-.8-.4-1.6-.4-2.4 0-2.1 1-4.1-.1-3.5-2.2Z"/>',
  nap: '<path d="M18.3 15.9A7.8 7.8 0 0 1 8.1 5.7a7.9 7.9 0 1 0 10.2 10.2Z"/><path d="M15.4 5.3h3.2l-3.2 3h3.2"/>',
  custom: '<path d="M3 5v6l10 10 8-8L11 3H5a2 2 0 0 0-2 2Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
};

const makeIcon = (name: QuickEventType | 'custom' | 'stop' | 'check', color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;

type Props = {
  dark?: boolean;
  compact?: boolean;
  activeNap?: boolean;
  lastEventAt?: QuickEventTimes;
  actions?: readonly ActivityKey[];
  customActivities?: readonly string[];
  confirmedAction?: ActivityKey;
  themePreference?: ThemePreference;
};

export function QuickLogWidget({
  dark = false,
  compact = false,
  activeNap = false,
  lastEventAt,
  actions: configuredActions = DEFAULT_WIDGET_ACTIONS,
  customActivities = [],
  confirmedAction,
  themePreference = 'system',
}: Props) {
  const theme = resolveTheme(themePreference, dark ? 'dark' : 'light');
  const background = theme.background as `#${string}`;
  const surface = theme.surface as `#${string}`;
  const border = theme.border as `#${string}`;
  const visibleTypes = widgetActionsForState(configuredActions, activeNap, customActivities);
  const now = Date.now();
  const visibleButtons = visibleTypes.map((type) => ({
    type,
    label: type.startsWith('custom:')
      ? customActivities.find((item) => customActivityKey(item) === type) ?? type.slice(7)
      : buttons.find((button) => button.type === type)?.label ?? type,
  }));
  const actionButtons = (
    <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row', flexGap: compact ? 4 : 7 }}>
      {visibleButtons.map((button) => {
        const isActiveNap = button.type === 'nap' && activeNap;
        const confirmed = confirmedAction === button.type;
        const label = confirmed ? 'Saved' : isActiveNap ? (compact ? 'Wake' : 'End nap') : button.label;
        const meta = EVENT_META[button.type.startsWith('custom:') ? 'custom' : button.type as QuickEventType];
        const actionInk = (theme.isDark ? meta.darkColor : meta.color) as `#${string}`;
        const actionBackground = (theme.isDark ? meta.darkSoftColor : meta.softColor) as `#${string}`;
        const actionBorder = actionInk;
        const lastAt = lastEventAt?.[button.type];
        const timeLabel = lastAt === undefined ? 'Never' : relativeTime(lastAt, now);
        return (
          <FlexWidget
            key={button.type}
            clickAction="LOG_EVENT"
            clickActionData={{ type: button.type }}
            accessibilityLabel={`${confirmed ? `${button.label} saved` : isActiveNap ? 'End nap' : `Log ${button.label.toLowerCase()}`}, ${timeLabel}`}
            style={{
              flex: 1,
              height: 'match_parent',
              flexDirection: compact ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: actionBackground,
              borderColor: actionBorder,
              borderWidth: theme.presentation.borderWidth,
              borderRadius: theme.presentation.controlRadius,
              paddingHorizontal: compact ? 4 : 3,
              paddingVertical: compact ? 2 : 7,
            }}
          >
            <SvgWidget
              svg={makeIcon(confirmed ? 'check' : isActiveNap ? 'stop' : button.type.startsWith('custom:') ? 'custom' : button.type as QuickEventType, actionInk)}
              style={{ width: compact ? 20 : 28, height: compact ? 20 : 28, marginRight: compact ? 4 : 0, marginBottom: compact ? 0 : 4 }}
            />
            <FlexWidget style={{ flex: compact ? 1 : undefined, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <TextWidget
                text={label}
                maxLines={1}
                style={{ color: actionInk, fontSize: compact ? 12 : 14, fontWeight: '700', textAlign: 'center', adjustsFontSizeToFit: true }}
              />
              <TextWidget
                text={timeLabel}
                maxLines={1}
                style={{ color: actionInk, fontSize: compact ? 9 : 11, fontWeight: '600', textAlign: 'center', adjustsFontSizeToFit: true, marginTop: 1 }}
              />
            </FlexWidget>
          </FlexWidget>
        );
      })}
    </FlexWidget>
  );

  if (compact) {
    return (
      <FlexWidget
        accessibilityLabel="Puptime quick log widget"
        style={{
          height: 'match_parent',
          width: 'match_parent',
          backgroundColor: background,
          backgroundGradient: { from: background, to: surface, orientation: 'TL_BR' },
          borderColor: border,
          borderWidth: theme.presentation.borderWidth,
          borderRadius: theme.presentation.cardRadius,
          padding: 4,
        }}
      >
        {actionButtons}
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      accessibilityLabel="Puptime quick log widget"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: background,
        backgroundGradient: { from: background, to: surface, orientation: 'TL_BR' },
        borderColor: border,
        borderWidth: theme.presentation.borderWidth,
        borderRadius: theme.presentation.cardRadius,
        padding: 7,
      }}
    >
      {actionButtons}
    </FlexWidget>
  );
}
