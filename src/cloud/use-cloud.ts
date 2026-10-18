import type { CloudHandle } from './handle';
export type { CloudHandle } from './handle';
const disabled:CloudHandle={available:false,controller:null,problem:null,getLocalName:async()=>''};
// Android and browser cloud activation follow the iOS release.
export function useCloud(_onRemoteChange:()=>unknown):CloudHandle {return disabled;}
