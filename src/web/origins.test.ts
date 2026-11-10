import assert from 'node:assert/strict';
import test from 'node:test';
import { webOrigins } from './origins.ts';

test('a custom public domain gives its app the app. prefix, independent of the product name', () => {
 assert.deepEqual(webOrigins('https://puppy.example'), { siteUrl: 'https://puppy.example', appUrl: 'https://app.puppy.example' });
 assert.equal(webOrigins('https://www.new-name.example').appUrl, 'https://app.new-name.example');
});
test('managed previews and local verification retain same-origin behavior until an app deployment is configured', () => {
 for (const site of ['https://puptime.pages.dev', 'http://127.0.0.1:8898', 'http://localhost:8898']) assert.deepEqual(webOrigins(site), { siteUrl: site, appUrl: site });
 assert.equal(webOrigins('https://puptime.pages.dev', 'https://puptime-app.pages.dev').appUrl, 'https://puptime-app.pages.dev');
});
test('origin configuration rejects credentials, insecure public hosts, and URL paths', () => {
 for (const value of ['http://puppy.example', 'https://user:secret@puppy.example', 'https://puppy.example/account', 'https://puppy.example/?x=1', 'https://puppy.example/#secret']) {
  assert.throws(() => webOrigins(value));
  assert.throws(() => webOrigins('https://puppy.example', value));
 }
});
