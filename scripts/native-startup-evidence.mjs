// Finite producer diagnostics only. Importing performs no I/O.
const stages=new Set(['runtime-selection','simulator-create','simulator-boot','host-install','sdk-spawn','sdk-process','sdk-host-validation','fixture-config','owned-port-preflight','existing-store-check','local-auth-migrations','local-worker-start','local-worker-health','fixture-keychain','fixture-root-certificate','fixture-server-certificate','fixture-certificate-sign','fixture-certificate-trust','fixture-proxy-bind','fixture-https-preflight','fixture-auth-database','candidate-bundle-copy','candidate-bundle-export','candidate-bundle-sign','candidate-bundle-install','maestro-process','case-assertions','case-result']);
const codes=new Set(['ETIMEDOUT','ERR_ASSERTION','ENOENT','EACCES','EPERM','ENOSPC','EADDRINUSE','ECONNREFUSED','ECONNRESET','ECONNABORTED','ABORT_ERR']);
const signals=new Set(['SIGINT','SIGTERM','SIGKILL','SIGABRT','SIGSEGV']);
export function startupEvidence(stage,status,error){
 const result={stage:stages.has(stage)?stage:'unknown',status:['started','passed','failed'].includes(status)?status:'unknown'};
 if(result.status!=='failed')return result;
 let observed={};try{observed={code:error?.code,status:error?.status,signal:error?.signal,name:error?.name};}catch{}
 const code=codes.has(observed.code)?observed.code:'other',exitStatus=Number.isInteger(observed.status)&&Math.abs(observed.status)<=255?observed.status:null,signal=signals.has(observed.signal)?observed.signal:null;
 const category=code==='ETIMEDOUT'?'timeout':code==='ERR_ASSERTION'||observed.name==='AssertionError'?'assertion':signal?'signal':exitStatus!==null&&exitStatus!==0?'process-exit':code!=='other'?'system-error':'other';
 return {...result,failure:{category,code,exitStatus,signal}};
}
