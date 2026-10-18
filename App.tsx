import { useFonts } from 'expo-font';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Appearance, AppState, BackHandler, Linking, Modal, Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, type Tab } from './src/components/BottomNav';
import { ThemePicker } from './src/components/ThemePicker';
import { Toast } from './src/components/Toast';
import type { ActivityCustomizations } from './src/activity-customization';
import { CsvImportError } from './src/export';
import { pickEventsCsv } from './src/share-export';
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
  activityKey,
  DEFAULT_WIDGET_ACTIONS,
  isOpenNap,
  isQuickEventType,
  normalizeCustomLabel,
  normalizeNote,
  type ActivityKey,
  type EventType,
  type PuppyEvent,
  type PuppyEventChanges,
  type ScheduleEntry,
} from './src/domain';
import { InsightsScreen } from './src/screens/InsightsScreen';
import { LearnScreen } from './src/screens/LearnScreen';
import { LogScreen, type LogEditRequest } from './src/screens/LogScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import type { FinishOnboardingOptions } from './src/onboarding';
import { ScheduleScreen } from './src/screens/ScheduleScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { useCloud } from './src/cloud/use-cloud';
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
  completeOnboarding,
  loadActivityCustomizations,
  EventsImportError,
  EventsStorageError,
  importEvents,
  loadEvents,
  loadCustomActivities,
  loadLanguagePreference,
  loadNotificationPreferences,
  loadSchedule,
  loadThemePreference,
  loadWidgetActions,
  removeEvent,
  saveSchedule,
  saveScheduleEntry,
  removeScheduleEntry,
  saveCustomActivity,
  saveLanguagePreference,
  saveNotificationPreferences,
  saveThemePreference,
  saveWidgetActions,
  shouldShowOnboarding,
  updateEvent,
} from './src/storage';
import { resolveTheme, type ThemePreference } from './src/theme';
import { readPendingWidgetEvents, updateHomeWidget } from './src/widgets/sync';

