// before every run: the test organisations go back to their saved starting state (same screens, same pictures)
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { request } from '@playwright/test';
import { qa } from './helpers';
import { BASE, BYPASS_STATE } from './playwright.config';

export default async function () {
  // staging sits behind the vercel login: one request with the bypass key, the cookie it sets goes to every test
  const key = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (key) {
    const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-vercel-protection-bypass': key, 'x-vercel-set-bypass-cookie': 'true' } });
    const r = await ctx.get('/version.json');
    if (!r.ok()) throw new Error(`staging bypass failed: ${r.status()}`);
    mkdirSync(dirname(BYPASS_STATE), { recursive: true });
    await ctx.storageState({ path: BYPASS_STATE });
    await ctx.dispose();
  }
  await qa('reset');
}
