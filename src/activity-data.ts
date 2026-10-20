import type {ActivityQueries} from './local/activity-queries';
export type {ActivityQueries} from './local/activity-queries';

// Browser activity fallback; both phones resolve activity-data.native.ts.
export async function getActivityData():Promise<ActivityQueries|undefined>{return undefined;}
export async function getActivityPetId():Promise<string|undefined>{return undefined;}
