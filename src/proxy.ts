import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { resumeSelfRewrite } from './server/auth/proxy-response';
import { clerkMiddleware } from '@clerk/nextjs/server';
// Session verification is also performed independently inside every sensitive operation.
const clerk = clerkMiddleware();
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
 const configured = [process.env.CLERK_SECRET_KEY, process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY].every(value => value && !value.startsWith('replace_'));
 if (!configured) {
   if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({error:{code:'CONFIGURATION_ERROR',message:'The service is not configured.',requestId:crypto.randomUUID()}},{status:503,headers:{'Cache-Control':'no-store'}});
   return NextResponse.next();
 }
 const result = await clerk(request,event);
 return result instanceof Response ? resumeSelfRewrite(request,result) : result;
}
export const config = { matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/(api|trpc)(.*)', '/__clerk/(.*)'] };
