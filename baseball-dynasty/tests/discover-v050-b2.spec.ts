/**
 * Discovery spec v2 — check awards, league sub-tabs, standings streak indicators deeper
 */
import { test } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API  = 'http://localhost:3001';

test('check awards API and league sub-navigation', async ({ page }) => {
  // Check awards API
  const awardsResp = await page.request.get(`${API}/api/awards/current`);
  console.log('awards/current status:', awardsResp.status());
  if (awardsResp.ok()) {
    const body = await awardsResp.text();
    console.log('awards/current body (first 500):', body.slice(0, 500));
  }

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Click league nav
  await page.locator('[data-testid="nav-league"]').click();
  await page.waitForTimeout(1000);

  // Check if there are sub-tabs inside the league view
  const subTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"], button'))
      .map(el => ({ tag: el.tagName, text: (el as HTMLElement).innerText?.trim().slice(0, 40), testid: el.getAttribute('data-testid') }))
      .filter(el => el.text && el.text.length > 0)
  );
  console.log('Sub-tabs / buttons on league:', JSON.stringify(subTabs.slice(0, 30)));

  // Look for awards text anywhere
  const awardsText = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all
      .filter(el => el.textContent && /award|mvp|cy young|rookie/i.test(el.textContent) && el.children.length < 3)
      .map(el => ({ tag: el.tagName, testid: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0, 80) }))
      .slice(0, 20);
  });
  console.log('Awards-related text elements:', JSON.stringify(awardsText));
});

test('check standings rows for streak data inside row content', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Check a single standings row for streak content
  const standingsRowContent = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid^="standings-row-"]'));
    return rows.slice(0, 3).map(row => ({
      id: row.getAttribute('data-testid'),
      html: row.innerHTML.slice(0, 300),
      allTestids: Array.from(row.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'))
    }));
  });
  console.log('STANDINGS ROW content:', JSON.stringify(standingsRowContent));

  // Also check team-streak-indicator anywhere in the DOM
  const streakIndicators = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="team-streak-indicator"]'))
      .map(el => el.getAttribute('data-testid'))
  );
  console.log('team-streak-indicator elements:', JSON.stringify(streakIndicators));
});

test('check franchise-at-a-glance full text', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="your-franchise-tab"]').first().click();
  await page.waitForTimeout(2000);

  const glanceText = await page.locator('[data-testid="franchise-at-a-glance"]').innerText();
  console.log('franchise-at-a-glance full text:', glanceText);

  const browseSelector = await page.locator('[data-testid="franchise-browse-selector"]').innerHTML();
  console.log('browse-selector HTML (first 300):', browseSelector.slice(0, 300));

  const browseReturn = await page.locator('[data-testid="franchise-browse-return"]').innerText();
  console.log('browse-return text:', browseReturn);

  const returnVisible = await page.locator('[data-testid="franchise-browse-return"]').isVisible();
  console.log('browse-return visible:', returnVisible);
});

test('check franchise-roster-panel for streak badges', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="your-franchise-tab"]').first().click();
  await page.waitForTimeout(2000);

  const rosterBadges = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="player-streak-badge-"]'))
      .map(el => ({ id: el.getAttribute('data-testid'), text: el.textContent?.trim() }))
  );
  console.log('player-streak-badge elements on franchise tab:', JSON.stringify(rosterBadges));

  const rosterPanelHtml = await page.locator('[data-testid="franchise-roster-panel"]').innerHTML();
  console.log('roster-panel HTML snippet (0-400):', rosterPanelHtml.slice(0, 400));
});
