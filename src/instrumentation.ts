/** Agent 1 runtime diagnostics; does not change auth, RLS or response semantics. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'development') {
    const { installLocalRuntimeDiagnostics } = await import('./server/local-runtime-diagnostics');
    installLocalRuntimeDiagnostics();
  }
}
