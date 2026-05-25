import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001';

test('dump all testids on Watch tab', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Get all testids on home page first
  const homeTestids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid'))
      .sort();
  });
  console.log('HOME PAGE testids:', JSON.stringify(homeTestids, null, 2));

  // Navigate to watch tab
  const watchTab = page.locator('[data-testid="watch-tab"]');
  if (await watchTab.count() > 0) {
    await watchTab.click();
    await page.waitForTimeout(2000);
  }

  const watchTestids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({ id: el.getAttribute('data-testid'), tag: el.tagName, text: el.textContent?.trim().slice(0, 50) }));
  });
  console.log('WATCH TAB testids:', JSON.stringify(watchTestids, null, 2));
});
