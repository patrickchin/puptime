import { normalizeActivityCustomizations, type ActivityCustomization } from '../activity-customization.ts';
import { customActivityKey, DEFAULT_WIDGET_ACTIONS, normalizeCustomActivities, normalizeWidgetActions, type ActivityKey, type PuppyEvent } from '../domain.ts';
import { isLanguagePreference, type LanguagePreference } from '../localization.ts';
import { DEFAULT_NOTIFICATION_PREFERENCES, normalizeNotificationPreferences, type NotificationPreferences } from '../notification-config.ts';
import { isThemePreference, type ThemePreference } from '../theme.ts';
import type { LocalDatabase, SqlExecutor } from './database.ts';
import { petSettingKeys, storageKeys, type StorageKey } from './settings.ts';
import { createLocalRepository } from './repository.ts';
import { localChanges, notifyLocalCommit, readLocalSettingsRecords, type LocalChangeSink } from './sync-projection.ts';
import { recordDataSchema } from '../cloud/protocol.ts';
import type { FinishOnboardingOptions } from '../onboarding.ts';
import {firstLaunchStepSchema,type FirstLaunchStep,type FirstLaunchProgress} from '../first-launch.ts';
import type { BackupGuard } from './activity-backups.ts';

export function createNativeStorage(database: LocalDatabase, petId: string, onChange?: LocalChangeSink, afterCommit?:()=>void, beforeChange?:BackupGuard) {
  const repository = createLocalRepository(database, petId, onChange,afterCommit,beforeChange);
  async function settingsWrite<T>(action:(sql:SqlExecutor)=>Promise<T>):Promise<T> {
    let changed=false;
    const result=await database.write(async sql=> {
      const before=(onChange||afterCommit)?await readLocalSettingsRecords(sql,petId):[];
      const result=await action(sql);
      if (onChange||afterCommit) {const changes=localChanges(before,await readLocalSettingsRecords(sql,petId));if (changes.length) {await onChange?.(sql,changes);changed=true;}}
      return result;
    });
    if (changed) notifyLocalCommit(afterCommit);
    return result;
  }
  async function get(sql: SqlExecutor, key: StorageKey) {
    const row = petSettingKeys.has(key)
      ? await sql.getFirstAsync<{ value: string }>('SELECT value FROM pet_settings WHERE pet_id=? AND key=?', petId, key)
      : await sql.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
    return row?.value ?? null;
  }
  async function set(sql: SqlExecutor, key: StorageKey, value: string) {
    if (petSettingKeys.has(key)) await sql.runAsync('INSERT INTO pet_settings(pet_id,key,value) VALUES (?,?,?) ON CONFLICT(pet_id,key) DO UPDATE SET value=excluded.value', petId, key, value);
    else await sql.runAsync('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
  }
  async function json(sql: SqlExecutor, key: StorageKey): Promise<unknown> {
    const raw = await get(sql, key);
    if (raw === null) return null;
    try { const value: unknown = JSON.parse(raw); if (value === null) throw new Error('Invalid null setting.'); return value; } catch { throw new Error('Saved settings could not be read. The original value has been preserved.'); }
  }
  async function strings(sql: SqlExecutor, key: StorageKey): Promise<string[]> {
    const value = await json(sql, key);
    if (value === null) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('Saved settings contain an invalid collection.');
    return value;
  }
  async function object(sql: SqlExecutor, key: StorageKey): Promise<object | null> {
    const value = await json(sql, key);
    if (value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved settings contain an invalid object.');
    return value;
  }
  async function activities(sql: SqlExecutor) {
    const stored = await strings(sql, storageKeys.customActivities);
    const deleted = await strings(sql, storageKeys.deletedCustomActivities);
    return normalizeCustomActivities(stored, deleted);
  }
  async function customizations(sql: SqlExecutor) { return normalizeActivityCustomizations(await object(sql, storageKeys.activityCustomizations)); }
  async function firstLaunch(sql:SqlExecutor):Promise<FirstLaunchProgress|null> {
    const shown=await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='show_onboarding'");
    const checkpoint=await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='first_launch_step'");
    if(!shown||!['true','false'].includes(shown.value))throw new Error('Saved setup state is invalid.');
    if(shown.value==='false'){
      if(checkpoint&&checkpoint.value!=='done')throw new Error('Saved setup completion is inconsistent.');
      return null;
    }
    const step=firstLaunchStepSchema.parse(checkpoint?.value??'welcome');
    const pet=await sql.getFirstAsync<{name:string}>('SELECT name FROM puppies WHERE id=?',petId);
    const puppy=recordDataSchema('puppy').parse({name:pet?.name});
    if(!('name' in puppy))throw new Error('The local puppy could not be found.');
    return {step,puppyName:puppy.name};
  }
  async function checkpoint(sql:SqlExecutor,step:FirstLaunchStep|'done') {
    await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('first_launch_step',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",step);
  }
  return {
    loadEvents: repository.loadEvents, appendEvents: repository.appendEvents, importEvents: repository.importEvents,
    removeEvent: repository.removeEvent, updateEvent: repository.updateEvent, updateEventTime: repository.updateEventTime,
    loadSchedule: repository.loadSchedule, saveSchedule: repository.saveSchedule,
    saveScheduleEntry:repository.saveScheduleEntry,removeScheduleEntry:repository.removeScheduleEntry,
    loadPuppyName:()=>database.read(async sql=>{const pet=await sql.getFirstAsync<{name:string}>('SELECT name FROM puppies WHERE id=?',petId);if (!pet) throw new Error('The local puppy could not be found.');return pet.name;}),
    savePuppyName:(name:string)=>settingsWrite(async sql=>{const value=recordDataSchema('puppy').parse({name});if (!('name' in value)) throw new Error('Invalid puppy name.');await sql.runAsync('UPDATE puppies SET name=? WHERE id=?',value.name,petId);}),
    async shouldShowOnboarding() {
      return database.read(async (sql) => (await sql.getFirstAsync<{ value: string }>("SELECT value FROM metadata WHERE key='show_onboarding'"))?.value === 'true');
    },
    loadFirstLaunch:()=>database.read(firstLaunch),
    loadNotificationDelivery:()=>database.read(async sql=>{
      const flag=await sql.getFirstAsync<{value:string}>("SELECT value FROM metadata WHERE key='notify_on_device'");
      if(flag){if(!['true','false'].includes(flag.value))throw new Error('Saved device notification choice is invalid.');return flag.value==='true';}
      return await firstLaunch(sql)===null;
    }),
    async saveNotificationDelivery(enabled:boolean) {
      if(typeof enabled!=='boolean')throw new TypeError('Invalid device notification choice.');
      await database.write(sql=>sql.runAsync("INSERT INTO metadata(key,value) VALUES ('notify_on_device',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(enabled)));
    },
    async saveFirstLaunchStep(step:FirstLaunchStep) {
      firstLaunchStepSchema.parse(step);
      await database.write(async sql=>{
        if(!await firstLaunch(sql))throw new Error('Setup is already complete.');
        await checkpoint(sql,step);
      });
    },
    async saveFirstLaunchProfile(name:string) {
      await settingsWrite(async sql=>{
        if(!await firstLaunch(sql))throw new Error('Setup is already complete.');
        const puppy=recordDataSchema('puppy').parse({name:name.trim()||'My puppy'});
        if(!('name' in puppy))throw new Error('Invalid puppy name.');
        await sql.runAsync('UPDATE puppies SET name=? WHERE id=?',puppy.name,petId);
        await checkpoint(sql,'account');
      });
    },
    async completeOnboarding(options?:FinishOnboardingOptions) {
      await settingsWrite(async (sql) => {
        if(!await firstLaunch(sql))return;
        if(options?.puppyName!==undefined){
          const value=recordDataSchema('puppy').parse({name:options.puppyName.trim()||'My puppy'});
          if(!('name' in value))throw new Error('Invalid puppy name.');
          await sql.runAsync('UPDATE puppies SET name=? WHERE id=?',value.name,petId);
        }
        await sql.runAsync("UPDATE metadata SET value='false' WHERE key='show_onboarding'");
        await checkpoint(sql,'done');
        await sql.runAsync("INSERT OR IGNORE INTO metadata(key,value) VALUES ('notify_on_device','false')");
        await set(sql, storageKeys.onboarding, 'done');
      });
    },
    loadThemePreference: () => database.read(async (sql) => { const value = await get(sql, storageKeys.theme); return isThemePreference(value) ? value : 'system'; }),
    saveThemePreference: (value: ThemePreference) => settingsWrite((sql) => set(sql, storageKeys.theme, value)),
    loadLanguagePreference: () => database.read(async (sql) => { const value = await get(sql, storageKeys.language); return isLanguagePreference(value) ? value : 'system'; }),
    saveLanguagePreference: (value: LanguagePreference) => settingsWrite((sql) => set(sql, storageKeys.language, value)),
    loadCustomActivities: (_events?: PuppyEvent[]) => database.read(activities),
    async saveCustomActivity(label: string) {
      return settingsWrite(async (sql) => {
        const key = customActivityKey(label);
        const deleted = await strings(sql, storageKeys.deletedCustomActivities);
        if (deleted.includes(key)) await set(sql, storageKeys.deletedCustomActivities, JSON.stringify(deleted.filter((item) => item !== key)));
        const next = normalizeCustomActivities([...await activities(sql), label]);
        await set(sql, storageKeys.customActivities, JSON.stringify(next)); return next;
      });
    },
    async deleteCustomActivity(label: string) {
      return settingsWrite(async (sql) => {
        const key = customActivityKey(label);
        await set(sql, storageKeys.deletedCustomActivities, JSON.stringify([...new Set([...await strings(sql, storageKeys.deletedCustomActivities), key])]));
        const next = normalizeCustomActivities((await activities(sql)).filter((item) => customActivityKey(item) !== key));
        await set(sql, storageKeys.customActivities, JSON.stringify(next));
        const values = await customizations(sql); delete values[key];
        await set(sql, storageKeys.activityCustomizations, JSON.stringify(values)); return next;
      });
    },
    loadActivityCustomizations: () => database.read(customizations),
    saveActivityCustomization: (key: ActivityKey, value: ActivityCustomization) => settingsWrite(async (sql) => {
      const next = { ...await customizations(sql), [key]: value };
      await set(sql, storageKeys.activityCustomizations, JSON.stringify(next)); return next;
    }),
    loadWidgetActions: (customActivities?: string[]) => database.read(async (sql) => {
      const raw = await get(sql, storageKeys.widgetActions);
      if (raw === null) return [...DEFAULT_WIDGET_ACTIONS];
      return normalizeWidgetActions(await strings(sql, storageKeys.widgetActions), customActivities ?? await activities(sql));
    }),
    saveWidgetActions: (actions: ActivityKey[]) => settingsWrite(async (sql) => {
      await set(sql, storageKeys.widgetActions, JSON.stringify(normalizeWidgetActions(actions, await activities(sql))));
    }),
    loadNotificationPreferences: () => database.read(async (sql) => normalizeNotificationPreferences(await object(sql, storageKeys.notificationPreferences) ?? DEFAULT_NOTIFICATION_PREFERENCES)),
    saveNotificationPreferences: (value: NotificationPreferences) => settingsWrite((sql) => set(sql, storageKeys.notificationPreferences, JSON.stringify(normalizeNotificationPreferences(value)))),
  };
}
