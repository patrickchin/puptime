import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { entityId } from './entity-id.ts';
import { createEvent } from './domain.ts';

test('generated event IDs are opaque, prefixed and independent of clock collisions', () => {
  const events=Array.from({length:64},()=>createEvent('pee','app',100));
  assert.equal(new Set(events.map(event=>event.id)).size,events.length);
  for(const event of events)assert.match(event.id,/^evt_[a-f0-9]{32}$/);
  assert.match(entityId('rtn'),/^rtn_[a-f0-9]{32}$/);
});

test('the standard entropy adapter fails closed without Web Crypto', () => {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'crypto')!;
  try {
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
    assert.throws(()=>entityId('evt'),TypeError);
  } finally {Object.defineProperty(globalThis,'crypto',previous);}
});

test('installed Expo Metro resolves native entropy on both platforms and Web Crypto on web', () => {
  const require=createRequire(import.meta.url),root=dirname(dirname(new URL(import.meta.url).pathname));
  const {resolver}=require('@expo/metro-config').getDefaultConfig(root);
  const {resolve:resolveModule}=require('metro-resolver');
  const context={...resolver,assetExts:new Set(resolver.assetExts),originModulePath:resolve(root,'src/entity-id.ts'),isESMImport:true,
    getPackageForModule:()=>({rootPath:root,packageJson:JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'))}),
    fileSystemLookup:(path:string)=>{try{return {exists:true,type:statSync(path).isDirectory()?'d':'f',realPath:realpathSync(path)};}catch{return {exists:false};}},
    unstable_logWarning:(message:string)=>{throw new Error(message);},
  };
  for(const platform of ['ios','android','web']) {
    const selected=resolveModule(context,'#entity-id-entropy',platform);
    assert.equal(selected.filePath,resolve(root,`src/entity-id-entropy${platform==='web'?'':'.native'}.ts`));
  }
});
