import { openDatabaseAsync } from 'expo-sqlite';
import { createLocalDatabase, initializeLocalDatabase } from './database';

// Both native platforms use this private connection and the same typed schema.
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
