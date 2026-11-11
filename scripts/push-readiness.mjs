/** Read-only local audit. Never writes configuration, activates delivery, or prints secret values. */
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(root+'/package.json');require('@next/env').loadEnvConfig(root,true);
const nativeNames=['NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY','BLOOM_PUSH_VAPID_PRIVATE_KEY','BLOOM_PUSH_VAPID_SUBJECT','BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY'];
const currentNames=['NEXT_PUBLIC_APP_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','CLERK_ISSUER_DOMAIN','BLOOM_PUSH_TRANSPORT','BLOOM_PUSH_MODE','BLOOM_PUSH_TEST_SUBJECTS','BLOOM_PUSH_TEST_DEVICE_IDS','BLOOM_PUSH_SCHEDULER_SECRET',...nativeNames];
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DOCKER_')&&!key.startsWith('PG')&&!key.startsWith('SUPABASE_')));
const run=(args,input)=>execFileSync('docker',args,{cwd:root,env,encoding:'utf8',input,stdio:['pipe','pipe','pipe']});
try{
 if(process.argv.length!==2)throw Error();
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55441'||!['http://localhost:3000','http://127.0.0.1:3000'].includes(process.env.NEXT_PUBLIC_APP_URL)||!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'))throw Error();
 const context=JSON.parse(run(['context','inspect']))[0];if(!context.Endpoints.docker.Host.startsWith('unix://'))throw Error();
 const container=JSON.parse(run(['inspect','supabase_db_bloom-backend-local']))[0];if(!container.State.Running||!container.NetworkSettings.Ports['5432/tcp']?.some(port=>port.HostPort==='55442'))throw Error();
 const query="select json_build_object('health',public.bloom_push_health(),'nativeDevices',(select count(*) from private.push_devices d where to_jsonb(d)->>'transport'='native' and verified),'migrations',(select json_agg(version order by version) from supabase_migrations.schema_migrations where version>='202611070078'),'scheduler',json_build_object('cronCatalogPresent',to_regclass('cron.job') is not null,'installedExtensions',(select coalesce(json_agg(extname),'[]') from pg_extension where extname in ('pg_cron','pg_net'))));";
 const data=JSON.parse(run(['exec','-i','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],query));
 if(data.scheduler.cronCatalogPresent)data.scheduler.pushJobs=JSON.parse(run(['exec','-i','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],"select coalesce(json_agg(json_build_object('name',jobname,'schedule',schedule,'active',active)),'[]') from cron.job where jobname='bloom-push-delivery';"));
const result={localTargetVerified:true,registration:{automaticEnrollmentImplemented:true,transport:process.env.BLOOM_PUSH_TRANSPORT==='native'?'native':'onesignal',nativeConfigurationPresent:nativeNames.every(name=>!!process.env[name]),nativeRegisteredDevices:data.nativeDevices},configuration:{present:currentNames.filter(name=>!!process.env[name]),missing:currentNames.filter(name=>!process.env[name]),optionalLegacyMissing:['ONESIGNAL_APP_ID','ONESIGNAL_REST_API_KEY'].filter(name=>!process.env[name])},delivery:{configuredForTest:process.env.BLOOM_PUSH_MODE==='test'&&!!process.env.BLOOM_PUSH_TEST_SUBJECTS&&nativeNames.every(name=>!!process.env[name])&&!!process.env.BLOOM_PUSH_SCHEDULER_SECRET,...data.health},scheduler:data.scheduler,migrations:data.migrations,physicalReceiptVerified:false};
 console.log(JSON.stringify(result,null,2));
}catch{console.error('Readiness audit refused: use the existing development configuration and the verified local Docker database. No values were printed or changed.');process.exitCode=1;}
