import { test } from '@playwright/test';

const BASE = 'http://localhost:5173';

test('dump all testids on Teams tab and team detail panel', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Navigate to Teams tab
  const teamsTab = page.locator('[data-testid="nav-teams"]');
  if (await teamsTab.count() > 0) {
    await teamsTab.click();
    await page.waitForTimeout(1500);
  }

  const teamsTestids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({ id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0, 60) }));
  });
  console.log('TEAMS TAB testids:', JSON.stringify(teamsTestids, null, 2));

  // Click team row 101
  const teamRow = page.locator('[data-testid="standings-row-101"]').or(
    page.locator('[data-testid="team-row-101"]')
  ).or(
    page.locator('[data-testid="team-card-101"]')
  );
  if (await teamRow.count() > 0) {
    await teamRow.first().click();
    await page.waitForTimeout(1500);
  }

  const teamDetailTestids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]'))
      .map(el => ({ id: el.getAttribute('data-testid'), text: el.textContent?.trim().slice(0, 80) }));
  });
  console.log('TEAM DETAIL testids:', JSON.stringify(teamDetailTestids, null, 2));
});
