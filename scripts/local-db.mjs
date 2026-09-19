import { spawnSync } from 'node:child_process';
const result=spawnSync('python3',['supabase/local-migrations.py',...process.argv.slice(2)],{stdio:'inherit',env:process.env});
process.exitCode=result.status??1;
