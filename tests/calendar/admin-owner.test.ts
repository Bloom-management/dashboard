import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('admin Owner Hub projects safe data with actual identity and rejects regular roles',()=>{
 const result=spawnSync(process.execPath,['--experimental-test-module-mocks','--conditions=react-server','--import','tsx','tests/calendar/support/admin-owner.ts'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
