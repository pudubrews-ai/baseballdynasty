const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Click Watch tab
  console.log('=== CLICKING nav-watch ===');
  await page.click('[data-testid="nav-watch"]');
  await page.waitForTimeout(2000);
  
  const watchTestids = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid]');
    return Array.from(els).map(el => ({
      testid: el.getAttribute('data-testid'),
      tag: el.tagName,
      visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
      text: el.textContent?.substring(0, 80)
    }));
  });
  
  console.log('=== WATCH TAB data-testid ELEMENTS ===');
  watchTestids.forEach(el => console.log(`  [${el.testid}] <${el.tag}> visible=${el.visible} text="${el.text}"`));
  
  // Now click Timeline
  console.log('\n=== CLICKING nav-timeline ===');
  await page.click('[data-testid="nav-timeline"]');
  await page.waitForTimeout(3000);
  
  const timelineTestids = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid]');
    return Array.from(els).map(el => ({
      testid: el.getAttribute('data-testid'),
      tag: el.tagName,
      visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
      text: el.textContent?.substring(0, 80)
    }));
  });
  
  console.log('=== TIMELINE TAB data-testid ELEMENTS ===');
  timelineTestids.forEach(el => console.log(`  [${el.testid}] <${el.tag}> visible=${el.visible} text="${el.text}"`));
  
  console.log('\n=== PAGE ERRORS ===', errors.length > 0 ? errors.join('; ') : 'none');
  
  await browser.close();
})();
