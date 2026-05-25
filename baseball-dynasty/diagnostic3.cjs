const { chromium } = require('./node_modules/playwright');
const path = require('path');
const fs = require('fs');

const REPORTS_DIR = '/Users/pudubrewshowie/code-repose/github/baseballdynasty/reports';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
  });
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-home.png') });
  console.log('Home page screenshot saved');
  
  // Click Watch
  await page.click('[data-testid="nav-watch"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-watch.png') });
  
  // Get body inner text for watch
  const watchBody = await page.evaluate(() => document.body.innerText?.substring(0, 800));
  console.log('=== WATCH TAB BODY TEXT ===\n', watchBody);
  
  // Check for any elements that might contain watch content (without testid)
  const watchContent = await page.evaluate(() => {
    const content = [];
    const allEls = document.querySelectorAll('div, section, article, canvas, svg');
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) {
        const testid = el.getAttribute('data-testid');
        if (testid) continue; // already logged
        const id = el.getAttribute('id');
        const cls = el.className?.substring(0, 50);
        content.push({ tag: el.tagName, id, cls, w: Math.round(rect.width), h: Math.round(rect.height), children: el.children.length });
      }
    }
    return content.slice(0, 20);
  });
  console.log('\n=== LARGE ELEMENTS IN WATCH (no testid) ===');
  watchContent.forEach(el => console.log(`  <${el.tag}> id="${el.id}" class="${el.cls}" ${el.w}x${el.h} children=${el.children}`));
  
  // Click Timeline
  await page.click('[data-testid="nav-timeline"]');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-timeline.png') });
  
  const timelineBody = await page.evaluate(() => document.body.innerText?.substring(0, 800));
  console.log('\n=== TIMELINE TAB BODY TEXT ===\n', timelineBody);
  
  // Check for timeline content elements
  const timelineContent = await page.evaluate(() => {
    const content = [];
    const allEls = document.querySelectorAll('[data-testid]');
    return Array.from(allEls).map(el => ({
      testid: el.getAttribute('data-testid'),
      tag: el.tagName,
      text: el.textContent?.substring(0, 80)
    }));
  });
  console.log('\n=== TIMELINE data-testid elements ===');
  timelineContent.forEach(el => console.log(`  [${el.testid}] <${el.tag}> "${el.text}"`));
  
  // Also check sim speed turbo
  console.log('\n=== TESTING TURBO MODE ===');
  await page.click('[data-testid="nav-watch"]');
  await page.waitForTimeout(1000);
  await page.click('[data-testid="sim-speed-turbo"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-watch-turbo.png') });
  
  const turboTestids = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid]');
    return Array.from(els).map(el => el.getAttribute('data-testid'));
  });
  const turboNewIds = turboTestids.filter(id => !['new-dynasty-button-header','nav-league','nav-teams','nav-games','nav-draft','nav-players','nav-timeline','news-tab','nav-watch','news-ticker','sim-speed-control','sim-speed-paused','sim-speed-normal','sim-speed-fast','sim-speed-turbo'].includes(id));
  console.log('New testids visible in turbo (excl nav/static):', turboNewIds.slice(0,30).join(', ') || 'none beyond news-ticker items');
  
  // reset to normal
  await page.click('[data-testid="sim-speed-normal"]');
  
  console.log('\n=== ERRORS ===', errors.length > 0 ? errors.slice(0,10).join('\n') : 'none');
  
  await browser.close();
})();
