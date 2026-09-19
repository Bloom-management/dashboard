import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const validator = join(dirname(common), 'scripts/validate-commit-message.mjs');
if (!existsSync(validator)) throw new Error('Install from a clone whose main checkout contains the tracked validator.');
let custom = '';
try { custom = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { /* default hooks directory */ }
if (custom) throw new Error('A custom hooksPath is configured. Integrate the validator into that hook without overwriting it.');
const target = join(common, 'hooks/commit-msg');
const body = `#!/bin/sh
# Bloom shared commit-message convention
BLOOM_COMMON_GIT_DIR="$(git rev-parse --path-format=absolute --git-common-dir)" || exit 1
exec node "$BLOOM_COMMON_GIT_DIR/../scripts/validate-commit-message.mjs" "$1"
`;
if (existsSync(target) && readFileSync(target, 'utf8') !== body) throw new Error('Existing commit-msg hook preserved. Integrate it manually.');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, body, { mode: 0o755 });
console.log('Installed commit format validation in the shared Git hooks directory.');
// Verify the actual resolved hook location for every existing worktree.
const entries = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
for (const line of entries.split('\n').filter(line => line.startsWith('worktree '))) {
  const cwd = line.slice('worktree '.length);
  const hook = execFileSync('git', ['rev-parse', '--git-path', 'hooks/commit-msg'], { cwd, encoding: 'utf8' }).trim();
  if (resolve(cwd, hook) !== target) throw new Error('A worktree uses a different hook location; inspect its Git configuration.');
}
console.log('Verified hook resolution across all existing worktrees.');
