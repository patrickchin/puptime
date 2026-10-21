import { Directory, File, Paths } from 'expo-file-system';
import { backupFileName, type BackupFiles } from './activity-backups';

export function localBackupFiles(): BackupFiles {
  const directory = new Directory(Paths.document, 'activity-backups');
  const file = (id: string) => {
    if (!backupFileName.test(id)) throw new Error('Invalid backup identifier.');
    return new File(directory, id);
  };
  return {
    async list() {
      if (!directory.exists) return [];
      return directory.list().filter((entry): entry is File => entry instanceof File && backupFileName.test(entry.name))
        .map(entry => ({ id: entry.name, bytes: entry.size }));
    },
    read: id => file(id).text(),
    async write(id, content) {
      directory.create({ intermediates: true, idempotent: true });
      const temporary = new File(directory, `${id}.tmp`);
      try {
        temporary.create({ overwrite: true });
        temporary.write(content);
        await temporary.move(file(id));
      } finally { if (temporary.exists && temporary.name.endsWith('.tmp')) temporary.delete(); }
    },
    async remove(id) { file(id).delete(); },
  };
}
