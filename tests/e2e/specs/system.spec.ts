// The console's System screen: every tab opens with its sections, fits a phone, no page errors.
// Its numbers change every run, so instead of comparing pictures each tab's picture is attached to the report.
import { test, expect } from '@playwright/test';
import { login, navRoutes, goTo, watchErrors, expectNoSideScroll } from '../helpers';

const TABS: [string, string[]][] = [
  ['overview', ['בדיקות המוניטור', 'גרסה']],
  ['jobs', ['לפי סוג', 'עבודות תקועות', 'כישלונות אחרונים']],
  ['wa', ['הודעות לפי יום, 7 ימים', 'לפי לקוח']],
  ['costs', ['עלות לפי יום', 'לפי לקוח']],
  ['deploys', ['עדכוני גרסה אחרונים']],
];

test('admin: System screen, every tab', async ({ page }, info) => {
  const errors = watchErrors(page);
  await login(page, 'admin');
  expect(await navRoutes(page)).toContain('a_system');
  await goTo(page, 'a_system');
  for (const [tab, sections] of TABS) {
    await test.step(tab, async () => {
      await page.locator(`[data-act="sysTab:${tab}"]`).click();
      await expect(page.locator(`#sysBody[data-tab="${tab}"] .card-head h3`).first()).toBeVisible({ timeout: 20_000 });
      for (const h of sections) await expect(page.locator('#sysBody .card-head h3', { hasText: h }).first()).toBeVisible();
      await expectNoSideScroll(page);
      await info.attach(`system-${tab}-${info.project.name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
  expect(errors, 'page errors').toEqual([]);
});

test('client users never see the System screen', async ({ page }) => {
  await login(page, 'manager');
  expect(await navRoutes(page)).not.toContain('a_system');
});
