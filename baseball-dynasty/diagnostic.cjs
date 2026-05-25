const { chromium } = require('./node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);
  
  // Get all data-testid attributes
  const testids = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid]');
    return Array.from(els).map(el => ({
      testid: el.getAttribute('data-testid'),
      tag: el.tagName,
      visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
      text: el.textContent?.substring(0, 60)
    }));
  });
  
  console.log('=== ALL data-testid ELEMENTS ON PAGE ===');
  if (testids.length === 0) console.log('  (none found)');
  testids.forEach(el => console.log(`  [${el.testid}] <${el.tag}> visible=${el.visible} text="${el.text}"`));
  
  console.log('\n=== PAGE TITLE ===', await page.title());
  
  // Get body text snippet
  const bodySnippet = await page.evaluate(() => document.body.innerText?.substring(0, 500));
  console.log('\n=== BODY TEXT SNIPPET ===\n', bodySnippet);
  
  // Get all nav/button elements
  const navEls = await page.evaluate(() => {
    const els = document.querySelectorAll('nav *, [role="tab"], button, a');
    return Array.from(els).slice(0, 30).map(el => ({
      tag: el.tagName,
      text: el.textContent?.trim().substring(0, 30),
      testid: el.getAttribute('data-testid'),
      classes: el.className?.substring(0, 60)
    }));
  });
  console.log('\n=== NAV/BUTTON/LINK ELEMENTS ===');
  navEls.forEach(el => console.log(`  <${el.tag}> testid="${el.testid}" class="${el.classes}" text="${el.text}"`));
  
  await browser.close();
})();
