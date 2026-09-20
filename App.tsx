import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Appearance, AppState, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, type Tab } from './src/components/BottomNav';
import { ThemePicker } from './src/components/ThemePicker';
import { Toast } from './src/components/Toast';
import type { MissingLogEstimate } from './src/analytics';
import { LocalizationProvider } from './src/localization-context';
import {
  localizedEventPastLabel,
  resolveLanguage,
  translate,
  type LanguagePreference,
} from './src/localization';
import {
  createEvent,
  createNapEvent,
  DEFAULT_WIDGET_ACTIONS,
  isOpenNap,
  normalizeCustomLabel,
  normalizeEventTypeChange,
  normalizeNote,
  type QuickEventType,
  type EventType,
  type PuppyEvent,
  type PuppyEventChanges,
  type ScheduleEntry,
} from './src/domain';
import { InsightsScreen } from './src/screens/InsightsScreen';
import { LogScreen } from './src/screens/LogScreen';
import { ScheduleScreen } from './src/screens/ScheduleScreen';
import { TimelineScreen } from './src/screens/TimelineScreen';
import { configureReminderHandling, requestReminderPermission, syncScheduleReminders } from './src/reminders';
import {
  appendEvents,
  loadEvents,
  loadLanguagePreference,
  loadSchedule,
  loadThemePreference,
  loadWidgetActions,
  removeEvent,
  saveSchedule,
  saveLanguagePreference,
  saveThemePreference,
  saveWidgetActions,
  updateEvent,
} from './src/storage';
import { resolveTheme, type ThemePreference } from './src/theme';
import { readPendingWidgetEvents, updateHomeWidget } from './src/widgets/sync';

configureReminderHandling();

