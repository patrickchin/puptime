import {getLocalRuntime} from './local/runtime.native';
export type {ActivityQueries} from './local/activity-queries';

export async function getActivityData(){return (await getLocalRuntime()).activity;}
export async function getActivityPetId(){return (await getLocalRuntime()).petId;}

export type {EventHistoryData} from './event-history';
export async function getEventHistoryData(){return (await getLocalRuntime()).history;}
