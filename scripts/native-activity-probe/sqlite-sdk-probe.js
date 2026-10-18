// Opt-in native initialization fault; never part of the default Metro config.
import {openDatabaseAsync as open} from 'expo-sqlite';
import {File,Paths} from 'expo-file-system';
export async function openDatabaseAsync(...args){
 const connection=await open(...args);
 if(!new File(Paths.document,'native-init-fault').exists)return connection;
 return new Proxy(connection,{get(target,key){
  if(key==='execAsync')return async query=>{
   await target.execAsync(query);
   if(query.includes('CREATE TABLE IF NOT EXISTS metadata')){
    await target.execAsync("CREATE TRIGGER qualification_init_fault BEFORE INSERT ON routines BEGIN SELECT RAISE(ABORT,'injected native seed failure'); END;");
   }
  };
  const value=Reflect.get(target,key,target);
  return typeof value==='function'?value.bind(target):value;
 }});
}
