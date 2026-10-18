import assert from 'node:assert/strict';
import test from 'node:test';
import * as view from './activity-view.ts';
import type {PuppyEvent} from './domain.ts';

test('refreshing a loaded page retains unchanged row references, replaces edits and removes deleted rows',()=>{
 const first:PuppyEvent={id:'one',type:'pee',at:100,source:'app'},second={...first,id:'two'},removed={...first,id:'deleted'};
 const next=view.retainActivityRows([first,second,removed],[{...second,note:'changed'},{...first}]);
 assert.equal(next[1],first);assert.notEqual(next[0],second);assert.equal(next[0].note,'changed');assert.equal(next.length,2);
 assert.equal(view.retainActivityRows(next,[{...next[0]},{...first}]),next);
});
