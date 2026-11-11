// Compile the production Swift scheduler against an in-memory notification
// center so late completions and cross-process snapshot changes are repeatable.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'puptime-widget-reminders-'));
const source=readFileSync(resolve('plugins/ios-widget/PuptimeWidgetNotifications.swift'),'utf8').replace('import UserNotifications','import Foundation').replaceAll('content.sound = .default','content.sound = .defaultSound');
const boundary=String.raw`
enum UNAuthorizationStatus { case authorized, provisional, ephemeral, denied }
struct UNNotificationSettings { let authorizationStatus: UNAuthorizationStatus }
enum UNNotificationInterruptionLevel { case passive }
struct UNNotificationSound { static let defaultSound = UNNotificationSound() }
class UNNotificationContent {
  var title="",body="",categoryIdentifier=""
  var interruptionLevel: UNNotificationInterruptionLevel = .passive
  var sound: UNNotificationSound?
  var userInfo: [AnyHashable:Any] = [:]
}
final class UNMutableNotificationContent: UNNotificationContent {}
final class UNTimeIntervalNotificationTrigger {
  let timeInterval: Double
  init(timeInterval:Double,repeats:Bool){ self.timeInterval=timeInterval }
}
struct UNNotificationRequest {
  let identifier:String
  let content:UNNotificationContent
  let trigger:UNTimeIntervalNotificationTrigger?
}
struct UNNotification { let request:UNNotificationRequest }
actor Gate {
  var entered=false
  var continuation:CheckedContinuation<Void,Never>?
  func pause() async { entered=true;await withCheckedContinuation { continuation=$0 } }
  func wait() async { while !entered { await Task.yield() } }
  func release(){ continuation?.resume();continuation=nil }
}
final class UNUserNotificationCenter {
  static let shared=UNUserNotificationCenter()
  static func current()->UNUserNotificationCenter { shared }
  private let lock=NSLock()
  private var requests:[String:UNNotificationRequest]=[:]
  var authorization:UNAuthorizationStatus = .authorized
  var holdNextAdd:Gate?
  func all()->[UNNotificationRequest] { lock.lock();defer{lock.unlock()};return Array(requests.values) }
  private func takeGate()->Gate? { lock.lock();defer{lock.unlock()};let gate=holdNextAdd;holdNextAdd=nil;return gate }
  private func store(_ request:UNNotificationRequest){lock.lock();defer{lock.unlock()};requests[request.identifier]=request}
  func add(_ request:UNNotificationRequest) async throws { if let gate=takeGate(){await gate.pause()};store(request) }
  func notificationSettings() async->UNNotificationSettings { UNNotificationSettings(authorizationStatus:authorization) }
  func pendingNotificationRequests() async->[UNNotificationRequest] {all()}
  func deliveredNotifications() async->[UNNotification] {[]}
  func removePendingNotificationRequests(withIdentifiers ids:[String]) {lock.lock();defer{lock.unlock()};for id in ids {requests.removeValue(forKey:id)}}
  func removeDeliveredNotifications(withIdentifiers ids:[String]) {}
  func reset(){lock.lock();defer{lock.unlock()};requests=[:];holdNextAdd=nil;authorization = .authorized}
}
enum WidgetsStorage {
  static let defaults:UserDefaults?=nil
  static var props:[String:Any]=[:]
  static func getArray(forKey key:String)->[Any]? {[["props":props]]}
}
enum PuptimeWidgetJournal {
  private static let lock=NSRecursiveLock()
  static func transaction<T>(in scope:URL?=nil,_ action:()throws->T) throws->T {lock.lock();defer{lock.unlock()};return try action()}
  static func reconcile(_ props:[String:Any])throws->[String:Any] {props}
}
@main struct Check {
  static let center=UNUserNotificationCenter.current()
  static let bridge=PuptimeWidgetNotificationBridge.shared
  static let source="PuptimeQuickLog"
  static func policy(scope:String="owner",delivery:Bool=true,at:Double?=nil,expiry:Double=0,canLog:Bool=true,canNotify:Bool=true)->[String:Any] {
    ["scope":scope,"notificationDelivery":delivery,"canLog":canLog,"canNotify":canNotify,"expiresAt":expiry,
     "pottyAfterPeeMinutes":120,"pottyAfterMealMinutes":30,"language":"en",
     "lastEventAt":["meal":at ?? floor(Date().timeIntervalSince1970*1000)-1000],
     "quietStatus":["petId":scope+"-pet","enabled":false]]
  }
  static func publish(_ props:[String:Any]){try! PuptimeWidgetJournal.transaction{WidgetsStorage.props=props}}
  static func tap(scope:String="owner") async {
    // Captured target delays deliberately disagree with committed policy.
    await bridge.handle(["source":source,"scope":scope,"target":"log|meal|0|en|0|240|","timestamp":Int(Date().timeIntervalSince1970*1000)])
  }
  static func main() async throws {
    publish(policy(delivery:false));await tap();precondition(center.all().isEmpty,"Disabled delivery must not be resurrected")
    publish(policy());await tap();precondition(center.all().count==1)
    precondition(center.all()[0].trigger!.timeInterval<1800,"Use committed 30-minute policy, not captured 240-minute target")
    publish(policy(expiry:Date().timeIntervalSince1970*1000+60_000));try await bridge.syncPottyReminders(source)
    precondition(center.all().isEmpty,"Do not deliver beyond care expiry")
    publish(policy(canLog:false,canNotify:false));await tap();precondition(center.all().isEmpty)
    var viewOnly=policy(canLog:false);viewOnly["notificationConfirmations"]=true;publish(viewOnly)
    try await bridge.syncPottyReminders(source);await tap()
    precondition(center.all().count==1 && center.all()[0].identifier.hasPrefix("puptime-activity-"),"View-only carers retain personal reminders without logging confirmations")
    center.reset()
    publish(policy());center.authorization = .denied;await tap();precondition(center.all().isEmpty);center.reset()

    let disableGate=Gate();center.holdNextAdd=disableGate;publish(policy())
    let disabledAdd=Task{await tap()};await disableGate.wait()
    publish(policy(delivery:false));try await bridge.syncPottyReminders(source)
    await disableGate.release();await disabledAdd.value
    precondition(center.all().isEmpty,"A late OS add must clean itself up after opt-out")

    let switchGate=Gate();center.holdNextAdd=switchGate;publish(policy(scope:"puppy-a"))
    let oldPuppy=Task{await tap(scope:"puppy-a")};await switchGate.wait()
    publish(policy(scope:"puppy-b"));await tap(scope:"puppy-b")
    let newerID=center.all().first!.identifier
    await switchGate.release();await oldPuppy.value
    precondition(center.all().map{$0.identifier}==[newerID],"An obsolete completion must not erase the new puppy's request")
    await tap(scope:"puppy-a");precondition(center.all().map{$0.identifier}==[newerID])

    center.reset();let tapGate=Gate();center.holdNextAdd=tapGate
    let oldTime=floor(Date().timeIntervalSince1970*1000)-2000
    publish(policy(at:oldTime));let oldTap=Task{await tap()};await tapGate.wait()
    var newer=policy(at:oldTime+1000);newer["lastEventAt"]=["pee":oldTime+1500,"meal":oldTime+1000]
    publish(newer);await tap();let latestID=center.all().first!.identifier
    precondition(latestID.contains("afterPee"))
    await tapGate.release();await oldTap.value
    precondition(center.all().map{$0.identifier}==[latestID],"A late meal add must not replace the newer pee plan")
    await tap();precondition(center.all().count==1,"Repeated handling must be idempotent")
    center.reset()
    for index in 0..<63 {try await center.add(UNNotificationRequest(identifier:"foreign-\(index)",content:UNMutableNotificationContent(),trigger:nil))}
    publish(policy());try await bridge.syncPottyReminders(source);precondition(center.all().count==64)
    var overflow=policy();overflow["lastEventAt"]=["pee":oldTime,"meal":oldTime+1000]
    publish(overflow)
    do {try await bridge.syncPottyReminders(source);fatalError("Capacity overflow must reject before deleting requests")}
    catch {precondition(center.all().count==64)}
    publish(policy(delivery:false));try await bridge.syncPottyReminders(source)
    precondition(center.all().count==63 && center.all().allSatisfy{$0.identifier.hasPrefix("foreign-")})

    center.reset();let confirmationGate=Gate();center.holdNextAdd=confirmationGate
    var confirmation=policy();confirmation["notificationConfirmations"]=true;publish(confirmation)
    let oldConfirmation=Task{await tap()};await confirmationGate.wait()
    publish(policy(delivery:false));try await bridge.syncPottyReminders(source)
    await confirmationGate.release();await oldConfirmation.value
    precondition(center.all().isEmpty,"An in-flight confirmation must respect a later opt-out")
    print("PASS: native delivery/access policy, expiry, denied OS permission, stale targets, late opt-out adds/confirmations, changed puppy, out-of-order taps, capacity and retained foreign requests")
  }
}
`;
try{
 const path=join(directory,'check.swift'),executable=join(directory,'verify');
 writeFileSync(path,source+'\n'+boundary);
 execFileSync('swiftc',['-swift-version','5','-parse-as-library',path,'-o',executable],{stdio:'inherit'});
 execFileSync(executable,[],{stdio:'inherit'});
}finally{rmSync(directory,{recursive:true,force:true});}
