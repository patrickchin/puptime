import {getLocalRuntime} from '../local/runtime.ios';

export const getNotificationDelivery=async()=>(await getLocalRuntime()).storage.loadNotificationDelivery();
export const setNotificationDelivery=async(enabled:boolean)=>(await getLocalRuntime()).storage.saveNotificationDelivery(enabled);
