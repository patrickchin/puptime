import assert from 'node:assert/strict';
import test from 'node:test';
import { handoffDevice, nativeCareLink } from './app-link.ts';

test('invitation handoff preserves validated credentials for the native app', () => {
 const id='shr_'+'a'.repeat(32),token='inv_'+'b'.repeat(32);
 assert.equal(nativeCareLink(`https://puptime.test/care?invite=${id}#${token}`),`puptime://care?invite=${id}#${token}`);
 assert.equal(nativeCareLink(`https://puptime.test/care?invite=${id}`),`puptime://care?invite=${id}`);
 assert.equal(nativeCareLink('https://puptime.test/care'),'puptime://');
 for(const suffix of ['?invite=bad','#secret','?invite='+id+'#bad','?invite=https://evil.example'])assert.equal(nativeCareLink('https://puptime.test/care'+suffix),null);
});

test('handoff device detection separates phones from desktops', () => {
 assert.equal(handoffDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',5),'android');
 assert.equal(handoffDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',5),'ios');
 assert.equal(handoffDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',5),'ios');
 assert.equal(handoffDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',0),'desktop');
 assert.equal(handoffDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'),'desktop');
});
