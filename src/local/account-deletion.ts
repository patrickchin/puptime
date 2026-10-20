import {z} from 'zod';
import {identifierSchema} from '../cloud/protocol.ts';
import type {LocalDatabase,SqlExecutor} from './database.ts';
import {notifyLocalCommit} from './sync-projection.ts';

const receiptSchema=z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const timeSchema=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const appleRevocationSchema=z.enum(['revoked','manual','not-linked']);
const intentSchema=z.strictObject({
  accountId:identifierSchema,generation:identifierSchema.nullable(),receipt:receiptSchema,
  expiresAt:timeSchema.refine(value=>value>0),savedAt:timeSchema,
  phase:z.enum(['prepared','dispatched','acknowledged']),appleRevocation:appleRevocationSchema.nullable(),
}).refine(value=>(value.phase==='acknowledged')===(value.appleRevocation!==null));
export type AppleRevocation=z.infer<typeof appleRevocationSchema>;
export type AccountDeletionIntent=z.infer<typeof intentSchema>;
export type AccountDeletionNotice={appleRevocation:AppleRevocation};
type Input=Pick<AccountDeletionIntent,'accountId'|'generation'|'receipt'|'expiresAt'>;
const columns='account_id AS accountId,generation,receipt,expires_at AS expiresAt,saved_at AS savedAt,phase,apple_revocation AS appleRevocation';
const noticeKey='account_deletion_notice';

// A status-only receipt survives uncertain HTTP responses. It never authorizes deletion.
export function createAccountDeletion(database:LocalDatabase,options:{now?:()=>number;afterCommit?:()=>void}={}) {
  async function read(sql:SqlExecutor):Promise<AccountDeletionIntent|null> {
    const row=await sql.getFirstAsync<AccountDeletionIntent>(`SELECT ${columns} FROM local_account_deletion WHERE singleton=1`);
    return row?intentSchema.parse(row):null;
  }
  async function fence(sql:SqlExecutor,intent:Pick<AccountDeletionIntent,'accountId'|'generation'>) {
    const owner=await sql.getFirstAsync<{account_id:string;generation:string}>('SELECT account_id,generation FROM local_sync_owner WHERE singleton=1');
    if(intent.generation===null?owner!==null:!owner||owner.account_id!==intent.accountId||owner.generation!==intent.generation)throw new Error('Cloud owner changed.');
  }
  async function required(sql:SqlExecutor,receipt:string) {
    receiptSchema.parse(receipt);
    const current=await read(sql);
    if(!current||current.receipt!==receipt)throw new Error('Deletion intent changed.');
    await fence(sql,current);
    return current;
  }
  async function write(action:(sql:SqlExecutor)=>Promise<void>) {
    await database.write(action);
    notifyLocalCommit(options.afterCommit);
  }
  function changed(result:{changes:number}) {
    if(result.changes!==1)throw new Error('Deletion intent changed.');
  }
  return {
    read:()=>database.read(read),
    owner:()=>database.read(async sql=>{
      const row=await sql.getFirstAsync<{accountId:string;generation:string}>('SELECT account_id AS accountId,generation FROM local_sync_owner WHERE singleton=1');
      return row?{accountId:identifierSchema.parse(row.accountId),generation:identifierSchema.parse(row.generation)}:null;
    }),
    async save(input:Input,expectedPreviousReceipt:null|string):Promise<AccountDeletionIntent> {
      const intent=intentSchema.parse({...input,savedAt:(options.now??Date.now)(),phase:'prepared',appleRevocation:null});
      if(intent.expiresAt<=intent.savedAt)throw new Error('Deletion receipt already expired.');
      if(expectedPreviousReceipt!==null)receiptSchema.parse(expectedPreviousReceipt);
      await write(async sql=>{
        const previous=await read(sql);
        if(expectedPreviousReceipt===null?previous!==null:!previous||previous.receipt!==expectedPreviousReceipt)throw new Error('Deletion intent changed.');
        if(previous&&(previous.accountId!==intent.accountId||previous.generation!==intent.generation||previous.phase==='acknowledged'||previous.receipt===intent.receipt))throw new Error('Deletion intent cannot be replaced.');
        await fence(sql,intent);
        changed(await sql.runAsync(`INSERT INTO local_account_deletion(singleton,account_id,generation,receipt,expires_at,saved_at,phase,apple_revocation) VALUES (1,?,?,?,?,?,'prepared',NULL)
          ON CONFLICT(singleton) DO UPDATE SET account_id=excluded.account_id,generation=excluded.generation,receipt=excluded.receipt,expires_at=excluded.expires_at,saved_at=excluded.saved_at,phase=excluded.phase,apple_revocation=NULL`,intent.accountId,intent.generation,intent.receipt,intent.expiresAt,intent.savedAt));
      });
      return intent;
    },
    async markDispatched(receipt:string):Promise<void> {
      await write(async sql=>{
        const current=await required(sql,receipt);
        if(current.phase==='acknowledged')throw new Error('Deletion already acknowledged.');
        changed(await sql.runAsync("UPDATE local_account_deletion SET phase='dispatched' WHERE singleton=1 AND receipt=?",receipt));
      });
    },
    async acknowledge(receipt:string,appleRevocation:AppleRevocation):Promise<void> {
      appleRevocationSchema.parse(appleRevocation);
      await write(async sql=>{
        const current=await required(sql,receipt);
        if(current.phase==='prepared'||(current.phase==='acknowledged'&&current.appleRevocation!==appleRevocation))throw new Error('Deletion acknowledgment changed.');
        changed(await sql.runAsync("UPDATE local_account_deletion SET phase='acknowledged',apple_revocation=? WHERE singleton=1 AND receipt=?",appleRevocation,receipt));
      });
    },
    async complete(receipt:string):Promise<void> {
      await write(async sql=>{
        const current=await required(sql,receipt);
        if(current.phase!=='acknowledged')throw new Error('Deletion has not been acknowledged.');
        if(current.generation!==null) {
          const removed=await sql.runAsync('DELETE FROM local_sync_owner WHERE singleton=1 AND account_id=? AND generation=?',current.accountId,current.generation);
          if(removed.changes!==1)throw new Error('Cloud owner changed.');
        }
        await sql.runAsync("DELETE FROM metadata WHERE key='pending_restore_operation'");
        changed(await sql.runAsync('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',noticeKey,current.appleRevocation));
        changed(await sql.runAsync('DELETE FROM local_account_deletion WHERE singleton=1 AND receipt=?',receipt));
      });
    },
    readNotice:()=>database.read(async sql=>{
      const row=await sql.getFirstAsync<{value:string}>('SELECT value FROM metadata WHERE key=?',noticeKey);
      return row?{appleRevocation:appleRevocationSchema.parse(row.value)}:null;
    }),
    dismissNotice:()=>write(async sql=>{await sql.runAsync('DELETE FROM metadata WHERE key=?',noticeKey);}),
    cancelPrepared:(receipt:string)=>write(async sql=>{
      const current=await required(sql,receipt);
      if(current.phase!=='prepared')throw new Error('Dispatched deletion must be resolved first.');
      changed(await sql.runAsync('DELETE FROM local_account_deletion WHERE singleton=1 AND receipt=?',receipt));
    }),
  };
}
