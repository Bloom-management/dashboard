#!/usr/bin/env python3
"""Apply reviewed migrations only to this profile's running LOCAL Docker database.
Never accepts a URL/project ref/file argument; never executes tests/platform.sql.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tomllib

ROOT=Path(__file__).resolve().parent.parent
CONFIG=tomllib.loads((ROOT/'supabase/config.toml').read_text())
PROJECT='bloom-backend-local'
PORT=55442

def run(args):
    return subprocess.run(args,cwd=ROOT,text=True,capture_output=True,check=True,env=ENV).stdout

# A remote Docker context or environment override must not redirect the local profile.
ENV={k:v for k,v in os.environ.items() if not (k.startswith('PG') or k.startswith('SUPABASE_') or k.startswith('DOCKER_'))}
try:
    if len(sys.argv)!=2 or sys.argv[1] not in ('start','check','apply'):raise ValueError('Use start, check or apply only.')
    if CONFIG['project_id']!=PROJECT or CONFIG['db']['port']!=PORT:raise ValueError('Unexpected local profile.')
    if CONFIG.get('db',{}).get('seed',{}).get('enabled') is not False:raise ValueError('Local seed must remain disabled.')
    context=json.loads(run(['docker','context','inspect']))[0]
    if not context['Endpoints']['docker']['Host'].startswith('unix://'):raise ValueError('A local Unix-socket Docker context is required.')
    if sys.argv[1]=='start':
        command=['npx','--yes','supabase@2.117.0','start','--workdir',str(ROOT)]
    else:
        container=json.loads(run(['docker','inspect','supabase_db_'+PROJECT]))[0]
        bindings=container['NetworkSettings']['Ports'].get('5432/tcp') or []
        if not container['State']['Running'] or not any(b['HostPort']==str(PORT) for b in bindings):raise ValueError('Expected local Supabase database is not running.')
        # Local --workdir and --local are fixed. No hosted URL/ref/password is read or accepted.
        command=['npx','--yes','supabase@2.117.0','migration','list' if sys.argv[1]=='check' else 'up','--local','--workdir',str(ROOT)]
    result=subprocess.run(command,cwd=ROOT,env=ENV,text=True,capture_output=True)
    if result.returncode:raise ValueError('Local migration command failed; inspect the local service configuration.')
    print({'start':'Local Supabase started.','check':'Local migration check passed.','apply':'Reviewed local migrations applied.'}[sys.argv[1]])
except (ValueError,KeyError,subprocess.CalledProcessError,json.JSONDecodeError,OSError) as error:
    # Do not print command output or inherited service configuration.
    print(str(error) if isinstance(error,ValueError) else 'Local database guard failed.',file=sys.stderr)
    sys.exit(1)
