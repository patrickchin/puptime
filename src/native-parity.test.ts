import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

test('both native module graphs select the shared cloud, SQLite and setup implementation', () => {
  const entry = resolve('App.tsx');
  const facades = ['storage', 'activity-data', 'cloud/use-cloud', 'cloud/auth', 'cloud/export',
    'cloud/notification-delivery', 'local/runtime', 'screens/FirstLaunchScreen',
    'screens/OnboardingScreen', 'screens/SettingsScreen', 'components/PuppyNameSetting'];
  for (const facade of facades) {
    const file = (platform: string) => ts.resolveModuleName(`./src/${facade}`, entry, {
      moduleResolution: ts.ModuleResolutionKind.Bundler, moduleSuffixes: [`.${platform}`, '.native', ''],
      allowImportingTsExtensions: true,
    }, ts.sys).resolvedModule?.resolvedFileName;
    const ios = file('ios'), android = file('android');
    assert.ok(ios, `${facade} resolves`);
    assert.equal(android, ios, `${facade} must not leave Android on the browser fallback`);
    assert.match(ios, /\.native\.tsx?$/);
  }
});
