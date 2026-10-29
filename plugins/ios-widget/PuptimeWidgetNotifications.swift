import UserNotifications

// Puptime: native widget confirmations.
final class PuptimeWidgetNotificationBridge {
  static let shared = PuptimeWidgetNotificationBridge()
  func handle(_ event: [String: Any]) async {
    guard
      let target = event["target"] as? String,
      let timestamp = event["timestamp"] as? Int
    else { return }

    let parts = target.split(separator: "|", maxSplits: 6, omittingEmptySubsequences: false).map(String.init)
    guard parts.count >= 4, parts[0] == "log" else { return }
    let type = parts[1].removingPercentEncoding ?? parts[1]
    let language = parts[3]
    guard ["pee", "poop", "meal", "pottyTrip", "walk", "nap"].contains(type) || type.hasPrefix("custom:") else { return }

    if parts[2] == "1" {
      await showConfirmation(type, language, timestamp, parts.count > 6 ? parts[6].removingPercentEncoding : nil, event["eventId"] as? String)
    }
    await syncPottyReminder(
      type,
      parts.count > 4 ? Int(parts[4]) ?? 0 : 0,
      parts.count > 5 ? Int(parts[5]) ?? 0 : 0,
      language
    )
    if let source = event["source"] as? String { await showStatus(source) }
  }

