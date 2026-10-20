import type { CloudHandle } from './handle';
export type { CloudHandle } from './handle';
const disabled:CloudHandle={available:false,controller:null,problem:null,getLocalName:async()=>''};
// Browser activity remains deferred; both phones resolve use-cloud.native.ts.
export function useCloud(_onRemoteChange:()=>unknown):CloudHandle {return disabled;}
