  func perform() async throws -> some IntentResult {
    let at = Int(Date().timeIntervalSince1970 * 1000)
    let eventData: [String: Any]? = try PuptimeWidgetJournal.transaction {
      guard let source else { return nil }
      WidgetsStorage.defaults?.synchronize()
      let layout = WidgetsStorage.getString(forKey: "__expo_widgets_\(source)_layout") ?? ""
      guard let timeline = WidgetsStorage.getArray(forKey: "__expo_widgets_\(source)_timeline"),
            let entryIndex, timeline.indices.contains(entryIndex),
            let entry = timeline[entryIndex] as? [String: Any],
            let storedProps = entry["props"] as? [String: Any],
            let environmentData = environmentString?.data(using: .utf8),
            var environment = try? JSONSerialization.jsonObject(with: environmentData) as? [String: Any] else {
        return nil
      }
      let props = try PuptimeWidgetJournal.reconcile(storedProps)
      guard props["canLog"] as? Bool != false else { return nil }
      if let expiry = props["expiresAt"] as? Double, expiry > 0, expiry <= Double(at) { return nil }
      environment["target"] = target
      environment["interactionId"] = PuptimeWidgetJournal.newId("evt")
      environment["interactionAt"] = at

      let newProps: [String: Any]
      switch evaluateWidgetButtonPress(layout: layout, props: props, environment: environment) {
      case .success(let result):
        guard let result else { return nil }
        newProps = result
      case .failure(let error):
        throw NSError(domain: "PuptimeWidget", code: 2, userInfo: [NSLocalizedDescriptionKey: error.message])
      }
      guard let pending = newProps["pending"] as? [[String: Any]], let event = pending.last,
            let eventId = event["id"] as? String else { return nil }
      // Commit the log before changing its presentation or issuing confirmation.
      // The app imports and acknowledges these operations after its SQLite commit.
      try PuptimeWidgetJournal.record(event)
      var newEntry = entry
      newEntry["props"] = props.merging(newProps) { _, new in new }
      guard var newTimeline = timeline as? [[String: Any]] else { return nil }
      newTimeline[entryIndex] = newEntry
      WidgetsStorage.set(newTimeline, forKey: "__expo_widgets_\(source)_timeline")
      WidgetsStorage.defaults?.synchronize()
      return ["source": source, "target": target as Any, "timestamp": at,
              "eventId": eventId, "type": "ExpoWidgetsUserInteraction"]
    }
    if let eventData {
      // Await notification scheduling before the intent finishes and WidgetKit
      // can suspend the extension. Notifications never confirm failed writes.
      await PuptimeWidgetNotificationBridge.shared.handle(eventData)
      WidgetsEvents.shared.sendNotification(type: .userEvent, data: eventData)
    }
    // WidgetKit automatically reloads after an interactive AppIntent finishes.
    return .result()
  }
