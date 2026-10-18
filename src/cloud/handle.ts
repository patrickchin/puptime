import type { AccountController } from './account-controller';

export type CloudHandle={available:boolean;controller:AccountController|null;problem:'configuration'|'local-storage'|null;getLocalName:()=>Promise<string>};
