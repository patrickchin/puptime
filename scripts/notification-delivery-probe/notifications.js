// Opt-in observation of the actual iOS notification center. Default builds
// never resolve this module. No session, email, code or notification body.
export * from 'expo-notifications';
import {getAllScheduledNotificationsAsync,getPermissionsAsync} from 'expo-notifications';
import {File,Paths} from 'expo-file-system';
const file=new File(Paths.document,'notification-delivery-probe.json');
let reading=false;
setInterval(async()=>{
 if(reading)return;reading=true;
 try{
  const [requests,permission]=await Promise.all([getAllScheduledNotificationsAsync(),getPermissionsAsync()]);
  file.write(JSON.stringify({at:Date.now(),permission:{granted:permission.granted,canAskAgain:permission.canAskAgain,status:permission.ios?.status},identifiers:requests.map(value=>value.identifier)}));
 }catch{/* A qualification observer never changes delivery behavior. */}
 finally{reading=false;}
},750);
