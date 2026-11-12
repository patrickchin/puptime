import type { AccountController } from './account-controller';
import type {SharingApi} from './sharing-api';

export type CloudHandle={available:boolean;controller:AccountController|null;problem:'configuration'|'local-storage'|null;getLocalName:()=>Promise<string>;retry?:()=>void;shareDiagnostics?:()=>Promise<void>;sharing?:SharingApi;sharingOrigin?:string};
