"""Guard tests use fake executables; they never start Docker or contact Supabase."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'local-migrations.py'
class LocalGuardTests(unittest.TestCase):
    def invoke(self,mode,remote=False):
        with tempfile.TemporaryDirectory(prefix='bloom-guard-test-') as directory:
            root=Path(directory);record=root/'called.json'
            docker=root/'docker'
            docker.write_text('#!'+sys.executable+'\nimport json,sys\n' +
                "print(json.dumps([{'Endpoints':{'docker':{'Host':"+repr('ssh://remote.example' if remote else 'unix:///tmp/synthetic-docker.sock')+"}}}]) if sys.argv[1]=='context' else json.dumps([{'State':{'Running':True},'NetworkSettings':{'Ports':{'5432/tcp':[{'HostPort':'55442'}]}}}]))\n")
            docker.chmod(0o755)
            npx=root/'npx'
            npx.write_text('#!'+sys.executable+'\nimport json,sys,os\nfrom pathlib import Path\n'+
                'Path('+repr(str(record))+').write_text(json.dumps({"args":sys.argv[1:],"remoteVariables":any(k.startswith(("PG","SUPABASE_","DOCKER_")) for k in os.environ)}))\n')
            npx.chmod(0o755)
            env={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH'],'PGHOST':'remote.example','SUPABASE_ACCESS_TOKEN':'synthetic-never-used','DOCKER_HOST':'ssh://remote.example'}
            result=subprocess.run([sys.executable,str(SCRIPT),mode],env=env,capture_output=True,text=True)
            called=json.loads(record.read_text()) if record.exists() else None
            return result,called
    def test_local_apply_is_fixed_and_scrubs_remote_overrides(self):
        result,called=self.invoke('apply');self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse(called['remoteVariables']);self.assertIn('--local',called['args'])
        self.assertEqual(called['args'][:5],['--yes','supabase@2.117.0','migration','up','--local'])
        self.assertNotIn('platform.sql',' '.join(called['args']))
    def test_remote_docker_context_is_rejected(self):
        result,called=self.invoke('apply',remote=True);self.assertNotEqual(result.returncode,0);self.assertIsNone(called)
    def test_arbitrary_commands_and_urls_are_rejected(self):
        for mode in ['push','reset','https://remote.example','tests/platform.sql']:
            result,called=self.invoke(mode);self.assertNotEqual(result.returncode,0);self.assertIsNone(called)
    def test_start_uses_fixed_local_profile(self):
        result,called=self.invoke('start');self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(called['args'][:4],['--yes','supabase@2.117.0','start','--workdir'])

if __name__=='__main__':unittest.main(verbosity=2)
