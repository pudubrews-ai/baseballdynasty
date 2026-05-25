import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3011';

test('discover history tab testids with filter', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="team-card-501"]').click();
  await page.waitForTimeout(2000);

  await page.locator('[data-testid="team-history-tab"]').click();
  await page.waitForTimeout(2000);

  const historyTestids = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid') as string);
    // Filter for history/franchise related
    return all.filter(id => id.includes('franchise') || id.includes('history') || id.includes('season') || id.includes('championship') || id.includes('stat') || id.includes('manager') || id.includes('owner'));
  });
  console.log('HISTORY related testids:', JSON.stringify(historyTestids));

  // Also get full inner HTML of team-detail-panel to see what's there
  const detailHTML = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="team-detail-panel"]');
    return panel ? panel.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) : 'NOT FOUND';
  });
  console.log('DETAIL PANEL TEXT (history tab):', detailHTML);
});

test('discover financials tab testids with filter', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="team-card-501"]').click();
  await page.waitForTimeout(2000);

  await page.locator('[data-testid="team-financials-tab"]').click();
  await page.waitForTimeout(2000);

  const financialsTestids = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid') as string);
    return all.filter(id => id.includes('financial') || id.includes('revenue') || id.includes('attendance') || id.includes('payroll') || id.includes('luxury') || id.includes('franchise') || id.includes('chart') || id.includes('value'));
  });
  console.log('FINANCIALS related testids:', JSON.stringify(financialsTestids));

  const detailHTML = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="team-detail-panel"]');
    return panel ? panel.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) : 'NOT FOUND';
  });
  console.log('DETAIL PANEL TEXT (financials tab):', detailHTML);
});
