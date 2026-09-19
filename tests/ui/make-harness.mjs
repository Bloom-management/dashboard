/** Local isolated renderer for a docs-only worktree. Never copies credentials or changes root setup. */
import { mkdtemp, cp, mkdir, readFile, writeFile, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = process.cwd();
const modules = resolve(process.env.BLOOM_UI_TOOLCHAIN ?? join(root, 'node_modules'));
await access(join(modules, 'next/dist/bin/next'));
const destination = await mkdtemp(join(tmpdir(), 'bloom-ui-check-'));
await cp(join(root, 'src'), join(destination, 'src'), { recursive: true });
await cp(join(root, 'public'), join(destination, 'public'), { recursive: true });
await symlink(modules, join(destination, 'node_modules'), 'dir');
await writeFile(join(destination, 'package.json'), JSON.stringify({ name: 'bloom-ui-isolated-harness', private: true }));
await writeFile(join(destination, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['dom', 'dom.iterable', 'es2022'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'preserve', strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true, plugins: [{ name: 'next' }] }, include: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', '.next/types/**/*.ts'] }));
await writeFile(join(destination, 'src/app/layout.tsx'), 'import type { ReactNode } from "react"; export default function Layout({children}: {children: ReactNode}) { return <html lang="en"><body>{children}</body></html>; }');
if (process.argv.includes('--synthetic')) {
  await mkdir(join(destination, 'tests/ui'), { recursive: true });
  await cp(join(root, 'tests/ui/synthetic-integration.ts'), join(destination, 'tests/ui/synthetic-integration.ts'));
  const page = join(destination, 'src/app/(cleaner)/cleaner/page.tsx');
  const source = await readFile(page, 'utf8');
  await writeFile(page, `'use client';\nimport { syntheticIntegration } from '../../../../tests/ui/synthetic-integration';\n${source.replace('<CleanerHub />', '<CleanerHub integration={syntheticIntegration} />')}`);
}
console.log(destination);
