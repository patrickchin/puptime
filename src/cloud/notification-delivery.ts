// Browser activity fallback; phones persist device opt-in in native SQLite.
export const getNotificationDelivery=async()=>true;
export const setNotificationDelivery=async(_enabled:boolean):Promise<void>=>{};
