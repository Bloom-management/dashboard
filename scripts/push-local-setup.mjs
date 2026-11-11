/** Local-only secret generation and allowlisting of the two requested preview profiles.
 * Never prints key material, tickets, cookies, subscription endpoints, or env values. */
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,chmodSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {generateVAPIDKeys} from 'web-push';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd(),true);
try{
 if(process.argv.length!==2||process.env.NEXT_PUBLIC_APP_URL!=='http://localhost:3000'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55441'||!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'))throw Error();
 const {chromium}=await import(pathToFileURL(process.cwd()+'/.bloom-local/private/browser-tools/node_modules/playwright/index.mjs').href);
 const named=JSON.parse(readFileSync('.bloom-local/private/named-test-logins.json','utf8'));
 const devices=[],subjects=[];
 for(const [name,role,port] of [['cleanertest','cleaner',9223],['ownertest','owner',9222]]){
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`),context=browser.contexts()[0];
  const page=context.pages().find(page=>page.url().startsWith('http://localhost:3000/'+role));if(!page)throw Error();
  const subject=await Promise.race([page.evaluate(()=>window.Clerk?.user?.id),new Promise((_,reject)=>setTimeout(()=>reject(Error()),20000))]);if(subject!==named[name].subject)throw Error();
  const cookie=(await context.cookies('http://localhost:3000')).find(c=>c.name==='bloom_push_device');if(!cookie||!cookie.httpOnly)throw Error();
  devices.push(createHash('sha256').update(cookie.value).digest('hex'));subjects.push(subject);
 }
 const file='.env.development.local';let content=existsSync(file)?readFileSync(file,'utf8'):'';
 const pair=process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY&&process.env.BLOOM_PUSH_VAPID_PRIVATE_KEY?{publicKey:process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY,privateKey:process.env.BLOOM_PUSH_VAPID_PRIVATE_KEY}:generateVAPIDKeys();
 const settings={NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY:pair.publicKey,BLOOM_PUSH_VAPID_PRIVATE_KEY:pair.privateKey,
  BLOOM_PUSH_VAPID_SUBJECT:process.env.BLOOM_PUSH_VAPID_SUBJECT??'https://bloomcleaning.org',
  BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY:process.env.BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY??randomBytes(32).toString('base64url'),
  BLOOM_PUSH_SCHEDULER_SECRET:process.env.BLOOM_PUSH_SCHEDULER_SECRET??randomBytes(32).toString('hex'),
  BLOOM_PUSH_TRANSPORT:'native',BLOOM_PUSH_MODE:'test',BLOOM_PUSH_TEST_SUBJECTS:subjects.join(','),BLOOM_PUSH_TEST_DEVICE_IDS:devices.join(',')};
 for(const [name,value] of Object.entries(settings)){
  const line=new RegExp('^'+name+'=.*$','m');content=line.test(content)?content.replace(line,()=>name+'='+value):content.trimEnd()+'\n'+name+'='+value+'\n';
 }
 writeFileSync(file,content,{mode:0o600});chmodSync(file,0o600);
 console.log('Local native Web Push configured. Secrets retained in ignored development configuration; only cleanertest and ownertest preview devices are allowlisted. No delivery activation or sends.');
 process.exit(0);
}catch{console.error('Local setup refused. Keep the authenticated cleaner/owner previews open and use the existing local development services. No credentials printed.');process.exit(1);}
