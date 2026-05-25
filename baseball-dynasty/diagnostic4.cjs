const { chromium } = require('./node_modules/playwright');
const path = require('path');

const REPORTS_DIR = '/Users/pudubrewshowie/code-repose/github/baseballdynasty/reports';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Click Watch
  await page.click('[data-testid="nav-watch"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-watch-v030.png'), fullPage: true });
  
  const watchTestids = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid]');
    return Array.from(els).map(el => ({
      testid: el.getAttribute('data-testid'),
      visible: el.getBoundingClientRect().width > 0,
      text: el.textContent?.substring(0, 60)
    }));
  });
  console.log('=== WATCH TAB TESTIDS ===');
  watchTestids.forEach(el => console.log(`  [${el.testid}] visible=${el.visible} "${el.text}"`));
  
  const watchBodyText = await page.evaluate(() => document.body.innerText?.substring(0, 300));
  console.log('\nWATCH BODY:\n', watchBodyText);
  
  console.log('\n=== WATCH ERRORS ===');
  errors.forEach(e => console.log(' ', e));
  consoleErrors.forEach(e => console.log(' CONSOLE:', e));
  
  // Now click Timeline  
  errors.length = 0;
  consoleErrors.length = 0;
  await page.click('[data-testid="nav-timeline"]');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-timeline-v030.png'), fullPage: true });
  
  const timelineTestids = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid]');
    return Array.from(els).map(el => ({
      testid: el.getAttribute('data-testid'),
      visible: el.getBoundingClientRect().width > 0,
      text: el.textContent?.substring(0, 80)
    }));
  });
  console.log('\n=== TIMELINE TAB TESTIDS ===');
  timelineTestids.forEach(el => console.log(`  [${el.testid}] visible=${el.visible} "${el.text}"`));
  
  const timelineBodyText = await page.evaluate(() => document.body.innerText?.substring(0, 600));
  console.log('\nTIMELINE BODY:\n', timelineBodyText);
  
  console.log('\n=== TIMELINE ERRORS ===');
  errors.forEach(e => console.log(' ', e));
  consoleErrors.forEach(e => console.log(' CONSOLE:', e));
  
  // Performance test: measure FPS on Watch tab
  await page.click('[data-testid="nav-watch"]');
  await page.waitForTimeout(1000);
  
  const fpsData = await page.evaluate(async () => {
    return new Promise((resolve) => {
      let frameCount = 0;
      const start = performance.now();
      const tick = (ts) => {
        frameCount++;
        if (ts - start < 2000) {
          requestAnimationFrame(tick);
        } else {
          resolve({ frames: frameCount, duration: ts - start });
        }
      };
      requestAnimationFrame(tick);
    });
  });
  const fps = fpsData.frames / (fpsData.duration / 1000);
  console.log(`\n=== PERFORMANCE: ${fps.toFixed(1)} FPS over ${Math.round(fpsData.duration)}ms ===`);
  
  // Turbo mode test
  console.log('\n=== TESTING TURBO ===');
  await page.click('[data-testid="sim-speed-turbo"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(REPORTS_DIR, 'ss-watch-turbo-v030.png'), fullPage: true });
  
  const turboTestids = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid]');
    return Array.from(els).map(el => el.getAttribute('data-testid'));
  });
  console.log('Turbo testids:', turboTestids.join(', '));
  
  const turboBodyText = await page.evaluate(() => document.body.innerText?.substring(0, 400));
  console.log('Turbo body:\n', turboBodyText);
  
  // Reset
  await page.click('[data-testid="sim-speed-normal"]').catch(() => {});
  
  console.log('\nAll screenshots saved to:', REPORTS_DIR);
  
  await browser.close();
})();
