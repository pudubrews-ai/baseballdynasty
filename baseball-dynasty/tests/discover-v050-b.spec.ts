/**
 * Discovery spec for v0.5.0 Worker B groups
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test('discover franchise tab content', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Dump top-level nav testids
  const navIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid'))
      .filter(id => id && (id.includes('franchise') || id.includes('nav') || id.includes('tab')))
  );
  console.log('NAV/FRANCHISE IDs on home:', JSON.stringify(navIds));

  // Click franchise tab (try both possible testids)
  const candidates = [
    '[data-testid="your-franchise-tab"]',
    '[data-testid="your-franchise-tab-nav"]',
    '[data-testid="franchise-tab"]',
  ];
  let clicked = false;
  for (const sel of candidates) {
    const el = page.locator(sel);
    if (await el.count() > 0) {
      console.log(`Clicking: ${sel}`);
      await el.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // Try text-based
    const byText = page.locator('button, a, [role="tab"]').filter({ hasText: /franchise/i });
    if (await byText.count() > 0) {
      await byText.first().click();
      clicked = true;
      console.log('Clicked franchise by text');
    }
  }

  await page.waitForTimeout(2000);

  const allIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({ id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0, 50) }))
  );
  console.log('ALL testids after franchise click:', JSON.stringify(allIds));
});

test('discover league tab content', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Click league nav
  const leagueNav = page.locator('[data-testid="nav-league"]');
  if (await leagueNav.count() > 0) {
    await leagueNav.click();
    await page.waitForTimeout(2000);
  }

  const allIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({ id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0, 60) }))
  );
  console.log('LEAGUE TAB testids:', JSON.stringify(allIds));
});

test('discover standings page for streak indicators', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Check standings on home page
  const standingsIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid'))
      .filter(id => id && (id.includes('streak') || id.includes('standing') || id.includes('row')))
  );
  console.log('STREAK/STANDINGS IDs on home:', JSON.stringify(standingsIds));

  // Navigate to league
  await page.locator('[data-testid="nav-league"]').click();
  await page.waitForTimeout(2000);

  const leagueStreakIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid'))
      .filter(id => id && (id.includes('streak') || id.includes('award') || id.includes('mvp') || id.includes('cy') || id.includes('roy') || id.includes('race')))
  );
  console.log('STREAK/AWARD IDs on league tab:', JSON.stringify(leagueStreakIds));

  const allLeagueIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid'))
  );
  console.log('ALL IDs on league tab:', JSON.stringify(allLeagueIds));
});

test('discover player streak badges on roster/teams', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Click teams nav and first team
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-testid^="team-card-"]').first().click();
  await page.waitForTimeout(2000);

  const teamDetailIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({ id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0, 40) }))
      .filter(({ id }) => id && (id.includes('streak') || id.includes('player') || id.includes('roster')))
  );
  console.log('TEAM DETAIL STREAK/PLAYER IDs:', JSON.stringify(teamDetailIds));

  // Also check all tabs on the team page
  const allTeamIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => el.getAttribute('data-testid'))
  );
  console.log('ALL TEAM DETAIL IDs:', JSON.stringify(allTeamIds.slice(0, 80)));
});
