import { test } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001';

test('dump testids in directive confirm modal', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  const watchTab = page.locator('[data-testid="watch-tab"]');
  await watchTab.click();
  await page.waitForTimeout(1500);

  // Click rebuild button
  const rebuildBtn = page.locator('[data-testid="directive-rebuild"]');
  const isDisabled = await rebuildBtn.isDisabled();
  console.log('rebuild disabled:', isDisabled);

  if (!isDisabled) {
    await rebuildBtn.click();
    await page.waitForTimeout(500);
  } else {
    // Try go-for-it
    const goForItBtn = page.locator('[data-testid="directive-go-for-it"]');
    await goForItBtn.click();
    await page.waitForTimeout(500);
  }

  const modalTestids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({ id: el.getAttribute('data-testid'), tag: el.tagName, text: el.textContent?.trim().slice(0, 80) }));
  });
  console.log('MODAL testids:', JSON.stringify(modalTestids, null, 2));

  // Also check for any buttons in the modal
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button'))
      .map(el => ({
        testid: el.getAttribute('data-testid'),
        text: el.textContent?.trim().slice(0, 50),
        disabled: el.disabled
      }));
  });
  console.log('ALL BUTTONS:', JSON.stringify(buttons, null, 2));
});
