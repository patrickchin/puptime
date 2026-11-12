import UserNotifications

// Puptime: native widget confirmations.
final class PuptimeWidgetNotificationBridge {
  static let shared = PuptimeWidgetNotificationBridge()
  func handle(_ event: [String: Any], refreshStatus: Bool = true) async {
    guard
      let target = event["target"] as? String,
      let timestamp = event["timestamp"] as? Int,
      let source = event["source"] as? String
    else { return }

    let parts = target.split(separator: "|", maxSplits: 6, omittingEmptySubsequences: false).map(String.init)
    guard parts.count >= 4, parts[0] == "log" else { return }
    let type = parts[1].removingPercentEncoding ?? parts[1]
    guard ["pee", "poop", "meal", "pottyTrip", "walk", "nap"].contains(type) || type.hasPrefix("custom:") else { return }
    let scope = event["scope"] as? String ?? "owner"
    if let props = currentProps(source), canDeliver(props, scope: scope), props["canLog"] as? Bool == true, props["notificationConfirmations"] as? Bool == true {
      await showConfirmation(type, props["language"] as? String ?? "en", timestamp, parts.count > 6 ? parts[6].removingPercentEncoding : nil, event["eventId"] as? String, source: source, scope: scope)
    }
    do { try await syncPottyReminders(source, scope: scope) }
    catch { print("[Puptime] Potty reminders could not be updated: \(error.localizedDescription)") }
    if refreshStatus { await showStatus(source) }
  }

  private func showStatus(_ source: String) async {
    let center = UNUserNotificationCenter.current()
    // Keep the default (off) path out of notification-center queries, so
    // ordinary widget logging does not wait for an unused status card.
    guard let first = WidgetsStorage.getArray(forKey: "__expo_widgets_\(source)_timeline")?.first as? [String: Any],
          let firstProps = first["props"] as? [String: Any],
          let firstStatus = firstProps["quietStatus"] as? [String: Any],
          firstStatus["enabled"] as? Bool == true else { return }
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
    let content = UNMutableNotificationContent()
    content.title = language == "zh-Hans" ? "\(name) · 快捷记录" : language == "es" ? "\(name) · Registro rápido" : "\(name) · Quick log"
    content.body = language == "zh-Hans" ? "长按以记录活动，无需打开 Puptime。" : language == "es" ? "Mantén pulsado para registrar sin abrir Puptime." : "Press and hold to log without opening Puptime."
    content.categoryIdentifier = "puptimeQuickLog"
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

  private func showConfirmation(_ type: String, _ language: String, _ timestamp: Int, _ customLabel: String?, _ eventId: String?, source: String, scope: String) async {
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
      if let props = currentProps(source), canDeliver(props, scope: scope), props["canLog"] as? Bool == true, props["notificationConfirmations"] as? Bool == true { return }
      UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [request.identifier])
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [request.identifier])
    } catch {
      print("[Puptime] Widget confirmation could not be scheduled: \(error.localizedDescription)")
    }
  }

  private struct PottyPlan: Equatable {
    let kind: String
    let minutes: Int
    let at: Double
    let scope: String
    let petId: String
    let language: String
    var identifier: String {
      "puptime-activity-\(kind)-plan-\(scope)|\(petId)|\(Int(at))|\(minutes)|\(language)"
    }
  }

  private func currentProps(_ source: String) -> [String: Any]? {
    WidgetsStorage.defaults?.synchronize()
    guard let entry = WidgetsStorage.getArray(forKey: "__expo_widgets_\(source)_timeline")?.first as? [String: Any],
          let stored = entry["props"] as? [String: Any],
          let props = try? PuptimeWidgetJournal.reconcile(stored) else { return nil }
    return props
  }

  private func canDeliver(_ props: [String: Any], scope: String? = nil) -> Bool {
    let now = Date().timeIntervalSince1970 * 1000
    let expiry = (props["expiresAt"] as? NSNumber)?.doubleValue ?? 0
    return props["notificationDelivery"] as? Bool == true && props["canNotify"] as? Bool == true
      && (expiry <= 0 || expiry > now) && (scope == nil || (props["scope"] as? String ?? "owner") == scope)
  }

  private func pottyPlans(_ source: String) -> [PottyPlan] {
    guard let props = currentProps(source), canDeliver(props) else { return [] }
    let now = Date().timeIntervalSince1970 * 1000
    let expiry = (props["expiresAt"] as? NSNumber)?.doubleValue ?? 0
    let times = props["lastEventAt"] as? [String: Double] ?? [:]
    let pee = times["pee"], meal = times["meal"]
    let scope = props["scope"] as? String ?? "owner"
    let petId = (props["quietStatus"] as? [String: Any])?["petId"] as? String ?? scope
    let language = props["language"] as? String ?? "en"
    return [("afterPee", pee, "pottyAfterPeeMinutes"), ("afterMeal", meal, "pottyAfterMealMinutes")].compactMap { kind, time, key in
      guard let time, let minutes = props[key] as? Int,
            [15, 30, 45, 60, 120, 180, 240].contains(minutes),
            kind != "afterMeal" || pee == nil || time > pee! else { return nil }
      let at = time + Double(minutes) * 60_000
      guard at > now, expiry <= 0 || at < expiry else { return nil }
      return PottyPlan(kind: kind, minutes: minutes, at: at, scope: scope, petId: petId, language: language)
    }
  }

  // Both host-app snapshots and extension logs use this one scheduler. Never
  // hold the journal's cross-process lock across an awaited OS operation.
  func syncPottyReminders(_ source: String, scope: String? = nil) async throws {
    guard source == "PuptimeQuickLog" else { return }
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral
    let pending = await center.pendingNotificationRequests()
    let candidates: [PottyPlan] = try PuptimeWidgetJournal.transaction {
      let plans = allowed ? pottyPlans(source) : []
      let retained = pending.filter { !$0.identifier.hasPrefix("puptime-activity-") }
      guard retained.count + plans.count <= 64 else {
        throw NSError(domain: "PuptimeReminders", code: 1, userInfo: [NSLocalizedDescriptionKey: "Remove a pending reminder before adding another."])
      }
      let wanted = Set(plans.map { $0.identifier })
      center.removePendingNotificationRequests(withIdentifiers: pending.map { $0.identifier }.filter {
        $0.hasPrefix("puptime-activity-") && !wanted.contains($0)
      })
      return plans.filter { scope == nil || $0.scope == scope }
    }
    for candidate in candidates {
      guard try PuptimeWidgetJournal.transaction({ pottyPlans(source).contains(candidate) }) else { continue }
      let content = UNMutableNotificationContent()
      content.title = pottyTitle(candidate.kind, candidate.language)
      content.body = pottyBody(candidate.kind, candidate.minutes, candidate.language)
      content.sound = .default
      content.userInfo = ["kind": "pottyReminder", "sourceType": candidate.kind == "afterPee" ? "pee" : "meal", "scope": candidate.scope]
      let request = UNNotificationRequest(
        identifier: candidate.identifier, content: content,
        trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, (candidate.at - Date().timeIntervalSince1970 * 1000) / 1000), repeats: false)
      )
      do {
        try await center.add(request)
      } catch {
        // A policy change may have made an old failed request irrelevant.
        if pottyPlans(source).contains(candidate) { throw error }
      }
      // Plan-specific IDs let an obsolete completion delete only its own add,
      // without cancelling a newer tap's or another puppy's notification.
      try PuptimeWidgetJournal.transaction {
        if !pottyPlans(source).contains(candidate) {
          center.removePendingNotificationRequests(withIdentifiers: [candidate.identifier])
        }
      }
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
