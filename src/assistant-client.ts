import {assistantRequestSchema,validateAssistantPlan,type AssistantRequest} from './assistant.ts';
import {CloudApiError,cloudErrorCategory,retryDelay,throwIfAborted,type CloudRequest} from './cloud/api.ts';
import {z} from 'zod';
export function createAssistantClient(request:CloudRequest){
  async function call(path:string,body?:AssistantRequest,signal?:AbortSignal){
    throwIfAborted(signal);
    let response:Awaited<ReturnType<CloudRequest>>;
    try{response=await request(path,{method:body?'POST':'GET',body,signal});}
    catch{throwIfAborted(signal);throw new CloudApiError('network');}
    throwIfAborted(signal);
    if(response.error)throw new CloudApiError(cloudErrorCategory(response.error.status),response.error.status,retryDelay(response.retryAfter));
    return response.data;
  }
  return {
    async status(signal?:AbortSignal){return z.strictObject({available:z.boolean()}).parse(await call('/api/assistant/status',undefined,signal));},
    async plan(raw:AssistantRequest,signal?:AbortSignal){const input=assistantRequestSchema.parse(raw);return validateAssistantPlan(await call('/api/assistant/plan',input,signal),input);},
  };
}
export type AssistantClient=ReturnType<typeof createAssistantClient>;
