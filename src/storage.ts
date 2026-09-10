import AsyncStorage from '@react-native-async-storage/async-storage';

import { STARTER_SCHEDULE, type PuppyEvent, type ScheduleEntry } from './domain';

const EVENTS_KEY = 'puptime.events.v1';
const SCHEDULE_KEY = 'puptime.schedule.v1';

let writeQueue = Promise.resolve();

function parseArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadEvents(): Promise<PuppyEvent[]> {
  const events = parseArray<PuppyEvent>(await AsyncStorage.getItem(EVENTS_KEY));
  return events.sort((a, b) => b.at - a.at);
}

export function appendEvents(incoming: PuppyEvent[]): Promise<PuppyEvent[]> {
  let result: PuppyEvent[] = [];
  writeQueue = writeQueue.then(async () => {
    const current = await loadEvents();
    const byId = new Map(current.map((event) => [event.id, event]));
    incoming.forEach((event) => byId.set(event.id, event));
    result = [...byId.values()].sort((a, b) => b.at - a.at);
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(result));
  });
  return writeQueue.then(() => result);
}

export function removeEvent(id: string): Promise<PuppyEvent[]> {
  let result: PuppyEvent[] = [];
  writeQueue = writeQueue.then(async () => {
    result = (await loadEvents()).filter((event) => event.id !== id);
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(result));
  });
  return writeQueue.then(() => result);
}

export async function loadSchedule(): Promise<ScheduleEntry[]> {
  const stored = await AsyncStorage.getItem(SCHEDULE_KEY);
  if (stored === null) {
    await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(STARTER_SCHEDULE));
    return STARTER_SCHEDULE;
  }
  return parseArray<ScheduleEntry>(stored).sort((a, b) => a.minutes - b.minutes);
}

export async function saveSchedule(schedule: ScheduleEntry[]): Promise<void> {
  await AsyncStorage.setItem(
    SCHEDULE_KEY,
    JSON.stringify([...schedule].sort((a, b) => a.minutes - b.minutes)),
  );
}
