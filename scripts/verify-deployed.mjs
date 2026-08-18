#!/usr/bin/env node
// Answers the only question that matters after a security commit:
// IS THE CODE THAT PROTECTS THINGS ACTUALLY RUNNING?
//
// A whole session's worth of hardening once shipped with everything committed,
// the migration applied and the secrets set — and nothing protected anything,
// because the functions were never redeployed. Green CI does not mean deployed.
//
//   node scripts/verify-deployed.mjs
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';

const localFunctions = readdirSync('supabase/functions')
  .filter((d) => !d.startsWith('_') && statSync(`supabase/functions/${d}`).isDirectory());

let listing;
try {
  listing = execSync('npx supabase functions list', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  console.error('Could not reach Supabase. Run `npx supabase login` and `npx supabase link` first.');
  console.error(String(e.stderr || e.message).trim().split('\n')[0]);
  process.exit(2);
}

const deployed = new Set(
  listing.split('\n').map((l) => l.trim().split(/\s*\|\s*/).find((c) => localFunctions.includes(c))).filter(Boolean),
);

const missing = localFunctions.filter((f) => !deployed.has(f));

console.log(`\n${deployed.size}/${localFunctions.length} functions deployed`);
if (missing.length) {
  console.log('\nNOT DEPLOYED — these exist in git and are doing nothing in production:');
  for (const f of missing) console.log(`  - ${f}`);
  console.log('\n  npx supabase functions deploy ' + missing.join(' '));
}

// Shared modules are bundled INTO each function, so a change to _shared/cors.ts
// or _shared/secrets.ts is live only in functions redeployed after that change.
console.log('\nEvery function bundles _shared/*. After changing a shared module,');
console.log('redeploy ALL of them or the old copy keeps running:');
console.log('  npx supabase functions deploy ' + localFunctions.join(' '));
console.log('\nThen compare the deploy timestamps above against your commit dates.\n');

process.exit(missing.length ? 1 : 0);
