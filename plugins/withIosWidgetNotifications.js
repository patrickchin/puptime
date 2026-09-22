const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const marker = '// Puptime: widget log notification bridge.';

const bridge = `${marker}
private final class PuptimeWidgetNotificationBridge {
  static let shared = PuptimeWidgetNotificationBridge()
  private var observer: NSObjectProtocol?

  func start() {
    guard observer == nil else { return }
    observer = NotificationCenter.default.addObserver(
      forName: Notification.Name("onExpoWidgetsUserInteraction"),
      object: nil,
      queue: nil
    ) { [weak self] notification in
      self?.handle(notification)
    }
  }

  private func handle(_ notification: Notification) {
    guard
      let event = notification.userInfo?["eventData"] as? [String: Any],
      let target = event["target"] as? String,
      let timestamp = event["timestamp"] as? Int
    else { return }

    let parts = target.split(separator: "|", maxSplits: 3).map(String.init)
    guard parts.count == 4, parts[0] == "log", parts[2] == "1" else { return }
    let type = parts[1]
    let language = parts[3]
    guard ["pee", "poop", "meal", "pottyTrip", "walk", "nap"].contains(type) else { return }

    let content = UNMutableNotificationContent()
    content.title = title(language)
    content.body = body(type, language)
    content.sound = .default
    content.categoryIdentifier = "puptimeWidgetLog"
    content.userInfo = ["kind": "widgetLog", "type": type, "at": timestamp]

    let request = UNNotificationRequest(
      identifier: "puptime-widget-\\(timestamp)-\\(type)",
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
    )
    UNUserNotificationCenter.current().add(request) { error in
      if let error {
        print("[Puptime] Widget confirmation could not be scheduled: \\(error.localizedDescription)")
      }
    }
  }

  private func title(_ language: String) -> String {
    switch language {
    case "zh-Hans": return "活动已记录"
    case "es": return "Actividad registrada"
    default: return "Activity logged"
    }
  }

  private func body(_ type: String, _ language: String) -> String {
    let activity: String
    switch language {
    case "zh-Hans":
      activity = [
        "pee": "尿尿", "poop": "便便", "meal": "吃饭", "pottyTrip": "外出如厕", "walk": "散步", "nap": "小睡"
      ][type] ?? type
      return "已通过小组件记录：\\(activity)。"
    case "es":
      activity = [
        "pee": "Pipí", "poop": "Caca", "meal": "Comida", "pottyTrip": "Salida al baño", "walk": "Paseo", "nap": "Siesta"
      ][type] ?? type
      return "Se guardó \\(activity) desde el widget."
    default:
      activity = [
        "pee": "Pee", "poop": "Poop", "meal": "Meal", "pottyTrip": "Potty trip", "walk": "Walk", "nap": "Nap"
      ][type] ?? type
      return "\\(activity) was saved from your widget."
    }
  }
}
`;

module.exports = function withIosWidgetNotifications(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const indexPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'ExpoWidgetsTarget',
        'index.swift',
      );
      if (!fs.existsSync(indexPath)) {
        throw new Error('Puptime could not find the Expo widget target. Keep this plugin before expo-widgets.');
      }

      let source = fs.readFileSync(indexPath, 'utf8');
      if (!source.includes(marker)) {
        const widgetBundleAnchor = '@main\nstruct ExportWidgets0: WidgetBundle {';
        if (!source.includes(widgetBundleAnchor)) {
          throw new Error('Puptime could not patch the generated Expo widget bundle entry point.');
        }
        if (!source.includes('import UserNotifications')) {
          source = source.replace('import SwiftUI\n', 'import SwiftUI\nimport UserNotifications\n');
        }
        source = source.replace(
          widgetBundleAnchor,
          `${bridge}\n@main\nstruct ExportWidgets0: WidgetBundle {\n  init() {\n    PuptimeWidgetNotificationBridge.shared.start()\n  }`,
        );
        fs.writeFileSync(indexPath, source);
      }
      return modConfig;
    },
  ]);
};
