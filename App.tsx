import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, type Tab } from './src/components/BottomNav';
import { Toast } from './src/components/Toast';
import {
  createEvent,
  createNapEvent,
  eventPastLabel,
  isOpenNap,
  normalizeNote,
  type EventType,
  type PuppyEvent,
  type ScheduleEntry,
} from './src/domain';
import { InsightsScreen } from './src/screens/InsightsScreen';
import { LogScreen } from './src/screens/LogScreen';
import { ScheduleScreen } from './src/screens/ScheduleScreen';
import { configureReminderHandling, requestReminderPermission, syncScheduleReminders } from './src/reminders';
import { appendEvents, loadEvents, loadSchedule, removeEvent, saveSchedule, updateEvent } from './src/storage';
import { darkTheme, lightTheme } from './src/theme';
import { readPendingWidgetEvents, updateHomeWidget } from './src/widgets/sync';

configureReminderHandling();

export default function App() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  const [tab, setTab] = useState<Tab>('log');
  const [events, setEvents] = useState<PuppyEvent[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [undoState, setUndoState] = useState<{ event: PuppyEvent; message: string; restore?: PuppyEvent } | null>(null);
  const [editEventId, setEditEventId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const pending = await readPendingWidgetEvents();
    const nextEvents = pending.length ? await appendEvents(pending) : await loadEvents();
    setEvents(nextEvents);
    const nextSchedule = await loadSchedule();
    setSchedule(nextSchedule);
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
        setUndoState({ event, restore: openNap, message: 'Nap ended' });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        updateHomeWidget(nextEvents).catch(() => undefined);
        return;
      }
    }

    const event = type === 'nap' ? createNapEvent('app', now) : createEvent(type, 'app', now, customLabel);
    const nextEvents = await appendEvents([event]);
    setEvents(nextEvents);
    setUndoState({ event, message: type === 'nap' ? 'Nap started' : `${eventPastLabel(event)} logged` });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const confirmDelete = (event: PuppyEvent) => {
    Alert.alert('Delete this log?', `${eventPastLabel(event)} at ${new Date(event.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
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
    at: number,
    endedAt: number | null | undefined,
    note: string,
  ) => {
    const cleanNote = normalizeNote(note);
    const nextEvents = await updateEvent(
      event.id,
      event.endedAt === undefined ? { at, note: cleanNote } : { at, endedAt, note: cleanNote },
    );
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
        Alert.alert('Routine saved', 'Notifications are off, so reminders could not be scheduled.');
      }
    } catch {
      Alert.alert('Routine saved', 'Puptime could not update reminders. Try editing the routine again.');
    }
  };

  const screen = useMemo(() => {
    if (tab === 'insights') return <InsightsScreen events={events} schedule={schedule} theme={theme} />;
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
        theme={theme}
      />
    );
  }, [editEventId, events, schedule, tab, theme]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
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
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
});
