import {File,Paths} from 'expo-file-system';
import {openLocalDatabase as originalOpen} from '../../src/local/open.native';
import {readPurpose} from './sql-purpose';
import {sqliteEngineReceipt} from './sqlite-engine';
export async function openLocalDatabase(...args){
 const opened=await originalOpen(...args),original=opened.database;
 try{
  const engine=new File(Paths.document,'sqlite-engine-probe.json');
  engine.create({overwrite:true});
  engine.write(JSON.stringify(await sqliteEngineReceipt(original)));
 }catch(error){await original.close().catch(()=>{});throw error;}
 const file=new File(Paths.document,'sql-query-probe.json');
 const state={scope:'actual iOS SQLite reads, no values or credentials',reads:[],decoded:0};let scheduled=false;
 function flush(){try{file.write(JSON.stringify(state));}catch{}}
 function later(){if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;flush();},0);}}
 function row(value){return value&&typeof value==='object'&&'source' in value?new Proxy(value,{get(target,key,receiver){if(key==='source'){state.decoded++;later();}return Reflect.get(target,key,receiver);}}):value;}
 function observe(sql){return new Proxy(sql,{get(target,key,receiver){
  if(key!=='getAllAsync'&&key!=='getFirstAsync')return Reflect.get(target,key,receiver);
  return async(query,...values)=>{const purpose=readPurpose(),start=Date.now(),result=await target[key](query,...values);
   if(/\b(?:FROM|JOIN) events\b/i.test(query)){
    state.reads.push({sql:query,purpose,rows:Array.isArray(result)?result.length:result===null?0:1,ms:Date.now()-start});
    if(state.reads.length>1000)state.reads.shift();later();
   }
   return Array.isArray(result)?result.map(row):row(result);
  };
 }});}
 file.create({overwrite:true});flush();
 return {...opened,database:{...original,read:action=>original.read(sql=>action(observe(sql))),write:action=>original.write(sql=>action(observe(sql)))}};
}
