// Whole user journeys through the real screens (not shortcuts). Login: e-mail -> 6-digit code -> dashboard.
import { test, expect } from '@playwright/test';
import { qa, skipOnboarding, watchErrors } from '../helpers';

// a right code empties every live code of that address, so desktop and mobile each sign in as a different user
const userFor = (project: string) => (project === 'mobile' ? 'solo' : 'manager');

test('login by e-mailed code reaches the dashboard', async ({ page }, info) => {
  const errors = watchErrors(page);
  const { email, code } = await qa('code', { who: userFor(info.project.name) });
  await page.goto('/');
  await page.locator('#lEmail').fill(email);
  await page.locator('#lIn').click();
  await expect(page.locator('#lCode')).toBeVisible();
  await page.locator('#lCode').fill(code); // 6 digits submit by themselves
  await page.waitForFunction(() => (window as any).PrimeLive && (window as any).PrimeLive.ready === true, null, { timeout: 30_000 });
  await skipOnboarding(page);
  await expect(page.locator('#sidebar [data-nav]').first()).toBeAttached();
  expect(errors, 'page errors').toEqual([]);
});

test('a wrong code is refused with a message next to the field', async ({ page }) => {
  const { email } = await qa('code', { who: 'dept' });
  await page.goto('/');
  await page.locator('#lEmail').fill(email);
  await page.locator('#lIn').click();
  await page.locator('#lCode').fill('000000');
  await expect(page.locator('#lCodeErr')).toBeVisible();
  await expect(page.locator('#lCode')).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => !!(window as any).PrimeLive?.ready)).toBe(false);
});
