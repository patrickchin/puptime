// Preserve the deferred platforms' existing permission-based behavior.
export const getNotificationDelivery=async()=>true;
export const setNotificationDelivery=async(_enabled:boolean):Promise<void>=>{};
