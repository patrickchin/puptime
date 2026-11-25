import { registerRootComponent } from 'expo';
import { useEffect } from 'react';
import { File, Paths } from 'expo-file-system';
import { openLocalDatabase } from '../src/local/open.native';
import { sqliteEngineReceipt } from './native-activity-probe/sqlite-engine';

async function recordSqliteEngine() {
  const mark = stage => {
    try {
      const marker = new File(Paths.document, 'sqlite-engine-stage.txt');
      marker.create({ overwrite: true });
      marker.write(stage);
    } catch {}
  };
  mark('file-create');
  const file = new File(Paths.document, 'sqlite-engine-probe.json');
  file.create({ overwrite: true });
  mark('database-open');
  const { database } = await openLocalDatabase(undefined, 'puptime-engine-probe.db');
  let value, failed = false;
  mark('query');
  try { value = await sqliteEngineReceipt(database); }
  catch (error) { failed = true; throw error; }
  finally {
    mark(failed ? 'close-after-query-error' : 'close-after-query');
    try { await database.close(); }
    catch (error) { if (!failed) throw error; }
  }
  mark('receipt-write');
  file.write(JSON.stringify(value));
  mark('complete');
}

registerRootComponent(function SqliteEngineProbe() {
  useEffect(() => { void recordSqliteEngine(); }, []);
  return null;
});
