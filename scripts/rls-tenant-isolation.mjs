#!/usr/bin/env node
// Runs scripts/rls-tenant-isolation.sql — the cross-tenant leakage suite.
//
// Connection string, in order of preference:
//   1. DATABASE_URL / SUPABASE_DB_URL from the environment (what CI sets)
//   2. the linked project's pooler URL + DATABASE_PASSWORD from .env
//
// With no connection available it SKIPS rather than fails, so `npm run verify`
// still works offline. CI sets DATABASE_URL, so the suite is enforced there.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlFile = join(root, 'scripts', 'rls-tenant-isolation.sql');

const readEnvFile = (name) => {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => /^\s*[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
};

const resolveConnection = () => {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, password: undefined };
  if (process.env.SUPABASE_DB_URL) return { url: process.env.SUPABASE_DB_URL, password: undefined };

  const poolerFile = join(root, 'supabase', '.temp', 'pooler-url');
  const password = process.env.DATABASE_PASSWORD ?? readEnvFile('.env').DATABASE_PASSWORD;
  if (!existsSync(poolerFile) || !password) return null;
  return { url: readFileSync(poolerFile, 'utf8').trim(), password };
};

const connection = resolveConnection();
if (!connection) {
  console.log('\nRLS tenant isolation: SKIPPED (no DATABASE_URL and no linked project password)');
  process.exit(0);
}

console.log('\nRLS tenant isolation:');
try {
  const out = execFileSync('psql', [connection.url, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(connection.password ? { PGPASSWORD: connection.password } : {}) },
  });
  process.stdout.write(out);
} catch (error) {
  process.stdout.write(error.stdout ?? '');
  process.stderr.write(error.stderr ?? '');
  console.error('\nRLS tenant isolation FAILED');
  process.exit(1);
}
