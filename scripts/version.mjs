// dist/version.json: which commit this deployment is (the browser tests wait for it before they run)
import { writeFileSync, existsSync } from 'node:fs';
if (existsSync('dist')) writeFileSync('dist/version.json', JSON.stringify({ sha: process.env.VERCEL_GIT_COMMIT_SHA || 'local', at: new Date().toISOString() }));
