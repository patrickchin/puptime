const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const grantedAction = 'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED';
const marker = '// Puptime: exact reminder access.';

module.exports = function withAndroidExactReminders(config) {
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] ??= [];
    if (!manifest['uses-permission'].some(item => item.$['android:name'] === 'android.permission.SCHEDULE_EXACT_ALARM')) {
      manifest['uses-permission'].push({ $: { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM' } });
    }
    const application = manifest.application[0];
    application.receiver ??= [];
    let receiver = application.receiver.find(item => item.$['android:name'] === 'expo.modules.notifications.service.NotificationsService');
    if (!receiver) {
      receiver = { $: { 'android:name': 'expo.modules.notifications.service.NotificationsService', 'android:exported': 'false' }, 'intent-filter': [] };
      application.receiver.push(receiver);
    }
    if (!receiver['intent-filter'].some(filter => filter.action?.some(action => action.$['android:name'] === grantedAction))) {
      receiver['intent-filter'].push({ action: [{ $: { 'android:name': grantedAction } }] });
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const library = path.dirname(require.resolve('expo-notifications/package.json', { paths: [mod.modRequest.projectRoot] }));
    const root = path.join(library, 'android/src/main/java/expo/modules/notifications');
    const schedulerPath = path.join(root, 'notifications/scheduling/NotificationScheduler.kt');
    let scheduler = fs.readFileSync(schedulerPath, 'utf8');
    if (!scheduler.includes(marker)) {
      const anchor = '    Name("ExpoNotificationScheduler")';
      if (!scheduler.includes(anchor)) throw new Error('Expo notification scheduler changed; review exact reminder access.');
      scheduler = scheduler.replace(anchor, `${anchor}

    ${marker}
    AsyncFunction("canScheduleExactRemindersAsync") {
      android.os.Build.VERSION.SDK_INT < 31 ||
        (schedulingContext.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager).canScheduleExactAlarms()
    }
    AsyncFunction("openExactReminderSettingsAsync") {
      if (android.os.Build.VERSION.SDK_INT >= 31) {
        schedulingContext.startActivity(android.content.Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
          .setData(android.net.Uri.parse("package:" + schedulingContext.packageName))
          .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
    AsyncFunction("restoreScheduledRemindersAsync") {
      expo.modules.notifications.service.delegates.ExpoSchedulingDelegate(schedulingContext).setupScheduledNotifications()
    }`);
      fs.writeFileSync(schedulerPath, scheduler);
    }
    const servicePath = path.join(root, 'service/NotificationsService.kt');
    let service = fs.readFileSync(servicePath, 'utf8');
    if (!service.includes(`"${grantedAction}"`)) {
      const anchor = '    val SETUP_ACTIONS = listOf(';
      const receive = '    if (SETUP_ACTIONS.contains(intent.action)) {';
      if (!service.includes(anchor) || !service.includes(receive)) throw new Error('Expo notification restore receiver changed.');
      service = service.replace(anchor, `${anchor}\n      "${grantedAction}",`)
        .replace(receive, `    // Permission can be revoked again before this broadcast arrives.
    if (intent.action == "${grantedAction}" && android.os.Build.VERSION.SDK_INT >= 31 &&
      !(context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager).canScheduleExactAlarms()) return
${receive}`);
      fs.writeFileSync(servicePath, service);
    }
    return mod;
  }]);
};
