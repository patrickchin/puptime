import {createContext,useContext,type ReactNode} from 'react';
import type {SharedPuppy} from './sharing';
import type {createLocalRuntime} from './local/runtime-factory';
export type CareSelection=SharedPuppy&{accountId:string};
export type CareSession={selection:CareSelection|null;runtime?:Awaited<ReturnType<typeof createLocalRuntime>>;key:string;activate:(puppy:SharedPuppy,accountId:string)=>Promise<void>;leave:()=>Promise<void>;isCurrent:()=>boolean};
export const CareContext=createContext<CareSession>({selection:null,key:'owner',activate:async()=>{},leave:async()=>{},isCurrent:()=>true});
export const useCareSession=()=>useContext(CareContext);
export function CareSessionHost({children}:{children:ReactNode}){return children;}
