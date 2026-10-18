import {File,Paths} from 'expo-file-system';
import {openLocalDatabase as originalOpen} from '../../src/local/open.native';
export async function openLocalDatabase(){
 const opened=await originalOpen(),original=opened.database;
 const file=new File(Paths.document,'sql-query-probe.json');
 const state={scope:'actual iOS SQLite reads, no values or credentials',reads:[],decoded:0};let scheduled=false;
 function flush(){try{file.write(JSON.stringify(state));}catch{}}
 function later(){if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;flush();},0);}}
 function row(value){return value&&typeof value==='object'&&'source' in value?new Proxy(value,{get(target,key,receiver){if(key==='source'){state.decoded++;later();}return Reflect.get(target,key,receiver);}}):value;}
 function observe(sql){return new Proxy(sql,{get(target,key,receiver){
  if(key!=='getAllAsync'&&key!=='getFirstAsync')return Reflect.get(target,key,receiver);
  return async(query,...values)=>{const start=Date.now(),result=await target[key](query,...values);
   if(/\b(?:FROM|JOIN) events\b/i.test(query)){
    state.reads.push({sql:query,rows:Array.isArray(result)?result.length:result===null?0:1,ms:Date.now()-start});
    if(state.reads.length>1000)state.reads.shift();later();
   }
   return Array.isArray(result)?result.map(row):row(result);
  };
 }});}
 file.create({overwrite:true});flush();
 return {...opened,database:{...original,read:action=>original.read(sql=>action(observe(sql))),write:action=>original.write(sql=>action(observe(sql)))}};
}
