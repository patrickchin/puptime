import { openDatabaseAsync } from 'expo-sqlite';
import { createLocalDatabase, initializeLocalDatabase } from './database';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { entityId } from '../entity-id';
import { localBackupFiles } from './backup-files.native';
import { checkpointBeforeUpgrade, createBackupGuard, existingBackupPet } from './backup-guard';
import type { PuppyEvent } from '../domain';
import type { ActivityBackup } from './activity-backups';

// Both native platforms use this private connection and the same typed schema.
export async function openLocalDatabase(restore: (events: PuppyEvent[], puppy: Pick<ActivityBackup, 'petId' | 'puppyName'>) => Promise<{ imported: number; skipped: number }> = async () => { throw new Error('Recovery is not ready.'); }) {
  const connection = await openDatabaseAsync('puptime-v2.db', { useNewConnection: true, enableChangeListener: true });
  try {
    const database = await createLocalDatabase(connection);
    if (!nativeApplicationVersion || !nativeBuildVersion) throw new Error('The installed app version could not be read.');
    const appVersion = `${nativeApplicationVersion}/${nativeBuildVersion}`;
    const makeGuard = (petId: string) => createBackupGuard({ files: localBackupFiles(), petId, appVersion, newId: () => entityId('bkp'), restore });
    const previousPet = await database.read(existingBackupPet);
    let guard = previousPet ? makeGuard(previousPet) : undefined;
    const {petId} = await initializeLocalDatabase(database, undefined, guard ? sql => checkpointBeforeUpgrade(sql, appVersion, guard!.checkpoint) : undefined);
    guard ??= makeGuard(petId);
    if (!previousPet) await database.write(sql => sql.runAsync("INSERT INTO metadata(key,value) VALUES ('backup_app_version',?)", appVersion));
    return { database, petId, ...guard };
  } catch (error) {
    await connection.closeAsync();
    throw error;
  }
}
