/** Prepare files only. Never deploys, connects to a hosted DB, activates delivery or prints secrets. */
import {generateVAPIDKeys} from 'web-push';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd(),true);
try{
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--origin'||args[2]!=='--supabase-url')throw Error();
 const origin=new URL(args[1]),database=new URL(args[3]);
 if(origin.protocol!=='https:'||origin.origin!==args[1]||origin.username||origin.password||['admin.bloomcleaning.org','bloomcleaning.org','localhost'].includes(origin.hostname))throw Error();
 if(database.protocol!=='https:'||database.origin!==args[3]||!database.hostname.endsWith('.supabase.co')||database.username||database.password)throw Error();
 if(!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'))throw Error();
 const named=JSON.parse(readFileSync('.bloom-local/private/named-test-logins.json','utf8'));
 const cleaner=named.cleanertest.subject,owner=named.ownertest.subject;
 if(![cleaner,owner].every(subject=>/^user_[a-zA-Z0-9]+$/.test(subject)))throw Error();
 const directory='.bloom-local/private/push-https';mkdirSync(directory,{recursive:true,mode:0o700});
 const file=directory+'/.env.preview';if(existsSync(file))throw Error(); // Never silently rotate an enrolled deployment's keys.
 const pair=generateVAPIDKeys();
 const variables={NEXT_PUBLIC_APP_URL:origin.origin,NEXT_PUBLIC_SUPABASE_URL:database.origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'replace_with_isolated_test_project_publishable_key',SUPABASE_SERVICE_ROLE_KEY:'replace_with_isolated_test_project_service_role_key',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,CLERK_SECRET_KEY:process.env.CLERK_SECRET_KEY,CLERK_ISSUER_DOMAIN:process.env.CLERK_ISSUER_DOMAIN,
  CALENDAR_ENCRYPTION_KEY:randomBytes(32).toString('hex'),BLOOM_PUSH_TRANSPORT:'native',BLOOM_PUSH_MODE:'test',
  BLOOM_PUSH_TEST_SUBJECTS:[cleaner,owner].join(','),BLOOM_PUSH_TEST_DEVICE_IDS:'',
  NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY:pair.publicKey,BLOOM_PUSH_VAPID_PRIVATE_KEY:pair.privateKey,BLOOM_PUSH_VAPID_SUBJECT:'https://bloomcleaning.org',
  BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY:randomBytes(32).toString('base64url'),BLOOM_PUSH_SCHEDULER_SECRET:randomBytes(32).toString('hex')};
 if(Object.values(variables).some(value=>typeof value!=='string'||/[\r\n]/.test(value)))throw Error();
 const seed=`-- PREPARED ONLY: dedicated empty test project, after migrations through 084. Never production.\nbegin;\ndo $$begin\n if exists(select 1 from public.users where clerk_user_id not in ('${cleaner}','${owner}')) then raise exception 'Expected an isolated test database';end if;\nend $$;\ninsert into public.users(clerk_user_id,role,display_name,approved_city_id,initial_city_selected_at,onboarding_completed_at) values\n ('${cleaner}','cleaner','cleanertest','00000000-0000-4000-8000-000000000001',now(),now()),\n ('${owner}','owner','ownertest','00000000-0000-4000-8000-000000000001',now(),now()) on conflict(clerk_user_id) do nothing;\ndo $$begin\n if not exists(select 1 from public.users where clerk_user_id='${cleaner}' and role='cleaner') or not exists(select 1 from public.users where clerk_user_id='${owner}' and role='owner') then raise exception 'Unexpected test account mapping';end if;\nend $$;\ncommit;\n`;
 writeFileSync(file,Object.entries(variables).map(([name,value])=>name+'='+value).join('\n')+'\n',{flag:'wx',mode:0o600});
 writeFileSync(directory+'/seed-test-accounts.sql',seed,{flag:'wx',mode:0o600});
 console.log('Prepared protected HTTPS test configuration and test-account seed under .bloom-local/private/push-https. Supply isolated-project credentials privately. No deployment, migration, activation or send performed.');
}catch{console.error('Preparation refused. Supply --origin and --supabase-url for an explicitly selected isolated HTTPS test deployment, use development Clerk configuration, and preserve existing prepared keys. No values printed.');process.exitCode=1;}
