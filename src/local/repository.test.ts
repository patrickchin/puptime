import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { createLocalDatabase, initializeLocalDatabase, type SqlValue } from './database.ts';
import { createLocalRepository } from './repository.ts';
import { createLocalRuntime } from './runtime-factory.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { EventsImportError, EventsStorageError } from '../storage-validation.ts';
import type { PuppyEvent } from '../domain.ts';
const event = (id = 'first', at = 100): PuppyEvent => ({ id, at, type: 'pee', source: 'app' });
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'puptime-repository-'));
  const path = join(directory, 'data.db');
  const connection=sqliteTestConnection(path),reads:Array<{sql:string;rows:number}>=[];
  const database = await createLocalDatabase({...connection,
    async getAllAsync<T>(sql:string,...values:SqlValue[]){const rows=await connection.getAllAsync<T>(sql,...values);reads.push({sql,rows:rows.length});return rows;},
    async getFirstAsync<T>(sql:string,...values:SqlValue[]){const row=await connection.getFirstAsync<T>(sql,...values);reads.push({sql,rows:row===null?0:1});return row;},
  });
  t.after(async () => { await database.close(); await rm(directory, { recursive: true, force: true }); });
  await initializeLocalDatabase(database,()=> 'pet-1');await database.write(sql=>sql.runAsync('DELETE FROM routines'));
  return { database, path, reads, repository: createLocalRepository(database, 'pet-1') };
}

test('ordinary mutations read only requested records with 10000 saved events and preserve atomic revision capture',async t=>{
  const {repository,database,reads}=await setup(t);
  await repository.appendEvents(Array.from({length:10000},(_,index)=>event(`event-${index}`,index)));
  const {storage}=await createLocalRuntime(database,'pet-1');
  reads.length=0;
  const result=await storage.updateEvent('event-5000',{note:'one saved edit'});
  const eventReads=reads.filter(read=>/\bFROM events\b/i.test(read.sql));
  assert.equal(eventReads.reduce((count,read)=>count+read.rows,0),1,'A one-row edit must not materialize event history.');
  assert.equal(eventReads.length,1,'Ordinary edits must not scan history to derive settings.');
  assert.equal(result,undefined);
  assert.equal((await database.read(sql=>sql.getFirstAsync<{note:string}>("SELECT note FROM events WHERE id='event-5000'")))!.note,'one saved edit');
  assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT COUNT(*) n FROM local_revisions')))!.n,1);
  reads.length=0;
  assert.equal(await storage.appendEvents([event('new',10001)]),undefined);
  assert.deepEqual(reads.filter(read=>/\bFROM events\b/i.test(read.sql)).map(read=>read.rows),[0]);
  reads.length=0;
  assert.equal(await storage.removeEvent('event-100'),undefined);
  assert.deepEqual(reads.filter(read=>/\bFROM events\b/i.test(read.sql)).map(read=>read.rows),[1]);
  reads.length=0;
  assert.deepEqual(await storage.importEvents([event('event-101'),event('imported')]),{imported:1,skipped:1});
  assert.deepEqual(reads.filter(read=>/\bFROM events\b/i.test(read.sql)).map(read=>read.rows),[1,0,0]);
  reads.length=0;
  await storage.savePuppyName('Biscuit');await storage.saveThemePreference('soft-play');await storage.loadCustomActivities();
  assert.equal(reads.filter(read=>/\bFROM events\b/i.test(read.sql)).length,0,'Settings must use stored activity state.');
  await storage.saveSchedule([{id:'one',type:'meal',minutes:500},{id:'two',type:'walk',minutes:600}]);
  reads.length=0;
  assert.equal(await storage.saveScheduleEntry({id:'one',type:'meal',minutes:515},{id:'one',type:'meal',minutes:500}),undefined);
  assert.deepEqual(reads.filter(read=>/\bFROM routines\b/i.test(read.sql)).map(read=>read.rows),[1]);
});

