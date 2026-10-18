import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {performance} from 'node:perf_hooks';
import {createLocalDatabase,initializeLocalDatabase,type SqlValue} from './database.ts';
import {sqliteTestConnection} from './sqlite-test-adapter.ts';
import {createLocalRepository} from './repository.ts';
import * as queries from './activity-queries.ts';
import {monthlyActivityStats,activityFrequencyStats} from '../analytics.ts';
import {latestQuickEventTimes,type PuppyEvent} from '../domain.ts';

const event=(id:string,at:number):PuppyEvent=>({id,type:'pee',at,source:'app'});
async function setup(t:TestContext){
 const raw=sqliteTestConnection(':memory:'),reads:Array<{sql:string;values:SqlValue[];rows:number}>=[];
 let decoded=0;
 function observe<T>(row:T):T {return row&&typeof row==='object'&&'source' in row?new Proxy(row,{get(target,key,receiver){if(key==='source')decoded++;return Reflect.get(target,key,receiver);}}):row;}
 const database=await createLocalDatabase({...raw,
  async getAllAsync<T>(sql:string,...values:SqlValue[]){const rows=await raw.getAllAsync<T>(sql,...values);reads.push({sql,values,rows:rows.length});return rows.map(observe);},
  async getFirstAsync<T>(sql:string,...values:SqlValue[]){const row=await raw.getFirstAsync<T>(sql,...values);reads.push({sql,values,rows:row===null?0:1});return observe(row);},
 });
 t.after(()=>database.close());await initializeLocalDatabase(database,()=> 'pet-1');
 assert.equal(typeof queries.createActivityQueries,'function');
 return {database,reads,repository:createLocalRepository(database,'pet-1'),activity:queries.createActivityQueries(database,'pet-1'),reset(){reads.length=0;decoded=0;},decoded:()=>decoded};
}

