import type {ActivityQueries} from './local/activity-queries';
export type {ActivityQueries} from './local/activity-queries';

// Deferred platforms keep their existing array-driven screen data.
export async function getActivityData():Promise<ActivityQueries|undefined>{return undefined;}
export async function getActivityPetId():Promise<string|undefined>{return undefined;}

export type {EventHistoryData} from './event-history';
export async function getEventHistoryData():Promise<import('./event-history').EventHistoryData|undefined>{return undefined;}
