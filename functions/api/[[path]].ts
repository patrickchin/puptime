export function onRequest({request,env}:{request:Request;env:{PUPTIME_API?:{fetch(request:Request):Promise<Response>}}}):Response|Promise<Response>{
 if(!env.PUPTIME_API)return Response.json({error:'service_unavailable'},{status:503,headers:{'cache-control':'no-store'}});
 return env.PUPTIME_API.fetch(request);
}
