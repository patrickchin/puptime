import { Button, HStack, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import { normalizeBackdateMinutes, type EventType } from '../domain';

export type WidgetPendingEvent = { id: string; type: EventType; at: number };

export type PuptimeWidgetProps = {
  pending: WidgetPendingEvent[];
  latestLabel: string;
  backdateMinutes?: number;
};

const PuptimeWidgetView = (props: PuptimeWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const pending = props.pending ?? [];
  const latestLabel = props.latestLabel || 'Tap to log';
  const backdateMinutes = normalizeBackdateMinutes(props.backdateMinutes);
  const foreground = environment.colorScheme === 'dark' ? '#F2F6F3' : '#17231E';
  const add = (type: EventType, label: string): PuptimeWidgetProps => {
    const at = Date.now() - backdateMinutes * 60_000;
    return {
      latestLabel: `${label} saved${backdateMinutes ? ` · ${backdateMinutes}m ago` : ''}`,
      backdateMinutes: 0,
      // ponytail: bound widget props; move to a shared native DB if 100 unopened taps becomes realistic.
      pending: [...pending, { id: `${at}-${type}`, type, at }].slice(-100),
    };
  };
  const adjust = (delta: number): PuptimeWidgetProps => ({
    pending,
    latestLabel,
    backdateMinutes: normalizeBackdateMinutes(backdateMinutes + delta),
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
        <Button label="Nap" systemImage="moon.zzz.fill" target="nap" onPress={() => add('nap', 'Nap')} />
      </HStack>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(foreground)]}>{latestLabel}</Text>
    </VStack>
  );
};

export default createWidget<PuptimeWidgetProps>('PuptimeQuickLog', PuptimeWidgetView);
