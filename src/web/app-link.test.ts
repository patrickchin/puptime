import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeCareLink } from './app-link.ts';

test('invitation handoff preserves validated credentials for the native app', () => {
 const id='shr_'+'a'.repeat(32),token='inv_'+'b'.repeat(32);
 assert.equal(nativeCareLink(`https://puptime.test/care?invite=${id}#${token}`),`puptime://care?invite=${id}#${token}`);
 assert.equal(nativeCareLink(`https://puptime.test/care?invite=${id}`),`puptime://care?invite=${id}`);
 assert.equal(nativeCareLink('https://puptime.test/care'),'puptime://');
 for(const suffix of ['?invite=bad','#secret','?invite='+id+'#bad','?invite=https://evil.example'])assert.equal(nativeCareLink('https://puptime.test/care'+suffix),null);
});
