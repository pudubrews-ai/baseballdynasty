import { test, expect, Page } from '@playwright/test';
const BASE_URL = 'http://localhost:5173';

test('deep check: expanded news item HTML', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const newsTab = page.locator('[data-testid="news-tab"]');
  await newsTab.click();
  await page.waitForTimeout(500);

  const newsItems = page.locator('[data-testid^="news-item-"]');
  const firstItem = newsItems.first();

  await firstItem.click();
  await page.waitForTimeout(600);

  const expandedHTML = await firstItem.innerHTML();
  console.log('=== EXPANDED ITEM HTML ===');
  console.log(expandedHTML);
});

test('deep check: filter-transactions behavior', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const newsTab = page.locator('[data-testid="news-tab"]');
  await newsTab.click();
  await page.waitForTimeout(500);

  // Click transactions filter and check actual badge text of items shown
  const filterTrans = page.locator('[data-testid="news-filter-transactions"]');
  await filterTrans.click();
  await page.waitForTimeout(500);

  const items = page.locator('[data-testid^="news-item-"]');
  const count = await items.count();
  console.log(`Transaction filter shows ${count} items`);

  // Sample badge text from first 10 items
  for (let i = 0; i < Math.min(count, 10); i++) {
    const text = await items.nth(i).textContent() || '';
    console.log(`Item ${i}: ${text.substring(0, 120)}`);
  }
});

test('deep check: check actual tab data-testids in nav', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Get all elements with data-testid
  const allTestIds = await page.evaluate(() => {
    const elements = document.querySelectorAll('[data-testid]');
    return Array.from(elements).map(el => el.getAttribute('data-testid')).filter(id => id?.includes('tab'));
  });
  console.log('All tab-related testids found:', JSON.stringify(allTestIds, null, 2));

  // Also get all testids
  const allIds = await page.evaluate(() => {
    const elements = document.querySelectorAll('[data-testid]');
    return Array.from(elements).map(el => el.getAttribute('data-testid'));
  });
  console.log('ALL testids on page:', JSON.stringify(allIds, null, 2));
});

test('deep check: ticker individual items', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const ticker = page.locator('[data-testid="news-ticker"]');
  if (await ticker.count() > 0) {
    const tickerHTML = await ticker.first().innerHTML();
    console.log('=== TICKER HTML ===');
    console.log(tickerHTML.substring(0, 2000));

    // Check for ticker items
    const tickerItems = page.locator('[data-testid^="ticker-item"]');
    console.log(`Ticker items count: ${await tickerItems.count()}`);
  }
});
