const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const marker = '// Puptime: durable widget interactions.';

module.exports = function withIosWidgetNotifications(config) {
  return withDangerousMod(config, ['ios', async (modConfig) => {
    const indexPath = path.join(modConfig.modRequest.platformProjectRoot, 'ExpoWidgetsTarget/index.swift');
    if (!fs.existsSync(indexPath)) {
      throw new Error('Puptime could not find the Expo widget target. Keep this plugin before expo-widgets.');
    }
    // Upgrade previously generated projects: notification work now runs inside
    // the awaited AppIntent, rather than a fire-and-forget bundle observer.
    let index = fs.readFileSync(indexPath, 'utf8');
    index = index.replace(/\/\/ Puptime: widget log notification bridge\.[\s\S]*?(?=@main\nstruct ExportWidgets0)/, '')
      .replace('  init() {\n    PuptimeWidgetNotificationBridge.shared.start()\n  }', '');
    fs.writeFileSync(indexPath, index);

    const library = path.dirname(require.resolve('expo-widgets/package.json', { paths: [modConfig.modRequest.projectRoot] }));
    const storagePath = path.join(library, 'ios/WidgetsStorage.swift');
    const storage = fs.readFileSync(storagePath, 'utf8').split(marker)[0].trimEnd();
    const native = ['PuptimeWidgetJournal.swift', 'PuptimeWidgetNotifications.swift']
      .map(file => fs.readFileSync(path.join(__dirname, 'ios-widget', file), 'utf8')).join('\n');
    fs.writeFileSync(storagePath, `${storage}\n\n${marker}\n${native}\n`);

    const utilsPath = path.join(library, 'ios/Widgets/Utils.swift');
    let utils = fs.readFileSync(utilsPath, 'utf8');
    const recoveredProps = 'props: (try? PuptimeWidgetJournal.reconcile(props)) ?? props,';
    if (!utils.includes(recoveredProps)) {
      if (!utils.includes('        props: props,')) throw new Error('The Expo widget timeline parser changed.');
      utils = utils.replace('        props: props,', `        ${recoveredProps}`);
      fs.writeFileSync(utilsPath, utils);
    }

    const providerPath = path.join(library, 'ios/Widgets/TimelineProvider.swift');
    const provider = fs.readFileSync(providerPath, 'utf8').replace(
      'entries: entries, policy: .atEnd',
      'entries: entries, policy: name == "PuptimeQuickLog" ? .never : .atEnd');
    fs.writeFileSync(providerPath, provider);

    // Unordered JSON and random child identities made every timeline update
    // replace the buttons, allowing a transition to interrupt the next touch.
    const entryPath = path.join(library, 'ios/Widgets/EntryView.swift');
    fs.writeFileSync(entryPath, fs.readFileSync(entryPath, 'utf8').replace(
      'JSONSerialization.data(withJSONObject: widgetEnvironment)',
      'JSONSerialization.data(withJSONObject: widgetEnvironment, options: .sortedKeys)'));
    const viewPath = path.join(library, 'ios/Widgets/DynamicView.swift');
    let view = fs.readFileSync(viewPath, 'utf8');
    if (!view.includes('let identityPath: String')) {
      const identity = fs.readFileSync(path.join(__dirname, 'ios-widget/PuptimeWidgetIdentity.swift'), 'utf8');
      const start = view.indexOf('// TODO(@jakex7): Hack to satisfy ExpoSwiftUI.AnyChild');
      const end = view.indexOf('public struct WidgetsDynamicView:', start);
      if (start < 0 || end < 0) throw new Error('The Expo widget child identity changed.');
      view = view.slice(0, start) + identity + '\n' + view.slice(end);
      view = view.replace('  let uuid = NodeIdentityWrapper(id: UUID())', '  let identityPath: String\n  private let uuid: NodeIdentityWrapper');
      view = view.replaceAll('    self.name = name', '    self.identityPath = identityPath ?? name\n    self.uuid = NodeIdentityWrapper.node(identityPath ?? name)\n    self.name = name');
      view = view.replace('node: [String: Any]) {', 'node: [String: Any], identityPath: String? = nil) {');
      view = view.replace('environmentString: String?) {', 'environmentString: String?, identityPath: String? = nil) {');
      view = view.replace('validChildren.map { WidgetsDynamicView', 'validChildren.enumerated().map { index, child in WidgetsDynamicView');
      view = view.replace('node: $0, entryIndex: entryIndex, environmentString: environmentString)',
        'node: child, entryIndex: entryIndex, environmentString: environmentString, identityPath: identityPath + "/" + (child["key"] as? String ?? String(index)))');
      view = view.replace('node: child, entryIndex: entryIndex, environmentString: environmentString)]',
        'node: child, entryIndex: entryIndex, environmentString: environmentString, identityPath: identityPath + "/0")]');
      fs.writeFileSync(viewPath, view);
    }

    const intentPath = path.join(library, 'ios/Widgets/AppIntent.swift');
    let intent = fs.readFileSync(intentPath, 'utf8');
    const replacement = fs.readFileSync(path.join(__dirname, 'ios-widget/perform-widget-interaction.swift'), 'utf8').trimEnd();
    if (!intent.includes(replacement)) {
      const structure = intent.indexOf('struct WidgetUserInteraction: AppIntent');
      const start = intent.indexOf('  func perform() async throws -> some IntentResult {', structure);
      if (structure < 0 || start < 0) throw new Error('The Expo widget AppIntent changed; review the Puptime integration.');
      const opening = intent.indexOf('{', start);
      let depth = 1, end = opening + 1;
      while (end < intent.length && depth) {
        if (intent[end] === '{') depth++;
        if (intent[end] === '}') depth--;
        end++;
      }
      if (depth) throw new Error('The Expo widget AppIntent has an unbalanced body.');
      intent = intent.slice(0, start) + replacement + intent.slice(end);
      fs.writeFileSync(intentPath, intent);
    }
    return modConfig;
  }]);
};
