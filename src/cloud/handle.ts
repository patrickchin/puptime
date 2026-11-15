import type { AccountController } from './account-controller';
import type {RecordOnboardingDiagnostic} from './sync-diagnostics';
import type {SharingApi} from './sharing-api';

export type CloudHandle={available:boolean;controller:AccountController|null;problem:'configuration'|'local-storage'|null;getLocalName:()=>Promise<string>;retry?:()=>void;shareDiagnostics?:()=>Promise<void>;recordOnboardingDiagnostic?:RecordOnboardingDiagnostic;sharing?:SharingApi;sharingOrigin?:string};
