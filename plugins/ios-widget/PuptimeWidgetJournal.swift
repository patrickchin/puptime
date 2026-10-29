import Foundation
import Darwin

// App Intents can overlap. Serialize the complete read/evaluate/save operation,
// rather than only the JavaScriptCore evaluation inside the widget library.
enum PuptimeWidgetJournal {
  private static let lock = NSRecursiveLock()

  private static var depth = 0
  static func transaction<T>(in scope: URL? = nil, _ action: () throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    if depth > 0 { return try action() }
    let parent = try (scope ?? directory()).deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    let descriptor = open(parent.appendingPathComponent("PuptimeQuickLog.lock").path, O_CREAT | O_RDWR, 0o600)
    guard descriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    defer { close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    defer { flock(descriptor, LOCK_UN) }
    depth += 1
    defer { depth -= 1 }
    return try action()
  }

  static func newId(_ prefix: String) -> String {
    prefix + "_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
  }

  static func record(_ event: [String: Any]) throws {
    try record(event, in: directory())
  }

  private static func directory() throws -> URL {
    guard let group = WidgetsStorage.appGroupIdentifier,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      throw NSError(domain: "PuptimeWidget", code: 1, userInfo: [NSLocalizedDescriptionKey: "Shared widget storage is unavailable."])
    }
    return container.appendingPathComponent("ExpoWidgets/PuptimePending", isDirectory: true)
  }

  static func record(_ event: [String: Any], in directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    // One immutable operation file per tap survives snapshot replacement and
    // process death. A nap end gets its own operation file with the same event ID.
    let destination = directory.appendingPathComponent(newId("wop") + ".json")
    let data = try JSONSerialization.data(withJSONObject: event)
    try data.write(to: destination, options: .atomic)
  }

  static func reconcile(_ props: [String: Any]) throws -> [String: Any] {
    let directory = try directory()
    guard FileManager.default.fileExists(atPath: directory.path) else { return props }
    let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix("wop_") && $0.pathExtension == "json" }
    let operations = try files.compactMap { file -> [String: Any]? in
      do {
        guard let event = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any] else {
          throw NSError(domain: "PuptimeWidget", code: 3, userInfo: [NSLocalizedDescriptionKey: "A pending widget log is invalid."])
        }
        return event
      } catch {
        // The app may acknowledge a committed operation during this read.
        if !FileManager.default.fileExists(atPath: file.path) { return nil }
        throw error
      }
    }
    return reconcile(props, operations: operations)
  }

  static func reconcile(_ props: [String: Any], operations: [[String: Any]]) -> [String: Any] {
    var result = props
    var latest: [String: [String: Any]] = [:]
    let previous = props["pending"] as? [[String: Any]] ?? []
    func instant(_ event: [String: Any]) -> Double {
      (event["endedAt"] as? NSNumber)?.doubleValue ?? (event["at"] as? NSNumber)?.doubleValue ?? 0
    }
    for event in previous + operations {
      guard let id = event["id"] as? String else { continue }
      if let before = latest[id], instant(before) > instant(event)
          || (instant(before) == instant(event) && before["endedAt"] is NSNumber) { continue }
      latest[id] = event
    }
    var times = props["lastEventAt"] as? [String: Double] ?? [:]
    let details = props["actionDetails"] as? [String: [String: Any]] ?? [:]
    let pending = latest.values.sorted {
      instant($0) == instant($1) ? ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") : instant($0) < instant($1)
    }
    for event in pending {
      guard let type = event["type"] as? String else { continue }
      let key = type == "custom" ? details.first(where: { $0.value["label"] as? String == event["customLabel"] as? String })?.key : type
      if let key { times[key] = max(times[key] ?? 0, instant(event)) }
      if type == "nap", instant(event) >= (times["nap"] ?? 0) {
        result["openNap"] = event["endedAt"] is NSNumber ? false : event as Any
      }
    }
    result["lastEventAt"] = times
    // Presentation is bounded; immutable operation files remain authoritative.
    result["pending"] = Array(pending.suffix(100))
    return result
  }
}
