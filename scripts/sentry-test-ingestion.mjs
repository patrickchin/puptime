import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Only synthetic envelopes from the isolated observability test project.
export default async function setup(project) {
  const records=[];
  let status=200;
  const server=createServer(async (request,response)=>{
    if(request.url==='/records') {
      if(request.method==='DELETE'){records.length=0;status=200;}
      response.writeHead(200,{'content-type':'application/json'});
      response.end(JSON.stringify(records));return;
    }
    if(request.url==='/fail'&&request.method==='POST'){status=503;response.end();return;}
    if(request.method!=='POST'||!request.url?.startsWith('/api/42/envelope/')) {
      response.writeHead(404);response.end();return;
    }
    let body='';
    for await(const chunk of request){body+=chunk.toString();if(Buffer.byteLength(body)>262144){response.writeHead(413);response.end();return;}}
    // Relay uses the envelope ID; without one it assigns a new ID.
    const responseEventId=JSON.parse(body.split('\n')[0]).event_id??randomUUID().replaceAll('-','');
    records.push({path:request.url,body,responseEventId});
    response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify({id:responseEventId}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  project.provide('sentryTestOrigin',`http://127.0.0.1:${port}`);
  return ()=>new Promise(resolve=>server.close(resolve));
}
