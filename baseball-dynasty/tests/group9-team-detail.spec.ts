import { test, expect } from '@playwright/test';
const BASE_URL = 'http://localhost:5173';

test('click team card and inspect team detail page', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const navTeams = page.locator('[data-testid="nav-teams"]');
  await navTeams.click();
  await page.waitForTimeout(600);

  // Click first team card
  const teamCard = page.locator('[data-testid="team-card-1"]');
  if (await teamCard.count() > 0) {
    await teamCard.click();
    await page.waitForTimeout(800);

    console.log('Team detail URL:', page.url());

    const allIds = await page.evaluate(() => {
      const elements = document.querySelectorAll('[data-testid]');
      return Array.from(elements).map(el => el.getAttribute('data-testid'));
    });
    console.log('Team detail ALL testids:', JSON.stringify(allIds, null, 2));

    // Specifically check for minors-stats
    const minorsStats = page.locator('[data-testid^="minors-stats-"]');
    console.log(`minors-stats count: ${await minorsStats.count()}`);

    // Check for roster/minors tabs within team page
    const tabs = allIds.filter(id => id?.toLowerCase().includes('tab'));
    console.log('Tab testids on team page:', JSON.stringify(tabs));
  }
});

test('team card - navigate to minors subtab', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const navTeams = page.locator('[data-testid="nav-teams"]');
  await navTeams.click();
  await page.waitForTimeout(600);

  const teamCard = page.locator('[data-testid="team-card-1"]');
  if (await teamCard.count() > 0) {
    await teamCard.click();
    await page.waitForTimeout(800);

    // Look for minors-tab
    const minorsTab = page.locator('[data-testid="minors-tab"]');
    if (await minorsTab.count() > 0) {
      await minorsTab.click();
      await page.waitForTimeout(500);

      const minorsStats = page.locator('[data-testid^="minors-stats-"]');
      const mCount = await minorsStats.count();
      console.log(`PASS: minors-tab found on team page, minors-stats count: ${mCount}`);
      if (mCount > 0) {
        const firstId = await minorsStats.first().getAttribute('data-testid');
        console.log(`First minors-stats: ${firstId}`);
        const html = await minorsStats.first().innerHTML();
        console.log(`HTML: ${html.substring(0, 200)}`);
      }
    } else {
      console.log('minors-tab not found on team detail page');

      // Check what tabs exist
      const allIds = await page.evaluate(() => {
        const elements = document.querySelectorAll('[data-testid]');
        return Array.from(elements).map(el => el.getAttribute('data-testid'));
      });
      const tabIds = allIds.filter(id => id?.includes('tab'));
      console.log('Available tabs on team page:', JSON.stringify(tabIds));
    }
  }
});
