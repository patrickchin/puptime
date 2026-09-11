'use no memo';

import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { normalizeBackdateMinutes, type QuickEventType } from '../domain';

type ActionButton = {
  type: QuickEventType;
  label: string;
  light: `#${string}`;
  dark: `#${string}`;
  inkLight: `#${string}`;
  inkDark: `#${string}`;
};

const buttons = [
  { type: 'pee', label: 'Pee', light: '#DDF4E9', dark: '#284A3D', inkLight: '#176B52', inkDark: '#92E3C2' },
  { type: 'poop', label: 'Poop', light: '#F6E8D8', dark: '#513923', inkLight: '#865425', inkDark: '#F2C48F' },
  { type: 'meal', label: 'Ate', light: '#FBE5E2', dark: '#53302D', inkLight: '#A34840', inkDark: '#F5B5AE' },
  { type: 'pottyTrip', label: 'Out', light: '#DFEFF8', dark: '#243E50', inkLight: '#286A91', inkDark: '#A6D7F3' },
  { type: 'walk', label: 'Walk', light: '#F3F0D2', dark: '#45431F', inkLight: '#716B18', inkDark: '#E7DF82' },
  { type: 'nap', label: 'Nap', light: '#E8E7FA', dark: '#34355C', inkLight: '#6156A5', inkDark: '#C8C3F3' },
] as const satisfies readonly ActionButton[];

const iconPaths: Record<QuickEventType | 'brand' | 'stop', string> = {
  pee: '<path d="M12 3.2S6.9 9.1 6.9 13.4a5.1 5.1 0 0 0 10.2 0C17.1 9.1 12 3.2 12 3.2Z"/><path d="M9.4 14.1a2.8 2.8 0 0 0 2.7 2.2"/>',
  poop: '<path d="M8.7 10.2c-.2-2.2 1.7-2.6 2.5-3.5.7-.8.2-1.8-.3-2.5 2.3.2 3.7 1.7 3.3 3.7 1.9.1 3 1.3 2.8 3.1 1.7.3 2.7 1.6 2.4 3.4H4.7c-.3-1.9 1.1-3.5 4-4.2Z"/><path d="M4.5 14.4h15a2.8 2.8 0 0 1-2.8 3.4H7.3a2.8 2.8 0 0 1-2.8-3.4Z"/>',
  meal: '<path d="M4.5 10.5h15a7.5 7.5 0 0 1-15 0Z"/><path d="M3.5 10.5h17M7.2 18.2h9.6M8.5 6.5c.4-1.1 1.4-1.7 2.5-1.7M14 6.5c.4-1.1 1.4-1.7 2.5-1.7"/>',
  pottyTrip: '<path d="M5 20V4h10v16M5 20h10"/><path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5"/><path d="M8.2 12h.1"/>',
  walk: '<circle cx="7" cy="8" r="2"/><circle cx="11" cy="5.5" r="2"/><circle cx="16" cy="6.5" r="2"/><circle cx="18.5" cy="10.5" r="2"/><path d="M7.7 15.4c.7-3 2.3-4.5 4.7-4.5 2.6 0 4.7 2 4.7 4.4 0 2-1.5 3.2-3.5 2.3-.8-.4-1.6-.4-2.4 0-2.1 1-4.1-.1-3.5-2.2Z"/>',
  nap: '<path d="M18.3 15.9A7.8 7.8 0 0 1 8.1 5.7a7.9 7.9 0 1 0 10.2 10.2Z"/><path d="M15.4 5.3h3.2l-3.2 3h3.2"/>',
  brand: '<circle cx="7" cy="8" r="2"/><circle cx="11" cy="5.5" r="2"/><circle cx="16" cy="6.5" r="2"/><circle cx="18.5" cy="10.5" r="2"/><path d="M7.7 15.4c.7-3 2.3-4.5 4.7-4.5 2.6 0 4.7 2 4.7 4.4 0 2-1.5 3.2-3.5 2.3-.8-.4-1.6-.4-2.4 0-2.1 1-4.1-.1-3.5-2.2Z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
};

