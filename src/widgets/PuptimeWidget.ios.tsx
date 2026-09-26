import { Button, HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  buttonBorderShape,
  buttonStyle,
  containerBackground,
  font,
  frame,
  foregroundStyle,
  lineLimit,
  minimumScaleFactor,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { QuickEventTimes, ActivityKey, QuickEventType } from '../domain';

export type WidgetPendingEvent = { id: string; type: QuickEventType | 'custom'; customLabel?: string; at: number; endedAt?: number };

export type PuptimeWidgetProps = {
  pending: WidgetPendingEvent[];
  // iOS UserDefaults rejects null inside widget snapshots.
  openNap?: WidgetPendingEvent | false;
  lastEventAt?: QuickEventTimes;
  actions?: ActivityKey[];
  actionDetails?: Record<string, { label: string; lightColor: string; darkColor: string }>;
  appearance?: {
    light: { background: string; surface: string; controlRadius: number };
    dark: { background: string; surface: string; controlRadius: number };
  };
  lastAction?: ActivityKey;
  notificationConfirmations?: boolean;
  pottyAfterPeeMinutes?: number;
  pottyAfterMealMinutes?: number;
  language?: 'en' | 'zh-Hans' | 'es';
};

const PuptimeWidgetView = (props: PuptimeWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const pending = props.pending ?? [];
  const configuredActions = props.actions ?? ['pee', 'poop', 'meal'];
  const visibleActions = props.openNap && !configuredActions.includes('nap')
    ? [...configuredActions.slice(0, 3), 'nap' as const]
    : configuredActions;
  const appearance = props.appearance?.[environment.colorScheme === 'dark' ? 'dark' : 'light']
    ?? { background: '#F5F3EC', surface: '#FFFEFA', controlRadius: 16 };
  const background = { type: 'linearGradient' as const, colors: [appearance.background, appearance.surface], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } };
  const savedLabel = props.language === 'zh-Hans' ? '已记录' : props.language === 'es' ? 'Guardado' : 'Saved';
  const add = (type: ActivityKey): PuptimeWidgetProps => {
    const at = Date.now();
    const customLabel = type.startsWith('custom:') ? props.actionDetails?.[type]?.label ?? type.slice(7) : undefined;
    if (type === 'nap' && props.openNap) {
      const completed = { ...props.openNap, endedAt: Math.max(props.openNap.at, at) };
      return {
        openNap: false,
        lastEventAt: { ...props.lastEventAt, nap: at },
        actions: configuredActions,
        actionDetails: props.actionDetails,
        appearance: props.appearance,
        lastAction: type,
        notificationConfirmations: props.notificationConfirmations,
        pottyAfterPeeMinutes: props.pottyAfterPeeMinutes,
        pottyAfterMealMinutes: props.pottyAfterMealMinutes,
        language: props.language,
        pending: [...pending.filter((event) => event.id !== completed.id), completed].slice(-100),
      };
    }
    const event = {
      id: `${at}-${type}`,
      type: type.startsWith('custom:') ? 'custom' as const : type as QuickEventType,
      ...(customLabel ? { customLabel } : {}),
      at,
    };
    return {
      openNap: type === 'nap' ? event : props.openNap ?? false,
      lastEventAt: { ...props.lastEventAt, [type]: at },
      actions: configuredActions,
      actionDetails: props.actionDetails,
      appearance: props.appearance,
      lastAction: type,
      notificationConfirmations: props.notificationConfirmations,
      pottyAfterPeeMinutes: props.pottyAfterPeeMinutes,
      pottyAfterMealMinutes: props.pottyAfterMealMinutes,
      language: props.language,
      // ponytail: bound widget props; move to a shared native DB if 100 unopened taps becomes realistic.
      pending: [...pending, event].slice(-100),
    };
  };
  const actionModifiers = (color: string) => [
    buttonStyle('bordered' as const),
    buttonBorderShape('roundedRectangle' as const, appearance.controlRadius),
    tint(color),
    frame({ minWidth: 44, maxWidth: 999, minHeight: 96, maxHeight: 999 }),
  ];

  return (
    <HStack
      spacing={7}
      modifiers={[padding({ all: 9 }), frame({ maxHeight: 999 }), containerBackground(background, 'widget')]}
    >
      {visibleActions.map((type) => {
        const detail = props.actionDetails?.[type] ?? { label: type, lightColor: '#176B52', darkColor: '#73D3AD' };
        const isEndingNap = type === 'nap' && Boolean(props.openNap);
        const confirmed = pending.length > 0 && props.lastAction === type;
        const color = environment.colorScheme === 'dark' ? detail.darkColor : detail.lightColor;
        const lastAt = props.lastEventAt?.[type];
        const systemImage = confirmed
          ? 'checkmark.circle.fill'
          : type === 'pee'
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
                  : type.startsWith('custom:') ? 'tag.fill' : 'moon.zzz.fill';
        return (
          <Button
            key={type}
            target={`log|${encodeURIComponent(type)}|${props.notificationConfirmations ? '1' : '0'}|${props.language ?? 'en'}|${props.pottyAfterPeeMinutes ?? 0}|${props.pottyAfterMealMinutes ?? 0}|${encodeURIComponent(type.startsWith('custom:') ? detail.label : '')}`}
            onPress={() => add(type)}
            modifiers={actionModifiers(color)}
          >
            <VStack spacing={4} modifiers={[padding({ vertical: 8, horizontal: 3 }), frame({ maxWidth: 999, maxHeight: 999 })]}>
              <Image
                systemName={systemImage}
                modifiers={[
                  font({ textStyle: 'title2', weight: 'semibold' }),
                  foregroundStyle(color),
                  accessibilityHidden(true),
                ]}
              />
              <Text modifiers={[
                font({ textStyle: 'subheadline', weight: 'bold', design: 'rounded' }),
                foregroundStyle(color),
                lineLimit(1),
                minimumScaleFactor(0.72),
              ]}>
                {confirmed ? savedLabel : isEndingNap ? 'End' : detail.label}
              </Text>
              {lastAt === undefined ? (
                <Text modifiers={[
                  font({ textStyle: 'caption', weight: 'medium' }),
                  foregroundStyle(color),
                  lineLimit(1),
                ]}>Never</Text>
              ) : (
                <Text
                  date={new Date(lastAt)}
                  dateStyle="relative"
                  modifiers={[
                    font({ textStyle: 'caption', weight: 'medium' }),
                    foregroundStyle(color),
                    lineLimit(1),
                    minimumScaleFactor(0.72),
                  ]}
                />
              )}
            </VStack>
          </Button>
        );
      })}
    </HStack>
  );
};

export default createWidget<PuptimeWidgetProps>('PuptimeQuickLog', PuptimeWidgetView);
