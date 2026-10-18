import type { AccountController } from './account-controller';
export type CloudHandle={available:boolean;controller:AccountController|null;problem:'configuration'|'local-storage'|null;getLocalName:()=>Promise<string>};
const disabled:CloudHandle={available:false,controller:null,problem:null,getLocalName:async()=>''};
// Android and browser cloud activation follow the iOS release.
export function useCloud(_onRemoteChange:()=>unknown):CloudHandle {return disabled;}
