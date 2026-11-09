// put a weekly backup (monitor ?backup=1 -> bucket v2-backups/<day>/<table>.json) back into a database.
// rows are upserted table by table in foreign-key order, so running it twice is safe. no dependencies.
//   SUPABASE_URL=... SERVICE_ROLE_KEY=... node ops/restore-backup.mjs <folder with the day's json files>
// download a day first:  supabase storage cp -r ss:///v2-backups/<day> <folder> --remote=<ref> --experimental
// prod refuses unless PRIMEOS_ALLOW_PROD=1 (owner's ok first). prints rows restored per table and the time.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.env.SUPABASE_URL || '';
const KEY = process.env.SERVICE_ROLE_KEY || '';
const DIR = process.argv[2];
if (!URL_ || !KEY || !DIR) { console.error('usage: SUPABASE_URL=... SERVICE_ROLE_KEY=... node ops/restore-backup.mjs <folder>'); process.exit(2); }
if (URL_.includes('tgropjisnheppsxejfdn') && process.env.PRIMEOS_ALLOW_PROD !== '1') { console.error('refuse: prod needs PRIMEOS_ALLOW_PROD=1'); process.exit(2); }

// parents before children (same list as monitor TABLES, reordered)
// a migration already creates the owner's admin row (new id): admin rows are matched by e-mail so the backup's id wins
const CONFLICT = { admin_users: 'email' };
const ORDER = ['v2_plan_defs', 'organizations', 'admin_users', 'org_members', 'org_state', 'admin_state', 'api_tokens', 'content_items', 'v2_jobs', 'v2_outputs', 'v2_usage', 'v2_pub_profiles', 'v2_pub_posts', 'v2_pub_events', 'v2_wa_sessions', 'v2_wa_msgs', 'v2_brand_kits', 'v2_audit', 'v2_login_codes', 'v2_incidents'];



const t0 = Date.now();
let bad = 0;
for (const t of ORDER) {
  const f = join(DIR, `${t}.json`);
  if (!existsSync(f)) { console.log(`${t.padEnd(16)} no file`); continue; }
  const rows = JSON.parse(readFileSync(f, 'utf8'));
  let done = 0;
  // columns the database computes itself (generated) are in the backup but can't be written: dropped on first refusal
  const skip = new Set();
  for (let i = 0; i < rows.length; i += 500) {
    let r, msg = '';
    for (let tries = 0; tries < 10; tries++) {
      const part = rows.slice(i, i + 500).map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !skip.has(k))));
      r = await fetch(`${URL_}/rest/v1/${t}${CONFLICT[t] ? `?on_conflict=${CONFLICT[t]}` : ''}`, {
        method: 'POST',
        headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(part),
      });
      if (r.ok) break;
      msg = await r.text();
      const gen = /Column \\?"([a-z0-9_]+)\\?" is a generated column/.exec(msg);
      if (!gen) break;
      skip.add(gen[1]);
    }
    if (!r.ok) { console.log(`${t.padEnd(16)} FAILED at row ${i}: ${r.status} ${msg.slice(0, 200)}`); bad++; break; }
    done += Math.min(500, rows.length - i);
  }
  console.log(`${t.padEnd(16)} ${done}/${rows.length}${skip.size ? `  (computed, left to the db: ${[...skip].join(', ')})` : ''}`);
}
console.log(`time ${((Date.now() - t0) / 1000).toFixed(1)}s${bad ? `, ${bad} tables failed` : ''}`);
process.exit(bad ? 1 : 0);
