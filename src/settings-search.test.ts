import assert from 'node:assert/strict';
import test from 'node:test';
import { translate, type AppLanguage } from './localization.ts';
import { findSettings, type SettingSearchId } from './settings-search.ts';

const available: SettingSearchId[] = ['appearance', 'language', 'notifications', 'widget', 'backups', 'csv', 'history', 'analytics', 'guide', 'privacy', 'account'];
const search = (query: string, language: AppLanguage = 'en', ids = available) => [...findSettings(query, key => translate(language, key), ids)];

test('settings search finds labels, partial words, synonyms, and one-edit typos', () => {
  for (const query of ['appearance', 'APPÉARANCE', '  dark  mode ', 'color', 'apperance', 'appeaarance', 'appearxnce']) {
    assert.ok(search(query).includes('appearance'), query);
  }
  for (const query of ['widgte', 'shortcuts', 'quick-log']) assert.ok(search(query).includes('widget'), query);
  for (const query of ['notifictaions', 'notificta', 'reminders', 'potty', 'quiet status']) assert.ok(search(query).includes('notifications'), query);
  assert.ok(search('restore').includes('backups'));
  assert.ok(search('download').includes('csv'));
  assert.ok(search('deleted versions').includes('history'));
  assert.ok(search('tutorial').includes('guide'));
  assert.ok(search('data collection').includes('analytics'));
  assert.ok(search('sign in').includes('account'));
});

test('settings search respects language, accents, word order, and real availability', () => {
  assert.ok(search('apariencia', 'es').includes('appearance'));
  assert.ok(search('analisis', 'es').includes('analytics'));
  assert.ok(search('sesion', 'es').includes('account'));
  assert.ok(search('恢复', 'zh-Hans').includes('backups'));
  assert.ok(search('中文', 'zh-Hans').includes('language'));
  assert.ok(search('模式 深色', 'zh-Hans').includes('appearance'));
  assert.deepEqual(search('account', 'en', ['appearance', 'language']), []);
  assert.deepEqual(search(''), available);
  assert.deepEqual(search('   '), available);
  assert.deepEqual(search('?!'), available);
  assert.deepEqual(search('spaceship refrigerator'), []);
  assert.deepEqual(search('xyz'), []);
  assert.deepEqual(search('dark notifications'), []);
  assert.deepEqual(search('灯', 'zh-Hans'), []);
});
