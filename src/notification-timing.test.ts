import assert from 'node:assert/strict';
import test from 'node:test';
import {createEvent} from './domain.ts';
import {DEFAULT_NOTIFICATION_PREFERENCES,normalizeNotificationPreferences,scheduleReminderLead} from './notification-config.ts';
import {pottyReminderPlans,reminderCopy,reminderTrigger} from './reminder-config.ts';
import {recordDataSchema} from './cloud/protocol.ts';
import {starterMealTimes} from './onboarding-preview.ts';

test('grouped meals have editable defaults for each supported meal count',()=>{
  assert.deepEqual(starterMealTimes(1),[720]);
  assert.deepEqual(starterMealTimes(2),[420,1080]);
  assert.deepEqual(starterMealTimes(3),[420,720,1080]);
  assert.deepEqual(starterMealTimes(4),[420,660,900,1140]);
  const edited=starterMealTimes(3);edited[1]=780;
  assert.equal(starterMealTimes(3)[1],720);
});

test('meal and poop offsets can be before or after, with midnight wrapping',()=>{
  const preferences={...DEFAULT_NOTIFICATION_PREFERENCES,mealReminderOffsetMinutes:-15 as const,poopReminderOffsetMinutes:30 as const};
  assert.equal(scheduleReminderLead('meal',preferences),15);
  assert.equal(scheduleReminderLead('poop',preferences),-30);
  assert.equal(scheduleReminderLead('walk',preferences),10);
  assert.deepEqual(reminderTrigger({id:'rtn_meal',type:'meal',minutes:5},15),{hour:23,minute:50});
  assert.deepEqual(reminderTrigger({id:'rtn_poop',type:'poop',minutes:1430},-30),{hour:0,minute:20});
  assert.match(reminderCopy({id:'rtn_poop',type:'poop',minutes:1430},'en',-30).title,/30 min ago/);
});

test('after-poop reminders use the latest real log and expire instead of repeating',()=>{
  const now=1_000_000,real=createEvent('poop','app',now),estimated={...createEvent('poop','app',now+60000),estimated:true};
  const preferences={...DEFAULT_NOTIFICATION_PREFERENCES,pottyAfterPoop:{enabled:true,delayMinutes:60 as const}};
  const [plan]=pottyReminderPlans([real,estimated],preferences,now);
  assert.equal(plan.kind,'afterPoop');assert.equal(plan.sourceEventId,real.id);assert.equal(plan.at,now+3_600_000);
  assert.deepEqual(pottyReminderPlans([real],preferences,now+3_600_000),[]);
  assert.deepEqual(pottyReminderPlans([real],DEFAULT_NOTIFICATION_PREFERENCES,now),[]);
});

test('timing preferences validate at storage and sync boundaries without changing old defaults',()=>{
  assert.deepEqual(normalizeNotificationPreferences({mealReminderOffsetMinutes:999,poopReminderOffsetMinutes:'15'}),DEFAULT_NOTIFICATION_PREFERENCES);
  const values={mealReminderOffsetMinutes:-15,poopReminderOffsetMinutes:30,pottyAfterPoop:{enabled:true,delayMinutes:180}};
  assert.deepEqual(normalizeNotificationPreferences(values),{...DEFAULT_NOTIFICATION_PREFERENCES,...values});
  assert.ok(recordDataSchema('accountPreferences').safeParse({mealReminderOffsetMinutes:-15,poopReminderOffsetMinutes:30,pottyAfterPoopEnabled:true,pottyAfterPoopDelayMinutes:180}).success);
  assert.equal(recordDataSchema('accountPreferences').safeParse({poopReminderOffsetMinutes:999}).success,false);
});