test('custom event labels commit with history and reads never materialize or resurrect deleted activities',async t=>{
  const {database}=await setup(t);const {storage}=await createLocalRuntime(database,'pet-1');
  await storage.importEvents([{...event('custom'),type:'custom',customLabel:'Training'}]);
  const stored=await database.read(sql=>sql.getFirstAsync<{value:string}>("SELECT value FROM pet_settings WHERE key='puptime.customActivities.v1' AND pet_id='pet-1'"));
  assert.equal(stored?.value,'["Training"]');
  const revisions=await database.read(sql=>sql.getAllAsync<{kind:string}>('SELECT kind FROM local_revisions ORDER BY sequence'));
  assert.deepEqual(revisions.map(row=>row.kind),['event','customActivity']);
  await storage.deleteCustomActivity('Training');
  await storage.importEvents([{...event('another-custom'),type:'custom',customLabel:'Training'}]);
  const before=(await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT total_changes() n')))!.n;
  assert.deepEqual(await storage.loadCustomActivities(),[]);
  assert.equal((await database.read(sql=>sql.getFirstAsync<{n:number}>('SELECT total_changes() n')))!.n,before);
  assert.equal((await storage.loadEvents()).length,2);
});

test('current event and routine fields are SQL columns with exact optional-value round trips',async t=>{
  const {repository,database}=await setup(t);
  for(const table of ['events','routines']){
    const columns=await database.read(sql=>sql.getAllAsync<{name:string}>(`PRAGMA table_info(${table})`));
    assert.ok(!columns.some(row=>row.name==='body'),'Current core data must not be a JSON body.');
    assert.ok(columns.some(row=>row.name==='type'));assert.ok(columns.some(row=>row.name==='custom_label'));
  }
  const events:PuppyEvent[]=[
    {id:'point',type:'nap',at:100,source:'app'},
    {id:'open',type:'nap',at:200,endedAt:null,source:'widget',note:'',estimated:false},
    {id:'closed',type:'nap',at:300,endedAt:400,source:'app',estimated:true,note:'🐾 训练\nkept'},
    {id:'custom',type:'custom',customLabel:'Training',at:500,source:'app'},
  ];
  await repository.appendEvents(events);
  const saved=await repository.loadEvents();
  for(const event of events)assert.deepEqual(saved.find(row=>row.id===event.id),event);
  const open=await database.read(sql=>sql.getFirstAsync<{end_state:number;ended_at:number|null;estimated:number;note:string}>('SELECT end_state,ended_at,estimated,note FROM events WHERE id=?','open'));
  assert.deepEqual({...open},{end_state:1,ended_at:null,estimated:0,note:''});
  const point=await database.read(sql=>sql.getFirstAsync<{end_state:number;estimated:number|null}>('SELECT end_state,estimated FROM events WHERE id=?','point'));
  assert.deepEqual({...point},{end_state:0,estimated:null});
  const routines=[{id:'point',type:'pee' as const,minutes:100},{id:'false',type:'custom' as const,customLabel:'Training',minutes:200,reminder:false,toleranceMinutes:0},{id:'true',type:'meal' as const,minutes:300,reminder:true,toleranceMinutes:1440}];
  await repository.saveSchedule(routines);assert.deepEqual(await repository.loadSchedule(),routines);
  const reminders=await database.read(sql=>sql.getAllAsync<{reminder:number|null}>('SELECT reminder FROM routines ORDER BY minutes'));
  assert.deepEqual(reminders.map(row=>row.reminder),[null,0,1]);
  await assert.rejects(database.write(sql=>sql.runAsync("UPDATE events SET type='unsupported' WHERE id='point'")),/constraint/i);
  await assert.rejects(database.write(sql=>sql.runAsync("UPDATE events SET end_state=2,ended_at=99 WHERE id='point'")),/constraint/i);
  await assert.rejects(database.write(sql=>sql.runAsync("UPDATE routines SET minutes=1440 WHERE id='false'")),/constraint/i);
  assert.deepEqual(await repository.loadEvents(),saved);
});

test('transactional CRUD retains estimate provenance and optional clears in committed history', async (t) => {
  const { repository } = await setup(t);
  const first = { ...event(), estimated: true, note: 'keep' };
  await repository.appendEvents([first, event('second', 200)]);
  assert.equal(await repository.appendEvents([{ ...event(), source: 'widget' }]),undefined);
  const updated = await repository.loadEvents();
  assert.equal(updated.find((item) => item.id === first.id)!.note, 'keep');
  assert.equal(updated.find((item) => item.id === first.id)!.estimated, true);
  assert.equal(await repository.updateEvent(first.id, { at: 300, note: undefined }),undefined);
  const changed = await repository.loadEvents();
  assert.deepEqual(changed.map((item) => item.id), ['first', 'second']);
  assert.equal(changed[0].estimated, true); assert.equal(changed[0].note, undefined);
  assert.equal(await repository.removeEvent('second'),undefined);
  assert.deepEqual(await repository.loadEvents(), [changed[0]]);
});

test('duplicate CSV import does not write and preserves existing conflicting-open-nap import behavior', async (t) => {
  const { repository, database } = await setup(t);
  await repository.appendEvents([{ ...event(), note: 'newer' }]);
  assert.deepEqual(await repository.importEvents([event(), event('second')]), { imported: 1, skipped: 1 });
  assert.deepEqual(await repository.loadEvents(),[event('second'),{...event(),note:'newer'}]);
  const before = (await database.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT total_changes() AS count')))!.count;
  assert.equal((await repository.importEvents([event(), event('second')])).imported, 0);
  assert.equal((await database.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT total_changes() AS count')))!.count, before);
  const nap: PuppyEvent = { id: 'nap', type: 'nap', at: 200, endedAt: null, source: 'app' };
  await repository.appendEvents([nap]);
  await assert.rejects(repository.importEvents([{ ...nap, id: 'another-nap' }, event('not-imported')]), EventsImportError);
  assert.equal((await repository.loadEvents()).some((item) => item.id === 'not-imported'), false);
});

test('concurrent app/widget connections preserve separate appends and independent edits', async (t) => {
  const { repository, path } = await setup(t);
  const otherDatabase = await createLocalDatabase(sqliteTestConnection(path));
  const widget = createLocalRepository(otherDatabase, 'pet-1');
  try {
    await Promise.all([repository.appendEvents([event('app')]), widget.appendEvents([event('widget')])]);
    assert.deepEqual(new Set((await repository.loadEvents()).map((item) => item.id)), new Set(['app', 'widget']));
    await Promise.all([repository.updateEvent('app', { note: 'edited on app' }), widget.updateEvent('app', { at: 500 })]);
    const saved = (await repository.loadEvents()).find((item) => item.id === 'app')!;
    assert.equal(saved.at, 500); assert.equal(saved.note, 'edited on app');
  } finally { await otherDatabase.close(); }
});

test('history reads and one-row edits preserve all unchanged event object references', async (t) => {
  const { repository } = await setup(t);
  await repository.appendEvents(Array.from({ length: 1000 }, (_, index) => event(`event-${index}`, index)));
  const before = await repository.loadEvents();
  assert.equal((await repository.loadEvents())[500], before[500]);
  await repository.updateEvent('event-500', { note: 'one edit' });
  const after = await repository.loadEvents();
  assert.equal(after.filter((item, index) => item === before[index]).length, 999);
  assert.equal(after.find((item) => item.id === 'event-500')!.note, 'one edit');
});

test('failed mid-batch writes roll back every change and leave the next write usable', async (t) => {
  const { repository, database } = await setup(t);
  await repository.appendEvents([event('first'), event('second')]);
  await database.write((sql) => sql.execAsync("CREATE TRIGGER fail_update BEFORE UPDATE ON events WHEN NEW.id='second' BEGIN SELECT RAISE(ABORT,'write failure'); END;"));
  await assert.rejects(repository.appendEvents([{ ...event('first'), note: 'must roll back' }, { ...event('second'), note: 'fails' }]), /write failure/);
  assert.equal((await repository.loadEvents()).every((item) => item.note === undefined), true);
  await repository.updateEvent('first', { note: 'retry works' });
  assert.equal((await repository.loadEvents()).find((item) => item.id === 'first')!.note, 'retry works');
});

test('event and routine identity are pet-scoped and routine replacement is atomic', async (t) => {
  const { repository, database } = await setup(t);
  await database.write((sql) => sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)', 'pet-2', 'Other'));
  const other = createLocalRepository(database, 'pet-2');
  await repository.appendEvents([event()]); await other.appendEvents([{ ...event(), note: 'other puppy' }]);
  assert.equal((await repository.loadEvents())[0].note, undefined);
  assert.equal((await other.loadEvents())[0].note, 'other puppy');
  const routine = { id: 'routine', type: 'meal' as const, minutes: 500 };
  await repository.saveSchedule([routine]); await other.saveSchedule([{ ...routine, minutes: 600 }]);
  await database.write((sql) => sql.execAsync("CREATE TRIGGER fail_routine BEFORE INSERT ON routines WHEN NEW.id='fails' BEGIN SELECT RAISE(ABORT,'routine failure'); END;"));
  await assert.rejects(repository.saveSchedule([{ ...routine, id: 'fails' }]), /routine failure/);
  assert.deepEqual(await repository.loadSchedule(), [routine]);
  assert.equal((await other.loadSchedule())[0].minutes, 600);
  await assert.rejects(createLocalRepository(database, 'missing-pet').loadEvents(), /puppy/i);
});

test('corrupt saved rows reject reads and edits while retaining the original bytes', async (t) => {
  const { repository, database } = await setup(t);
  await repository.appendEvents([event()]);
  await database.write(sql=>sql.execAsync("PRAGMA ignore_check_constraints=ON; UPDATE events SET source='corrupt' WHERE id='first'; PRAGMA ignore_check_constraints=OFF;"));
  await assert.rejects(repository.loadEvents(), EventsStorageError);
  await assert.rejects(repository.updateEvent('first', { note: 'overwrite' }), EventsStorageError);
  assert.equal((await database.read(sql=>sql.getFirstAsync<{source:string}>("SELECT source FROM events WHERE id='first'")))!.source,'corrupt');
});

test('SQLite disk quota failure acknowledges no partial batch and recovers after capacity returns', async (t) => {
  const { repository, database } = await setup(t);
  await repository.appendEvents([event('saved')]);
  const pages = (await database.read((sql) => sql.getFirstAsync<{ page_count: number }>('PRAGMA page_count')))!.page_count;
  await database.read((sql) => sql.execAsync(`PRAGMA max_page_count=${pages + 1}`));
  await assert.rejects(repository.appendEvents(Array.from({ length: 20 }, (_, index) => ({ ...event(`large-${index}`), note: 'x'.repeat(16384) }))));
  assert.deepEqual(await repository.loadEvents(), [event('saved')]);
  await database.read((sql) => sql.execAsync('PRAGMA max_page_count=10000'));
  await repository.appendEvents([event('after-capacity')]);
  assert.equal((await repository.loadEvents()).length, 2);
});

test('persistent external write locks stop after bounded retries without losing existing history', async (t) => {
  const { repository, database, path } = await setup(t);
  await repository.appendEvents([event('saved')]);
  const blocker = sqliteTestConnection(path);
  await blocker.execAsync("BEGIN IMMEDIATE; UPDATE puppies SET name='Locked' WHERE id='pet-1';");
  try {
    await assert.rejects(repository.appendEvents([event('must-not-save')]), /locked|busy/i);
    assert.deepEqual(await repository.loadEvents(), [event('saved')]);
  } finally { await blocker.execAsync('ROLLBACK'); await blocker.closeAsync(); }
  await repository.appendEvents([event('after-unlock')]);
  assert.equal((await repository.loadEvents()).length, 2);
  assert.equal((await database.read((sql) => sql.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM events')))!.count, 2);
});

test('routine field edits preserve independently committed fields and newly added routines',async t=>{
 const {repository}=await setup(t);
 const original={id:'routine',type:'meal' as const,minutes:600,reminder:false,toleranceMinutes:15};
 const remote={...original,reminder:true,toleranceMinutes:30};
 const added={id:'other-device',type:'walk' as const,minutes:700};
 await repository.saveSchedule([original]);await repository.saveSchedule([remote,added]);
 assert.equal(typeof repository.saveScheduleEntry,'function');
 assert.equal(await repository.saveScheduleEntry({...original,minutes:615},original),undefined);
 assert.deepEqual(await repository.loadSchedule(),[{...remote,minutes:615},added]);
});

test('saving a deleted routine rejects without resurrection, preserving other current routines',async t=>{
 const {repository}=await setup(t);
 const original={id:'removed',type:'meal' as const,minutes:600};
 const other={id:'kept',type:'walk' as const,minutes:700};
 await repository.saveSchedule([original,other]);await repository.saveSchedule([other]);
 assert.equal(typeof repository.saveScheduleEntry,'function');
 await assert.rejects(repository.saveScheduleEntry({...original,minutes:615},original),/removed|deleted/i);
 assert.deepEqual(await repository.loadSchedule(),[other]);
});

test('routine edits validate and roll back atomically while deletion touches only the selected identity',async t=>{
 const {repository,database}=await setup(t);
 const first={id:'first',type:'meal' as const,minutes:600},other={id:'other',type:'walk' as const,minutes:700};
 await repository.saveSchedule([first,other]);
 assert.equal(typeof repository.saveScheduleEntry,'function');assert.equal(typeof repository.removeScheduleEntry,'function');
 await assert.rejects(repository.saveScheduleEntry({...first,minutes:1440},first));
 await database.write(sql=>sql.execAsync("CREATE TRIGGER fail_routine_patch BEFORE UPDATE ON routines BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;"));
 await assert.rejects(repository.saveScheduleEntry({...first,minutes:615},first),/write failure/);
 assert.deepEqual(await repository.loadSchedule(),[first,other]);
 assert.equal(await repository.removeScheduleEntry('first'),undefined);
 assert.deepEqual(await repository.loadSchedule(),[other]);
});
