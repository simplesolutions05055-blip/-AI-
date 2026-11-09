// Content made by the real AI on staging: graphic and PDF document, start to finished file.
// Costs API credit, so it runs only nightly / on demand (E2E_AI=1), desktop only.
import { test, expect, type Page } from '@playwright/test';
import { login, qa } from '../helpers';

test.skip(process.env.E2E_AI !== '1', 'AI flows run nightly or on demand (E2E_AI=1)');
test.describe.configure({ mode: 'serial' });

// the server's job for this run, until it is done or failed (the screen only mirrors it)
async function waitJob(kind: string, since: string, ms = 5 * 60_000) {
  const end = Date.now() + ms;
  let last: any = null;
  while (Date.now() < end) {
    const { jobs } = await qa('jobs', { who: 'manager', since });
    last = (jobs as any[]).find((j) => j.kind === kind) ?? last;
    if (last && (last.state === 'done' || last.state === 'error')) return last;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${kind} job not finished in ${ms / 1000}s, last: ${JSON.stringify(last)}`);
}

async function expectFile(page: Page, url: string, type: RegExp) {
  const r = await page.request.get(url);
  expect(r.status(), url).toBe(200);
  expect(r.headers()['content-type'] || '').toMatch(type);
}

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'one device is enough, halves the AI spend'); });

test('graphic: brief to finished image', async ({ page }) => {
  test.setTimeout(7 * 60_000);
  await login(page, 'manager');
  const since = new Date(Date.now() - 5000).toISOString();
  await page.evaluate(() => (window as any).startWiz('graphic'));
  await page.locator('#wTitle').fill('בדיקה: יום ניקיון בפארק');
  await page.locator('#wFree').fill('יום ניקיון קהילתי בפארק העירוני ביום שישי ב-9:00. מביאים כפפות, העירייה מספקת שקיות ומים.');
  const plat = page.locator('.plat:not(.is-disabled)').first();
  if (await plat.count()) await plat.click();
  await page.locator('[data-act="wizNext"]').click();
  const job = await waitJob('graphic', since);
  expect(job.state, job.error || '').toBe('done');
  await expectFile(page, job.result.url, /^image\//);
});

test('document: request to finished PDF', async ({ page }) => {
  test.setTimeout(7 * 60_000);
  await login(page, 'manager');
  const since = new Date(Date.now() - 5000).toISOString();
  await page.evaluate(() => (window as any).startDoc());
  await page.locator('[data-act="dwSty:formal"]').click();
  await page.locator('#dwT').fill('בדיקה: עבודות תשתית ברחוב הרצל');
  await page.locator('#dwP').fill('הודעה קצרה לתושבים: עבודות ביוב ברחוב הרצל בין 10/11 ל-20/11, חסימה חלקית, הסדרי חניה חלופיים במגרש העירוני.');
  await page.locator('[data-act="dwGen"]').click();
  const job = await waitJob('doc', since);
  expect(job.state, job.error || '').toBe('done');
  await expectFile(page, job.result.url, /pdf/);
});
