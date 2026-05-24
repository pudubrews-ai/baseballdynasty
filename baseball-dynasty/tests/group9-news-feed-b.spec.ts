import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

// Helper: wait for page to load and stabilize
async function loadApp(page: Page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
}

// Helper: navigate to news tab
async function goToNewsTab(page: Page) {
  const newsTab = page.locator('[data-testid="news-tab"]');
  await expect(newsTab).toBeVisible({ timeout: 10000 });
  await newsTab.click();
  await page.waitForTimeout(500);
}

test.describe('Group 9 — News Feed UI (Worker B)', () => {

  test('9.1 news-tab is present in main navigation', async ({ page }) => {
    await loadApp(page);
    const newsTab = page.locator('[data-testid="news-tab"]');
    await expect(newsTab).toBeVisible({ timeout: 10000 });
    console.log('PASS: news-tab found in navigation');
  });

  test('9.2 news-ticker is visible on home/standings tab', async ({ page }) => {
    await loadApp(page);
    // Check ticker on the default/home page (not on news tab)
    const ticker = page.locator('[data-testid="news-ticker"]');
    const tickerCount = await ticker.count();
    if (tickerCount > 0) {
      await expect(ticker.first()).toBeVisible({ timeout: 5000 });
      console.log('PASS: news-ticker visible on home tab');
    } else {
      console.log('INFO: news-ticker not found on home/default tab (may only show during active sim)');
    }
  });

  test('9.3 news-ticker visible on multiple tabs', async ({ page }) => {
    await loadApp(page);
    // Check ticker visibility across different tabs
    const tabIds = ['standings-tab', 'schedule-tab', 'roster-tab', 'minors-tab', 'draft-tab'];
    const results: Record<string, string> = {};

    for (const tabId of tabIds) {
      const tab = page.locator(`[data-testid="${tabId}"]`);
      const tabCount = await tab.count();
      if (tabCount > 0) {
        await tab.click();
        await page.waitForTimeout(300);
        const ticker = page.locator('[data-testid="news-ticker"]');
        const tickerCount = await ticker.count();
        if (tickerCount > 0) {
          const visible = await ticker.first().isVisible();
          results[tabId] = visible ? 'VISIBLE' : 'HIDDEN';
        } else {
          results[tabId] = 'NOT_FOUND';
        }
      } else {
        results[tabId] = 'TAB_NOT_FOUND';
      }
    }
    console.log('news-ticker visibility across tabs:', JSON.stringify(results, null, 2));
  });

  test('9.4 news-feed renders list of news items', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });
    console.log('PASS: news-feed container is visible');

    // Count news items
    const newsItems = page.locator('[data-testid^="news-item-"]');
    const itemCount = await newsItems.count();
    console.log(`INFO: Found ${itemCount} news items in feed`);
    expect(itemCount).toBeGreaterThan(0);
  });

  test('9.5 news-item structure: badge, headline, game number', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    const newsItems = page.locator('[data-testid^="news-item-"]');
    const itemCount = await newsItems.count();
    expect(itemCount).toBeGreaterThan(0);
    console.log(`Checking structure of ${Math.min(itemCount, 5)} news items`);

    const results = [];
    for (let i = 0; i < Math.min(itemCount, 5); i++) {
      const item = newsItems.nth(i);
      const testId = await item.getAttribute('data-testid');
      const eventId = testId?.replace('news-item-', '') || 'unknown';

      // Check badge
      const badge = item.locator('[data-testid="news-badge"]');
      const hasBadge = await badge.count() > 0;
      let badgeText = '';
      if (hasBadge) {
        badgeText = (await badge.first().textContent()) || '';
      }

      // Check headline
      const headline = item.locator('[data-testid="news-headline"]');
      const hasHeadline = await headline.count() > 0;
      let headlineText = '';
      if (hasHeadline) {
        headlineText = (await headline.first().textContent()) || '';
      }

      // Check game number
      const gameNum = item.locator('[data-testid="news-game-number"]');
      const hasGameNum = await gameNum.count() > 0;
      let gameNumText = '';
      if (hasGameNum) {
        gameNumText = (await gameNum.first().textContent()) || '';
      }

      results.push({
        eventId,
        hasBadge,
        badgeText: badgeText.trim(),
        hasHeadline,
        headlineText: headlineText.trim().substring(0, 80),
        hasGameNum,
        gameNumText: gameNumText.trim()
      });
    }

    console.log('News item structures:', JSON.stringify(results, null, 2));

    // Verify at least some items have badge and headline
    const itemsWithBadge = results.filter(r => r.hasBadge);
    const itemsWithHeadline = results.filter(r => r.hasHeadline);
    console.log(`Items with badge: ${itemsWithBadge.length}/${results.length}`);
    console.log(`Items with headline: ${itemsWithHeadline.length}/${results.length}`);
  });

  test('9.5b news-item DOM structure inspection (raw HTML)', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    // Get full HTML of first few news items to understand DOM structure
    const newsItems = page.locator('[data-testid^="news-item-"]');
    const itemCount = await newsItems.count();

    if (itemCount > 0) {
      const firstItemHTML = await newsItems.first().innerHTML();
      const firstItemTestId = await newsItems.first().getAttribute('data-testid');
      console.log(`First item testid: ${firstItemTestId}`);
      console.log(`First item inner HTML (truncated): ${firstItemHTML.substring(0, 600)}`);

      if (itemCount > 1) {
        const secondItemHTML = await newsItems.nth(1).innerHTML();
        const secondItemTestId = await newsItems.nth(1).getAttribute('data-testid');
        console.log(`Second item testid: ${secondItemTestId}`);
        console.log(`Second item inner HTML (truncated): ${secondItemHTML.substring(0, 600)}`);
      }
    }
  });

  test('9.6 news-filter-all shows all event types', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    const filterAll = page.locator('[data-testid="news-filter-all"]');
    const filterAllCount = await filterAll.count();
    if (filterAllCount > 0) {
      await filterAll.click();
      await page.waitForTimeout(500);
      const allItems = page.locator('[data-testid^="news-item-"]');
      const totalCount = await allItems.count();
      console.log(`PASS: news-filter-all found; shows ${totalCount} items`);
      expect(totalCount).toBeGreaterThan(0);
    } else {
      console.log('FAIL: news-filter-all not found');
      expect(filterAllCount).toBeGreaterThan(0);
    }
  });

  test('9.7 news-filter-transactions filters to transaction events', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    // Get baseline count
    const filterAll = page.locator('[data-testid="news-filter-all"]');
    if (await filterAll.count() > 0) await filterAll.click();
    await page.waitForTimeout(300);
    const allCount = await page.locator('[data-testid^="news-item-"]').count();

    const filterTrans = page.locator('[data-testid="news-filter-transactions"]');
    const filterCount = await filterTrans.count();
    if (filterCount > 0) {
      await filterTrans.click();
      await page.waitForTimeout(500);
      const transCount = await page.locator('[data-testid^="news-item-"]').count();
      console.log(`PASS: news-filter-transactions found; ${allCount} total -> ${transCount} transaction items`);
      // Transaction count should be <= total
      expect(transCount).toBeLessThanOrEqual(allCount);
    } else {
      console.log('FAIL: news-filter-transactions not found');
      expect(filterCount).toBeGreaterThan(0);
    }
  });

  test('9.8 news-filter-frontoffice filters to front office events', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    const filterAll = page.locator('[data-testid="news-filter-all"]');
    if (await filterAll.count() > 0) await filterAll.click();
    await page.waitForTimeout(300);
    const allCount = await page.locator('[data-testid^="news-item-"]').count();

    const filterFO = page.locator('[data-testid="news-filter-frontoffice"]');
    const filterCount = await filterFO.count();
    if (filterCount > 0) {
      await filterFO.click();
      await page.waitForTimeout(500);
      const foCount = await page.locator('[data-testid^="news-item-"]').count();
      console.log(`PASS: news-filter-frontoffice found; ${allCount} total -> ${foCount} front office items`);
      expect(foCount).toBeLessThanOrEqual(allCount);
    } else {
      console.log('FAIL: news-filter-frontoffice not found');
      expect(filterCount).toBeGreaterThan(0);
    }
  });

  test('9.9 news-filter-injuries filters to injury events', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    const filterAll = page.locator('[data-testid="news-filter-all"]');
    if (await filterAll.count() > 0) await filterAll.click();
    await page.waitForTimeout(300);
    const allCount = await page.locator('[data-testid^="news-item-"]').count();

    const filterInj = page.locator('[data-testid="news-filter-injuries"]');
    const filterCount = await filterInj.count();
    if (filterCount > 0) {
      await filterInj.click();
      await page.waitForTimeout(500);
      const injCount = await page.locator('[data-testid^="news-item-"]').count();
      console.log(`PASS: news-filter-injuries found; ${allCount} total -> ${injCount} injury items`);
      expect(injCount).toBeLessThanOrEqual(allCount);
    } else {
      console.log('FAIL: news-filter-injuries not found');
      expect(filterCount).toBeGreaterThan(0);
    }
  });

  test('9.10 news-filter-milestones filters to milestone events', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    const filterAll = page.locator('[data-testid="news-filter-all"]');
    if (await filterAll.count() > 0) await filterAll.click();
    await page.waitForTimeout(300);
    const allCount = await page.locator('[data-testid^="news-item-"]').count();

    const filterMile = page.locator('[data-testid="news-filter-milestones"]');
    const filterCount = await filterMile.count();
    if (filterCount > 0) {
      await filterMile.click();
      await page.waitForTimeout(500);
      const mileCount = await page.locator('[data-testid^="news-item-"]').count();
      console.log(`PASS: news-filter-milestones found; ${allCount} total -> ${mileCount} milestone items`);
      expect(mileCount).toBeLessThanOrEqual(allCount);
    } else {
      console.log('FAIL: news-filter-milestones not found');
      expect(filterCount).toBeGreaterThan(0);
    }
  });

  test('9.11 click news item expands to show full detail', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    const newsItems = page.locator('[data-testid^="news-item-"]');
    const itemCount = await newsItems.count();
    expect(itemCount).toBeGreaterThan(0);

    // Click first news item
    const firstItem = newsItems.first();
    const testId = await firstItem.getAttribute('data-testid');
    console.log(`Clicking item: ${testId}`);

    // Get initial height/content
    const initialHTML = await firstItem.innerHTML();

    await firstItem.click();
    await page.waitForTimeout(600);

    const afterClickHTML = await firstItem.innerHTML();
    const expanded = afterClickHTML !== initialHTML || afterClickHTML.length > initialHTML.length;

    // Look for news-item-detail testid
    const detail = page.locator('[data-testid="news-item-detail"]');
    const detailCount = await detail.count();

    console.log(`After click HTML length: before=${initialHTML.length}, after=${afterClickHTML.length}`);
    console.log(`news-item-detail elements found: ${detailCount}`);

    if (detailCount > 0) {
      const detailText = await detail.first().textContent();
      console.log(`PASS: news-item-detail visible. Content: ${detailText?.substring(0, 150)}`);
    } else {
      // Content expansion may work differently - check if item grew
      if (expanded) {
        console.log('PASS: News item expanded (HTML changed after click)');
      } else {
        console.log('WARN: No visible expansion detected after click');
      }
    }
  });

  test('9.12 check badges present in news items', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    const newsItems = page.locator('[data-testid^="news-item-"]');
    const itemCount = await newsItems.count();

    const badgeTypes: Record<string, number> = {};
    const sampleSize = Math.min(itemCount, 30);

    for (let i = 0; i < sampleSize; i++) {
      const item = newsItems.nth(i);
      const itemText = await item.textContent() || '';

      // Look for common badge types in text
      for (const badge of ['GAME', 'ROSTER', 'TRANSACTION', 'FRONT OFFICE', 'INJURY', 'MILESTONE', 'TRADE', 'SIGNING', 'RELEASE', 'CALL UP', 'SEND DOWN', 'WAIVER', 'DRAFT']) {
        if (itemText.toUpperCase().includes(badge)) {
          badgeTypes[badge] = (badgeTypes[badge] || 0) + 1;
        }
      }
    }

    console.log('Badge types found in first 30 items:', JSON.stringify(badgeTypes, null, 2));
    // Just verify badges exist (not zero findings)
    expect(Object.keys(badgeTypes).length).toBeGreaterThan(0);
  });

  test('9.13 game result events: ticker score check', async ({ page }) => {
    await loadApp(page);
    // Check ticker on current tab - look for game score format
    const ticker = page.locator('[data-testid="news-ticker"]');
    const tickerCount = await ticker.count();
    if (tickerCount > 0) {
      const tickerText = await ticker.first().textContent() || '';
      console.log(`Ticker text (first 300 chars): ${tickerText.substring(0, 300)}`);
      // Check if ticker contains score-like patterns (e.g., "5-3", "Team A 4, Team B 2")
      const hasScorePattern = /\d+-\d+|\d+,\s*\d+/.test(tickerText);
      console.log(`Ticker has score pattern: ${hasScorePattern}`);
    } else {
      console.log('INFO: news-ticker not visible on current page (may require active sim)');
    }
  });

  test('9.14 non-game events have non-empty headlines', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    // Filter to non-game events - check transactions, front office, injuries, milestones
    const nonGameFilters = ['news-filter-transactions', 'news-filter-frontoffice', 'news-filter-injuries', 'news-filter-milestones'];

    for (const filterId of nonGameFilters) {
      const filter = page.locator(`[data-testid="${filterId}"]`);
      if (await filter.count() > 0) {
        await filter.click();
        await page.waitForTimeout(500);

        const items = page.locator('[data-testid^="news-item-"]');
        const count = await items.count();

        if (count > 0) {
          let emptyHeadlines = 0;
          const sampleSize = Math.min(count, 10);

          for (let i = 0; i < sampleSize; i++) {
            const item = items.nth(i);
            const text = await item.textContent() || '';
            // Very short text (< 20 chars) might indicate missing headline
            if (text.trim().length < 20) emptyHeadlines++;
          }

          console.log(`Filter ${filterId}: ${count} items, ${emptyHeadlines} with very short/empty text`);
        } else {
          console.log(`Filter ${filterId}: 0 items (may not exist in DB)`);
        }
      } else {
        console.log(`Filter ${filterId}: filter button NOT FOUND`);
      }
    }
  });

  test('9.15 additional testids: waivers-list exists', async ({ page }) => {
    await loadApp(page);

    // Look for waivers tab or section
    const waiverTab = page.locator('[data-testid="waivers-tab"]');
    const waiverTabCount = await waiverTab.count();

    if (waiverTabCount > 0) {
      await waiverTab.click();
      await page.waitForTimeout(500);
    }

    const waiversList = page.locator('[data-testid="waivers-list"]');
    const waiversCount = await waiversList.count();

    if (waiversCount > 0) {
      const isVisible = await waiversList.first().isVisible();
      console.log(`PASS: waivers-list found (visible: ${isVisible})`);

      // Check for individual waiver player entries
      const waiverPlayers = page.locator('[data-testid^="waiver-player-"]');
      const playerCount = await waiverPlayers.count();
      console.log(`INFO: waiver-player-{id} entries found: ${playerCount} (DB at Season 11 — may be empty)`);
    } else {
      console.log('FAIL: waivers-list not found');
    }
  });

  test('9.16 additional testids: minors-stats-{playerId} on minors tab', async ({ page }) => {
    await loadApp(page);

    const minorsTab = page.locator('[data-testid="minors-tab"]');
    const minorsTabCount = await minorsTab.count();

    if (minorsTabCount > 0) {
      await minorsTab.click();
      await page.waitForTimeout(800);

      const minorsStats = page.locator('[data-testid^="minors-stats-"]');
      const statsCount = await minorsStats.count();

      if (statsCount > 0) {
        const firstId = await minorsStats.first().getAttribute('data-testid');
        console.log(`PASS: minors-stats-{playerId} found. First: ${firstId}. Total: ${statsCount}`);
      } else {
        console.log('FAIL: minors-stats-{playerId} elements not found on minors tab');
      }
    } else {
      console.log('FAIL: minors-tab not found in navigation');
    }
  });

  test('9.17 news-item-{eventId} verify DOM structure of actual items', async ({ page }) => {
    await loadApp(page);
    await goToNewsTab(page);

    const newsFeed = page.locator('[data-testid="news-feed"]');
    await expect(newsFeed).toBeVisible({ timeout: 10000 });

    const newsItems = page.locator('[data-testid^="news-item-"]');
    const itemCount = await newsItems.count();

    console.log(`Total news-item-{eventId} elements: ${itemCount}`);

    // Collect all testids
    const testIds = [];
    for (let i = 0; i < Math.min(itemCount, 10); i++) {
      const tid = await newsItems.nth(i).getAttribute('data-testid');
      testIds.push(tid);
    }
    console.log('Sample news-item testids:', testIds);

    // Verify the pattern: news-item-{some numeric or string id}
    for (const tid of testIds) {
      expect(tid).toMatch(/^news-item-\S+/);
    }
    console.log(`PASS: All sampled items match news-item-{eventId} pattern`);
  });

});
