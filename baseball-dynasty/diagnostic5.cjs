const { chromium } = require('./node_modules/playwright');
const path = require('path');

const REPORTS_DIR = '/Users/pudubrewshowie/code-repose/github/baseballdynasty/reports';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().substring(0, 300));
  });
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Take home screenshot
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-g1-home.png'), fullPage: false });
  console.log('Home screenshot saved');
  
  // Click Watch tab
  await page.click('[data-testid="nav-watch"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-g2-watch.png'), fullPage: false });
  console.log('Watch screenshot saved');
  console.log('Watch console errors:', consoleErrors.length);
  consoleErrors.slice(0,3).forEach(e => console.log(' ', e.substring(0, 200)));
  
  // Check "Something went wrong" text
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasCrash = bodyText.includes('Something went wrong');
  console.log(`Watch tab crashed: ${hasCrash}`);
  
  // Check if sim-speed-control is visible (above the error boundary maybe)
  const speedControl = await page.locator('[data-testid="sim-speed-control"]').count();
  const turboBtn = await page.locator('[data-testid="sim-speed-turbo"]').count();
  console.log(`sim-speed-control: ${speedControl}, sim-speed-turbo: ${turboBtn}`);
  
  // Try turbo via API instead
  const resp = await page.request.post('http://localhost:3001/api/sim/speed', {
    data: { speed: 'turbo' },
    headers: { 'Content-Type': 'application/json' }
  });
  console.log('POST /api/sim/speed turbo via API:', resp.status(), await resp.text());
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-g5-turbo.png'), fullPage: false });
  console.log('Turbo screenshot saved');
  
  const turboTestids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'));
  });
  console.log('Turbo testids:', turboTestids.join(', '));
  const turboBody = await page.evaluate(() => document.body.innerText?.substring(0, 400));
  console.log('Turbo body:', turboBody);
  
  // Check for turbo-headline-flash, turbo-mode-badge, calendar-overlay
  const turboHeadline = await page.locator('[data-testid="watch-turbo-headline-flash"]').count();
  const turboBadge = await page.locator('[data-testid="turbo-mode-badge"]').count();
  const calendarOverlay = await page.locator('[data-testid*="calendar"]').count();
  console.log(`turbo-headline-flash: ${turboHeadline}, turbo-mode-badge: ${turboBadge}, calendar-overlay: ${calendarOverlay}`);
  
  // Reset to normal speed
  await page.request.post('http://localhost:3001/api/sim/speed', {
    data: { speed: 'normal' },
    headers: { 'Content-Type': 'application/json' }
  });
  
  // Navigate to timeline
  await page.click('[data-testid="nav-timeline"]');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-g7-timeline.png'), fullPage: true });
  console.log('\nTimeline screenshot saved');
  
  const timelineTestids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]')).map(el => ({
      id: el.getAttribute('data-testid'),
      text: el.textContent?.substring(0,80)
    }));
  });
  console.log('Timeline testids count:', timelineTestids.length);
  const timelineSpecific = timelineTestids.filter(t => t.id?.includes('timeline'));
  console.log('Timeline-specific testids:');
  timelineSpecific.forEach(t => console.log(`  [${t.id}] "${t.text}"`));
  
  const timelineBody = await page.evaluate(() => document.body.innerText?.substring(0, 600));
  console.log('\nTimeline body text:', timelineBody);
  
  // Check /api/timeline response
  const tlResp = await page.request.get('http://localhost:3001/api/timeline');
  console.log('\n/api/timeline status:', tlResp.status());
  
  // Performance: FPS measurement on home page (League tab)
  await page.click('[data-testid="nav-league"]');
  await page.waitForTimeout(1000);
  const fps = await page.evaluate(async () => {
    return new Promise((resolve) => {
      let n = 0; const t0 = performance.now();
      const raf = (ts) => { n++; ts - t0 < 2000 ? requestAnimationFrame(raf) : resolve(n / ((ts - t0) / 1000)); };
      requestAnimationFrame(raf);
    });
  });
  console.log(`\nLeague tab FPS: ${fps.toFixed(1)}`);
  
  await browser.close();
  console.log('\nDone.');
})();
