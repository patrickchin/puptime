import SwiftUI
import UserNotificationsUI
import WidgetKit

// Uses the widget's committed snapshot and immutable operation journal. The
// content extension writes without activating or depending on the host app.
final class QuickLogNotificationController: UIViewController, UNNotificationContentExtension {
  private let model = NotificationQuickLogModel()
  private var host: UIHostingController<NotificationQuickLogView>?

  override func viewDidLoad() {
    super.viewDidLoad()
    let host = UIHostingController(rootView: NotificationQuickLogView(model: model))
    self.host = host
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    host.view.backgroundColor = .clear
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    host.didMove(toParent: self)
    preferredContentSize = CGSize(width: 360, height: 160)
  }

  func didReceive(_ notification: UNNotification) {
    model.petId = notification.request.content.userInfo["petId"] as? String
    model.reload()
    title = (model.props["quietStatus"] as? [String: Any])?["name"] as? String ?? "Puptime"
  }
}

final class NotificationQuickLogModel: ObservableObject {
  @Published var props: [String: Any] = [:]
  @Published var error: String?
  var petId: String?
  private var notificationWork: Task<Void, Never>?
  private let source = "PuptimeQuickLog"

  private func snapshot() throws -> ([[String: Any]], [String: Any]) {
    WidgetsStorage.defaults?.synchronize()
    guard let timeline = WidgetsStorage.getArray(forKey: "__expo_widgets_\(source)_timeline") as? [[String: Any]],
          let stored = timeline.first?["props"] as? [String: Any],
          let status = stored["quietStatus"] as? [String: Any], status["enabled"] as? Bool == true,
          let petId, status["petId"] as? String == petId else {
      throw NSError(domain: "PuptimeQuickLog", code: 1)
    }
    return (timeline, try PuptimeWidgetJournal.reconcile(stored))
  }

  func reload() {
    do { props = try snapshot().1; error = nil }
    catch { props = [:]; self.error = message("Open Puptime to refresh quick log.", "打开 Puptime 以刷新快捷记录。", "Abre Puptime para actualizar el registro rápido.") }
  }

  func log(_ key: String) {
    do {
      var eventData: [String: Any] = [:]
      props = try PuptimeWidgetJournal.transaction {
        var (timeline, current) = try snapshot()
        let configured = current["actions"] as? [String] ?? ["pee", "poop", "meal"]
        let open = current["openNap"] as? [String: Any]
        guard configured.contains(key) || (key == "nap" && open != nil) else { throw NSError(domain: "PuptimeQuickLog", code: 2) }
        let now = Int(Date().timeIntervalSince1970 * 1000)
        var event: [String: Any]
        if key == "nap", let open {
          event = open; event["endedAt"] = max(now, (open["at"] as? Int) ?? now)
        } else {
          event = ["id": PuptimeWidgetJournal.newId("evt"), "type": key.hasPrefix("custom:") ? "custom" : key, "at": now]
          if key.hasPrefix("custom:") {
            guard let details = current["actionDetails"] as? [String: [String: Any]], let label = details[key]?["label"] as? String, !label.isEmpty else { throw NSError(domain: "PuptimeQuickLog", code: 3) }
            event["customLabel"] = label
          }
        }
        try PuptimeWidgetJournal.record(event)
        current = PuptimeWidgetJournal.reconcile(current, operations: [event])
        timeline[0]["props"] = current
        WidgetsStorage.set(timeline, forKey: "__expo_widgets_\(source)_timeline")
        WidgetsStorage.defaults?.synchronize()
        let language = current["language"] as? String ?? "en"
        let confirmations = current["notificationConfirmations"] as? Bool == true ? "1" : "0"
        let pee = current["pottyAfterPeeMinutes"] as? Int ?? 0, meal = current["pottyAfterMealMinutes"] as? Int ?? 0
        // Encode separators as data, matching the widget's target contract.
        var allowed = CharacterSet.urlQueryAllowed; allowed.remove(charactersIn: "|%")
        let encoded = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
        let custom = (event["customLabel"] as? String ?? "").addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        eventData = ["source": source, "target": "log|\(encoded)|\(confirmations)|\(language)|\(pee)|\(meal)|\(custom)", "timestamp": now, "eventId": event["id"] as? String ?? ""]
        return current
      }
      error = nil
      WidgetCenter.shared.reloadTimelines(ofKind: source)
      let previous = notificationWork
      notificationWork = Task {
        await previous?.value
        // Keep this expanded interface in place for further taps. Its compact
        // card is an action cue; no notification replacement is needed here.
        await PuptimeWidgetNotificationBridge.shared.handle(eventData, refreshStatus: false)
      }
    } catch { self.error = message("Couldn’t save. Try again.", "无法保存，请重试。", "No se pudo guardar. Inténtalo de nuevo.") }
  }

