// Exercise the actual Swift journal/serialization logic with a temporary file
// boundary. Native AppIntent and SpringBoard interaction are checked separately.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'puptime-widget-journal-'));
const source = readFileSync(resolve('plugins/ios-widget/PuptimeWidgetJournal.swift'), 'utf8');
const identity = readFileSync(resolve('plugins/ios-widget/PuptimeWidgetIdentity.swift'), 'utf8');
const check = `
enum WidgetsStorage { static let appGroupIdentifier: String? = nil }
private let firstNode = NodeIdentityWrapper.node("PuptimeQuickLog/pee/0")
precondition(firstNode === NodeIdentityWrapper.node("PuptimeQuickLog/pee/0"))
precondition(firstNode !== NodeIdentityWrapper.node("PuptimeQuickLog/poop/0"))
let encodedIdentity = try JSONEncoder().encode(ObjectIdentifier(firstNode))
let decodedIdentity = try JSONDecoder().decode(String.self, from: encodedIdentity)
precondition(decodedIdentity == "PuptimeQuickLog/pee/0")
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
var count = 0
DispatchQueue.concurrentPerform(iterations: 250) { index in
  try! PuptimeWidgetJournal.transaction(in: directory) {
    try! PuptimeWidgetJournal.record(["id": PuptimeWidgetJournal.newId("evt"), "type": "pee", "at": index + 100], in: directory)
    count += 1
  }
}
precondition(count == 250)
let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
precondition(files.count == 250)
let records = try files.map { try JSONSerialization.jsonObject(with: Data(contentsOf: $0)) as! [String: Any] }
precondition(Set(records.map { $0["id"] as! String }).count == 250)
precondition(records.allSatisfy { ($0["id"] as! String).hasPrefix("evt_") && ($0["id"] as! String).count == 36 })
let props = PuptimeWidgetJournal.reconcile(["pending": []], operations: records)
precondition((props["pending"] as! [[String: Any]]).count == 100)
let remaining = try FileManager.default.contentsOfDirectory(atPath: directory.path)
precondition(remaining.count == 250)
let nap: [String: Any] = ["id": "evt_nap", "type": "nap", "at": 100]
let closed = nap.merging(["endedAt": 100]) { _, new in new }
let recovered = PuptimeWidgetJournal.reconcile(["pending": [nap], "openNap": nap], operations: [closed, nap])
precondition(recovered["openNap"] as? Bool == false)
do {
  try PuptimeWidgetJournal.record(nap, in: files[0])
  fatalError("A failed journal write must throw before confirmation.")
} catch {}
print("PASS: stable widget child identities, 250 concurrent Swift transactions and atomic records, bounded presentation without dropped operations, nap recovery, and failed-write propagation.")
`;
const path = join(directory, 'main.swift'), executable = join(directory, 'verify');
writeFileSync(path, source + '\n' + identity + '\n' + check);
execFileSync('swiftc', ['-swift-version', '5', path, '-o', executable], { stdio: 'inherit' });
execFileSync(executable, [join(directory, 'operations')], { stdio: 'inherit' });
