import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { BottomNav, type Tab } from './src/components/BottomNav';
import { Toast } from './src/components/Toast';
import { EVENT_META, createEvent, type EventType, type PuppyEvent, type ScheduleEntry } from './src/domain';
import { InsightsScreen } from './src/screens/InsightsScreen';
import { LogScreen } from './src/screens/LogScreen';
import { ScheduleScreen } from './src/screens/ScheduleScreen';
import { appendEvents, loadEvents, loadSchedule, removeEvent, saveSchedule } from './src/storage';
import { darkTheme, lightTheme } from './src/theme';
import { readPendingWidgetEvents, updateHomeWidget } from './src/widgets/sync';

export default function App() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  const [tab, setTab] = useState<Tab>('log');
  const [events, setEvents] = useState<PuppyEvent[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [undoEvent, setUndoEvent] = useState<PuppyEvent | null>(null);

  const refresh = useCallback(async () => {
    const pending = await readPendingWidgetEvents();
    const nextEvents = pending.length ? await appendEvents(pending) : await loadEvents();
    setEvents(nextEvents);
    setSchedule(await loadSchedule());
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
    if (!undoEvent) return;
    const timer = setTimeout(() => setUndoEvent(null), 4_500);
    return () => clearTimeout(timer);
  }, [undoEvent]);

  const logEvent = async (type: EventType) => {
    const event = createEvent(type);
    const nextEvents = await appendEvents([event]);
    setEvents(nextEvents);
    setUndoEvent(event);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const confirmDelete = (event: PuppyEvent) => {
    Alert.alert('Delete this log?', `${EVENT_META[event.type].pastLabel} at ${new Date(event.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, [
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

  const undo = async () => {
    if (!undoEvent) return;
    const nextEvents = await removeEvent(undoEvent.id);
    setEvents(nextEvents);
    setUndoEvent(null);
    Haptics.selectionAsync().catch(() => undefined);
    updateHomeWidget(nextEvents).catch(() => undefined);
  };

  const changeSchedule = async (nextSchedule: ScheduleEntry[]) => {
    setSchedule(nextSchedule);
    await saveSchedule(nextSchedule);
  };

  const screen = useMemo(() => {
    if (tab === 'insights') return <InsightsScreen events={events} schedule={schedule} theme={theme} />;
    if (tab === 'schedule') return <ScheduleScreen schedule={schedule} onChange={changeSchedule} theme={theme} />;
    return <LogScreen events={events} onLog={logEvent} onDelete={confirmDelete} theme={theme} />;
  }, [events, schedule, tab, theme]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <View style={styles.screen}>{screen}</View>
        <BottomNav tab={tab} onChange={setTab} theme={theme} />
        {undoEvent ? <Toast message={`${EVENT_META[undoEvent.type].pastLabel} logged`} onUndo={undo} theme={theme} /> : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
});
