import { useFonts } from 'expo-font';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator,Alert, Appearance, AppState, BackHandler, Linking, Modal, Platform, Pressable,StyleSheet,Text,useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav } from './src/components/BottomNav';
import {SideNavigation,type AppTab} from './src/components/SideNavigation';
import {MaterialCommunityIcons} from '@expo/vector-icons';
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
import {FirstLaunchScreen,loadInitialSetup} from './src/screens/FirstLaunchScreen';
import type {FirstLaunchProgress} from './src/first-launch';
import type { FinishOnboardingOptions } from './src/onboarding';
import { ScheduleScreen } from './src/screens/ScheduleScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import {NotificationsScreen} from './src/screens/NotificationsScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { useCloud } from './src/cloud/use-cloud';
import {getNotificationDelivery,setNotificationDelivery} from './src/cloud/notification-delivery';
import {getActivityData,getActivityPetId,type ActivityQueries} from './src/activity-data';
import { TimelineScreen } from './src/screens/TimelineScreen';
import {
  ADD_NOTE_ACTION,
  configureNotificationActions,
  configureReminderHandling,
  getNotificationPermissionState,
  POTTY_REMINDER_NOTIFICATION_KIND,
  CUSTOM_TIMED_REMINDER_NOTIFICATION_KIND,
  cancelCustomTimedRemindersIfDeliveryOff,
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
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState<boolean | null>(null);
  const [guideOpenedFromSettings, setGuideOpenedFromSettings] = useState(false);
  const [scheduleOpenedFromSettings, setScheduleOpenedFromSettings] = useState(false);
  const [firstLaunch,setFirstLaunch]=useState<FirstLaunchProgress|null>(null);
  const [startupFailed,setStartupFailed]=useState(false);
  const startupLoading=useRef(false);
  const [initialOnboardingCheck]=useState(()=>shouldShowOnboarding().catch(()=>false));
  const theme = resolveTheme(themePreference, colorScheme);
  const language = resolveLanguage(languagePreference);
  const languageRef = useRef(language);
  languageRef.current = language;
  const [tab, setTab] = useState<AppTab>('log');
  const [events, setEvents] = useState<PuppyEvent[]>([]);
  const [activity,setActivity]=useState<ActivityQueries>();
  const [petId,setPetId]=useState<string>();
  const activityRef=useRef<ActivityQueries|undefined>(undefined);
  const [refreshToken,setRefreshToken]=useState(0);
  const [eventCount,setEventCount]=useState(0);
  const refreshGeneration=useRef(0);
  const [customActivities, setCustomActivities] = useState<string[]>([]);
  const [activityCustomizations, setActivityCustomizations] = useState<ActivityCustomizations>({});
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [widgetActions, setWidgetActions] = useState<ActivityKey[]>([...DEFAULT_WIDGET_ACTIONS]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('requestable');
  const [notificationDelivery,setDelivery]=useState(false);
  const [undoState, setUndoState] = useState<{ event: PuppyEvent; message: string; restore?: PuppyEvent } | null>(null);
  const [editRequest, setEditRequest] = useState<LogEditRequest | null>(null);
  const handledNotificationResponses = useRef(new Set<string>());
  const onboardingChecked = useRef(false);

  const showSaveError = useCallback(() => {
    Alert.alert(translate(language, 'app.saveErrorTitle'), translate(language, 'app.saveErrorBody'));
  }, [language]);

  const refresh = useCallback(async () => {
    const generation=++refreshGeneration.current;
    const [data,nextPetId]=await Promise.all([getActivityData(),getActivityPetId()]);
    activityRef.current=data;
    const pending = await readPendingWidgetEvents();
    if (pending.length) await appendEvents(pending);
    let nextEvents:PuppyEvent[],count:number;
    if(data){const [latest,summary]=await Promise.all([data.latestEvents(),data.summary()]);nextEvents=latest;count=summary.eventCount;}
    else{nextEvents=await loadEvents();count=nextEvents.length;}
    if(generation!==refreshGeneration.current)return nextEvents;
    setActivity(data);
    setPetId(nextPetId);
    setEvents(nextEvents);
    setEventCount(count);
    setRefreshToken(value=>value+1);
    const nextCustomActivities = await loadCustomActivities(nextEvents);
    setCustomActivities(nextCustomActivities);
    const [nextSchedule, nextWidgetActions, nextTheme, nextLanguagePreference, nextNotificationPreferences, nextPermission, nextActivityCustomizations,nextDelivery] = await Promise.all([
      loadSchedule(),
      loadWidgetActions(nextCustomActivities),
      loadThemePreference(),
      loadLanguagePreference(),
      loadNotificationPreferences(),
      getNotificationPermissionState(),
      loadActivityCustomizations(),
      getNotificationDelivery(),
    ]);
    if(generation!==refreshGeneration.current)return nextEvents;
    setSchedule(nextSchedule);
    setWidgetActions(nextWidgetActions);
    setThemePreference(nextTheme);
    setLanguagePreference(nextLanguagePreference);
    setNotificationPreferences(nextNotificationPreferences);
    setNotificationPermission(nextPermission);
    setDelivery(nextDelivery);
    setActivityCustomizations(current=>JSON.stringify(current)===JSON.stringify(nextActivityCustomizations)?current:nextActivityCustomizations);
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
      ...(Platform.OS==='ios'?[cancelCustomTimedRemindersIfDeliveryOff().catch(()=>undefined)]:[]),
    ]);
    return nextEvents;
  }, []);

  const refreshCommittedState=useCallback(async()=>{
    try{await refresh();}
    catch{Alert.alert(translate(languageRef.current,'app.loadErrorTitle'),translate(languageRef.current,'app.loadErrorBody'));}
  },[refresh]);
  const cloud=useCloud(refreshCommittedState);

  const openJournal=useCallback(async()=>{
    if(startupLoading.current)return;
    startupLoading.current=true;setStartupFailed(false);
    try{
      let setup:FirstLaunchProgress|null;
      if(Platform.OS==='ios'){setup=await loadInitialSetup();await refresh();}
      else{
        const shown=await initialOnboardingCheck;
        try{await refresh();}catch{Alert.alert(translate(languageRef.current,'app.loadErrorTitle'),translate(languageRef.current,'app.loadErrorBody'));}
        setup=shown?{step:'welcome',puppyName:'My puppy'}:null;
      }
      setFirstLaunch(setup);setOnboardingVisible(setup!==null);onboardingChecked.current=true;
    }catch{setStartupFailed(true);}
    finally{startupLoading.current=false;}
  },[refresh,initialOnboardingCheck]);

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
    void openJournal();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && onboardingChecked.current) void reload();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [openJournal, refresh]);

  useEffect(() => {
    Appearance.setColorScheme(themePreference === 'system' ? 'unspecified' : theme.isDark ? 'dark' : 'light');
  }, [theme.isDark, themePreference]);

  const navigateToTab = (nextTab: AppTab) => {
    setDrawerOpen(false);
    setSettingsVisible(false);
    setScheduleOpenedFromSettings(false);
    setTab(nextTab);
  };

  useEffect(() => {
    if (onboardingVisible !== false) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if(drawerOpen){setDrawerOpen(false);return true;}
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
  }, [accountVisible,drawerOpen,onboardingVisible, preferencePicker, scheduleOpenedFromSettings, settingsVisible, tab]);

  useEffect(() => {
    configureNotificationActions(language).catch(() => undefined);
  }, [language]);

  const handleNotificationResponse = useCallback(async (response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data;
    if(Platform.OS==='ios'&&data?.kind===CUSTOM_TIMED_REMINDER_NOTIFICATION_KIND){
      setDrawerOpen(false);setAccountVisible(false);setSettingsVisible(false);setTab('notifications');return;
    }
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
    const dataSource=activityRef.current;
    const requested=eventId&&dataSource?await dataSource.getEvent(eventId):nextEvents.find(candidate=>candidate.id===eventId);
    const candidates=!requested&&type&&at!==undefined&&dataSource
      ?await dataSource.eventsBetween(Math.max(-8640000000000000,at-60000),Math.min(8640000000000001,at+60001))
      :nextEvents;
    const event = requested
      ?? (type && at !== undefined
        ? candidates.find((candidate) => (
            activityKey(candidate) === type
            && (
              (candidate.source === 'widget' && Math.abs(candidate.at - at) < 60_000)
              || (typeof candidate.endedAt === 'number' && Math.abs(candidate.endedAt - at) < 60_000)
            )
          ))
        : undefined);
    if (!event) return;

    if (response.actionIdentifier === ADD_NOTE_ACTION && response.userText?.trim()) {
      await updateEvent(event.id, { note: normalizeNote(response.userText) });
      await refreshCommittedState();
    }
    setAccountVisible(false);
    setSettingsVisible(false);
    setTab('log');
    setEditRequest({
      eventId: event.id,
      focusNote: response.actionIdentifier === ADD_NOTE_ACTION && !response.userText?.trim(),
    });
  }, [initialOnboardingCheck, refresh, refreshCommittedState]);

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
    if (Platform.OS !== 'ios' && type === 'custom' && customLabel) setCustomActivities(await saveCustomActivity(customLabel));
    const now = Date.now();
    if (type === 'nap') {
      const openNap = (activityRef.current?await activityRef.current.latestEvents():await loadEvents()).find(isOpenNap);
      if (openNap) {
        const event = { ...openNap, endedAt: Math.max(openNap.at, now) };
        await updateEvent(openNap.id, { endedAt: event.endedAt });
        setUndoState({ event, restore: openNap, message: translate(language, 'app.napEnded') });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        await refreshCommittedState();
        return;
      }
    }

    const event = type === 'nap' ? createNapEvent('app', now) : createEvent(type, 'app', now, customLabel);
    await appendEvents([event],{restoreCustomActivities:type==='custom'});
    setUndoState({
      event,
      message: type === 'nap'
        ? translate(language, 'app.napStarted')
        : translate(language, 'app.logged', { activity: displayPastLabel(event) }),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    await refreshCommittedState();
  };

  const logEvent = (type: EventType, customLabel?: string) => {
    return persistLogEvent(type, customLabel).catch(showSaveError);
  };

  const deleteEvent = async (event: PuppyEvent) => {
    await removeEvent(event.id);
    await refreshCommittedState();
  };

  const importActivity = async () => {
    try {
      const incoming = await pickEventsCsv();
      if (incoming === null) return;
      const result = await importEvents(incoming);
      setUndoState(null);
      await refreshCommittedState();
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
    const restoreCustomActivities=!!((changes.type??event.type)==='custom'&&changes.customLabel&&activityKey({type:'custom',customLabel:changes.customLabel})!==activityKey(event));
    if (Platform.OS !== 'ios' && restoreCustomActivities && changes.customLabel) {
      setCustomActivities(await saveCustomActivity(changes.customLabel));
    }
    await updateEvent(event.id,changes,{restoreCustomActivities});
    Haptics.selectionAsync().catch(() => undefined);
    await refreshCommittedState();
  };

  const persistUndo = async () => {
    if (!undoState) return;
    if (undoState.restore) await appendEvents([undoState.restore]);
    else await removeEvent(undoState.event.id);
    setUndoState(null);
    Haptics.selectionAsync().catch(() => undefined);
    await refreshCommittedState();
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
  const refreshCommittedSchedule=async()=>{
    try{await applySavedSchedule(await loadSchedule());}
    catch{Alert.alert(translate(language,'app.loadErrorTitle'),translate(language,'app.loadErrorBody'));}
  };
  const changeSchedule = async (nextSchedule:ScheduleEntry[]) => {await saveSchedule(nextSchedule);await refreshCommittedSchedule();};
  const changeScheduleEntry = async (entry:ScheduleEntry,original?:ScheduleEntry) => {await saveScheduleEntry(entry,original);await refreshCommittedSchedule();};
  const deleteScheduleEntry = async (id:string) => {await removeScheduleEntry(id);await refreshCommittedSchedule();};

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
    let granted:boolean;
    try{granted=await requestReminderPermission(language);}
    finally{
      const [permission,delivery]=await Promise.all([getNotificationPermissionState(),getNotificationDelivery()]);
      setNotificationPermission(permission);setDelivery(delivery);
    }
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

  const changeNotificationDelivery=async(enabled:boolean)=>{
    if(enabled){await requestNotifications();return;}
    await setNotificationDelivery(false);setDelivery(false);
    await Promise.all([
      ...(Platform.OS==='ios'?[cancelCustomTimedRemindersIfDeliveryOff()]:[]),
      syncScheduleReminders(schedule,notificationPreferences.reminderLeadMinutes,language),
      syncPottyReminders(events,notificationPreferences,language),
    ]);
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
      if(Platform.OS==='ios')await refresh();
      setFirstLaunch(null);
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
          {...{showHeader:Platform.OS!=='ios',notificationDelivery:Platform.OS==='ios'?notificationDelivery:undefined,
            onNotificationDeliveryChange:changeNotificationDelivery,routineReminderCount:schedule.filter(entry=>entry.reminder).length,
            onOpenSchedule:()=>{setSettingsVisible(false);setScheduleOpenedFromSettings(true);setTab('schedule');}}}
          theme={theme}
          themePreference={themePreference}
          languagePreference={languagePreference}
          widgetActions={widgetActions}
          customActivities={customActivities}
          notificationPreferences={notificationPreferences}
          notificationPermission={notificationPermission}
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
          onOpenGuide={() => {
            setSettingsVisible(false);
            setGuideOpenedFromSettings(true);
            setOnboardingVisible(true);
          }}
        />
      );
    }
    if(tab==='notifications')return <NotificationsScreen theme={theme} petId={petId} notificationPreferences={notificationPreferences}
      notificationPermission={notificationPermission} notificationDelivery={notificationDelivery}
      routineReminderCount={schedule.filter(entry=>entry.reminder).length}
      onNotificationPreferencesChange={changeNotificationPreferences} onRequestNotificationPermission={requestNotifications}
      onNotificationDeliveryChange={changeNotificationDelivery} onOpenSystemSettings={()=>{void Linking.openSettings().catch(()=>undefined);}}
      onOpenSchedule={()=>navigateToTab('schedule')}/>;
    if (tab === 'learn') return <LearnScreen theme={theme} />;
    if (tab === 'timeline') return <TimelineScreen events={events} activity={activity} refreshToken={refreshToken} customActivities={customActivities} theme={theme} />;
    if (tab === 'insights') return <InsightsScreen events={events} activity={activity} refreshToken={refreshToken} customActivities={customActivities} onImport={importActivity} theme={theme} />;
    if (tab === 'schedule') {
      return (
        <ScheduleScreen
          events={events}
          activity={activity}
          refreshToken={refreshToken}
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
        showHeader={Platform.OS!=='ios'}
        events={events}
        activity={activity}
        refreshToken={refreshToken}
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
    activity,
    petId,
    refreshToken,
    language,
    languagePreference,
    notificationPermission,
    notificationDelivery,
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
          edges={Platform.OS==='ios'||settingsVisible||onboardingVisible ? ['top', 'bottom', 'left', 'right'] : ['top', 'left', 'right']}
        >
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
          <SideNavigation open={drawerOpen} enabled={onboardingVisible===false} tab={tab} settingsVisible={settingsVisible} theme={theme}
            onOpen={()=>setDrawerOpen(true)} onClose={()=>setDrawerOpen(false)} onChange={navigateToTab} onSettings={()=>setSettingsVisible(true)}>
          {Platform.OS==='ios'&&onboardingVisible===false?<View style={styles.navigationHeader}>
            <Pressable testID="nav.open" accessibilityRole="button" accessibilityLabel={translate(language,'nav.open')} onPress={()=>setDrawerOpen(true)}
              style={({pressed})=>[styles.menuButton,{backgroundColor:pressed?theme.primarySoft:theme.surface,borderRadius:theme.presentation.controlRadius}]}>
              <MaterialCommunityIcons accessible={false} name="menu" size={25} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no"/>
            </Pressable>
            <Text accessibilityRole={settingsVisible||tab==='notifications'?'header':undefined} style={[styles.navigationTitle,{color:theme.text}]}>{settingsVisible?translate(language,'settings.title'):tab==='notifications'?translate(language,'notifications.title'):'Puptime'}</Text>
            {settingsVisible?<Pressable testID="settings.back" accessibilityRole="button" accessibilityLabel={translate(language,'settings.back')} onPress={()=>setSettingsVisible(false)} style={styles.menuButton}>
              <MaterialCommunityIcons accessible={false} name="close" size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no"/>
            </Pressable>:null}
            {!settingsVisible&&tab==='log'?<Pressable testID="settings.open" accessibilityRole="button" accessibilityLabel={translate(language,'log.openSettingsA11y')} onPress={()=>setSettingsVisible(true)} style={styles.menuButton}>
              <MaterialCommunityIcons accessible={false} name="cog-outline" size={24} color={theme.primary} accessibilityElementsHidden importantForAccessibility="no"/>
            </Pressable>:null}
          </View>:null}
          <View style={styles.screen}>
            {onboardingVisible === null || (!fontsLoaded && !fontError) ? Platform.OS==='ios'?<View testID="setup.loading" style={styles.startup}>
              {startupFailed?<>
                <Text testID="setup.loadError" accessibilityRole="alert" style={[styles.startupText,{color:theme.text}]}>{translate(language,'setup.loadError')}</Text>
                <Pressable testID="setup.retry" accessibilityRole="button" onPress={()=>{cloud.retry?.();void openJournal();}} style={[styles.startupRetry,{backgroundColor:theme.primary}]}><Text style={[styles.startupText,{color:theme.onPrimary}]}>{translate(language,'setup.retry')}</Text></Pressable>
              </>:<><ActivityIndicator color={theme.primary}/><Text style={[styles.startupText,{color:theme.textMuted}]}>{translate(language,'setup.loading')}</Text></>}
            </View>:null : onboardingVisible ? guideOpenedFromSettings?(
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
            ):firstLaunch?<FirstLaunchScreen progress={firstLaunch} cloud={cloud} theme={theme} notificationPermission={notificationPermission} onAllowNotifications={requestNotifications} onDisableNotifications={()=>changeNotificationDelivery(false)} onOpenSystemSettings={()=>{void Linking.openSettings().catch(()=>undefined);}} onFinish={finishOnboarding}/>:null : screen}
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
          {Platform.OS!=='ios'&&onboardingVisible === false && !settingsVisible ? (
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.nav }}>
              <BottomNav tab={tab==='notifications'?'log':tab} onChange={navigateToTab} theme={theme} />
            </SafeAreaView>
          ) : null}
          </SideNavigation>
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
            {accountVisible?<SafeAreaProvider><AccountScreen cloud={cloud} theme={theme} eventCount={eventCount} onBack={()=>setAccountVisible(false)} onOpenActivity={()=>{setAccountVisible(false);setSettingsVisible(false);setTab('log');}}/></SafeAreaProvider>:null}
          </Modal>
        </SafeAreaView>
      </LocalizationProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
  navigationHeader:{minHeight:60,paddingHorizontal:20,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:14},
  menuButton:{minHeight:48,minWidth:48,alignItems:'center',justifyContent:'center'},
  navigationTitle:{fontSize:20,lineHeight:28,fontWeight:'700',flex:1},
  startup:{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:16},
  startupText:{fontSize:16,lineHeight:24,textAlign:'center'},
  startupRetry:{minHeight:48,paddingHorizontal:24,paddingVertical:12,borderRadius:12},
});
