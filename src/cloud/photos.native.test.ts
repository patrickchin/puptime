import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {createAuthClient} from 'better-auth/react';
import {createPhotoTransfer} from './photo-transfer.ts';
import {assertPuppyPhotoBytes} from '../puppy-photo.ts';

test('the native photo adapter sends file bytes through the installed SDK and rejects corrupt disk data before transport',async()=>{
 const jpeg=new Uint8Array([255,216,255,219,0,255,217]),photoId='img_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
 let diskBytes=jpeg,calls=0;
 const file={exists:true,bytes:async()=>diskBytes,toJSON:()=>({uri:'file:///synthetic-photo.jpg'})};
 const modules:Record<string,unknown>={
  '../local/runtime.native':{getLocalRuntime:async()=>{throw new Error('Unexpected runtime read');}},
  '../photo-files.native':{puppyPhotoFile:()=>file,localPuppyPhotoUri:()=>undefined,savePuppyPhotoFile:()=>{throw new Error('Unexpected download');}},
  '../puppy-photo':{assertPuppyPhotoBytes},
 };
 const source=readFileSync(new URL('./photos.native.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {createNativePhotoSync:(transfer:ReturnType<typeof createPhotoTransfer>)=>{upload:(id:string,petId:string,accountId:string,signal:AbortSignal)=>Promise<void>}}};
 Function('require','module','exports',compiled)((name:string)=>{assert.ok(name in modules,name);return modules[name];},module,module.exports);
 const auth=createAuthClient({baseURL:'https://puptime.test',fetchOptions:{customFetchImpl:async(_input,options)=>{
  calls++;assert.equal(new Headers(options?.headers).get('content-type'),'image/jpeg');
  assert.deepEqual(new Uint8Array(await new Response(options?.body).arrayBuffer()),jpeg);
  return Response.json({photoId});
 }}});
 const adapter=module.exports.createNativePhotoSync(createPhotoTransfer((url,options)=>auth.$fetch<unknown>(url,options),'https://puptime.test'));
 await adapter.upload(photoId,'pet-1','owner-1',new AbortController().signal);assert.equal(calls,1);
 diskBytes=new Uint8Array([1,2,3,4]);
 await assert.rejects(adapter.upload(photoId,'pet-1','owner-1',new AbortController().signal),/Invalid profile JPEG/);
 assert.equal(calls,1);
});
