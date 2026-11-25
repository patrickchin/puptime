import { registerRootComponent } from 'expo';
import { useEffect } from 'react';
import { File, Paths } from 'expo-file-system';
import { openLocalDatabase } from './src/local/open.native';
import { sqliteEngineReceipt } from './scripts/native-activity-probe/sqlite-engine';

async function recordSqliteEngine() {
  const file = new File(Paths.document, 'sqlite-engine-probe.json');
  file.create({ overwrite: true });
  const { database } = await openLocalDatabase(undefined, 'puptime-engine-probe.db');
  let value, failed = false;
  try { value = await sqliteEngineReceipt(database); }
  catch (error) { failed = true; throw error; }
  finally {
    try { await database.close(); }
    catch (error) { if (!failed) throw error; }
  }
  file.write(JSON.stringify(value));
}

registerRootComponent(function SqliteEngineProbe() {
  useEffect(() => { void recordSqliteEngine(); }, []);
  return null;
});
