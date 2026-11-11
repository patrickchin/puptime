import type {AccountSnapshot} from './account-controller.ts';
export type OpenChanges=(options:{signal:AbortSignal;onCursor:(cursor:number)=>void;onClose:()=>void})=>Promise<{close:()=>void}|null>;
type Controller={read:()=>AccountSnapshot;subscribe:(fn:()=>void)=>()=>void;invalidate:()=>void};
const defaultDefer=(fn:()=>void,delay:number)=>{const timer=setTimeout(fn,delay);return()=>clearTimeout(timer);};
function ownerKey(state:AccountSnapshot):string|null {
  if(!state.active||!state.online||state.busy||state.problem||!state.account?.cloud.canSync||state.sync?.accountId!==state.account.user.id||state.sync.state==='local')return null;
  return JSON.stringify([state.account.user.id,state.sync.generation]);
}
export function watchAccountChanges({controller,open,defer=defaultDefer}:{controller:Controller;open:OpenChanges;defer?:(fn:()=>void,delay:number)=>()=>void}) {
  type Connection={key:string;abort:AbortController;state:
    |{phase:'connecting'}
    |{phase:'connected';close:()=>void}
    |{phase:'waiting';cancelRetry:()=>void}
    |{phase:'closed'}};
  let current:Connection|null=null,disposed=false;
  function close(connection:Connection) {
    const state=connection.state;connection.state={phase:'closed'};
    connection.abort.abort();
    if(state.phase==='connected')state.close();
    if(state.phase==='waiting')state.cancelRetry();
  }
  function clear(){const old=current;current=null;if(old)close(old);}
  function connect(key:string,delay=1000) {
    clear();if(disposed||ownerKey(controller.read())!==key)return;
    const connection:Connection={key,abort:new AbortController(),state:{phase:'connecting'}};current=connection;
    let cursor=-1;
    const closed=()=>{
      if(disposed||current!==connection||connection.abort.signal.aborted)return;
      close(connection);
      connection.state={phase:'waiting',cancelRetry:defer(()=>{
        if(current!==connection||connection.state.phase!=='waiting')return;
        connect(key,Math.min(delay*2,60000));
      },delay)};
    };
    void open({signal:connection.abort.signal,onCursor:value=>{
      if(connection.abort.signal.aborted||current!==connection||!Number.isSafeInteger(value)||value<0||value<=cursor)return;
      cursor=value;controller.invalidate();
    },onClose:closed}).then(socket=>{
      if(disposed||current!==connection||connection.abort.signal.aborted){socket?.close();return;}
      if(!socket){closed();return;}connection.state={phase:'connected',close:()=>socket.close()};
    }).catch(closed);
  }
  function update(){const key=ownerKey(controller.read());if(current?.key===key)return;if(!key)clear();else connect(key);}
  const unsubscribe=controller.subscribe(update);update();
  return()=>{disposed=true;unsubscribe();clear();};
}

export type ChangeSocket=Pick<WebSocket,'onmessage'|'onerror'|'onclose'|'close'>;
export function createChangeOpener({origin,getCookie,createSocket}:{origin:string;getCookie:()=>Promise<string>;createSocket:(url:string,options:{headers:Record<string,string>})=>ChangeSocket}):OpenChanges {
  // origin is the exact validated cloud origin from createNativeCloudClient.
  const url=new URL('/api/sync/changes',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  return async({signal,onCursor,onClose})=>{
    if(signal.aborted)return null;
    const cookie=await getCookie();if(!cookie||signal.aborted)return null;
    const socket=createSocket(url.href,{headers:{Cookie:cookie,Origin:origin}});
    let stopped=false;
    const close=()=>{if(stopped)return;stopped=true;socket.onmessage=null;socket.onerror=null;socket.onclose=null;socket.close();};
    const failed=()=>{if(stopped)return;close();if(!signal.aborted)onClose();};
    socket.onclose=failed;socket.onerror=failed;
    socket.onmessage=event=>{
      if(signal.aborted||stopped)return;
      try{
        if(typeof event.data!=='string'||event.data.length>256)throw new Error('Invalid invalidation.');
        const message=JSON.parse(event.data) as Record<string,unknown>;
        if(!message||Object.keys(message).length!==2||message.protocolVersion!==1||!Number.isSafeInteger(message.cursor)||(message.cursor as number)<0)throw new Error('Invalid invalidation.');
        onCursor(message.cursor as number);
      }catch{failed();}
    };
    return {close};
  };
}
