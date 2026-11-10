import {homedir} from 'node:os';
import {join} from 'node:path';
if(process.argv.length===5)process.argv.push(join(homedir(),'Pictures/Screenshots/Codex/puptime-sharing'));
process.argv.push('--sharing');
await import('./verify-ios-guest-account.mjs');
