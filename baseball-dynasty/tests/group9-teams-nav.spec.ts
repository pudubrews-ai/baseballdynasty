import { test, expect } from '@playwright/test';
const BASE_URL = 'http://localhost:5173';

test('inspect nav-teams section fully', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const navTeams = page.locator('[data-testid="nav-teams"]');
  await navTeams.click();
  await page.waitForTimeout(800);

  // Get full page URL
  console.log('Current URL:', page.url());

  // Get ALL testids
  const allIds = await page.evaluate(() => {
    const elements = document.querySelectorAll('[data-testid]');
    return Array.from(elements).map(el => el.getAttribute('data-testid'));
  });
  console.log('All testids on teams page:', JSON.stringify(allIds, null, 2));

  // Check waivers-list
  const waiversList = page.locator('[data-testid="waivers-list"]');
  const wCount = await waiversList.count();
  console.log(`waivers-list count: ${wCount}`);
  if (wCount > 0) {
    const isVisible = await waiversList.first().isVisible();
    const html = await waiversList.first().innerHTML();
    console.log(`waivers-list visible: ${isVisible}`);
    console.log(`waivers-list HTML: ${html.substring(0, 300)}`);
  }

  // Check minors-stats
  const minorsStats = page.locator('[data-testid^="minors-stats-"]');
  const mCount = await minorsStats.count();
  console.log(`minors-stats-{id} count: ${mCount}`);
  if (mCount > 0) {
    const firstId = await minorsStats.first().getAttribute('data-testid');
    console.log(`First minors-stats id: ${firstId}`);
  }
});

test('check specific team page by clicking team link', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const navTeams = page.locator('[data-testid="nav-teams"]');
  await navTeams.click();
  await page.waitForTimeout(600);

  // Find team row or link
  const teamRows = page.locator('[data-testid^="team-row-"]');
  const teamRowCount = await teamRows.count();
  console.log(`team-row-{id} count: ${teamRowCount}`);

  if (teamRowCount > 0) {
    const firstRowId = await teamRows.first().getAttribute('data-testid');
    console.log(`First team row: ${firstRowId}`);
    await teamRows.first().click();
    await page.waitForTimeout(600);

    console.log('After click URL:', page.url());

    const allIds = await page.evaluate(() => {
      const elements = document.querySelectorAll('[data-testid]');
      return Array.from(elements).map(el => el.getAttribute('data-testid'));
    });
    console.log('After team click testids:', JSON.stringify(allIds, null, 2));

    // Check minors-stats
    const minorsStats = page.locator('[data-testid^="minors-stats-"]');
    const mCount = await minorsStats.count();
    console.log(`minors-stats count after click: ${mCount}`);
  } else {
    // Try standings rows as team links
    const standingsRows = page.locator('[data-testid^="standings-row-"]');
    const sCount = await standingsRows.count();
    console.log(`standings-row count: ${sCount}`);
    if (sCount > 0) {
      await standingsRows.first().click();
      await page.waitForTimeout(600);

      console.log('After standings click URL:', page.url());
      const allIds = await page.evaluate(() => {
        const elements = document.querySelectorAll('[data-testid]');
        return Array.from(elements).map(el => el.getAttribute('data-testid'));
      });
      console.log('Team detail testids:', JSON.stringify(allIds, null, 2));
    }
  }
});
