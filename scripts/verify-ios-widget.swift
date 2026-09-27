import Foundation
import JavaScriptCore

precondition(CommandLine.arguments.count == 3, "Usage: verify-ios-widget.swift <widget defaults plist> <widget JS bundle>")
let defaults = try PropertyListSerialization.propertyList(
  from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])),
  format: nil
) as! [String: Any]
let layout = defaults["__expo_widgets_PuptimeQuickLog_layout"] as! String
let timeline = defaults["__expo_widgets_PuptimeQuickLog_timeline"] as! [[String: Any]]
precondition(!timeline.isEmpty, "Widget snapshot has no timeline")
let props = timeline[0]["props"] as! [String: Any]
precondition(PropertyListSerialization.propertyList(props, isValidFor: .binary), "Widget props cannot be saved to UserDefaults")

let context = JSContext()!
context.evaluateScript(try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8))
precondition(context.exception == nil, "Widget JS bundle failed: \(String(describing: context.exception))")
context.setObject(context.evaluateScript("(\(layout))"), forKeyedSubscript: "__expoWidgetLayout" as NSString)
precondition(context.exception == nil, "Widget layout failed: \(String(describing: context.exception))")

func invoke(_ name: String, _ props: [String: Any], target: String = "", colorScheme: String = "light") -> [String: Any] {
  let environment: [String: Any] = [
    "colorScheme": colorScheme, "widgetFamily": "systemMedium",
    "timestamp": Date().timeIntervalSince1970 * 1000, "target": target,
  ]
  let result = context.objectForKeyedSubscript(name)!.call(withArguments: [props, environment])!
  precondition(context.exception == nil, "\(name) failed: \(String(describing: context.exception))")
  return result.toObject() as! [String: Any]
}

func buttonCount(_ value: Any) -> Int {
  if let array = value as? [Any] { return array.reduce(0) { $0 + buttonCount($1) } }
  if let object = value as? [String: Any] {
    return (object["type"] as? String == "Button" ? 1 : 0)
      + object.values.reduce(0) { $0 + buttonCount($1) }
  }
  return 0
}

let rendered = invoke("__expoWidgetRender", props)
precondition(buttonCount(rendered) == (props["actions"] as! [String]).count, "Widget did not render its quick log buttons")
precondition(buttonCount(invoke("__expoWidgetRender", props, colorScheme: "dark")) == 3, "Dark widget did not render")

let pee = invoke("__expoWidgetHandlePress", props, target: "log|pee|0|en|120|30|")
precondition(PropertyListSerialization.propertyList(pee, isValidFor: .binary), "Pee action returned invalid UserDefaults props")
precondition((pee["pending"] as? [[String: Any]])?.first?["type"] as? String == "pee", "Pee action was not recorded")

var napProps = props
napProps["actions"] = ["nap", "pee"]
let started = invoke("__expoWidgetHandlePress", napProps, target: "log|nap|0|en|120|30|")
precondition(PropertyListSerialization.propertyList(started, isValidFor: .binary), "Nap start returned invalid UserDefaults props")
precondition(started["openNap"] is [String: Any], "Nap action did not start a nap")
let ended = invoke("__expoWidgetHandlePress", started, target: "log|nap|0|en|120|30|")
precondition(PropertyListSerialization.propertyList(ended, isValidFor: .binary), "Nap end returned invalid UserDefaults props")
precondition(ended["openNap"] as? Bool == false, "Nap action did not end the nap")
precondition((ended["pending"] as? [[String: Any]])?.first?["endedAt"] != nil, "Ended nap has no end time")
print("Widget snapshot, three rendered buttons, pee action, and nap start/end passed")
