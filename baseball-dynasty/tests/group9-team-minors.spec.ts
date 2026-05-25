import { test, expect } from '@playwright/test';
const BASE_URL = 'http://localhost:5173';

test('check team-minors-tab and minors-stats testids', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const navTeams = page.locator('[data-testid="nav-teams"]');
  await navTeams.click();
  await page.waitForTimeout(600);

  const teamCard = page.locator('[data-testid="team-card-1"]');
  await teamCard.click();
  await page.waitForTimeout(800);

  // Click the team-minors-tab
  const minorsTab = page.locator('[data-testid="team-minors-tab"]');
  const minorsTabCount = await minorsTab.count();
  console.log(`team-minors-tab count: ${minorsTabCount}`);

  if (minorsTabCount > 0) {
    await minorsTab.click();
    await page.waitForTimeout(600);

    const allIds = await page.evaluate(() => {
      const elements = document.querySelectorAll('[data-testid]');
      return Array.from(elements).map(el => el.getAttribute('data-testid'));
    });
    console.log('After team-minors-tab click, all testids:', JSON.stringify(allIds, null, 2));

    const minorsStats = page.locator('[data-testid^="minors-stats-"]');
    const mCount = await minorsStats.count();
    console.log(`minors-stats-{playerId} count: ${mCount}`);

    if (mCount > 0) {
      const firstId = await minorsStats.first().getAttribute('data-testid');
      const firstHtml = await minorsStats.first().innerHTML();
      console.log(`First minors-stats id: ${firstId}`);
      console.log(`First minors-stats HTML: ${firstHtml.substring(0, 300)}`);
    } else {
      // Check what's rendered in the panel
      const panelHtml = await page.locator('[data-testid="team-detail-panel"]').innerHTML();
      console.log(`team-detail-panel HTML (truncated): ${panelHtml.substring(0, 1000)}`);
    }
  }
});
