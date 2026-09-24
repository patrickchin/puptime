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

import {
  EVENT_META,
  normalizeWidgetActions,
  widgetActionsForState,
  type QuickEventTimes,
  type QuickEventType,
} from '../domain';
import { resolveTheme, type ThemePreference } from '../theme';

export type WidgetPendingEvent = { id: string; type: QuickEventType; at: number; endedAt?: number | null };

export type PuptimeWidgetProps = {
  pending: WidgetPendingEvent[];
  openNap?: WidgetPendingEvent | null;
  lastEventAt?: QuickEventTimes;
  actions?: QuickEventType[];
  themePreference?: ThemePreference;
  notificationConfirmations?: boolean;
  pottyAfterPeeMinutes?: number;
  pottyAfterMealMinutes?: number;
  language?: 'en' | 'zh-Hans' | 'es';
};

const PuptimeWidgetView = (props: PuptimeWidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const pending = props.pending ?? [];
  const configuredActions = normalizeWidgetActions(props.actions);
  const visibleActions = widgetActionsForState(configuredActions, Boolean(props.openNap));
  const theme = resolveTheme(props.themePreference ?? 'system', environment.colorScheme);
  const background = { type: 'linearGradient' as const, colors: [theme.background, theme.surface], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } };
  const savedLabel = props.language === 'zh-Hans' ? '已记录' : props.language === 'es' ? 'Guardado' : 'Saved';
  const add = (type: QuickEventType): PuptimeWidgetProps => {
    const at = Date.now();
    if (type === 'nap' && props.openNap) {
      const completed = { ...props.openNap, endedAt: Math.max(props.openNap.at, at) };
      return {
        openNap: null,
        lastEventAt: { ...props.lastEventAt, nap: at },
        actions: configuredActions,
        themePreference: props.themePreference,
        notificationConfirmations: props.notificationConfirmations,
        pottyAfterPeeMinutes: props.pottyAfterPeeMinutes,
        pottyAfterMealMinutes: props.pottyAfterMealMinutes,
        language: props.language,
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
      openNap: type === 'nap' ? event : props.openNap,
      lastEventAt: { ...props.lastEventAt, [type]: at },
      actions: configuredActions,
      themePreference: props.themePreference,
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
    buttonBorderShape('roundedRectangle' as const, theme.presentation.controlRadius),
    tint(color),
    frame({ minWidth: 44, maxWidth: 999, minHeight: 96, maxHeight: 999 }),
  ];

  return (
    <HStack
      spacing={7}
      modifiers={[padding({ all: 9 }), frame({ maxHeight: 999 }), containerBackground(background, 'widget')]}
    >
      {visibleActions.map((type) => {
        const meta = EVENT_META[type];
        const isEndingNap = type === 'nap' && Boolean(props.openNap);
        const confirmed = pending[pending.length - 1]?.type === type;
        const color = theme.isDark ? meta.darkColor : meta.color;
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
                    : 'moon.zzz.fill';
        return (
          <Button
            key={type}
            target={`log|${type}|${props.notificationConfirmations ? '1' : '0'}|${props.language ?? 'en'}|${props.pottyAfterPeeMinutes ?? 0}|${props.pottyAfterMealMinutes ?? 0}`}
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
                {confirmed ? savedLabel : isEndingNap ? 'End' : meta.label}
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
