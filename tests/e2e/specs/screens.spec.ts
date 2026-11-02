// Every screen of every kind of user opens without errors, fits a phone, and looks exactly like its approved picture.
import { test, expect } from '@playwright/test';
import { login, navRoutes, goTo, watchErrors, expectNoSideScroll, type Who } from '../helpers';

const USERS: Who[] = ['manager', 'dept', 'solo'];

for (const who of USERS) {
  test(`${who}: all screens`, async ({ page }) => {
    const errors = watchErrors(page);
    await login(page, who);
    const routes = await navRoutes(page);
    expect(routes.length, 'side menu has screens').toBeGreaterThan(2);
    for (const r of routes) {
      await test.step(r, async () => {
        await goTo(page, r);
        await expect(page.locator('#view')).toBeVisible();
        await expectNoSideScroll(page);
        await expect(page).toHaveScreenshot(`${who}-${r}.png`);
      });
    }
    expect(errors, 'page errors').toEqual([]);
  });
}

test('admin: all console screens', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'admin');
  const routes = await navRoutes(page);
  expect(routes.length, 'admin menu has screens').toBeGreaterThan(2);
  for (const r of routes) {
    await test.step(r, async () => {
      await goTo(page, r);
      await expectNoSideScroll(page);
      await expect(page).toHaveScreenshot(`admin-${r}.png`);
    });
  }
  expect(errors, 'page errors').toEqual([]);
});
