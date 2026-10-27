import type { AccountController } from './account-controller';
import type {AssistantClient} from '../assistant-client';

export type CloudHandle={available:boolean;controller:AccountController|null;problem:'configuration'|'local-storage'|null;getLocalName:()=>Promise<string>;retry?:()=>void;assistant?:AssistantClient};
