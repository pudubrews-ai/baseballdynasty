import { test, expect } from '@playwright/test';
const BASE_URL = 'http://localhost:5173';

test('find waivers and minors testids by navigating all nav sections', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Try all nav links
  const navIds = ['nav-league', 'nav-teams', 'nav-games', 'nav-draft', 'nav-players', 'nav-timeline'];

  for (const navId of navIds) {
    const nav = page.locator(`[data-testid="${navId}"]`);
    if (await nav.count() > 0) {
      await nav.click();
      await page.waitForTimeout(500);

      const allIds = await page.evaluate(() => {
        const elements = document.querySelectorAll('[data-testid]');
        return Array.from(elements).map(el => el.getAttribute('data-testid'));
      });

      const waiversRelated = allIds.filter(id => id?.toLowerCase().includes('waiver') || id?.toLowerCase().includes('minor'));
      if (waiversRelated.length > 0) {
        console.log(`On ${navId}: waivers/minors testids = ${JSON.stringify(waiversRelated)}`);
      }
    }
  }
});

test('check team page for waivers-list and minors testids', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Navigate to a team page
  const navTeams = page.locator('[data-testid="nav-teams"]');
  if (await navTeams.count() > 0) {
    await navTeams.click();
    await page.waitForTimeout(500);

    const teamLinks = page.locator('a[href*="/team/"], a[href*="team"]');
    const teamLinkCount = await teamLinks.count();
    console.log(`Team links found: ${teamLinkCount}`);

    if (teamLinkCount > 0) {
      await teamLinks.first().click();
      await page.waitForTimeout(500);

      const allIds = await page.evaluate(() => {
        const elements = document.querySelectorAll('[data-testid]');
        return Array.from(elements).map(el => el.getAttribute('data-testid'));
      });
      console.log('Team page testids:', JSON.stringify(allIds.slice(0, 50), null, 2));

      const waiversList = page.locator('[data-testid="waivers-list"]');
      const minorsStats = page.locator('[data-testid^="minors-stats-"]');
      console.log(`waivers-list: ${await waiversList.count()}`);
      console.log(`minors-stats-{id}: ${await minorsStats.count()}`);
    }
  }
});

test('check /api/news endpoint directly', async ({ page }) => {
  const response = await page.request.get('http://localhost:3001/api/news');
  const status = response.status();
  console.log(`GET /api/news status: ${status}`);

  if (status === 200) {
    const body = await response.json();
    console.log(`Total news events: ${Array.isArray(body) ? body.length : 'not array'}`);
    if (Array.isArray(body) && body.length > 0) {
      console.log('First item:', JSON.stringify(body[0], null, 2));
      console.log('Last item:', JSON.stringify(body[body.length - 1], null, 2));

      // Count by event_type
      const byType: Record<string, number> = {};
      for (const item of body) {
        byType[item.event_type] = (byType[item.event_type] || 0) + 1;
      }
      console.log('Events by type:', JSON.stringify(byType, null, 2));
    }
  }
});

test('check /api/waivers endpoint', async ({ page }) => {
  const response = await page.request.get('http://localhost:3001/api/waivers');
  const status = response.status();
  console.log(`GET /api/waivers status: ${status}`);
  if (status === 200) {
    const body = await response.json();
    console.log(`Waiver wire entries: ${Array.isArray(body) ? body.length : JSON.stringify(body)}`);
  }
});
