import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3011';

test('discover testids in team detail panel', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  
  // Navigate to teams
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(1500);

  // Click team card 501
  const teamCard = page.locator('[data-testid="team-card-501"]');
  await teamCard.click();
  await page.waitForTimeout(2000);

  const allTestids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({id: el.getAttribute('data-testid'), visible: (el as HTMLElement).offsetParent !== null, text: el.textContent?.trim().slice(0,40)}))
  );
  console.log('AFTER TEAM CLICK testids:', JSON.stringify(allTestids, null, 2));
});
