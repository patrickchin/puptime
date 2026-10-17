import assert from 'node:assert/strict';
import test from 'node:test';
import { publicPaths, pageMetadata } from './site.ts';
import { privacySignalActive, sanitizeWebsiteEvent } from './telemetry-policy.ts';

test('telemetry drops unknown events and strips sensitive properties and URL values', () => {
  assert.equal(sanitizeWebsiteEvent({ event: '$autocapture', properties: { text: 'private note' } }), null);
  const result = sanitizeWebsiteEvent({ event: 'website_cta', properties: {
    page: '/puppy-care/toilet-training', destination: 'android_download',
    $current_url: 'https://puptime.pages.dev/?email=private#secret', $referrer: 'https://example.com/private',
    email: 'private@example.com', note: 'private note', $set: { name: 'private' }, distinct_id: 'anonymous-id',
  } });
  assert.deepEqual(result?.properties, {
    page: '/puppy-care/toilet-training', $current_url: 'https://puptime.pages.dev/puppy-care/toilet-training',
    $pathname: '/puppy-care/toilet-training', $process_person_profile: false, destination: 'android_download', distinct_id: 'anonymous-id',
  });
  assert.equal(sanitizeWebsiteEvent({ event: 'website_error', properties: { page: '/private-token', error_kind: 'secret' } })?.properties.page, '/404');
  assert.equal(privacySignalActive({ doNotTrack: '1' }), true);
  assert.equal(privacySignalActive({ globalPrivacyControl: true }), true);
  assert.equal(privacySignalActive({}), false);
});

test('every public page has unique metadata and a clean canonical URL', () => {
  assert.equal(publicPaths.length, 15);
  assert.equal(new Set(publicPaths.map((path) => pageMetadata(path).title)).size, publicPaths.length);
  for (const path of publicPaths) {
    const meta = pageMetadata(path);
    assert.ok(meta.description.length > 30);
    assert.ok(!meta.url.includes('#'));
    assert.ok(meta.url.startsWith('https://puptime.pages.dev/'));
  }
});
