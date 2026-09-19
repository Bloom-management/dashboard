import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('calendar outage is isolated from real account/admin authorization/property read paths and routes', () => {
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--conditions=react-server', '--import', 'tsx', 'tests/calendar/support/recovery-boundary.ts'], {
    encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_ENV: 'test' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS actual account/);
});
