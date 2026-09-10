import { Button, HStack, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { EventType } from '../domain';

export type WidgetPendingEvent = { id: string; type: EventType; at: number };

export type PuptimeWidgetProps = {
  pending: WidgetPendingEvent[];
  latestLabel: string;
};

const PuptimeWidgetView = (props: PuptimeWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const pending = props.pending ?? [];
  const latestLabel = props.latestLabel || 'Tap to log';
  const foreground = environment.colorScheme === 'dark' ? '#F2F6F3' : '#17231E';
  const add = (type: EventType, label: string): PuptimeWidgetProps => {
    const at = Date.now();
    return {
      latestLabel: `${label} saved`,
      pending: [...pending, { id: `${at}-${type}`, type, at }].slice(-100),
    };
  };

  return (
    <VStack spacing={6} modifiers={[padding({ all: 10 })]}>
      <Text modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(foreground)]}>Puptime</Text>
      <HStack spacing={6}>
        <Button label="Pee" systemImage="drop.fill" target="pee" onPress={() => add('pee', 'Pee')} />
        <Button label="Poop" systemImage="circle.hexagongrid.fill" target="poop" onPress={() => add('poop', 'Poop')} />
      </HStack>
      <HStack spacing={6}>
        <Button label="Ate" systemImage="fork.knife" target="meal" onPress={() => add('meal', 'Meal')} />
        <Button label="Nap" systemImage="moon.zzz.fill" target="nap" onPress={() => add('nap', 'Nap')} />
      </HStack>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(foreground)]}>{latestLabel}</Text>
    </VStack>
  );
};

export default createWidget<PuptimeWidgetProps>('PuptimeQuickLog', PuptimeWidgetView);
