import { test } from '@playwright/test';

const BASE = 'http://localhost:5173';

test('dump testids on Team History tab', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Navigate to Teams tab
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(1000);

  // Click team card 101
  await page.locator('[data-testid="team-card-101"]').click();
  await page.waitForTimeout(1000);

  // Click History tab
  const historyTab = page.locator('[data-testid="team-history-tab"]');
  if (await historyTab.count() > 0) {
    await historyTab.click();
    await page.waitForTimeout(1500);
  }

  const testids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({ id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0, 100) }));
  });
  console.log('HISTORY TAB testids:', JSON.stringify(testids, null, 2));
});