const makeIcon = (name: QuickEventType | 'brand' | 'stop', color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;

type Props = {
  latestLabel?: string;
  dark?: boolean;
  compact?: boolean;
  backdateMinutes?: number;
  activeNap?: boolean;
};

export function QuickLogWidget({
  latestLabel = 'Tap to log',
  dark = false,
  compact = false,
  backdateMinutes = 0,
  activeNap = false,
}: Props) {
  const background = dark ? '#17211C' : '#FFFEFA';
  const backgroundEnd = dark ? '#111A15' : '#EDF4EF';
  const foreground = dark ? '#F2F6F3' : '#17231E';
  const muted = dark ? '#B9C5BE' : '#56635D';
  const border = dark ? '#35443C' : '#D7E2DA';
  const primary = dark ? '#73D3AD' : '#176B52';
  const primarySurface = dark ? '#253E33' : '#DDEFE7';
  const minutesAgo = normalizeBackdateMinutes(backdateMinutes);
  const timeLabel = minutesAgo ? `${minutesAgo}m ago` : 'Now';
  const visibleButtons = compact
    ? buttons.filter((button) => ['pee', 'poop', 'meal', 'nap'].includes(button.type))
    : buttons;
  const actions = (
    <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row', flexGap: compact ? 4 : 5 }}>
      {visibleButtons.map((button) => {
        const isActiveNap = button.type === 'nap' && activeNap;
        const label = isActiveNap ? (compact ? 'Wake' : 'End nap') : button.label;
        const actionBackground = isActiveNap ? (dark ? '#493C70' : '#DED7FA') : dark ? button.dark : button.light;
        const actionInk = isActiveNap ? (dark ? '#E0D8FF' : '#4C3D92') : dark ? button.inkDark : button.inkLight;
        return (
          <FlexWidget
            key={button.type}
            clickAction="LOG_EVENT"
            clickActionData={{ type: button.type, minutesAgo }}
            accessibilityLabel={`${isActiveNap ? 'End nap' : `Log ${button.label.toLowerCase()}`} ${minutesAgo ? `${minutesAgo} minutes ago` : 'now'}`}
            style={{
              flex: 1,
              height: 'match_parent',
              flexDirection: compact ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: actionBackground,
              borderColor: isActiveNap ? actionInk : dark ? button.inkLight : button.inkDark,
              borderWidth: 1,
              borderRadius: compact ? 12 : 14,
              paddingHorizontal: compact ? 4 : 2,
            }}
          >
            <SvgWidget
              svg={makeIcon(isActiveNap ? 'stop' : button.type, actionInk)}
              style={{ width: compact ? 16 : 19, height: compact ? 16 : 19, marginRight: compact ? 4 : 0, marginBottom: compact ? 0 : 2 }}
            />
            <TextWidget
              text={label}
              maxLines={1}
              style={{ color: actionInk, fontSize: compact ? 11 : 9, fontWeight: '700', adjustsFontSizeToFit: true }}
            />
          </FlexWidget>
        );
      })}
    </FlexWidget>
  );

  if (compact) {
    return (
      <FlexWidget
        accessibilityLabel="Puptime quick log widget. Resize taller for time controls."
        style={{
          height: 'match_parent',
          width: 'match_parent',
          backgroundColor: background,
          backgroundGradient: { from: background, to: backgroundEnd, orientation: 'TL_BR' },
          borderColor: border,
          borderWidth: 1,
          borderRadius: 17,
          padding: 4,
        }}
      >
        {actions}
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
        backgroundGradient: { from: background, to: backgroundEnd, orientation: 'TL_BR' },
        borderColor: border,
        borderWidth: 1,
        borderRadius: 21,
        padding: 7,
      }}
    >
      <FlexWidget style={{ width: 'match_parent', height: 42, flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
        <FlexWidget
          style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginRight: 7 }}
        >
          <SvgWidget svg={makeIcon('brand', dark ? '#142019' : '#FFFFFF')} style={{ width: 22, height: 22 }} />
        </FlexWidget>
        <FlexWidget style={{ flex: 1, height: 'match_parent', justifyContent: 'center' }}>
          <TextWidget text="Puptime" style={{ color: foreground, fontSize: 14, fontWeight: '800', letterSpacing: -0.2 }} />
          <TextWidget text={latestLabel} maxLines={1} truncate="END" style={{ color: muted, fontSize: 9 }} />
        </FlexWidget>
        <FlexWidget
          style={{ height: 34, flexDirection: 'row', alignItems: 'center', backgroundColor: primarySurface, borderColor: border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' }}
        >
          <FlexWidget
            clickAction="ADJUST_TIME"
            clickActionData={{ minutesAgo: normalizeBackdateMinutes(minutesAgo + 5) }}
            accessibilityLabel="Move logged time 5 minutes earlier"
            style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
          >
            <TextWidget text="−5" style={{ color: primary, fontSize: 11, fontWeight: '800' }} />
          </FlexWidget>
          <FlexWidget
            style={{ width: 52, height: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: dark ? '#172A21' : '#FFFFFF', borderColor: border, borderLeftWidth: 1, borderRightWidth: 1 }}
          >
            <TextWidget text={timeLabel} maxLines={1} style={{ color: foreground, fontSize: 10, fontWeight: '800', adjustsFontSizeToFit: true }} />
          </FlexWidget>
          <FlexWidget
            clickAction="ADJUST_TIME"
            clickActionData={{ minutesAgo: normalizeBackdateMinutes(minutesAgo - 5) }}
            accessibilityLabel="Move logged time 5 minutes later"
            style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
          >
            <TextWidget text="+5" style={{ color: primary, fontSize: 11, fontWeight: '800' }} />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
      {actions}
    </FlexWidget>
  );
}
