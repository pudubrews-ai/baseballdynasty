import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3011';

test('discover testids on teams page', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const homeTestids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid')).sort()
  );
  console.log('HOME testids:', JSON.stringify(homeTestids));

  // Try nav-teams
  const navTeams = page.locator('[data-testid="nav-teams"]');
  if (await navTeams.count() > 0) {
    await navTeams.click();
    await page.waitForTimeout(2000);
    const teamsTestids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid]'))
        .map(el => ({id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0,30)}))
    );
    console.log('TEAMS PAGE testids:', JSON.stringify(teamsTestids));

    // Try clicking first team row
    const firstRow = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-testid]'));
      return els.map(el => el.getAttribute('data-testid')).filter(id => id?.includes('team') || id?.includes('standings') || id?.includes('row'));
    });
    console.log('TEAM/STANDINGS related testids:', JSON.stringify(firstRow));
  }
});
