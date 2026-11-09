// PrimeOS browser tests. They run against the STAGING site (separate backend, made-up accounts),
// never against app.primeos.co.il. See claude/staging-environment.md.
import { defineConfig, devices } from '@playwright/test';

export const BASE = process.env.E2E_BASE_URL || 'https://primeos-staging.vercel.app';
if (/app\.primeos\.co\.il/.test(BASE)) throw new Error('the browser tests never run against the live site');
// staging is a preview (vercel login wall). setup.ts trades the bypass key for a cookie (staging site only, not supabase)
export const BYPASS_STATE = 'results/bypass-state.json';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './specs',
  globalSetup: './setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  fullyParallel: true,
  workers: 4,
  retries: 1,
  // a missing reference picture is created (and reported) instead of failing; a changed one fails
  updateSnapshots: process.env.E2E_UPDATE === '1' ? 'all' : 'missing',
  snapshotPathTemplate: '{testDir}/__screens__/{projectName}/{arg}{ext}',
  reporter: [['list'], ['json', { outputFile: 'results/results.json' }], ['./report.ts']],
  outputDir: 'results/artifacts',
  use: {
    baseURL: BASE,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: BYPASS ? BYPASS_STATE : undefined,
  },
  projects: [
    { name: 'desktop', testIgnore: /ai-flows/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', testIgnore: /ai-flows/, use: { ...devices['Pixel 7'], viewport: { width: 400, height: 860 } } },
    // AI flows add content to the manager's library: they run only after every screen picture is taken, desktop only
    { name: 'ai', testMatch: /ai-flows/, dependencies: ['desktop', 'mobile'], use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
