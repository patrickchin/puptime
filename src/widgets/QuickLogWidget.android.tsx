'use no memo';

import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { normalizeBackdateMinutes, type QuickEventType } from '../domain';

const buttons = [
  { type: 'pee', label: 'Pee', light: '#DDF4E9', dark: '#284A3D' },
  { type: 'poop', label: 'Poop', light: '#F6E8D8', dark: '#513923' },
  { type: 'meal', label: 'Ate', light: '#FBE5E2', dark: '#53302D' },
  { type: 'pottyTrip', label: 'Out', light: '#DFEFF8', dark: '#243E50' },
  { type: 'walk', label: 'Walk', light: '#F3F0D2', dark: '#45431F' },
  { type: 'nap', label: 'Nap', light: '#E8E7FA', dark: '#34355C' },
] as const satisfies readonly {
  type: QuickEventType;
  label: string;
  light: `#${string}`;
  dark: `#${string}`;
}[];

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
  const foreground = dark ? '#F2F6F3' : '#17231E';
  const muted = dark ? '#B9C5BE' : '#56635D';
  const control = dark ? '#253E33' : '#DDEFE7';
  const minutesAgo = normalizeBackdateMinutes(backdateMinutes);
  const timeLabel = minutesAgo ? `${minutesAgo}m ago` : 'Now';
  const visibleButtons = compact ? buttons.filter((button) => ['pee', 'poop', 'meal', 'nap'].includes(button.type)) : buttons;
  const actions = (
    <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row' }}>
      {visibleButtons.map((button, index) => {
        const label = button.type === 'nap' && activeNap ? (compact ? 'Wake' : 'End nap') : button.label;
        return (
        <FlexWidget
          key={button.type}
          clickAction="LOG_EVENT"
          clickActionData={{ type: button.type, minutesAgo }}
          accessibilityLabel={`${button.type === 'nap' && activeNap ? 'End nap' : `Log ${button.label.toLowerCase()}`} ${minutesAgo ? `${minutesAgo} minutes ago` : 'now'}`}
          style={{
            flex: 1,
            height: 'match_parent',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: dark ? button.dark : button.light,
            borderRadius: compact ? 11 : 14,
            marginRight: index < visibleButtons.length - 1 ? (compact ? 4 : 5) : 0,
          }}
        >
          <TextWidget text={label} style={{ color: foreground, fontSize: compact ? 12 : 10, fontWeight: '700' }} />
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
          borderRadius: 16,
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
        borderRadius: 20,
        padding: 6,
      }}
    >
      <FlexWidget style={{ width: 'match_parent', height: 44, flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <FlexWidget style={{ flex: 1, height: 'match_parent', justifyContent: 'center' }}>
          <TextWidget text="Puptime" style={{ color: foreground, fontSize: 14, fontWeight: '700' }} />
          <TextWidget text={latestLabel} style={{ color: muted, fontSize: 9 }} />
        </FlexWidget>
        <FlexWidget
          clickAction="ADJUST_TIME"
          clickActionData={{ minutesAgo: normalizeBackdateMinutes(minutesAgo + 5) }}
          accessibilityLabel="Move logged time 5 minutes earlier"
          style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: control, alignItems: 'center', justifyContent: 'center' }}
        >
          <TextWidget text="−5" style={{ color: foreground, fontSize: 12, fontWeight: '700' }} />
        </FlexWidget>
        <FlexWidget style={{ width: 52, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <TextWidget text={timeLabel} style={{ color: foreground, fontSize: 11, fontWeight: '700' }} />
        </FlexWidget>
        <FlexWidget
          clickAction="ADJUST_TIME"
          clickActionData={{ minutesAgo: normalizeBackdateMinutes(minutesAgo - 5) }}
          accessibilityLabel="Move logged time 5 minutes later"
          style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: control, alignItems: 'center', justifyContent: 'center' }}
        >
          <TextWidget text="+5" style={{ color: foreground, fontSize: 12, fontWeight: '700' }} />
        </FlexWidget>
      </FlexWidget>
      {actions}
    </FlexWidget>
  );
}
