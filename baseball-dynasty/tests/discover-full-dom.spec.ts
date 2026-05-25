import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test('get ALL testids after clicking team-history-tab', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="team-card-501"]').click();
  await page.waitForTimeout(2000);
  await page.locator('[data-testid="team-history-tab"]').click();
  await page.waitForTimeout(2000);

  const all = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid')).sort()
  );
  console.log('ALL testids (history tab):', JSON.stringify(all));
});

test('get ALL testids after clicking team-financials-tab', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="team-card-501"]').click();
  await page.waitForTimeout(2000);
  await page.locator('[data-testid="team-financials-tab"]').click();
  await page.waitForTimeout(2000);

  const all = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid')).sort()
  );
  console.log('ALL testids (financials tab):', JSON.stringify(all));
});
