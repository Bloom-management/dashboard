import { readFileSync } from 'node:fs';
const subject = readFileSync(process.argv[2], 'utf8').split(/\r?\n/, 1)[0];
const valid = /^(feat|fix|doc|docs|refactor|perf|test|build|ci|chore|style|revert|deps|security)\([a-z0-9][a-z0-9._/-]*\): ?\S.*$/.test(subject);
if (!valid) {
  console.error('Commit rejected. Use type(scope):description, e.g. fix(auth):handle missing account setup');
  process.exitCode = 1;
}
