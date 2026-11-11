// Share host-app notification capacity across Expo and the iOS widget bridge.
// Later opt-outs also cancel native writes that were already in flight.
let writes:Promise<unknown>=Promise.resolve();
export function updateNotifications<T>(action:()=>Promise<T>):Promise<T> {
  const result=writes.then(action);writes=result.catch(()=>undefined);return result;
}
