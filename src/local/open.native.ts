import { openDatabaseAsync } from 'expo-sqlite';
import { createLocalDatabase, initializeLocalDatabase } from './database';

// The iOS facade uses this private connection; Android activation is deferred.
export async function openLocalDatabase() {
  const connection = await openDatabaseAsync('puptime-v2.db', { useNewConnection: true, enableChangeListener: true });
  try {
    const database = await createLocalDatabase(connection);
    const {petId} = await initializeLocalDatabase(database);
    return { database, petId };
  } catch (error) {
    await connection.closeAsync();
    throw error;
  }
}
