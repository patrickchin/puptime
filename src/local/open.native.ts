import AsyncStorage from '@react-native-async-storage/async-storage';
import { openDatabaseAsync } from 'expo-sqlite';
import { createLocalDatabase, migrateLegacy } from './database';
import { legacyKeys, parseLegacySnapshot } from './legacy';

// The iOS facade uses this private connection; Android activation is deferred.
export async function openLocalDatabase() {
  const connection = await openDatabaseAsync('puptime-v2.db', { useNewConnection: true, enableChangeListener: true });
  try {
    const database = await createLocalDatabase(connection);
    const migration = await migrateLegacy(database, async () => parseLegacySnapshot(await AsyncStorage.multiGet(legacyKeys)));
    return { database, petId: migration.petId };
  } catch (error) {
    await connection.closeAsync();
    throw error;
  }
}
