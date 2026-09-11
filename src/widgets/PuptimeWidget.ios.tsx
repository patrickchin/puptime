import { Button, HStack, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
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
  const foreground = environment.colorScheme === 'dark' ? '#F2F6F3' : '#17231E';
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

  return (
    <VStack spacing={6} modifiers={[padding({ all: 10 })]}>
      <HStack spacing={6}>
        <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle(foreground)]}>Puptime</Text>
        <Button label="−5m" target="earlier" onPress={() => adjust(5)} />
        <Text modifiers={[font({ weight: 'semibold', size: 11 }), foregroundStyle(foreground)]}>
          {backdateMinutes ? `${backdateMinutes}m ago` : 'Now'}
        </Text>
        <Button label="+5m" target="later" onPress={() => adjust(-5)} />
      </HStack>
      <HStack spacing={5}>
        <Button label="Pee" systemImage="drop.fill" target="pee" onPress={() => add('pee', 'Pee')} />
        <Button label="Poop" systemImage="circle.hexagongrid.fill" target="poop" onPress={() => add('poop', 'Poop')} />
        <Button label="Ate" systemImage="fork.knife" target="meal" onPress={() => add('meal', 'Meal')} />
        <Button label="Out" systemImage="door.left.hand.open" target="pottyTrip" onPress={() => add('pottyTrip', 'Potty trip')} />
        <Button label="Walk" systemImage="figure.walk" target="walk" onPress={() => add('walk', 'Walk')} />
        <Button label={props.openNap ? 'End' : 'Nap'} systemImage={props.openNap ? 'stop.fill' : 'moon.zzz.fill'} target="nap" onPress={() => add('nap', 'Nap')} />
      </HStack>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(foreground)]}>{latestLabel}</Text>
    </VStack>
  );
};

export default createWidget<PuptimeWidgetProps>('PuptimeQuickLog', PuptimeWidgetView);
