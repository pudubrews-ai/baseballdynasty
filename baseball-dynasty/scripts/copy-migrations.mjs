#!/usr/bin/env node
// Copy server/migrations/*.sql to dist/server/migrations/ after tsc build.
// C-4 fix: tsc does not copy .sql files; this script does.

import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const src = join(projectRoot, 'server', 'migrations');
const dst = join(projectRoot, 'dist', 'server', 'migrations');

mkdirSync(dst, { recursive: true });

const files = readdirSync(src).filter(f => f.endsWith('.sql'));
if (files.length === 0) {
  console.error('[copy-migrations] ERROR: No .sql files found in', src);
  process.exit(1);
}

for (const file of files) {
  copyFileSync(join(src, file), join(dst, file));
  console.log(`[copy-migrations] Copied ${file}`);
}

console.log(`[copy-migrations] Done: ${files.length} migrations copied to ${dst}`);
