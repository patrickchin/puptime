import type { EventType } from './domain.ts';

// Row-major order in each theme's 2 × 2 combination atlas.
const combinations: readonly (readonly EventType[])[] = [
  ['pee', 'poop'], ['pee', 'meal'], ['poop', 'meal'], ['pee', 'poop', 'meal'],
];

export function activityCombinationIndex(activities: readonly EventType[]): number | undefined {
  const types = new Set(activities);
  const index = combinations.findIndex(combination => combination.length === types.size && combination.every(type => types.has(type)));
  return index < 0 ? undefined : index;
}
