// What each kind of user may see: a department user never gets the organisation's management screens.
import { test, expect } from '@playwright/test';
import { login, navRoutes } from '../helpers';

test('department user has no team/settings management', async ({ page }) => {
  await login(page, 'dept');
  const routes = await navRoutes(page);
  expect(routes).not.toContain('team');
});

test('the staging site talks only to the staging backend', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch { /* data: urls */ } });
  await login(page, 'manager');
  await page.waitForTimeout(1500);
  expect([...hosts].some((h) => h.includes('tgropjisnheppsxejfdn')), 'no request to the live backend').toBe(false);
});

test('the site sends its security headers', async ({ page }) => {
  const r = await page.request.get('/');
  const h = r.headers();
  expect(h['strict-transport-security']).toContain('max-age=');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  // report-only first: violations show in the console (and fail the screen tests) before anything is enforced
  expect(h['content-security-policy-report-only']).toContain("frame-ancestors 'none'");
});