  func message(_ english: String, _ chinese: String, _ spanish: String) -> String {
    switch props["language"] as? String { case "zh-Hans": return chinese; case "es": return spanish; default: return english }
  }
}

struct NotificationQuickLogView: View {
  @ObservedObject var model: NotificationQuickLogModel
  @Environment(\.colorScheme) private var scheme

  private var actions: [String] {
    let configured = model.props["actions"] as? [String] ?? ["pee", "poop", "meal"]
    return model.props["openNap"] is [String: Any] && !configured.contains("nap") ? Array(configured.prefix(3)) + ["nap"] : configured
  }
  private var appearance: [String: Any] {
    (model.props["appearance"] as? [String: [String: Any]])?[scheme == .dark ? "dark" : "light"] ?? [:]
  }
  private func color(_ hex: String) -> Color {
    let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x176B52
    return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
  }
  private func icon(_ key: String, ending: Bool) -> String {
    switch key { case "pee": return "drop.fill"; case "poop": return "circle.hexagongrid.fill"; case "meal": return "fork.knife"; case "pottyTrip": return "door.left.hand.open"; case "walk": return "figure.walk"; case "nap": return ending ? "stop.fill" : "moon.zzz.fill"; default: return "tag.fill" }
  }

  var body: some View {
    VStack(spacing: 6) {
      if !model.props.isEmpty {
        HStack(spacing: 7) {
          ForEach(actions, id: \.self) { key in
            let detail = (model.props["actionDetails"] as? [String: [String: Any]])?[key] ?? [:]
            let ending = key == "nap" && model.props["openNap"] is [String: Any]
            let ink = color(detail[scheme == .dark ? "darkColor" : "lightColor"] as? String ?? "#176B52")
            Button { model.log(key) } label: {
              VStack(spacing: 4) {
                Image(systemName: icon(key, ending: ending)).font(.title2.weight(.semibold)).accessibilityHidden(true)
                Text(ending ? "End" : detail["label"] as? String ?? key)
                  .font(.system(.subheadline, design: .rounded).weight(.bold)).lineLimit(1).minimumScaleFactor(0.72)
                if let at = (model.props["lastEventAt"] as? [String: Double])?[key] {
                  Text(Date(timeIntervalSince1970: at / 1000), style: .relative).font(.caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.65)
                } else { Text(model.message("Never", "从未", "Nunca")).font(.caption.weight(.medium)).lineLimit(1) }
              }
              .foregroundStyle(ink).padding(.vertical, 8).padding(.horizontal, 3)
              .frame(maxWidth: .infinity, minHeight: 96, maxHeight: .infinity)
            }
            .buttonStyle(.bordered).buttonBorderShape(.roundedRectangle(radius: CGFloat(appearance["controlRadius"] as? Double ?? 16)))
            .tint(ink).accessibilityIdentifier("notification.log.\(key)")
          }
        }
      }
      if let error = model.error { Text(error).font(.footnote).accessibilityIdentifier("notification.log.error") }
    }
    .padding(9).background(LinearGradient(colors: [color(appearance["background"] as? String ?? "#F5F3EC"), color(appearance["surface"] as? String ?? "#FFFEFA")], startPoint: .topLeading, endPoint: .bottomTrailing))
  }
}