configureReminderHandling();

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Delius: require('./assets/fonts/Delius-Regular.ttf'),
    LilitaOne: require('./assets/fonts/LilitaOne-Regular.ttf'),
    Itim: require('./assets/fonts/Itim-Regular.ttf'),
  });
  const colorScheme = useColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>('system');
  const [preferencePicker, setPreferencePicker] = useState<'theme' | 'language' | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [accountVisible,setAccountVisible]=useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState<boolean | null>(null);
  const [guideOpenedFromSettings, setGuideOpenedFromSettings] = useState(false);
  const [scheduleOpenedFromSettings, setScheduleOpenedFromSettings] = useState(false);
  const [initialOnboardingCheck] = useState(shouldShowOnboarding);
  const theme = resolveTheme(themePreference, colorScheme);
  const language = resolveLanguage(languagePreference);
  const languageRef = useRef(language);
  languageRef.current = language;
  const [tab, setTab] = useState<Tab>('log');
  const [events, setEvents] = useState<PuppyEvent[]>([]);
  const [customActivities, setCustomActivities] = useState<string[]>([]);
  const [activityCustomizations, setActivityCustomizations] = useState<ActivityCustomizations>({});
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [widgetActions, setWidgetActions] = useState<ActivityKey[]>([...DEFAULT_WIDGET_ACTIONS]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('requestable');
  const [undoState, setUndoState] = useState<{ event: PuppyEvent; message: string; restore?: PuppyEvent } | null>(null);
  const [editRequest, setEditRequest] = useState<LogEditRequest | null>(null);
  const handledNotificationResponses = useRef(new Set<string>());
  const onboardingChecked = useRef(false);

  const showSaveError = useCallback(() => {
    Alert.alert(translate(language, 'app.saveErrorTitle'), translate(language, 'app.saveErrorBody'));
  }, [language]);

  const refresh = useCallback(async () => {
    const pending = await readPendingWidgetEvents();
    const nextEvents = pending.length ? await appendEvents(pending) : await loadEvents();
    setEvents(nextEvents);
    const nextCustomActivities = await loadCustomActivities(nextEvents);
    setCustomActivities(nextCustomActivities);
    const [nextSchedule, nextWidgetActions, nextTheme, nextLanguagePreference, nextNotificationPreferences, nextPermission, nextActivityCustomizations] = await Promise.all([
      loadSchedule(),
      loadWidgetActions(nextCustomActivities),
      loadThemePreference(),
      loadLanguagePreference(),
      loadNotificationPreferences(),
      getNotificationPermissionState(),
      loadActivityCustomizations(),
    ]);
    setSchedule(nextSchedule);
    setWidgetActions(nextWidgetActions);
    setThemePreference(nextTheme);
    setLanguagePreference(nextLanguagePreference);
    setNotificationPreferences(nextNotificationPreferences);
    setNotificationPermission(nextPermission);
    setActivityCustomizations(nextActivityCustomizations);
    void Promise.all([
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

  const refreshFromCloud=useCallback(async()=>{
    try{await refresh();}
    catch{Alert.alert(translate(languageRef.current,'app.loadErrorTitle'),translate(languageRef.current,'app.loadErrorBody'));}
  },[refresh]);
  const cloud=useCloud(refreshFromCloud);

  useEffect(() => {
    let mounted = true;
    const reload = async () => {
      try {
        await refresh();
      } catch {
        if (mounted) {
          Alert.alert(translate(languageRef.current, 'app.loadErrorTitle'), translate(languageRef.current, 'app.loadErrorBody'));
        }
      }
    };
    void (async () => {
      const showOnboarding = await initialOnboardingCheck.catch(() => false);
      onboardingChecked.current = true;
      await reload();
      if (mounted) setOnboardingVisible(showOnboarding);
    })();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && onboardingChecked.current) void reload();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [initialOnboardingCheck, refresh]);

  useEffect(() => {
    Appearance.setColorScheme(themePreference === 'system' ? 'unspecified' : theme.isDark ? 'dark' : 'light');
  }, [theme.isDark, themePreference]);

  const navigateToTab = (nextTab: Tab) => {
    setScheduleOpenedFromSettings(false);
    setTab(nextTab);
  };

  useEffect(() => {
    if (onboardingVisible !== false) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if(accountVisible){setAccountVisible(false);return true;}
      if (preferencePicker !== null) {
        setPreferencePicker(null);
        return true;
      }
      if (settingsVisible) {
        setSettingsVisible(false);
        return true;
      }
      if (tab === 'schedule' && scheduleOpenedFromSettings) {
        setScheduleOpenedFromSettings(false);
        setTab('log');
        setSettingsVisible(true);
        return true;
      }
      if (tab !== 'log') {
        setTab('log');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [accountVisible,onboardingVisible, preferencePicker, scheduleOpenedFromSettings, settingsVisible, tab]);

  useEffect(() => {
    configureNotificationActions(language).catch(() => undefined);
  }, [language]);

  const handleNotificationResponse = useCallback(async (response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data;
    if (data?.kind === POTTY_REMINDER_NOTIFICATION_KIND) {
      setAccountVisible(false);
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

    await initialOnboardingCheck.catch(() => false);
    const nextEvents = await refresh();
    const eventId = typeof data.eventId === 'string' ? data.eventId : undefined;
    const type = isQuickEventType(data.type) || (typeof data.type === 'string' && data.type.startsWith('custom:')) ? data.type : undefined;
    const at = typeof data.at === 'number' ? data.at : undefined;
    const event = nextEvents.find((candidate) => candidate.id === eventId)
      ?? (type && at !== undefined
        ? nextEvents.find((candidate) => (
            activityKey(candidate) === type
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
    setAccountVisible(false);
    setSettingsVisible(false);
    setTab('log');
    setEditRequest({
      eventId: event.id,
      focusNote: response.actionIdentifier === ADD_NOTE_ACTION && !response.userText?.trim(),
    });
  }, [initialOnboardingCheck, refresh]);

  useEffect(() => {
    const initialResponse = Notifications.getLastNotificationResponse();
    if (initialResponse) {
      void handleNotificationResponse(initialResponse)
        .catch(showSaveError)
        .finally(() => Notifications.clearLastNotificationResponse());
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationResponse(response)
        .catch(showSaveError)
        .finally(() => Notifications.clearLastNotificationResponse());
    });
    return () => subscription.remove();
  }, [handleNotificationResponse, showSaveError]);

  useEffect(() => {
    if (!undoState) return;
    const timer = setTimeout(() => setUndoState(null), 4_500);
    return () => clearTimeout(timer);
  }, [undoState]);

  const displayPastLabel = (event: PuppyEvent) => activityCustomizations[activityKey(event)]?.name ?? localizedEventPastLabel(language, event);

  const persistLogEvent = async (type: EventType, customLabel?: string) => {
    if (type === 'custom' && customLabel) setCustomActivities(await saveCustomActivity(customLabel));
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
        : translate(language, 'app.logged', { activity: displayPastLabel(event) }),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    syncPottyReminders(nextEvents, notificationPreferences, language).catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const logEvent = (type: EventType, customLabel?: string) => {
    return persistLogEvent(type, customLabel).catch(showSaveError);
  };

  const deleteEvent = async (event: PuppyEvent) => {
    const nextEvents = await removeEvent(event.id);
    setEvents(nextEvents);
    syncPottyReminders(nextEvents, notificationPreferences, language).catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const importActivity = async () => {
    try {
      const incoming = await pickEventsCsv();
      if (incoming === null) return;
      const result = await importEvents(incoming);
      setEvents(result.events);
      setUndoState(null);
      void loadCustomActivities(result.events).then(setCustomActivities).catch(() => undefined);
      syncPottyReminders(result.events, notificationPreferences, language).catch(() => undefined);
      updateHomeWidget(result.events).catch(() => undefined);
      Alert.alert(translate(language, 'insights.importedTitle'), translate(language, 'insights.importedBody', {
        imported: result.imported,
        skipped: result.skipped,
      }));
    } catch (error) {
      const body = error instanceof CsvImportError
        ? 'insights.invalidCsvBody'
        : error instanceof EventsImportError
          ? 'insights.importNapConflictBody'
          : error instanceof EventsStorageError
            ? 'app.loadErrorBody'
            : 'insights.importErrorBody';
      Alert.alert(translate(language, 'insights.importErrorTitle'), translate(language, body));
    }
  };

  const saveEventDetails = async (
    event: PuppyEvent,
    changes: PuppyEventChanges,
  ) => {
    if ((changes.type??event.type)==='custom'&&changes.customLabel&&activityKey({type:'custom',customLabel:changes.customLabel})!==activityKey(event)) {
      setCustomActivities(await saveCustomActivity(changes.customLabel));
    }
    const nextEvents=await updateEvent(event.id,changes);
    setEvents(nextEvents);
    Haptics.selectionAsync().catch(() => undefined);
    syncPottyReminders(nextEvents, notificationPreferences, language).catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const persistUndo = async () => {
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

  const undo = () => {
    void persistUndo().catch(showSaveError);
  };

  const applySavedSchedule = async (nextSchedule: ScheduleEntry[]) => {
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
  const changeSchedule = async (nextSchedule:ScheduleEntry[]) => {await saveSchedule(nextSchedule);await applySavedSchedule(await loadSchedule());};
  const changeScheduleEntry = async (entry:ScheduleEntry,original?:ScheduleEntry) => applySavedSchedule(await saveScheduleEntry(entry,original));
  const deleteScheduleEntry = async (id:string) => applySavedSchedule(await removeScheduleEntry(id));

  const chooseTheme = (preference: ThemePreference) => {
    saveThemePreference(preference)
      .then(() => {
        setThemePreference(preference);
        setPreferencePicker(null);
        Haptics.selectionAsync().catch(() => undefined);
        updateHomeWidget(events).catch(() => undefined);
      })
      .catch(() => Alert.alert(translate(language, 'settings.saveErrorTitle'), translate(language, 'settings.saveErrorBody')));
  };

  const chooseLanguage = (preference: LanguagePreference) => {
    saveLanguagePreference(preference)
      .then(() => {
        setLanguagePreference(preference);
        setPreferencePicker(null);
        Haptics.selectionAsync().catch(() => undefined);
        void Promise.all([
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
        ]).catch(() => undefined);
      })
      .catch(() => Alert.alert(translate(language, 'settings.saveErrorTitle'), translate(language, 'settings.saveErrorBody')));
  };

  const changeWidgetActions = useCallback(async (nextActions: ActivityKey[]) => {
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

  const finishOnboarding = async (options?:FinishOnboardingOptions) => {
    if(Platform.OS==='ios'&&guideOpenedFromSettings){
      setOnboardingVisible(false);
      setGuideOpenedFromSettings(false);
      setSettingsVisible(true);
      return;
    }
    try {
      await completeOnboarding(Platform.OS==='ios'?options:undefined);
      setOnboardingVisible(false);
      setGuideOpenedFromSettings(false);
      navigateToTab('log');
    } catch {
      Alert.alert(translate(language, 'settings.saveErrorTitle'), translate(language, 'settings.saveErrorBody'));
    }
  };

  const screen = useMemo(() => {
    if (settingsVisible) {
      return (
        <SettingsScreen
          theme={theme}
          themePreference={themePreference}
          languagePreference={languagePreference}
          widgetActions={widgetActions}
          customActivities={customActivities}
          notificationPreferences={notificationPreferences}
          notificationPermission={notificationPermission}
          routineReminderCount={schedule.filter((entry) => entry.reminder).length}
          onBack={() => setSettingsVisible(false)}
          cloudHandle={cloud}
          onOpenAccount={()=>setAccountVisible(true)}
          onOpenPicker={setPreferencePicker}
          onWidgetActionsChange={changeWidgetActions}
          onNotificationPreferencesChange={changeNotificationPreferences}
          onRequestNotificationPermission={requestNotifications}
          onOpenSystemSettings={() => {
            Linking.openSettings().catch(() => undefined);
          }}
          onOpenSchedule={() => {
            setSettingsVisible(false);
            setScheduleOpenedFromSettings(true);
            setTab('schedule');
          }}
          onOpenGuide={() => {
            setSettingsVisible(false);
            setGuideOpenedFromSettings(true);
            setOnboardingVisible(true);
          }}
        />
      );
    }
    if (tab === 'learn') return <LearnScreen theme={theme} />;
    if (tab === 'timeline') return <TimelineScreen events={events} customActivities={customActivities} theme={theme} />;
    if (tab === 'insights') return <InsightsScreen events={events} customActivities={customActivities} onImport={importActivity} theme={theme} />;
    if (tab === 'schedule') {
      return (
        <ScheduleScreen
          events={events}
          schedule={schedule}
          customActivities={customActivities}
          onChange={changeSchedule}
          onSaveEntry={changeScheduleEntry}
          onRemoveEntry={deleteScheduleEntry}
          onRequestReminderPermission={requestNotifications}
          theme={theme}
        />
      );
    }
    return (
      <LogScreen
        events={events}
        customActivities={customActivities}
        editRequest={editRequest}
        onEditRequestHandled={() => setEditRequest(null)}
        onLog={logEvent}
        onSave={saveEventDetails}
        onDelete={deleteEvent}
        onOpenSettings={() => setSettingsVisible(true)}
        theme={theme}
      />
    );
  }, [
    changeWidgetActions,
    cloud,
    customActivities,
    activityCustomizations,
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
      <LocalizationProvider language={language} customizations={activityCustomizations}>
        <SafeAreaView
          style={[styles.container, { backgroundColor: theme.background }]}
          edges={settingsVisible || onboardingVisible ? ['top', 'bottom', 'left', 'right'] : ['top', 'left', 'right']}
        >
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
          <View style={styles.screen}>
            {onboardingVisible === null || (!fontsLoaded && !fontError) ? null : onboardingVisible ? (
              <OnboardingScreen
                theme={theme}
                mode={guideOpenedFromSettings?'replay':'first-run'}
                notificationPermission={notificationPermission}
                onAllowNotifications={requestNotifications}
                onOpenSystemSettings={() => Linking.openSettings().catch(() => undefined)}
                onFinish={finishOnboarding}
                onBack={() => {
                  if (!guideOpenedFromSettings) return false;
                  setOnboardingVisible(false);
                  setGuideOpenedFromSettings(false);
                  setSettingsVisible(true);
                  return true;
                }}
              />
            ) : screen}
            {!onboardingVisible && undoState ? (
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
          {onboardingVisible === false && !settingsVisible ? (
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.nav }}>
              <BottomNav tab={tab} onChange={navigateToTab} theme={theme} />
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
          <Modal visible={accountVisible&&cloud.available} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={()=>setAccountVisible(false)}>
            {accountVisible?<SafeAreaProvider><AccountScreen cloud={cloud} theme={theme} eventCount={events.length} onBack={()=>setAccountVisible(false)} onOpenActivity={()=>{setAccountVisible(false);setSettingsVisible(false);setTab('log');}}/></SafeAreaProvider>:null}
          </Modal>
        </SafeAreaView>
      </LocalizationProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
});
