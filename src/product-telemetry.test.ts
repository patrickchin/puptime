import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductTelemetry, sanitizeProductEvent, telemetryControl, type ProductEvent, type ProductProperties } from './product-telemetry.ts';

function fixture() {
  let time = 0;
  const events: { event: ProductEvent; properties: ProductProperties }[] = [];
  const telemetry = createProductTelemetry((event, properties) => events.push({ event, properties }), () => time);
  return { telemetry, events, at: (value: number) => { time = value; } };
}

test('foreground dwell checkpoints add up once and exclude background time', () => {
  const { telemetry: t, events, at } = fixture();
  t.setForeground(true); at(100); t.setEnabled(true);
  at(1100); t.checkpoint('checkpoint');
  at(2100); t.setScreen('timeline');
  at(3100); t.setForeground(false);
  at(100_000); t.setForeground(true);
  at(101_000); t.setScreen('log');
  const transitions = events.filter(e => e.event === 'app_navigation');
  assert.deepEqual(transitions.map(e => [e.properties.from_screen, e.properties.to_screen, e.properties.duration_ms]), [
    ['log', 'timeline', 2000], ['timeline', 'log', 2000],
  ]);
  const times = events.filter(e => e.event === 'app_screen_time');
  assert.equal(times.reduce((total, e) => total + Number(e.properties.duration_ms), 0), 4000);
  assert.equal(events.filter(e => e.event === 'app_screen_view').length, 4);
});

test('nested editor/history overlays own their time without changing underlying rows', () => {
  const { telemetry: t, events, at } = fixture();
  t.setForeground(true); t.setEnabled(true);
  at(100); const closeEditor = t.overlay('log_editor');
  at(200); const closeHistory = t.overlay('log_history');
  at(300); t.setScreen('timeline');
  closeEditor(); // Parent can unmount before a child cleans up.
  assert.equal(events.at(-1)?.properties.screen, 'log_history');
  at(400); closeHistory(); closeHistory();
  assert.deepEqual(events.filter(e => e.event === 'app_navigation').map(e => e.properties.to_screen), ['log_editor', 'log_history', 'timeline']);
});

test('consent defaults off, withdrawal drops intervals and reconsent starts fresh', () => {
  const { telemetry: t, events, at } = fixture();
  t.setForeground(true); t.setScreen('settings'); t.capture('app_press', { control: 'nav.open' });
  at(1000); t.checkpoint('checkpoint'); assert.equal(events.length, 0);
  t.setEnabled(true); at(2000); t.setEnabled(false);
  const length = events.length;
  t.capture('app_log_action', { action: 'create', activity_type: 'pee' });
  at(10_000); t.checkpoint('checkpoint'); assert.equal(events.length, length);
  t.setEnabled(true); at(10_100); t.setScreen('log');
  assert.equal(events.at(-2)?.properties.duration_ms, 100);
});

test('screen updates and repeated foreground notifications do not create visits', () => {
  const { telemetry: t, events } = fixture();
  t.setForeground(true); t.setEnabled(true);
  t.setForeground(true); t.setEnabled(true); t.setScreen('log');
  assert.equal(events.filter(e => e.event === 'app_screen_view').length, 1);
});

test('schema strips private content, rejects unknown events and normalizes dynamic IDs', () => {
  const privateText = 'private@example.com secret note puppy name';
  const safe = sanitizeProductEvent('app_log_action', { screen: 'log_editor', action: 'update', activity_type: 'custom', result: 'success', note: privateText, customLabel: privateText, pet_id: 'pet_secret', email: privateText });
  assert.deepEqual(safe, { screen: 'log_editor', schema_version: 1, action: 'update', activity_type: 'custom', result: 'success' });
  assert.equal(sanitizeProductEvent('$autocapture', { screen: 'log' }), null);
  assert.equal(sanitizeProductEvent('app_screen_view', { screen: privateText }), null);
  assert.equal(sanitizeProductEvent('app_press', { screen: 'log', control: privateText }), null);
  assert.equal(telemetryControl('settings.widget.action.custom:' + privateText), 'settings.widget.action.custom');
  assert.equal(telemetryControl('timeline.mark.point.2026-10-27.12'), 'timeline.mark.point');
  assert.equal(telemetryControl('history.day.2026-10-27'), 'history.day');
  assert.equal(telemetryControl('event.custom.edit'), 'event.custom.edit');
  assert.equal(sanitizeProductEvent('app_press', { screen: 'log', control: 'history.day' })?.control, 'history.day');
  assert.equal(telemetryControl('nav.' + privateText), undefined);
  const press = sanitizeProductEvent('app_press', { screen: 'log', control: 'quick.pee', press_duration_ms: NaN, duration_ms: Infinity, count: -1 });
  assert.deepEqual(press, { screen: 'log', schema_version: 1, control: 'quick.pee' });
});

test('an analytics failure never breaks the UI action', () => {
  const t = createProductTelemetry(() => { throw new Error('offline'); });
  assert.doesNotThrow(() => { t.setEnabled(true); t.setForeground(true); t.setScreen('schedule'); });
});
