/** Snapshot current working files for review, including uncommitted changes, without secrets/provider links. */
import {cpSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd(),base=resolve(root,'.bloom-local/private/push-https/release');
if(process.argv.length!==2||!existsSync(resolve(root,'src/server/push/native.ts')))throw Error('Run from the Bloom dashboard checkout without arguments.');
const target=resolve(base,'dashboard-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(target,{recursive:true,mode:0o700});
for(const path of ['src','public','scripts','tests','supabase/migrations','supabase/push','supabase/tests','supabase/config.toml','supabase/local-migrations.py','supabase/seed.sql','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','.gitignore','.vercelignore','.env.example']){
 const source=resolve(root,path);if(existsSync(source))cpSync(source,resolve(target,path),{recursive:true});
}
writeFileSync(resolve(base,'latest-release.json'),JSON.stringify({directory:target,source:root,preparedAt:new Date().toISOString(),deployed:false})+'\n',{mode:0o600});
console.log('Prepared source snapshot: '+target);
console.log('No populated environment files, local database state, provider links, hosted operations or sends.');
