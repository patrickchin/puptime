import { Button, HStack } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  containerBackground,
  controlSize,
  frame,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import {
  EVENT_META,
  normalizeWidgetActions,
  widgetActionsForState,
  type QuickEventType,
} from '../domain';
import { resolveTheme, type ThemePreference } from '../theme';

export type WidgetPendingEvent = { id: string; type: QuickEventType; at: number; endedAt?: number | null };

export type PuptimeWidgetProps = {
  pending: WidgetPendingEvent[];
  openNap?: WidgetPendingEvent | null;
  actions?: QuickEventType[];
  themePreference?: ThemePreference;
  notificationConfirmations?: boolean;
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
        actions: configuredActions,
        themePreference: props.themePreference,
        notificationConfirmations: props.notificationConfirmations,
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
      actions: configuredActions,
      themePreference: props.themePreference,
      notificationConfirmations: props.notificationConfirmations,
      language: props.language,
      // ponytail: bound widget props; move to a shared native DB if 100 unopened taps becomes realistic.
      pending: [...pending, event].slice(-100),
    };
  };
  const actionModifiers = (color: string) => [
    buttonStyle('bordered' as const),
    buttonBorderShape('roundedRectangle' as const, theme.presentation.controlRadius),
    controlSize('small' as const),
    tint(color),
    frame({ width: 46, minHeight: 60, maxHeight: 999 }),
  ];

  return (
    <HStack spacing={5} modifiers={[padding({ all: 8 }), frame({ maxHeight: 999 }), containerBackground(background, 'widget')]}>
      {visibleActions.map((type) => {
        const meta = EVENT_META[type];
        const isEndingNap = type === 'nap' && Boolean(props.openNap);
        const confirmed = pending[pending.length - 1]?.type === type;
        const color = theme.isDark ? meta.darkColor : meta.color;
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
            label={confirmed ? savedLabel : isEndingNap ? 'End' : meta.label}
            systemImage={systemImage}
            target={`log|${type}|${props.notificationConfirmations ? '1' : '0'}|${props.language ?? 'en'}`}
            onPress={() => add(type)}
            modifiers={actionModifiers(color)}
          />
        );
      })}
    </HStack>
  );
};

export default createWidget<PuptimeWidgetProps>('PuptimeQuickLog', PuptimeWidgetView);
