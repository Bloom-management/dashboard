import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceRpc } from '../../src/server/calendar/store';
test('RPC transport preserves only exact safe status/code pairs and hides upstream details',async()=>{
 const saved={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:globalThis.fetch};
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:55441';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-test-key';
 try{
  globalThis.fetch=async()=>new Response(null,{status:204});
  assert.equal(await serviceRpc()('test_void',{}),undefined);
  for(const [status,code] of [[400,'VALIDATION_ERROR'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[409,'CONFLICT'],[503,'CONFIGURATION_ERROR']] as const){
   globalThis.fetch=async()=>Response.json({message:code,details:'must-not-escape'},{status});
   await assert.rejects(serviceRpc()('test_rpc',{}),{code,status,message:code});
  }
  for(const [status,body] of [[400,{message:'private SQL detail'}],[404,{message:'FORBIDDEN'}],[500,{message:'CONFLICT'}]] as const){
   globalThis.fetch=async()=>Response.json(body,{status});
   await assert.rejects(serviceRpc()('test_rpc',{}),{code:'CONFIGURATION_ERROR',status:503});
  }
 }finally{globalThis.fetch=saved.fetch;if(saved.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=saved.url;if(saved.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=saved.key;}
});
test('RPC construction is inert without calendar credentials; bad configuration is safely scoped to invocation', async () => {
 const saved = { url:process.env.NEXT_PUBLIC_SUPABASE_URL, key:process.env.SUPABASE_SERVICE_ROLE_KEY, fetch:globalThis.fetch };
 try {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch=async()=>{assert.fail('Invalid configuration must not attempt a network request');};
  const rpc=serviceRpc();
  await assert.rejects(rpc('bloom_calendar_sources',{}),{code:'CONFIGURATION_ERROR',status:503});
  process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
  for(const url of ['not-a-url-with-private-material','https://private:secret@example.invalid','file:///private']) {
   process.env.NEXT_PUBLIC_SUPABASE_URL=url;
   await assert.rejects(rpc('bloom_calendar_sources',{}),{code:'CONFIGURATION_ERROR',status:503,message:'CONFIGURATION_ERROR'});
  }
 } finally {
  globalThis.fetch=saved.fetch;
  if(saved.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=saved.url;
  if(saved.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=saved.key;
 }
});
