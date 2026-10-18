import {getLocalRuntime} from './local/runtime.ios';
export type {ActivityQueries} from './local/activity-queries';

export async function getActivityData(){return (await getLocalRuntime()).activity;}
