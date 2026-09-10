'use no memo';

import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { EventType } from '../domain';

const buttons = [
  { type: 'pee', label: 'Pee', light: '#DDF4E9', dark: '#284A3D' },
  { type: 'poop', label: 'Poop', light: '#F6E8D8', dark: '#513923' },
  { type: 'meal', label: 'Ate', light: '#FBE5E2', dark: '#53302D' },
  { type: 'nap', label: 'Nap', light: '#E8E7FA', dark: '#34355C' },
] as const satisfies readonly {
  type: EventType;
  label: string;
  light: `#${string}`;
  dark: `#${string}`;
}[];

export function QuickLogWidget({ latestLabel = 'Tap to log', dark = false }: { latestLabel?: string; dark?: boolean }) {
  const background = dark ? '#17211C' : '#FFFEFA';
  const foreground = dark ? '#F2F6F3' : '#17231E';
  const muted = dark ? '#B9C5BE' : '#56635D';

  return (
    <FlexWidget
      accessibilityLabel="Puptime quick log widget"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: background,
        borderRadius: 20,
        padding: 12,
      }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <TextWidget text="Puptime" style={{ color: foreground, fontSize: 16, fontWeight: '700' }} />
        <TextWidget text={latestLabel} style={{ color: muted, fontSize: 11, marginLeft: 10 }} />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row' }}>
        {buttons.map((button, index) => (
          <FlexWidget
            key={button.type}
            clickAction="LOG_EVENT"
            clickActionData={{ type: button.type }}
            accessibilityLabel={`Log ${button.label.toLowerCase()}`}
            style={{
              flex: 1,
              height: 'match_parent',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: dark ? button.dark : button.light,
              borderRadius: 14,
              marginRight: index < buttons.length - 1 ? 6 : 0,
            }}
          >
            <TextWidget text={button.label} style={{ color: foreground, fontSize: 14, fontWeight: '700' }} />
          </FlexWidget>
        ))}
      </FlexWidget>
    </FlexWidget>
  );
}
