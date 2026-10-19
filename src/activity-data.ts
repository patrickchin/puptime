import type {ActivityQueries} from './local/activity-queries';
export type {ActivityQueries} from './local/activity-queries';

// Deferred platforms keep their existing array-driven screen data.
export async function getActivityData():Promise<ActivityQueries|undefined>{return undefined;}
export async function getActivityPetId():Promise<string|undefined>{return undefined;}
