import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeSelfRewrite } from './proxy-response';
test('self rewrite resumes while preserving Clerk request authentication overrides',()=>{
 const request=new Request('http://127.0.0.1:3107/api/me');
 const response=new Response(null,{headers:{'x-middleware-rewrite':request.url,'x-middleware-override-headers':'x-clerk-auth-status,x-clerk-auth-signature','x-middleware-request-x-clerk-auth-status':'signed-out','x-middleware-request-x-clerk-auth-signature':'synthetic-signature'}});
 resumeSelfRewrite(request,response);
 assert.equal(response.headers.get('x-middleware-next'),'1');assert.equal(response.headers.has('x-middleware-rewrite'),false);
 assert.equal(response.headers.get('x-middleware-request-x-clerk-auth-signature'),'synthetic-signature');
 assert.equal(response.headers.get('x-middleware-override-headers'),'x-clerk-auth-status,x-clerk-auth-signature');
});
test('real rewrites and redirects retain their destination and behavior',()=>{
 const request=new Request('http://127.0.0.1:3107/api/me');
 const cases: Record<string,string>[] = [{'x-middleware-rewrite':'http://127.0.0.1:3107/other'},{'x-middleware-rewrite':'https://example.invalid/api/me'},{'x-middleware-rewrite':request.url,location:'/sign-in'}];
 for(const headers of cases){
 const response=new Response(null,{headers});resumeSelfRewrite(request,response);assert.equal(response.headers.has('x-middleware-next'),false);assert.equal(response.headers.get('x-middleware-rewrite'),headers['x-middleware-rewrite']);
 }
});

// Clerk's production proxy serves scripts that the general static-file rule skips.
test('Clerk scripts reach proxy while ordinary static assets remain excluded',async()=>{
 const { unstable_doesMiddlewareMatch } = await import('next/experimental/testing/server');
 const { config } = await import('../../proxy');
 for(const url of ['/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js','/__clerk/npm/@clerk/ui@1/dist/ui.browser.js','/__clerk/v1/client','/api/me','/admin']) {
  assert.equal(unstable_doesMiddlewareMatch({config,nextConfig:{},url}),true,url);
 }
 for(const url of ['/_next/static/chunks/app.js','/icon.svg','/fonts/font.woff2']) {
  assert.equal(unstable_doesMiddlewareMatch({config,nextConfig:{},url}),false,url);
 }
});
