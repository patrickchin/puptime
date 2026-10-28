// Expo's dynamic children use object identities. Reuse them by tree path and
// encode that path so WidgetKit preserves buttons across renders and launches.
private final class NodeIdentityWrapper {
  private static let lock = NSLock()
  private static var nodes: [String: NodeIdentityWrapper] = [:]
  private static var paths: [ObjectIdentifier: String] = [:]

  static func node(_ path: String) -> NodeIdentityWrapper {
    lock.lock()
    defer { lock.unlock() }
    if let node = nodes[path] { return node }
    let node = NodeIdentityWrapper()
    nodes[path] = node
    paths[ObjectIdentifier(node)] = path
    return node
  }

  static func path(_ id: ObjectIdentifier) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return paths[id]
  }
}

extension ObjectIdentifier: @retroactive Encodable {
  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(NodeIdentityWrapper.path(self) ?? String(describing: self))
  }
}
