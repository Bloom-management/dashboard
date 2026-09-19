/** Clerk encodes a normal continuation as an exact self-rewrite. Resume locally
 * so Next does not forward a loopback hostname alias back through Proxy.
 * Preserve all Clerk request overrides/signatures; never alter real redirects/rewrites.
 */
export function resumeSelfRewrite(request: Request, response: Response) {
 if(response.headers.get('x-middleware-rewrite')===request.url && !response.headers.has('location')) {
  response.headers.delete('x-middleware-rewrite');
  response.headers.set('x-middleware-next','1');
 }
 return response;
}
