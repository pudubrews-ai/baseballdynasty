import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3011';

test('discover testids in history and financials tabs', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  
  // Navigate to teams
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(1500);

  // Click team card 501
  await page.locator('[data-testid="team-card-501"]').click();
  await page.waitForTimeout(2000);

  // --- History Tab ---
  await page.locator('[data-testid="team-history-tab"]').click();
  await page.waitForTimeout(2000);

  const historyTestids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0,60)}))
  );
  console.log('HISTORY TAB testids:', JSON.stringify(historyTestids, null, 2));

  // --- Financials Tab ---
  await page.locator('[data-testid="team-financials-tab"]').click();
  await page.waitForTimeout(2000);

  const financialsTestids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0,60)}))
  );
  console.log('FINANCIALS TAB testids:', JSON.stringify(financialsTestids, null, 2));
});