export default function App() {
  const colorScheme = useColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>('system');
  const [themePickerVisible, setThemePickerVisible] = useState(false);
  const theme = resolveTheme(themePreference, colorScheme);
  const language = resolveLanguage(languagePreference);
  const [tab, setTab] = useState<Tab>('log');
  const [events, setEvents] = useState<PuppyEvent[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [widgetActions, setWidgetActions] = useState<QuickEventType[]>([...DEFAULT_WIDGET_ACTIONS]);
  const [undoState, setUndoState] = useState<{ event: PuppyEvent; message: string; restore?: PuppyEvent } | null>(null);
  const [editEventId, setEditEventId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const pending = await readPendingWidgetEvents();
    const nextEvents = pending.length ? await appendEvents(pending) : await loadEvents();
    setEvents(nextEvents);
    const nextSchedule = await loadSchedule();
    setSchedule(nextSchedule);
    setWidgetActions(await loadWidgetActions());
    await syncScheduleReminders(nextSchedule).catch(() => undefined);
    await updateHomeWidget(nextEvents).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    loadThemePreference().then(setThemePreference).catch(() => undefined);
    loadLanguagePreference().then(setLanguagePreference).catch(() => undefined);
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(themePreference === 'system' ? 'unspecified' : theme.isDark ? 'dark' : 'light');
  }, [theme.isDark, themePreference]);

  useEffect(() => {
    if (!undoState) return;
    const timer = setTimeout(() => setUndoState(null), 4_500);
    return () => clearTimeout(timer);
  }, [undoState]);

  const logEvent = async (type: EventType, customLabel?: string) => {
    const now = Date.now();
    if (type === 'nap') {
      const openNap = (await loadEvents()).find(isOpenNap);
      if (openNap) {
        const event = { ...openNap, endedAt: Math.max(openNap.at, now) };
        const nextEvents = await updateEvent(openNap.id, { endedAt: event.endedAt });
        setEvents(nextEvents);
        setUndoState({ event, restore: openNap, message: translate(language, 'app.napEnded') });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        updateHomeWidget(nextEvents).catch(() => undefined);
        return;
      }
    }

    const event = type === 'nap' ? createNapEvent('app', now) : createEvent(type, 'app', now, customLabel);
    const nextEvents = await appendEvents([event]);
    setEvents(nextEvents);
    setUndoState({
      event,
      message: type === 'nap'
        ? translate(language, 'app.napStarted')
        : translate(language, 'app.logged', { activity: localizedEventPastLabel(language, event) }),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const addEstimatedEvent = async (estimate: MissingLogEstimate) => {
    const event: PuppyEvent = {
      ...createEvent(estimate.type, 'app', estimate.at),
      ...(estimate.endedAt === undefined ? {} : { endedAt: estimate.endedAt }),
    };
    const nextEvents = await appendEvents([event]);
    setEvents(nextEvents);
    setUndoState({
      event,
      message: translate(language, 'app.estimateAdded', {
        activity: localizedEventPastLabel(language, event),
      }),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const confirmDelete = (event: PuppyEvent) => {
    Alert.alert(translate(language, 'app.deleteTitle'), translate(language, 'app.deleteMessage', {
      activity: localizedEventPastLabel(language, event),
      time: new Date(event.at).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' }),
    }), [
      { text: translate(language, 'app.cancel'), style: 'cancel' },
      {
        text: translate(language, 'app.delete'),
        style: 'destructive',
        onPress: async () => {
          const nextEvents = await removeEvent(event.id);
          setEvents(nextEvents);
          updateHomeWidget(nextEvents).catch(() => undefined);
        },
      },
    ]);
  };

  const saveEventDetails = async (
    event: PuppyEvent,
    changes: PuppyEventChanges,
  ) => {
    const type = normalizeEventTypeChange(event, changes.type ?? event.type);
    const nextEvents = await updateEvent(event.id, {
      ...changes,
      type,
      endedAt: type === 'nap' ? changes.endedAt : undefined,
      customLabel: type === 'custom' ? normalizeCustomLabel(changes.customLabel) : undefined,
      note: normalizeNote(changes.note),
    });
    setEvents(nextEvents);
    Haptics.selectionAsync().catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const undo = async () => {
    if (!undoState) return;
    const nextEvents = undoState.restore
      ? await appendEvents([undoState.restore])
      : await removeEvent(undoState.event.id);
    setEvents(nextEvents);
    setUndoState(null);
    Haptics.selectionAsync().catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const changeSchedule = async (nextSchedule: ScheduleEntry[]) => {
    await saveSchedule(nextSchedule);
    setSchedule(nextSchedule);
    try {
      const synced = await syncScheduleReminders(nextSchedule);
      if (!synced && nextSchedule.some((entry) => entry.reminder)) {
        Alert.alert(translate(language, 'app.routineSaved'), translate(language, 'app.notificationsOff'));
      }
    } catch {
      Alert.alert(translate(language, 'app.routineSaved'), translate(language, 'app.reminderError'));
    }
  };

  const chooseTheme = (preference: ThemePreference) => {
    setThemePreference(preference);
    setThemePickerVisible(false);
    Haptics.selectionAsync().catch(() => undefined);
    saveThemePreference(preference)
      .then(() => updateHomeWidget(events))
      .catch(() => undefined);
  };

  const chooseLanguage = (preference: LanguagePreference) => {
    setLanguagePreference(preference);
    Haptics.selectionAsync().catch(() => undefined);
    saveLanguagePreference(preference).catch(() => undefined);
  };

  const changeWidgetActions = useCallback(async (nextActions: QuickEventType[]) => {
    await saveWidgetActions(nextActions);
    setWidgetActions(nextActions);
    await updateHomeWidget(events).catch(() => undefined);
  }, [events]);

  const screen = useMemo(() => {
    if (tab === 'timeline') return <TimelineScreen events={events} theme={theme} />;
    if (tab === 'insights') return <InsightsScreen events={events} onAddEstimate={addEstimatedEvent} theme={theme} />;
    if (tab === 'schedule') {
      return (
        <ScheduleScreen
          events={events}
          schedule={schedule}
          onChange={changeSchedule}
          onRequestReminderPermission={requestReminderPermission}
          theme={theme}
        />
      );
    }
    return (
      <LogScreen
        events={events}
        schedule={schedule}
        editEventId={editEventId}
        onEditRequestHandled={() => setEditEventId(null)}
        onLog={logEvent}
        onSave={saveEventDetails}
        onDelete={confirmDelete}
        onOpenSchedule={() => setTab('schedule')}
        onOpenThemePicker={() => setThemePickerVisible(true)}
        widgetActions={widgetActions}
        onWidgetActionsChange={changeWidgetActions}
        theme={theme}
      />
    );
  }, [changeWidgetActions, editEventId, events, language, schedule, tab, theme, widgetActions]);

  return (
    <SafeAreaProvider>
      <LocalizationProvider language={language} voice={theme.presentation.voice}>
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
          <View style={styles.screen}>
            {screen}
            {undoState ? (
              <Toast
                message={undoState.message}
                onNote={() => {
                  setTab('log');
                  setEditEventId(undoState.event.id);
                  setUndoState(null);
                }}
                onUndo={undo}
                theme={theme}
              />
            ) : null}
          </View>
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.nav }}>
            <BottomNav tab={tab} onChange={setTab} theme={theme} />
          </SafeAreaView>
          <ThemePicker
            visible={themePickerVisible}
            selected={themePreference}
            selectedLanguage={languagePreference}
            colorScheme={colorScheme}
            theme={theme}
            onSelect={chooseTheme}
            onSelectLanguage={chooseLanguage}
            onClose={() => setThemePickerVisible(false)}
          />
        </SafeAreaView>
      </LocalizationProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
});