test('keyset pages preserve ties, deleted cursors, pet isolation and unchanged row references',async t=>{
 const {database,repository,activity}=await setup(t);
 await repository.appendEvents([event('a',100),event('b',100),event('c',100),event('d',50)]);
 await database.write(sql=>sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet-2','Other')"));
 await createLocalRepository(database,'pet-2').appendEvents([event('foreign',200)]);
 const first=await activity.eventsPage({limit:2});assert.deepEqual(first.events.map(row=>row.id),['c','b']);assert.deepEqual(first.next,{at:100,id:'b'});
 assert.equal((await activity.eventsPage({limit:2})).events[0],first.events[0]);
 assert.equal(await activity.getEvent('c'),first.events[0]);assert.equal(await activity.getEvent('foreign'),null);
 await repository.removeEvent('b');
 const second=await activity.eventsPage({limit:2,before:first.next!});assert.deepEqual(second.events.map(row=>row.id),['a','d']);assert.equal(second.next,null);
 assert.deepEqual(await activity.eventsPage({before:{at:0,id:'before-everything'}}),{events:[],next:null});
 await repository.updateEvent('d',{at:300,note:'moved'});
 assert.equal((await activity.eventsPage()).events[0].id,'d');assert.equal(await activity.getEvent('c'),first.events[0]);
 assert.deepEqual(await activity.summary(),{eventCount:3,earliestAt:100});
 await repository.appendEvents([event('💩',999),event('\ufffd',999)]);
 const unicode=await activity.eventsPage({limit:1});assert.equal(unicode.events[0].id,'💩');
 assert.equal((await activity.eventsPage({limit:1,before:unicode.next!})).events[0].id,'\ufffd');
});

test('invalid query limits, cursors and windows reject before SQL without a full-history fallback',async t=>{
 const {activity,reset,reads}=await setup(t);reset();
 for(const limit of [0,-1,1.5,1001,NaN,Infinity])await assert.rejects(activity.eventsPage({limit}));
 for(const before of [{at:NaN,id:'a'},{at:0,id:''},{at:8640000000000001,id:'a'},{at:1.5,id:'a'}])await assert.rejects(activity.eventsPage({before}));
 await assert.rejects(activity.getEvent('bad\nidentity'));await assert.rejects(activity.eventsBetween(100,99));await assert.rejects(activity.eventsBetween(NaN,100));
 assert.equal(reads.length,0);assert.deepEqual(await activity.summary(),{eventCount:0,earliestAt:null});assert.deepEqual(await activity.monthlyStats(),[]);
});

test('date windows include overlapping durations and exclude touching ends, points outside and other pets',async t=>{
 const {repository,activity,reads,database}=await setup(t);
 await repository.appendEvents([
  event('before',99),event('start',100),event('last',199),event('after',200),
  {...event('point-nap',99),type:'nap'},
  {...event('touches-start',50),type:'nap',endedAt:100},
  {...event('overlap',50),type:'nap',endedAt:101},
  {...event('open',40),type:'nap',endedAt:null},
  {...event('future-open',200),type:'nap',endedAt:null},
 ]);
 await database.write(sql=>sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet-2','Other')"));
 await createLocalRepository(database,'pet-2').appendEvents([event('foreign-point',100),{...event('foreign-open',40),type:'nap',endedAt:null},{...event('foreign-closed',50),type:'nap',endedAt:150}]);
 reads.length=0;
 assert.deepEqual((await activity.eventsBetween(100,200)).map(row=>row.id),['last','start','overlap','open']);
 const windowRead=reads.find(read=>read.sql.includes('UNION ALL'))!;
 const windowPlan=await database.read(sql=>sql.getAllAsync<{detail:string}>('EXPLAIN QUERY PLAN '+windowRead.sql,...windowRead.values));
  t.diagnostic(windowPlan.map(row=>row.detail).join('\n'));
 assert.ok(windowPlan.some(row=>row.detail.includes('events_by_pet_time')));
 assert.ok(windowPlan.some(row=>row.detail.includes('events_open_nap')));
 assert.ok(windowPlan.some(row=>row.detail.includes('events_closed_nap')));
 assert.deepEqual(await activity.eventsBetween(100,100),[]);
});

test('calendar aggregates retain valid timestamp extremes without iterating empty years or losing the last instant',async t=>{
 const {repository,activity}=await setup(t);
 const events=[event('first',-8640000000000000),event('year-fifty',new Date('0050-02-01T00:00:00Z').getTime()),event('epoch',0),event('last',8640000000000000)];
 await repository.appendEvents(events);
 assert.deepEqual(await activity.monthlyStats(),monthlyActivityStats(events));
 assert.deepEqual((await activity.eventsBetween(8640000000000000,8640000000000001)).map(row=>row.id),['last']);
});

test('latest activity candidates ignore estimates, use duration ends and retain an older open duration',async t=>{
 const {repository,activity,database,reads}=await setup(t);
 await repository.appendEvents([
  event('old',100),event('latest',200),{...event('estimate',400),estimated:true},
  {...event('open',50),type:'nap',endedAt:null},
  {...event('closed',100),type:'nap',endedAt:600},
  {...event('custom-old',100),type:'custom',customLabel:'Training'},
  {...event('custom-new',300),type:'custom',customLabel:'training'},
 ]);
 const latest=await activity.latestEvents();
 assert.deepEqual(new Set(latest.map(row=>row.id)),new Set(['latest','open','closed','custom-new']));
 assert.deepEqual(latestQuickEventTimes(latest),{pee:200,nap:600,'custom:training':300});
 const candidate=reads.find(read=>read.sql.includes('ORDER BY MAX('))!;
 const plan=await database.read(sql=>sql.getAllAsync<{detail:string}>('EXPLAIN QUERY PLAN '+candidate.sql,...candidate.values));
 assert.ok(plan.some(row=>row.detail.includes('events_latest_activity')));assert.ok(plan.every(row=>!row.detail.includes('TEMP B-TREE')));
});

test('calendar aggregates match local months, recorded days and frequency windows across DST and estimated-only months',async t=>{
 const {repository,activity,reset,decoded}=await setup(t);
 const at=(month:number,day:number,hour=0,minute=0)=>new Date(2026,month-1,day,hour,minute).getTime();
 const events:PuppyEvent[]=[event('march-one',at(3,8,1,59)),{...event('march-estimate',at(3,8,3,1)),estimated:true},
  {...event('march-meal',at(3,9,0,1)),type:'meal'},event('nov-one',at(11,1,1,30)),event('nov-two',at(11,1,1,30)+3600000),
  {...event('dec-estimate',at(12,1)),estimated:true},event('month-edge',at(4,1,0,1))];
 await repository.appendEvents(events);reset();
 assert.deepEqual(await activity.monthlyStats(),monthlyActivityStats(events));assert.equal(decoded(),0,'Monthly aggregates must not decode event rows.');
 const start=at(3,8),end=at(3,9);
 if(process.env.TZ==='America/New_York')assert.equal(end-start,23*3600000);
 assert.deepEqual((await activity.eventsBetween(start,end)).map(row=>row.id),['march-estimate','march-one']);
 const now=new Date(2026,2,10,12),from=new Date(now);from.setHours(0,0,0,0);from.setDate(from.getDate()-9);
 assert.deepEqual(activityFrequencyStats(await activity.eventsBetween(from.getTime(),now.getTime()+1),['pee','poop'],10,now),activityFrequencyStats(events,['pee','poop'],10,now));
});

test('bounded query work is measured separately from explicit full export at 1k, 10k and 100k events',async t=>{
 for(const size of [1000,10000,100000]){
  const fixture=await setup(t),{database,repository,activity,reads,reset,decoded}=fixture;
  const start=new Date(2026,8,1).getTime();
  await database.write(async sql=>{for(let index=0;index<size;index++)await sql.runAsync("INSERT INTO events(pet_id,id,type,at,source) VALUES ('pet-1',?,'pee',?,'app')",String(index).padStart(6,'0'),start+index*60000);});
  async function measure(label:string,action:()=>Promise<unknown>){reset();const begun=performance.now();await action();return {label,ms:Number((performance.now()-begun).toFixed(2)),rows:reads.filter(read=>/\bFROM events\b/i.test(read.sql)).reduce((count,read)=>count+read.rows,0),decoded:decoded()};}
  const page=await measure('page',async()=>assert.equal((await activity.eventsPage()).events.length,200));
  assert.equal(page.rows,201);assert.equal(page.decoded,200);
  const pageRead=reads.find(read=>/LIMIT/.test(read.sql))!;
  const plan=await database.read(sql=>sql.getAllAsync<{detail:string}>('EXPLAIN QUERY PLAN '+pageRead.sql,...pageRead.values));
  assert.ok(plan.some(row=>row.detail.includes('events_by_pet_time')));
  const window=await measure('day',async()=>assert.equal((await activity.eventsBetween(start,start+86400000)).length,Math.min(size,1440)));
  assert.equal(window.decoded,Math.min(size,1440));
  const edit=await measure('edit',()=>repository.updateEvent('000500',{note:'one changed row'}));assert.equal(edit.rows,1);assert.equal(edit.decoded,1);
  const latest=await measure('latest candidates',async()=>assert.equal((await activity.latestEvents()).length,1));assert.equal(latest.decoded,1);
  const monthly=await measure('monthly aggregates',async()=>assert.ok((await activity.monthlyStats()).length>0));assert.equal(monthly.decoded,0);
  const exported=await measure('full export',async()=>assert.equal((await repository.loadEvents()).length,size));assert.equal(exported.rows,size);assert.equal(exported.decoded,size);
  t.diagnostic(JSON.stringify({size,results:[page,window,edit,latest,monthly,exported],scope:'desktop real SQLite; event-query result rows only, not iOS latency'}));
 }
});
