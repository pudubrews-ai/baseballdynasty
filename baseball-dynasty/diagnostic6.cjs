const { chromium } = require('./node_modules/playwright');
const path = require('path');

const REPORTS_DIR = '/Users/pudubrewshowie/code-repose/github/baseballdynasty/reports';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Screenshot 1: Home / League tab
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-g1-league-home.png') });
  console.log('1. Home/League screenshot saved');
  
  // Screenshot 2: Watch tab (will show crash)
  await page.click('[data-testid="nav-watch"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-g2-watch-crashed.png') });
  console.log('2. Watch tab screenshot saved (expected to show error boundary)');
  
  // Screenshot 3: Timeline
  await page.click('[data-testid="nav-timeline"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-g7-timeline-crashed.png') });
  console.log('3. Timeline screenshot saved');
  
  // Screenshot 4: Turbo mode from API
  await page.request.post('http://localhost:3001/api/sim/speed', {
    data: { speed: 'turbo' },
    headers: { 'Content-Type': 'application/json' }
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-g5-turbo-state.png') });
  console.log('4. Turbo state screenshot saved');
  
  const turboIds = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-testid]')).map(function(el) { return el.getAttribute('data-testid'); });
  });
  console.log('Turbo testids:', turboIds.filter(function(id) { return id && !id.startsWith('news-ticker-item'); }).join(', '));
  
  const turboBadgeVisible = await page.locator('[data-testid="turbo-mode-badge"]').isVisible().catch(function() { return false; });
  const turboHeadlineFlash = await page.locator('[data-testid="watch-turbo-headline-flash"]').count();
  console.log('turbo-mode-badge visible: ' + turboBadgeVisible + ', watch-turbo-headline-flash: ' + turboHeadlineFlash);
  
  // Reset
  await page.request.post('http://localhost:3001/api/sim/speed', {
    data: { speed: 'normal' },
    headers: { 'Content-Type': 'application/json' }
  });
  
  // Navigate to League and check FPS
  await page.click('[data-testid="nav-league"]');
  await page.waitForTimeout(1000);
  
  const fps = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var n = 0; var t0 = performance.now();
      function raf(ts) { n++; if (ts - t0 < 2000) { requestAnimationFrame(raf); } else { resolve(n / ((ts - t0) / 1000)); } }
      requestAnimationFrame(raf);
    });
  });
  console.log('\nFPS on League tab: ' + fps.toFixed(1));
  
  // CLS
  const cls = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var total = 0, entries = 0;
      var obs = new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(e) {
          if (!e.hadRecentInput) { total += e.value || 0; entries++; }
        });
      });
      try { obs.observe({ type: 'layout-shift', buffered: true }); } catch(ex) {}
      setTimeout(function() { obs.disconnect(); resolve({ total: total, entries: entries }); }, 3000);
    });
  });
  console.log('CLS: ' + cls.total.toFixed(4) + ' (' + cls.entries + ' entries)');
  
  console.log('\nPage errors: ' + (errors.length > 0 ? errors.slice(0,3).join('\n') : 'none'));
  
  await browser.close();
  console.log('Done.');
})();