  private func showStatus(_ source: String) async {
    let center = UNUserNotificationCenter.current()
    let requests = await center.pendingNotificationRequests()
    let delivered = await center.deliveredNotifications()
    // Read the latest committed snapshot after awaited work, so a rapid widget
    // tap burst cannot replace newer activity with an older tap's presentation.
    guard let timeline = WidgetsStorage.getArray(forKey: "__expo_widgets_\(source)_timeline"),
          let entry = timeline.first as? [String: Any],
          let stored = entry["props"] as? [String: Any],
          let props = try? PuptimeWidgetJournal.reconcile(stored),
          let status = props["quietStatus"] as? [String: Any] else { return }
    guard status["enabled"] as? Bool == true else {
      center.removeDeliveredNotifications(withIdentifiers: ["puptime-status"])
      return
    }
    let language = props["language"] as? String ?? "en"
    let name = status["name"] as? String ?? "Puptime"
    let petId = status["petId"] as? String ?? ""
    let times = props["lastEventAt"] as? [String: Double] ?? [:]
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: language)
    formatter.setLocalizedDateFormatFromTemplate("MMMdjmm")
    func clock(_ milliseconds: Double) -> String { formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000)) }
    let labels = language == "zh-Hans" ? ["尿尿", "便便", "吃饭"] : language == "es" ? ["Pipí", "Caca", "Comida"] : ["Pee", "Poop", "Meal"]
    var lines = zip(["pee", "poop", "meal"], labels).compactMap { key, label in
      times[key].map { "\(label) · \(clock($0))" }
    }
    if lines.isEmpty {
      lines.append(language == "zh-Hans" ? "还没有尿尿、便便或吃饭记录。" : language == "es" ? "Aún no hay registros de pipí, caca o comida." : "No pee, poop or meal logs yet.")
    }
    let next = requests.compactMap { request -> (String, Date)? in
      let data = request.content.userInfo
      let routine = request.identifier.hasPrefix("puptime-routine-") || request.identifier.hasPrefix("puptime-activity-")
      let timed = data["kind"] as? String == "customTimedReminder" && data["petId"] as? String == petId
      let nextDate = (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate()
        ?? (request.trigger as? UNTimeIntervalNotificationTrigger)?.nextTriggerDate()
      guard routine || timed, let at = nextDate, at > Date() else { return nil }
      return (request.content.title, at)
    }.min { $0.1 < $1.1 }
    if let next {
      let label = language == "zh-Hans" ? "提醒" : language == "es" ? "Recordatorio" : "Reminder"
      lines.append("\(label) · \(next.0) · \(clock(next.1.timeIntervalSince1970 * 1000))")
    }
    let content = UNMutableNotificationContent()
    let title = language == "zh-Hans" ? "最近活动" : language == "es" ? "Actividad reciente" : "Recent activity"
    content.title = "\(name) · \(title)"
    content.body = lines.joined(separator: "\n")
    content.interruptionLevel = .passive
    content.userInfo = ["kind": "quietStatus", "petId": petId]
    if let existing = delivered.first(where: { $0.request.identifier == "puptime-status" })?.request.content,
       existing.title == content.title, existing.body == content.body,
       existing.userInfo["petId"] as? String == petId { return }
    do {
      try await center.add(UNNotificationRequest(identifier: "puptime-status", content: content, trigger: nil))
    } catch {
      print("[Puptime] Quiet status could not be updated: \(error.localizedDescription)")
    }
  }

  private func showConfirmation(_ type: String, _ language: String, _ timestamp: Int, _ customLabel: String?, _ eventId: String?) async {
    let content = UNMutableNotificationContent()
    content.title = title(language)
    content.body = body(type, language, customLabel)
    // Confirm in Notification Center without covering a top-row widget's
    // remaining buttons while the person is still tapping them.
    content.interruptionLevel = .passive
    content.categoryIdentifier = "puptimeWidgetLog"
    content.userInfo = ["kind": "widgetLog", "type": type, "at": timestamp]
    if let eventId { content.userInfo["eventId"] = eventId }

    let request = UNNotificationRequest(
      identifier: "puptime-widget-\(eventId ?? "\(timestamp)-\(type)")",
      content: content,
      trigger: nil
    )
    do {
      try await UNUserNotificationCenter.current().add(request)
    } catch {
      print("[Puptime] Widget confirmation could not be scheduled: \(error.localizedDescription)")
    }
  }

  private func syncPottyReminder(
    _ type: String,
    _ afterPeeMinutes: Int,
    _ afterMealMinutes: Int,
    _ language: String
  ) async {
    let center = UNUserNotificationCenter.current()
    if type == "pee" {
      center.removePendingNotificationRequests(withIdentifiers: [
        "puptime-activity-afterPee", "puptime-activity-afterMeal"
      ])
      if afterPeeMinutes > 0 {
        await schedulePottyReminder("afterPee", afterPeeMinutes, language)
      }
    } else if type == "meal" {
      center.removePendingNotificationRequests(withIdentifiers: ["puptime-activity-afterMeal"])
      if afterMealMinutes > 0 {
        await schedulePottyReminder("afterMeal", afterMealMinutes, language)
      }
    }
  }

  private func schedulePottyReminder(_ kind: String, _ minutes: Int, _ language: String) async {
    let content = UNMutableNotificationContent()
    content.title = pottyTitle(kind, language)
    content.body = pottyBody(kind, minutes, language)
    content.sound = .default
    content.userInfo = ["kind": "pottyReminder", "sourceType": kind == "afterPee" ? "pee" : "meal"]

    let request = UNNotificationRequest(
      identifier: "puptime-activity-\(kind)",
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(minutes * 60), repeats: false)
    )
    do {
      try await UNUserNotificationCenter.current().add(request)
    } catch {
      print("[Puptime] Potty reminder could not be scheduled: \(error.localizedDescription)")
    }
  }

  private func pottyTitle(_ kind: String, _ language: String) -> String {
    switch language {
    case "zh-Hans": return kind == "afterPee" ? "该出去尿尿了吗？" : "饭后该出去尿尿了吗？"
    case "es": return kind == "afterPee" ? "¿Hora de salir al baño?" : "¿Hora de salir después de comer?"
    default: return kind == "afterPee" ? "Potty break?" : "Potty break after eating?"
    }
  }

  private func pottyBody(_ kind: String, _ minutes: Int, _ language: String) -> String {
    let delay: String
    if minutes < 60 {
      delay = language == "zh-Hans" ? "\(minutes) 分钟" : language == "es" ? "\(minutes) minutos" : "\(minutes) minutes"
    } else {
      let hours = minutes / 60
      delay = language == "zh-Hans"
        ? "\(hours) 小时"
        : language == "es"
          ? (hours == 1 ? "1 hora" : "\(hours) horas")
          : (hours == 1 ? "1 hour" : "\(hours) hours")
    }

    switch language {
    case "zh-Hans":
      return kind == "afterPee"
        ? "距离上次尿尿已经 \(delay)，小狗可能又需要出去了。"
        : "距离上次吃饭已经 \(delay)，小狗可能需要出去尿尿。"
    case "es":
      return kind == "afterPee"
        ? "Han pasado \(delay) desde el último pipí. Puede que necesite volver a salir."
        : "Han pasado \(delay) desde la última comida. Puede que necesite salir al baño."
    default:
      return kind == "afterPee"
        ? "It’s been \(delay) since the last pee. Your puppy may need to go again."
        : "It’s been \(delay) since the last meal. Your puppy may need to go."
    }
  }

  private func title(_ language: String) -> String {
    switch language {
    case "zh-Hans": return "活动已记录"
    case "es": return "Actividad registrada"
    default: return "Activity logged"
    }
  }

  private func body(_ type: String, _ language: String, _ customLabel: String?) -> String {
    if type.hasPrefix("custom:") {
      let activity = customLabel ?? String(type.dropFirst("custom:".count))
      switch language {
      case "zh-Hans": return "已通过小组件记录：\(activity)。"
      case "es": return "Se guardó \(activity) desde el widget."
      default: return "\(activity) saved from the widget."
      }
    }
    let activity: String
    switch language {
    case "zh-Hans":
      activity = [
        "pee": "尿尿", "poop": "便便", "meal": "吃饭", "pottyTrip": "外出如厕", "walk": "散步", "nap": "小睡"
      ][type] ?? type
      return "已通过小组件记录：\(activity)。"
    case "es":
      activity = [
        "pee": "Pipí", "poop": "Caca", "meal": "Comida", "pottyTrip": "Salida al baño", "walk": "Paseo", "nap": "Siesta"
      ][type] ?? type
      return "Se guardó \(activity) desde el widget."
    default:
      activity = [
        "pee": "Pee", "poop": "Poop", "meal": "Meal", "pottyTrip": "Potty trip", "walk": "Walk", "nap": "Nap"
      ][type] ?? type
      return "\(activity) was saved from your widget."
    }
  }
}
