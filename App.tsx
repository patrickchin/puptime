import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Appearance, AppState, BackHandler, Linking, StyleSheet, useColorScheme, View } from 'react-native';
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
  isQuickEventType,
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
import { LogScreen, type LogEditRequest } from './src/screens/LogScreen';
import { ScheduleScreen } from './src/screens/ScheduleScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TimelineScreen } from './src/screens/TimelineScreen';
import {
  ADD_NOTE_ACTION,
  configureNotificationActions,
  configureReminderHandling,
  getNotificationPermissionState,
  POTTY_REMINDER_NOTIFICATION_KIND,
  requestReminderPermission,
  syncPottyReminders,
  syncScheduleReminders,
  WIDGET_LOG_NOTIFICATION_KIND,
  type NotificationPermissionState,
} from './src/reminders';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from './src/notification-config';
import {
  appendEvents,
  loadEvents,
  loadLanguagePreference,
  loadNotificationPreferences,
  loadSchedule,
  loadThemePreference,
  loadWidgetActions,
  removeEvent,
  saveSchedule,
  saveLanguagePreference,
  saveNotificationPreferences,
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
  const [preferencePicker, setPreferencePicker] = useState<'theme' | 'language' | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const theme = resolveTheme(themePreference, colorScheme);
  const language = resolveLanguage(languagePreference);
  const [tab, setTab] = useState<Tab>('log');
  const [events, setEvents] = useState<PuppyEvent[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [widgetActions, setWidgetActions] = useState<QuickEventType[]>([...DEFAULT_WIDGET_ACTIONS]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('requestable');
  const [undoState, setUndoState] = useState<{ event: PuppyEvent; message: string; restore?: PuppyEvent } | null>(null);
  const [editRequest, setEditRequest] = useState<LogEditRequest | null>(null);
  const handledNotificationResponses = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const pending = await readPendingWidgetEvents();
    const nextEvents = pending.length ? await appendEvents(pending) : await loadEvents();
    setEvents(nextEvents);
    const [nextSchedule, nextWidgetActions, nextTheme, nextLanguagePreference, nextNotificationPreferences, nextPermission] = await Promise.all([
      loadSchedule(),
      loadWidgetActions(),
      loadThemePreference(),
      loadLanguagePreference(),
      loadNotificationPreferences(),
      getNotificationPermissionState(),
    ]);
    setSchedule(nextSchedule);
    setWidgetActions(nextWidgetActions);
    setThemePreference(nextTheme);
    setLanguagePreference(nextLanguagePreference);
    setNotificationPreferences(nextNotificationPreferences);
    setNotificationPermission(nextPermission);
    await Promise.all([
      syncScheduleReminders(
        nextSchedule,
        nextNotificationPreferences.reminderLeadMinutes,
        resolveLanguage(nextLanguagePreference),
      ).catch(() => undefined),
      syncPottyReminders(
        nextEvents,
        nextNotificationPreferences,
        resolveLanguage(nextLanguagePreference),
      ).catch(() => undefined),
      updateHomeWidget(nextEvents).catch(() => undefined),
    ]);
    return nextEvents;
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    Appearance.setColorScheme(themePreference === 'system' ? 'unspecified' : theme.isDark ? 'dark' : 'light');
  }, [theme.isDark, themePreference]);

  useEffect(() => {
    if (!settingsVisible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSettingsVisible(false);
      return true;
    });
    return () => subscription.remove();
  }, [settingsVisible]);

  useEffect(() => {
    configureNotificationActions(language).catch(() => undefined);
  }, [language]);

  const handleNotificationResponse = useCallback(async (response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data;
    if (data?.kind === POTTY_REMINDER_NOTIFICATION_KIND) {
      setSettingsVisible(false);
      setTab('log');
      return;
    }
    if (data?.kind !== WIDGET_LOG_NOTIFICATION_KIND) return;
    const responseKey = [
      response.notification.request.identifier,
      response.actionIdentifier,
      response.notification.date,
      response.userText ?? '',
    ].join(':');
    if (handledNotificationResponses.current.has(responseKey)) return;
    handledNotificationResponses.current.add(responseKey);

    const nextEvents = await refresh();
    const eventId = typeof data.eventId === 'string' ? data.eventId : undefined;
    const type = isQuickEventType(data.type) ? data.type : undefined;
    const at = typeof data.at === 'number' ? data.at : undefined;
    const event = nextEvents.find((candidate) => candidate.id === eventId)
      ?? (type && at !== undefined
        ? nextEvents.find((candidate) => (
            candidate.type === type
            && (
              (candidate.source === 'widget' && Math.abs(candidate.at - at) < 60_000)
              || (typeof candidate.endedAt === 'number' && Math.abs(candidate.endedAt - at) < 60_000)
            )
          ))
        : undefined);
    if (!event) return;

    if (response.actionIdentifier === ADD_NOTE_ACTION && response.userText?.trim()) {
      const updatedEvents = await updateEvent(event.id, { note: normalizeNote(response.userText) });
      setEvents(updatedEvents);
      updateHomeWidget(updatedEvents).catch(() => undefined);
    }
    setSettingsVisible(false);
    setTab('log');
    setEditRequest({
      eventId: event.id,
      focusNote: response.actionIdentifier === ADD_NOTE_ACTION && !response.userText?.trim(),
    });
  }, [refresh]);

  useEffect(() => {
    const initialResponse = Notifications.getLastNotificationResponse();
    if (initialResponse) {
      void handleNotificationResponse(initialResponse)
        .finally(() => Notifications.clearLastNotificationResponse());
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationResponse(response)
        .finally(() => Notifications.clearLastNotificationResponse());
    });
    return () => subscription.remove();
  }, [handleNotificationResponse]);

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
    syncPottyReminders(nextEvents, notificationPreferences, language).catch(() => undefined);
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
    syncPottyReminders(nextEvents, notificationPreferences, language).catch(() => undefined);
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
          syncPottyReminders(nextEvents, notificationPreferences, language).catch(() => undefined);
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
    syncPottyReminders(nextEvents, notificationPreferences, language).catch(() => undefined);
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
    syncPottyReminders(nextEvents, notificationPreferences, language).catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const changeSchedule = async (nextSchedule: ScheduleEntry[]) => {
    await saveSchedule(nextSchedule);
    setSchedule(nextSchedule);
    try {
      const synced = await syncScheduleReminders(
        nextSchedule,
        notificationPreferences.reminderLeadMinutes,
        language,
      );
      if (!synced && nextSchedule.some((entry) => entry.reminder)) {
        Alert.alert(translate(language, 'app.routineSaved'), translate(language, 'app.notificationsOff'));
      }
    } catch {
      Alert.alert(translate(language, 'app.routineSaved'), translate(language, 'app.reminderError'));
    }
  };

  const chooseTheme = (preference: ThemePreference) => {
    setThemePreference(preference);
    setPreferencePicker(null);
    Haptics.selectionAsync().catch(() => undefined);
    saveThemePreference(preference)
      .then(() => updateHomeWidget(events))
      .catch(() => undefined);
  };

  const chooseLanguage = (preference: LanguagePreference) => {
    setLanguagePreference(preference);
    setPreferencePicker(null);
    Haptics.selectionAsync().catch(() => undefined);
    saveLanguagePreference(preference)
      .then(() => Promise.all([
        configureNotificationActions(resolveLanguage(preference)),
        syncScheduleReminders(
          schedule,
          notificationPreferences.reminderLeadMinutes,
          resolveLanguage(preference),
        ),
        syncPottyReminders(
          events,
          notificationPreferences,
          resolveLanguage(preference),
        ),
        updateHomeWidget(events),
      ]))
      .catch(() => undefined);
  };

  const changeWidgetActions = useCallback(async (nextActions: QuickEventType[]) => {
    await saveWidgetActions(nextActions);
    setWidgetActions(nextActions);
    await updateHomeWidget(events).catch(() => undefined);
  }, [events]);

  const changeNotificationPreferences = async (nextPreferences: NotificationPreferences) => {
    await saveNotificationPreferences(nextPreferences);
    setNotificationPreferences(nextPreferences);
    await Promise.all([
      syncScheduleReminders(
        schedule,
        nextPreferences.reminderLeadMinutes,
        language,
      ),
      syncPottyReminders(events, nextPreferences, language),
      updateHomeWidget(events).catch(() => undefined),
    ]);
  };

  const requestNotifications = async () => {
    const granted = await requestReminderPermission(language);
    setNotificationPermission(await getNotificationPermissionState());
    if (granted) {
      await Promise.all([
        syncScheduleReminders(
          schedule,
          notificationPreferences.reminderLeadMinutes,
          language,
        ),
        syncPottyReminders(events, notificationPreferences, language),
        updateHomeWidget(events).catch(() => undefined),
      ]);
    }
    return granted;
  };

  const screen = useMemo(() => {
    if (settingsVisible) {
      return (
        <SettingsScreen
          theme={theme}
          themePreference={themePreference}
          languagePreference={languagePreference}
          widgetActions={widgetActions}
          notificationPreferences={notificationPreferences}
          notificationPermission={notificationPermission}
          routineReminderCount={schedule.filter((entry) => entry.reminder).length}
          onBack={() => setSettingsVisible(false)}
          onOpenPicker={setPreferencePicker}
          onWidgetActionsChange={changeWidgetActions}
          onNotificationPreferencesChange={changeNotificationPreferences}
          onRequestNotificationPermission={requestNotifications}
          onOpenSystemSettings={() => {
            Linking.openSettings().catch(() => undefined);
          }}
          onOpenSchedule={() => {
            setSettingsVisible(false);
            setTab('schedule');
          }}
        />
      );
    }
    if (tab === 'timeline') return <TimelineScreen events={events} theme={theme} />;
    if (tab === 'insights') return <InsightsScreen events={events} onAddEstimate={addEstimatedEvent} theme={theme} />;
    if (tab === 'schedule') {
      return (
        <ScheduleScreen
          events={events}
          schedule={schedule}
          onChange={changeSchedule}
          onRequestReminderPermission={requestNotifications}
          theme={theme}
        />
      );
    }
    return (
      <LogScreen
        events={events}
        schedule={schedule}
        editRequest={editRequest}
        onEditRequestHandled={() => setEditRequest(null)}
        onLog={logEvent}
        onSave={saveEventDetails}
        onDelete={confirmDelete}
        onOpenSchedule={() => setTab('schedule')}
        onOpenSettings={() => setSettingsVisible(true)}
        theme={theme}
      />
    );
  }, [
    changeWidgetActions,
    editRequest,
    events,
    language,
    languagePreference,
    notificationPermission,
    notificationPreferences,
    schedule,
    settingsVisible,
    tab,
    theme,
    themePreference,
    widgetActions,
  ]);

  return (
    <SafeAreaProvider>
      <LocalizationProvider language={language}>
        <SafeAreaView
          style={[styles.container, { backgroundColor: theme.background }]}
          edges={settingsVisible ? ['top', 'bottom', 'left', 'right'] : ['top', 'left', 'right']}
        >
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
          <View style={styles.screen}>
            {screen}
            {undoState ? (
              <Toast
                message={undoState.message}
                onNote={() => {
                  setSettingsVisible(false);
                  setTab('log');
                  setEditRequest({ eventId: undoState.event.id, focusNote: true });
                  setUndoState(null);
                }}
                onUndo={undo}
                theme={theme}
              />
            ) : null}
          </View>
          {!settingsVisible ? (
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.nav }}>
              <BottomNav tab={tab} onChange={setTab} theme={theme} />
            </SafeAreaView>
          ) : null}
          <ThemePicker
            visible={preferencePicker !== null}
            mode={preferencePicker ?? 'theme'}
            selected={themePreference}
            selectedLanguage={languagePreference}
            colorScheme={colorScheme}
            theme={theme}
            onSelect={chooseTheme}
            onSelectLanguage={chooseLanguage}
            onClose={() => setPreferencePicker(null)}
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
