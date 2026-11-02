import { expect, type Page } from '@playwright/test';

// the staging copy of the backend (the qa helper answers only there)
export const QA_URL = process.env.E2E_QA_URL || 'https://lcbiktjrjcygxbteqaiu.supabase.co/functions/v1/qa';
export type Who = 'manager' | 'dept' | 'solo' | 'admin';

export async function qa(action: string, body: Record<string, unknown> = {}) {
  const r = await fetch(QA_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`qa ${action}: ${r.status} ${JSON.stringify(j)}`);
  return j as any;
}

// the same day and hour on every run: greetings and dates on the screens stay the same, so the pictures can be compared
export const FIXED_NOW = new Date('2026-11-04T10:00:00+02:00');

// errors the page throws while a test runs (a broken screen usually shows here first)
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|speed-insights|ERR_BLOCKED|net::ERR/i.test(m.text())) errors.push(m.text()); });
  return errors;
}

export async function login(page: Page, who: Who) {
  await page.clock.setFixedTime(FIXED_NOW);
  const { lc } = await qa('login', { who });
  await page.goto('/?lc=' + lc);
  await page.waitForFunction(() => (window as any).PrimeLive && (window as any).PrimeLive.ready === true, null, { timeout: 30_000 });
  await skipOnboarding(page);
}

// the first-run questionnaire of a new organisation (it opens a moment after the dashboard)
export async function skipOnboarding(page: Page) {
  const skip = page.locator('.dq-skipall');
  try { await skip.waitFor({ state: 'visible', timeout: 3000 }); } catch { return; }
  await skip.click();
  // the summary that follows the skip
  const enter = page.getByRole('button', { name: 'כניסה למערכת' });
  if (await enter.isVisible({ timeout: 2000 }).catch(() => false)) await enter.click();
  await page.waitForTimeout(400);
}

// the screens in the side menu for whoever is signed in
export async function navRoutes(page: Page): Promise<string[]> {
  return page.evaluate(() => [...new Set([...document.querySelectorAll('#sidebar [data-nav]')].map((e) => (e as HTMLElement).dataset.nav || ''))].filter(Boolean));
}

export async function goTo(page: Page, route: string) {
  await page.evaluate((r) => (window as any).go(r, { force: true }), route);
  // heavy screens show a skeleton for a moment
  await page.waitForFunction('typeof S === "undefined" || !S.loading', null, { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

// nothing may push the page sideways (RTL layouts at phone width)
export async function expectNoSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'horizontal overflow in px').toBeLessThanOrEqual(1);
}
