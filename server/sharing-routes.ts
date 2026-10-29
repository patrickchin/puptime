import {Hono,type Context} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {z} from 'zod';
import {authenticated,type AccountEnv} from './account-routes';
import {createAuth} from './auth';
import {getAccountStore} from './account-store';
import {acceptShareSchema,careWriteSchema,createShareSchema,shareIdSchema} from '../src/sharing';
import {identifierSchema} from '../src/cloud/protocol';

type ShareRow={id:string;owner_id:string;pet_id:string;kind:'household'|'temporary';permission:'view'|'contribute';label:string;token_hash:string;expires_at:number|null;invite_expires_at:number;member_id:string|null;member_name:string|null;revoked_at:number|null;created_at:number;owner_name:string};
export async function secretHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');}
function info(row:ShareRow){return {id:row.id,petId:row.pet_id,kind:row.kind,permission:row.permission,label:row.label,expiresAt:row.expires_at,inviteExpiresAt:row.invite_expires_at,memberName:row.member_name,accepted:row.member_id!==null,revoked:row.revoked_at!==null,createdAt:row.created_at};}
function unavailable():never{throw new HTTPException(410,{message:'This invitation has expired or access has ended.'});}
async function share(context:Context<AccountEnv>,id:string){
  const row=await context.env.AUTH_DB.prepare(`SELECT s.*,u.name AS owner_name,m.name AS member_name FROM puppy_shares s JOIN user u ON u.id=s.owner_id LEFT JOIN user m ON m.id=s.member_id LEFT JOIN cloud_accounts c ON c.account_id=s.owner_id WHERE s.id=? AND COALESCE(c.state,'')!='deleting'`).bind(shareIdSchema.parse(id)).first<ShareRow>();
  if(!row||row.revoked_at!==null||(row.expires_at!==null&&row.expires_at<=Date.now()))unavailable();
  return row;
}
async function user(context:Context<AccountEnv>){
  const result=await createAuth(context.env).api.getSession({headers:context.req.raw.headers,returnHeaders:true});
  for(const cookie of result.headers.getSetCookie())context.header('set-cookie',cookie,{append:true});
  if(!result.response)return null;
  const expected=context.req.header('x-puptime-account');
  if(expected!==undefined&&expected!==result.response.user.id)throw new HTTPException(409);
  const active=await context.env.AUTH_DB.prepare("SELECT id FROM user LEFT JOIN cloud_accounts c ON c.account_id=user.id WHERE id=? AND COALESCE(c.state,'')!='deleting'").bind(result.response.user.id).first();
  return active?result.response.user:null;
}
async function access(context:Context<AccountEnv>,row:ShareRow){
  const member=await user(context);
  if(!member||member.id!==row.member_id)throw new HTTPException(401);
  return {id:member.id,name:member.name||row.label};
}
export const sharingRoutes=new Hono<AccountEnv>();
sharingRoutes.use('*',async(context,next)=>{
  if(!/^\/api\/(?:sharing(?:\/|$)|care\/)/.test(context.req.path)){await next();return;}
  context.header('Cache-Control','no-store');context.header('Referrer-Policy','no-referrer');context.header('X-Robots-Tag','noindex, nofollow');
  if(!['GET','HEAD','OPTIONS'].includes(context.req.method)){
    const origin=context.req.header('origin'),allowed=[context.env.AUTH_BASE_URL?new URL(context.env.AUTH_BASE_URL).origin:'',...(context.env.WEB_ORIGINS??'').split(',')];
    if(origin?!allowed.includes(origin):context.req.header('sec-fetch-site')==='cross-site')throw new HTTPException(403);
  }
  await next();
});
sharingRoutes.use('/sharing*',authenticated,async(context,next)=>{
  const expected=context.req.header('x-puptime-account');
  if(expected!==context.get('user').id)throw new HTTPException(409);
  await next();
});
sharingRoutes.get('/sharing',async context=>{
  const petId=identifierSchema.parse(context.req.query('petId'));
  const rows=await context.env.AUTH_DB.prepare('SELECT s.*,m.name AS member_name FROM puppy_shares s LEFT JOIN user m ON m.id=s.member_id WHERE owner_id=? AND pet_id=? ORDER BY (revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND (member_id IS NOT NULL OR invite_expires_at>?)) DESC,created_at DESC LIMIT 100').bind(context.get('user').id,petId,Date.now(),Date.now()).all<ShareRow>();
  return context.json({shares:rows.results.map(info)});
});
sharingRoutes.post('/sharing',async context=>{
  const input=createShareSchema.parse(await context.req.json()),owner=context.get('user').id,now=Date.now();
  if(input.expiresAt!==null&&(input.expiresAt<=now||input.expiresAt>now+30*86400000))throw new HTTPException(400);
  if(!(await context.get('store').summary()).pets.some(pet=>pet.id===input.petId))throw new HTTPException(404);
  const hash=await secretHash(input.token),db=context.env.AUTH_DB;
  const old=await db.prepare('SELECT s.*,m.name AS member_name FROM puppy_shares s LEFT JOIN user m ON m.id=s.member_id WHERE s.id=?').bind(input.id).first<ShareRow>();
  if(old){
    if(old.owner_id!==owner||old.token_hash!==hash||old.pet_id!==input.petId||old.kind!==input.kind||old.permission!==input.permission||old.label!==input.label||old.expires_at!==input.expiresAt)throw new HTTPException(409);
    return context.json(info(old));
  }
  const count=await db.prepare('SELECT COUNT(*) AS n FROM puppy_shares WHERE owner_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').bind(owner,now).first<{n:number}>();
  if(count!.n>=100)throw new HTTPException(429);
  await db.prepare(`INSERT INTO puppy_shares(id,owner_id,pet_id,kind,permission,label,token_hash,expires_at,invite_expires_at,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM user LEFT JOIN cloud_accounts c ON c.account_id=user.id WHERE user.id=? AND COALESCE(c.state,'')!='deleting')`).bind(input.id,owner,input.petId,input.kind,input.permission,input.label,hash,input.expiresAt,input.expiresAt??now+7*86400000,now,owner).run();
  return context.json(info(await share(context,input.id)),201);
});
sharingRoutes.post('/sharing/:id/revoke',async context=>{
  const result=await context.env.AUTH_DB.prepare('UPDATE puppy_shares SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND owner_id=?').bind(Date.now(),shareIdSchema.parse(context.req.param('id')),context.get('user').id).run();
  if(!result.meta.changes)throw new HTTPException(404);
  return context.json({ok:true});
});
sharingRoutes.post('/care/preview',async context=>{
  const input=acceptShareSchema.parse(await context.req.json()),row=await share(context,input.id);
  if(row.token_hash!==await secretHash(input.token)||row.invite_expires_at<=Date.now())unavailable();
  const pet=(await getAccountStore(context.env,row.owner_id).summary()).pets.find(pet=>pet.id===row.pet_id);if(!pet)unavailable();
  return context.json({share:info(row),puppyName:pet.name,ownerName:row.owner_name});
});
sharingRoutes.post('/care/accept',async context=>{
  const input=acceptShareSchema.parse(await context.req.json()),row=await share(context,input.id);
  if(row.token_hash!==await secretHash(input.token)||row.invite_expires_at<=Date.now())unavailable();
  const member=await user(context);if(!member)throw new HTTPException(401);
  if(member.id===row.owner_id)throw new HTTPException(409,{message:'You already own this puppy. Send this invitation to your carer.'});
  const result=await context.env.AUTH_DB.prepare('UPDATE puppy_shares SET member_id=? WHERE id=? AND revoked_at IS NULL AND (member_id IS NULL OR member_id=?)').bind(member.id,row.id,member.id).run();
  if(!result.meta.changes)throw new HTTPException(409,{message:'This invitation has already been accepted.'});
  return context.json({id:row.id});
});
sharingRoutes.get('/care/puppies',async context=>{
  const member=await user(context);if(!member)throw new HTTPException(401);
  const rows=await context.env.AUTH_DB.prepare(`SELECT s.*,u.name AS owner_name FROM puppy_shares s JOIN user u ON u.id=s.owner_id LEFT JOIN cloud_accounts c ON c.account_id=s.owner_id WHERE s.member_id=? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>?) AND COALESCE(c.state,'')!='deleting' ORDER BY s.created_at DESC LIMIT 100`).bind(member.id,Date.now()).all<ShareRow>();
  const puppies=await Promise.all(rows.results.map(async row=>({id:row.id,name:(await getAccountStore(context.env,row.owner_id).summary()).pets.find(pet=>pet.id===row.pet_id)?.name??'Puppy',ownerName:row.owner_name,petId:row.pet_id,kind:row.kind,permission:row.permission,expiresAt:row.expires_at})));
  return context.json({puppies});
});
sharingRoutes.get('/care/:id',async context=>{
  const row=await share(context,context.req.param('id')),actor=await access(context,row);
  const kind=z.enum(['event','routine']).parse(context.req.query('kind')??'event'),after=z.coerce.number().int().min(0).parse(context.req.query('after')??0);
  const result=await getAccountStore(context.env,row.owner_id).careList(row.id,actor.id,kind,after);
  return context.json({...result,share:info(row),ownerName:row.owner_name,actorName:actor.name});
});
sharingRoutes.post('/care/:id/logs',async context=>{
  const row=await share(context,context.req.param('id')),actor=await access(context,row),input=careWriteSchema.parse(await context.req.json());
  if(row.permission==='view'||(input.kind==='routine'&&row.kind!=='household'))throw new HTTPException(403);
  const result=await getAccountStore(context.env,row.owner_id).careWrite(row.id,actor.id,input);
  return context.json(result,result.ok?200:result.error==='forbidden'?403:result.error==='not_found'?404:409);
});
