import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';

const {copyNotices} = createRequire(import.meta.url)('../plugins/withAndroidFontNotices.js');
test('Android prebuild copies the same offline notice bytes and replaces stale generated content', () => {
  const root = mkdtempSync(join(tmpdir(), 'puptime-font-notices-'));
  try {
    mkdirSync(join(root, 'src'));
    const source = Buffer.from('[{"id":"synthetic","body":"License\\n"}]\n');
    for (const name of ['font-icon-notices.json', 'android-software-notices.json']) writeFileSync(join(root, 'src', name), source);
    copyNotices(root, join(root, 'android'));
    const target = join(root, 'android/app/src/main/assets/puptime/font-icon-notices.json');
    const software = join(root, 'android/app/src/main/assets/puptime/android-software-notices.json');
    assert.deepEqual(readFileSync(target), source);
    assert.deepEqual(readFileSync(software), source);
    writeFileSync(target, 'stale');
    writeFileSync(software, 'stale');
    copyNotices(root, join(root, 'android'));
    assert.deepEqual(readFileSync(target), source);
    assert.deepEqual(readFileSync(software), source);
  } finally {
    rmSync(root, {recursive:true, force:true});
  }
});
