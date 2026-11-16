// The console's System screen: every tab opens with its sections, fits a phone, no page errors.
// Its numbers change every run, so instead of comparing pictures each tab's picture is attached to the report.
import { test, expect } from '@playwright/test';
import { login, navRoutes, goTo, watchErrors, expectNoSideScroll, qa, adminCall } from '../helpers';

const TABS: [string, string[]][] = [
  ['live', ['יומן חי']],
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

test('admin: the live log shows a new event without a reload, and a production timeline opens', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'admin');
  await goTo(page, 'a_system');
  await page.locator('[data-act="sysTab:live"]').click();
  await expect(page.locator('#lvState.lv-s-live')).toBeVisible({ timeout: 20_000 });
  // a new incident lands in the list by itself (the stream), with its technical detail behind a click
  const { id } = await qa('incident');
  try {
    await expect.poll(async () => {
      // every closed incident row is opened (a click takes the row out of this list, so always the first)
      // rows that came while the list was scrolled wait behind the 'new events' button
      const fresh = page.locator('#lvNew:not([hidden])');
      if (await fresh.count()) await fresh.click();
      const shut = page.locator('#lvFeed .lv-row[data-kind="incident.open"]:not(.open) .lv-main');
      for (let k = await shut.count(); k > 0; k--) await shut.first().click();
      return page.locator('#lvFeed .lv-det', { hasText: new RegExp('incident' + id + '(?!\\d)') }).count();
    }, { timeout: 25_000 }).toBeGreaterThan(0);
    // errors only: the list reloads through the filter and stays connected
    await page.locator('#lvLevel').selectOption('error');
    await expect(page.locator('#lvState.lv-s-live')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#lvFeed .lv-row.lv-ok')).toHaveCount(0);
    await expectNoSideScroll(page);
  } finally {
    await adminCall(page, 'admin.incident.set', { id, op: 'resolve', note: 'e2e' }).catch(() => {});
  }
  // one production, step by step: the newest one in the log (events outlive a production that the tests cleaned up)
  const { events } = await adminCall(page, 'admin.events.load', { src: 'job', limit: 50 });
  const job = events.find((e: any) => e.job_id)?.job_id;
  if (job) {
    // through the page's own click handling, like the timeline button of a row
    await page.evaluate((j) => { const b = document.createElement('button'); b.dataset.act = 'sysJob:' + j; document.body.appendChild(b); b.click(); b.remove(); }, job);
    await expect(page.locator('#lvJob .lv-kv')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#lvJob .tl-i').first()).toBeVisible();
  }
  await expectNoSideScroll(page);
  expect(errors, 'page errors').toEqual([]);
});

test('client users never see the System screen', async ({ page }) => {
  await login(page, 'manager');
  expect(await navRoutes(page)).not.toContain('a_system');
});
