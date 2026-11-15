import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncDiagnostics } from './sync-diagnostics.ts';

test('diagnostics retain only bounded allowlisted data and sanitize persisted history again', async () => {
  let saved = JSON.stringify([
    { at: 1, event: 'request', result: 'error', route: 'push', status: 400, note: 'PRIVATE_NOTE', accountId: 'PRIVATE_ACCOUNT' },
    { at: 2, event: 'request', result: 'error', route: 'https://PRIVATE_URL.test/?token=PRIVATE_TOKEN' },
  ]);
  const storage = { getItem: async () => saved, setItem: async (_key: string, value: string) => { saved = value; } };
  let time = 10;
  const diagnostics = createSyncDiagnostics(storage, () => time++);
  assert.deepEqual(await diagnostics.read(), [{ at: 1, event: 'request', result: 'error', route: 'push', status: 400 }]);
  const input = { event: 'sync' as const, result: 'started' as const, pending: 7, blocked: 0, note: 'PRIVATE_INPUT', url: 'https://PRIVATE_URL.test', error: new Error('PRIVATE_ERROR') };
  diagnostics.record(input);
  diagnostics.record({ event: 'request', result: 'error', status: Infinity });
  await diagnostics.flush();
  assert.equal((await diagnostics.read()).length, 2);
  assert.ok(!saved.includes('PRIVATE'));
  for (let i = 0; i < 105; i++) diagnostics.record({ event: 'sync', result: 'success', pending: i });
  await diagnostics.flush();
  const reloaded = createSyncDiagnostics(storage);
  const events = await reloaded.read();
  assert.equal(events.length, 100);
  assert.equal(events[0].event==='sync'&&events[0].pending, 5);
  const last=events.at(-1);assert.equal(last?.event==='sync'&&last.pending, 104);
  if(events[0].event==='sync')events[0].pending = 999;
  const first=(await reloaded.read())[0];assert.equal(first.event==='sync'&&first.pending, 5);
});

test('logging during asynchronous load keeps both histories and recovers after storage failures', async () => {
  let release!: (value: string | null) => void, fail = true, stored = '';
  const storage = {
    getItem: () => new Promise<string | null>(resolve => { release = resolve; }),
    setItem: async (_key: string, value: string) => { if (fail) throw new Error('unavailable'); stored = value; },
  };
  const diagnostics = createSyncDiagnostics(storage, () => 20);
  diagnostics.record({ event: 'sync', result: 'started', pending: 4 });
  await Promise.resolve();
  release(JSON.stringify([{ at: 10, event: 'request', result: 'error', route: 'account', status: 503 }]));
  await diagnostics.flush();
  assert.deepEqual((await diagnostics.read()).map(value => value.at), [10, 20]);
  fail = false;
  diagnostics.record({ event: 'sync', result: 'success', pending: 0 });
  await diagnostics.flush();
  assert.equal(JSON.parse(stored).length, 3);
  const corrupt = createSyncDiagnostics({ getItem: async () => 'invalid JSON', setItem: storage.setItem });
  await assert.doesNotReject(corrupt.read());
});


test('device-only onboarding records use the same bounded ring and strip private fields again after restart',async()=>{
 let saved=JSON.stringify([{at:1,event:'onboarding',point:'guest-handler',step:'welcome',accountActionPending:false,email:'PRIVATE_EMAIL',input:'PRIVATE_NAME',sessionId:'PRIVATE_ID'}]);
 const storage={getItem:async()=>saved,setItem:async(_key:string,value:string)=>{assert.equal(_key,'puptime.sync.diagnostics.v1');saved=value;}};
 const ring=createSyncDiagnostics(storage,()=>2);
 assert.deepEqual(await ring.read(),[{at:1,event:'onboarding',point:'guest-handler',step:'welcome',accountActionPending:false}]);
 ring.record({event:'onboarding',point:'profile-decision',step:'welcome',decision:'accepted',...( {url:'PRIVATE_URL',error:new Error('PRIVATE_MESSAGE'),stack:'PRIVATE_STACK'} as {})});
 for(const field of ['point','step','decision','animation','accountActionPending'])ring.record({event:'onboarding',point:'screen',step:'welcome',[field]:'PRIVATE_VALUE'} as never);
 await ring.flush();assert.equal((await ring.read()).length,2);assert.ok(!saved.includes('PRIVATE'));
 for(let i=0;i<105;i++)ring.record(i%2?{event:'sync',result:'success',pending:i}:{event:'onboarding',point:'screen',step:'profile',accountActionPending:false});
 await ring.flush();const reopened=createSyncDiagnostics(storage,()=>3);const entries=await reopened.read();assert.equal(entries.length,100);assert.ok(entries.some(row=>row.event==='sync'));assert.ok(entries.some(row=>row.event==='onboarding'));
 assert.ok(!saved.includes('PRIVATE'));assert.deepEqual(await reopened.read(),entries);
});
