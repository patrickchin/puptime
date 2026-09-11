import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  containerBackground,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import { normalizeBackdateMinutes, type QuickEventType } from '../domain';

export type WidgetPendingEvent = { id: string; type: QuickEventType; at: number; endedAt?: number | null };

export type PuptimeWidgetProps = {
  pending: WidgetPendingEvent[];
  latestLabel: string;
  backdateMinutes?: number;
  openNap?: WidgetPendingEvent | null;
};

const PuptimeWidgetView = (props: PuptimeWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const pending = props.pending ?? [];
  const latestLabel = props.latestLabel || 'Tap to log';
  const backdateMinutes = normalizeBackdateMinutes(props.backdateMinutes);
  const dark = environment.colorScheme === 'dark';
  const foreground = dark ? '#F2F6F3' : '#17231E';
  const muted = dark ? '#B9C5BE' : '#56635D';
  const primary = dark ? '#73D3AD' : '#176B52';
  const background = dark
    ? { type: 'linearGradient' as const, colors: ['#1A2821', '#111A15'], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } }
    : { type: 'linearGradient' as const, colors: ['#FFFEFA', '#EDF4EF'], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } };
  const actionTints = {
    pee: dark ? '#92E3C2' : '#176B52',
    poop: dark ? '#F2C48F' : '#865425',
    meal: dark ? '#F5B5AE' : '#A34840',
    pottyTrip: dark ? '#A6D7F3' : '#286A91',
    walk: dark ? '#E7DF82' : '#716B18',
    nap: props.openNap ? (dark ? '#E0D8FF' : '#4C3D92') : dark ? '#C8C3F3' : '#6156A5',
  };
  const add = (type: QuickEventType, label: string): PuptimeWidgetProps => {
    const at = Date.now() - backdateMinutes * 60_000;
    if (type === 'nap' && props.openNap) {
      const completed = { ...props.openNap, endedAt: Math.max(props.openNap.at, at) };
      return {
        latestLabel: `Nap ended${backdateMinutes ? ` · ${backdateMinutes}m ago` : ''}`,
        backdateMinutes: 0,
        openNap: null,
        pending: [...pending.filter((event) => event.id !== completed.id), completed].slice(-100),
      };
    }
    const event = {
      id: `${at}-${type}`,
      type,
      at,
      ...(type === 'nap' ? { endedAt: null } : {}),
    };
    return {
      latestLabel: `${type === 'nap' ? 'Nap started' : `${label} saved`}${backdateMinutes ? ` · ${backdateMinutes}m ago` : ''}`,
      backdateMinutes: 0,
      openNap: type === 'nap' ? event : props.openNap,
      // ponytail: bound widget props; move to a shared native DB if 100 unopened taps becomes realistic.
      pending: [...pending, event].slice(-100),
    };
  };
  const adjust = (delta: number): PuptimeWidgetProps => ({
    pending,
    latestLabel,
    backdateMinutes: normalizeBackdateMinutes(backdateMinutes + delta),
    openNap: props.openNap,
  });

  const actionModifiers = (color: string) => [
    buttonStyle('bordered' as const),
    buttonBorderShape('roundedRectangle' as const, 11),
    controlSize('small' as const),
    tint(color),
    frame({ width: 46, height: 46 }),
  ];

  return (
    <VStack spacing={7} modifiers={[padding({ all: 10 }), containerBackground(background, 'widget')]}>
      <HStack spacing={7}>
        <Image systemName="pawprint.fill" size={22} color={primary} />
        <VStack spacing={0}>
          <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle(foreground)]}>Puptime</Text>
          <Text modifiers={[font({ size: 9 }), foregroundStyle(muted), lineLimit(1)]}>{latestLabel}</Text>
        </VStack>
        <Spacer minLength={3} />
        <Button
          label="−5"
          target="earlier"
          onPress={() => adjust(5)}
          modifiers={[buttonStyle('bordered'), buttonBorderShape('roundedRectangle', 10), controlSize('small'), tint(primary)]}
        />
        <Text modifiers={[font({ weight: 'bold', size: 10 }), foregroundStyle(foreground), frame({ minWidth: 38 })]}>
          {backdateMinutes ? `${backdateMinutes}m` : 'Now'}
        </Text>
        <Button
          label="+5"
          target="later"
          onPress={() => adjust(-5)}
          modifiers={[buttonStyle('bordered'), buttonBorderShape('roundedRectangle', 10), controlSize('small'), tint(primary)]}
        />
      </HStack>
      <HStack spacing={5}>
        <Button label="Pee" systemImage="drop.fill" target="pee" onPress={() => add('pee', 'Pee')} modifiers={actionModifiers(actionTints.pee)} />
        <Button label="Poop" systemImage="circle.hexagongrid.fill" target="poop" onPress={() => add('poop', 'Poop')} modifiers={actionModifiers(actionTints.poop)} />
        <Button label="Ate" systemImage="fork.knife" target="meal" onPress={() => add('meal', 'Meal')} modifiers={actionModifiers(actionTints.meal)} />
        <Button label="Out" systemImage="door.left.hand.open" target="pottyTrip" onPress={() => add('pottyTrip', 'Potty trip')} modifiers={actionModifiers(actionTints.pottyTrip)} />
        <Button label="Walk" systemImage="figure.walk" target="walk" onPress={() => add('walk', 'Walk')} modifiers={actionModifiers(actionTints.walk)} />
        <Button
          label={props.openNap ? 'End' : 'Nap'}
          systemImage={props.openNap ? 'stop.fill' : 'moon.zzz.fill'}
          target="nap"
          onPress={() => add('nap', 'Nap')}
          modifiers={actionModifiers(actionTints.nap)}
        />
      </HStack>
    </VStack>
  );
};

export default createWidget<PuptimeWidgetProps>('PuptimeQuickLog', PuptimeWidgetView);
