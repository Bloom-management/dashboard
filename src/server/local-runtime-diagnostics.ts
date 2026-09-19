const codes = new Set(['ECONNREFUSED','ENOTFOUND','ETIMEDOUT','EHOSTUNREACH','ECONNRESET','UND_ERR_CONNECT_TIMEOUT']);
function transportCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'FETCH_FAILED';
  if ('code' in error && typeof error.code === 'string' && codes.has(error.code)) return error.code;
  return 'cause' in error ? transportCode(error.cause) : 'FETCH_FAILED';
}
export function installLocalRuntimeDiagnostics() {
  const target = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const local = target === 'http://127.0.0.1:55441';
  console.info('[Bloom runtime]', JSON.stringify({pid:process.pid,localSupabase:local,appOrigin:process.env.NEXT_PUBLIC_APP_URL==='http://127.0.0.1:3000'}));
  if (!local) return;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    try { return await originalFetch(input, init); }
    catch (error) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === target && url.pathname === '/rest/v1/rpc/bloom_me') {
        console.info('[Bloom runtime transport]', JSON.stringify({pid:process.pid,operation:'bloom_me',target,code:transportCode(error)}));
      }
      throw error;
    }
  };
}
