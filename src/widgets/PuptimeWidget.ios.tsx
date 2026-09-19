import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  containerBackground,
  controlSize,
  font,
  foregroundStyle,
  frame,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import {
  EVENT_META,
  normalizeBackdateMinutes,
  normalizeWidgetActions,
  widgetActionsForState,
  type QuickEventType,
} from '../domain';

export type WidgetPendingEvent = { id: string; type: QuickEventType; at: number; endedAt?: number | null };

export type PuptimeWidgetProps = {
  pending: WidgetPendingEvent[];
  backdateMinutes?: number;
  openNap?: WidgetPendingEvent | null;
  actions?: QuickEventType[];
};

const PuptimeWidgetView = (props: PuptimeWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const pending = props.pending ?? [];
  const backdateMinutes = normalizeBackdateMinutes(props.backdateMinutes);
  const configuredActions = normalizeWidgetActions(props.actions);
  const visibleActions = widgetActionsForState(configuredActions, Boolean(props.openNap));
  const dark = environment.colorScheme === 'dark';
  const foreground = dark ? '#F2F6F3' : '#17231E';
  const primary = dark ? '#73D3AD' : '#176B52';
  const background = dark
    ? { type: 'linearGradient' as const, colors: ['rgba(26, 40, 33, 0.92)', 'rgba(17, 26, 21, 0.86)'], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } }
    : { type: 'linearGradient' as const, colors: ['rgba(255, 254, 250, 0.92)', 'rgba(237, 244, 239, 0.86)'], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } };
  const add = (type: QuickEventType): PuptimeWidgetProps => {
    const at = Date.now() - backdateMinutes * 60_000;
    if (type === 'nap' && props.openNap) {
      const completed = { ...props.openNap, endedAt: Math.max(props.openNap.at, at) };
      return {
        backdateMinutes: 0,
        openNap: null,
        actions: configuredActions,
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
      backdateMinutes: 0,
      openNap: type === 'nap' ? event : props.openNap,
      actions: configuredActions,
      // ponytail: bound widget props; move to a shared native DB if 100 unopened taps becomes realistic.
      pending: [...pending, event].slice(-100),
    };
  };
  const adjust = (delta: number): PuptimeWidgetProps => ({
    pending,
    backdateMinutes: normalizeBackdateMinutes(backdateMinutes + delta),
    openNap: props.openNap,
    actions: configuredActions,
  });

  const actionModifiers = (color: string) => [
    buttonStyle('bordered' as const),
    buttonBorderShape('roundedRectangle' as const, 11),
    controlSize('small' as const),
    tint(color),
    frame({ width: 46, height: 60 }),
  ];

  return (
    <VStack spacing={6} modifiers={[padding({ all: 8 }), containerBackground(background, 'widget')]}>
      <HStack spacing={7}>
        <Image systemName="pawprint.fill" size={22} color={primary} />
        <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle(foreground)]}>Puptime</Text>
        <Spacer minLength={3} />
        <Button
          label="−15"
          target="earlier"
          onPress={() => adjust(15)}
          modifiers={[buttonStyle('bordered'), buttonBorderShape('roundedRectangle', 10), controlSize('small'), tint(primary)]}
        />
        <Text modifiers={[font({ weight: 'bold', size: 10 }), foregroundStyle(foreground), frame({ minWidth: 38 })]}>
          {backdateMinutes ? `${backdateMinutes}m` : 'Now'}
        </Text>
        <Button
          label="+15"
          target="later"
          onPress={() => adjust(-15)}
          modifiers={[buttonStyle('bordered'), buttonBorderShape('roundedRectangle', 10), controlSize('small'), tint(primary)]}
        />
      </HStack>
      <HStack spacing={5}>
        {visibleActions.map((type) => {
          const meta = EVENT_META[type];
          const isEndingNap = type === 'nap' && Boolean(props.openNap);
          const color = dark ? meta.darkColor : meta.color;
          const systemImage = type === 'pee'
            ? 'drop.fill'
            : type === 'poop'
              ? 'circle.hexagongrid.fill'
              : type === 'meal'
                ? 'fork.knife'
                : type === 'pottyTrip'
                  ? 'door.left.hand.open'
                  : type === 'walk'
                    ? 'figure.walk'
                    : isEndingNap
                      ? 'stop.fill'
                      : 'moon.zzz.fill';
          return (
            <Button
              key={type}
              label={isEndingNap ? 'End' : meta.label}
              systemImage={systemImage}
              target={type}
              onPress={() => add(type)}
              modifiers={actionModifiers(color)}
            />
          );
        })}
      </HStack>
    </VStack>
  );
};

export default createWidget<PuptimeWidgetProps>('PuptimeQuickLog', PuptimeWidgetView);
