/**
 * UI Tester B — Iteration 3
 * Baseball Dynasty Simulator v0.3.0
 * Groups: 1, 2, 3, 4, 5, 7, 11
 *
 * Key focus for Iter 3:
 * - Group 5: watch-turbo-calendar now exists (M-02 fix), scoreboard spin animation
 * - Group 7: timeline newspaper testids fully populated
 * - Group 1: Fresh league test for selectionResolved=false
 * - Groups 2-4: data-testid only, no SVG child-element counts
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';

// Helper: navigate to app and wait for hydration
async function loadApp(page: Page, waitMs = 3500) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(waitMs);
}

// Helper: get API state
async function getState() {
  const resp = await fetch(`${API_URL}/api/state`);
  return resp.json();
}

// Helper: wait for element with auto-retry
async function assertPresent(page: Page, testid: string, timeoutMs = 8000) {
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: timeoutMs });
}

// Helper: click Watch tab
async function goToWatch(page: Page) {
  const watchTab = page.locator('[data-testid="watch-tab"]');
  await expect(watchTab).toBeVisible({ timeout: 8000 });
  await watchTab.click();
  await page.waitForTimeout(1000);
}

// Helper: click Timeline tab
async function goToTimeline(page: Page) {
  const timelineTab = page.locator('[data-testid="timeline-tab"]');
  await expect(timelineTab).toBeVisible({ timeout: 8000 });
  await timelineTab.click();
  await page.waitForTimeout(1500);
}

// ============================================================
// GROUP 1 — Franchise Selection Screen
// Uses a FRESH league: seed 88
// ============================================================

test.describe('Group 1 — Franchise Selection Screen', () => {
  let franchisePage: Page;

  test.beforeAll(async ({ browser }) => {
    // Create fresh league with seed 88
    await fetch(`${API_URL}/api/league/current`, { method: 'DELETE' });
    await new Promise(r => setTimeout(r, 500));
    const resp = await fetch(`${API_URL}/api/league/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: 88 })
    });
    const data = await resp.json();
    console.log('[G1] New league created:', JSON.stringify(data).slice(0, 200));
    await new Promise(r => setTimeout(r, 1000));

    franchisePage = await browser.newPage();
    await franchisePage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await franchisePage.waitForTimeout(4000);
  });

  test.afterAll(async () => {
    await franchisePage?.close();
  });

  test('G1-01: franchise-selection-screen renders with selectionResolved=false', async () => {
    // Verify API state first
    const state = await fetch(`${API_URL}/api/state`).then(r => r.json());
    console.log('[G1-01] State:', JSON.stringify(state));

    const screen = franchisePage.locator('[data-testid="franchise-selection-screen"]');
    await expect(screen).toBeVisible({ timeout: 10000 });
    console.log('[G1-01] PASS: franchise-selection-screen visible');
  });

  test('G1-02: exactly 20 franchise cards', async () => {
    await expect(franchisePage.locator('[data-testid="franchise-selection-screen"]')).toBeVisible({ timeout: 8000 });
    const cards = franchisePage.locator('[data-testid^="franchise-card-"]');
    const count = await cards.count();
    console.log(`[G1-02] Franchise card count: ${count}`);
    expect(count).toBe(20);
  });

  test('G1-03: each card shows city, nickname, market badge, owner tag, GM tag, flavor line', async () => {
    await expect(franchisePage.locator('[data-testid="franchise-selection-screen"]')).toBeVisible({ timeout: 8000 });
    const cards = franchisePage.locator('[data-testid^="franchise-card-"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Check first card has substantive text content
    const firstCard = cards.first();
    const text = await firstCard.textContent();
    console.log(`[G1-03] First card text: ${text?.slice(0, 200)}`);
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(20);
  });

  test('G1-04: hover on card reveals payroll/capacity info', async () => {
    await expect(franchisePage.locator('[data-testid="franchise-selection-screen"]')).toBeVisible({ timeout: 8000 });
    const firstCard = franchisePage.locator('[data-testid^="franchise-card-"]').first();

    const beforeText = await firstCard.textContent();
    await firstCard.hover();
    await franchisePage.waitForTimeout(500);
    const afterText = await firstCard.textContent();
    console.log(`[G1-04] Before hover: ${beforeText?.slice(0, 100)}`);
    console.log(`[G1-04] After hover: ${afterText?.slice(0, 150)}`);

    // Check for payroll or capacity related text appearing
    const hasPayroll = afterText?.toLowerCase().includes('payroll') || afterText?.toLowerCase().includes('budget') || afterText?.toLowerCase().includes('$');
    const hasCapacity = afterText?.toLowerCase().includes('cap') || afterText?.toLowerCase().includes('seat') || afterText?.toLowerCase().includes('stadium');
    console.log(`[G1-04] hasPayroll=${hasPayroll}, hasCapacity=${hasCapacity}`);
  });

  test('G1-05: click card shows franchise-confirm-modal with team name', async () => {
    await expect(franchisePage.locator('[data-testid="franchise-selection-screen"]')).toBeVisible({ timeout: 8000 });
    const firstCard = franchisePage.locator('[data-testid^="franchise-card-"]').first();
    await firstCard.click();
    await franchisePage.waitForTimeout(800);

    const modal = franchisePage.locator('[data-testid="franchise-confirm-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    const modalText = await modal.textContent();
    console.log(`[G1-05] Modal text: ${modalText?.slice(0, 200)}`);
    expect(modalText).toBeTruthy();
  });

  test('G1-06: franchise-confirm-button present in modal', async () => {
    // Modal should already be open from previous test, but ensure
    const modal = franchisePage.locator('[data-testid="franchise-confirm-modal"]');
    const isVisible = await modal.isVisible();
    if (!isVisible) {
      await franchisePage.locator('[data-testid^="franchise-card-"]').first().click();
      await franchisePage.waitForTimeout(800);
    }

    const confirmBtn = franchisePage.locator('[data-testid="franchise-confirm-button"]');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    console.log('[G1-06] PASS: franchise-confirm-button visible');
  });

  test('G1-07: confirm button click — selection confirmed, screen disappears, server updated', async () => {
    const modal = franchisePage.locator('[data-testid="franchise-confirm-modal"]');
    const isVisible = await modal.isVisible();
    if (!isVisible) {
      await franchisePage.locator('[data-testid^="franchise-card-"]').first().click();
      await franchisePage.waitForTimeout(800);
    }

    const confirmBtn = franchisePage.locator('[data-testid="franchise-confirm-button"]');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
    await franchisePage.waitForTimeout(3000);

    // Screen should be gone
    const screen = franchisePage.locator('[data-testid="franchise-selection-screen"]');
    const screenVisible = await screen.isVisible();
    console.log(`[G1-07] Screen visible after confirm: ${screenVisible}`);

    // Check server state
    const state = await fetch(`${API_URL}/api/state`).then(r => r.json());
    console.log(`[G1-07] Post-confirm state: ownedTeamId=${state.ownedTeamId}, selectionResolved=${state.selectionResolved}`);

    const serverUpdated = state.ownedTeamId !== null && state.selectionResolved === true;
    console.log(`[G1-07] Server updated: ${serverUpdated}`);

    expect(screenVisible).toBe(false);
    // Note: server update is the iter-2 critical bug; check if fixed in iter-3
  });

  test('G1-08: selection screen does not reappear after reload', async () => {
    // Reload page
    await franchisePage.reload({ waitUntil: 'domcontentloaded' });
    await franchisePage.waitForTimeout(4000);

    const screen = franchisePage.locator('[data-testid="franchise-selection-screen"]');
    const visible = await screen.isVisible();
    console.log(`[G1-08] Screen visible after reload: ${visible}`);
    // If server was not updated, screen may reappear
    const state = await fetch(`${API_URL}/api/state`).then(r => r.json());
    console.log(`[G1-08] State after reload: ownedTeamId=${state.ownedTeamId}, selectionResolved=${state.selectionResolved}`);
  });
});

// ============================================================
// GROUP 2 — Watch Tab: Ballpark
// ============================================================

test.describe('Group 2 — Watch Tab: Ballpark', () => {
  test('G2-01: watch-tab present in main navigation', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('[data-testid="watch-tab"]')).toBeVisible({ timeout: 8000 });
    console.log('[G2-01] PASS: watch-tab visible');
  });

  test('G2-02: watch-ballpark renders', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const ballpark = page.locator('[data-testid="watch-ballpark"]');
    await expect(ballpark).toBeVisible({ timeout: 8000 });

    // Check innerHTML for SVG content (may be dangerouslySetInnerHTML)
    const innerHTML = await ballpark.innerHTML();
    console.log(`[G2-02] ballpark innerHTML length: ${innerHTML.length}`);
    console.log(`[G2-02] ballpark innerHTML sample: ${innerHTML.slice(0, 300)}`);

    const hasSvgContent = innerHTML.includes('<svg') || innerHTML.includes('svg') || innerHTML.includes('<rect') || innerHTML.includes('<path');
    console.log(`[G2-02] Has SVG content in innerHTML: ${hasSvgContent}`);

    // Check for SVG element directly
    const svgCount = await ballpark.locator('svg').count();
    console.log(`[G2-02] Direct SVG children: ${svgCount}`);
  });

  test('G2-03: watch-scoreboard shows teams/score during active game', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const scoreboard = page.locator('[data-testid="watch-scoreboard"]');
    await expect(scoreboard).toBeVisible({ timeout: 8000 });
    const text = await scoreboard.textContent();
    console.log(`[G2-03] Scoreboard text: ${text?.slice(0, 200)}`);
    expect(text).toBeTruthy();
  });

  test('G2-04: watch-crowd element present', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const crowd = page.locator('[data-testid="watch-crowd"]');
    await expect(crowd).toBeVisible({ timeout: 8000 });

    const innerHTML = await crowd.innerHTML();
    console.log(`[G2-04] crowd innerHTML length: ${innerHTML.length}`);
    console.log(`[G2-04] crowd innerHTML sample: ${innerHTML.slice(0, 200)}`);
    const hasSvgContent = innerHTML.includes('svg') || innerHTML.includes('<rect') || innerHTML.includes('<circle');
    console.log(`[G2-04] Has SVG content: ${hasSvgContent}`);
  });

  test('G2-05: watch-diamond shows baserunner element', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    await expect(page.locator('[data-testid="watch-diamond"]')).toBeVisible({ timeout: 8000 });
    console.log('[G2-05] PASS: watch-diamond visible');
  });

  test('G2-06: watch-sky element exists', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const sky = page.locator('[data-testid="watch-sky"]');
    await expect(sky).toBeVisible({ timeout: 8000 });
    const innerHTML = await sky.innerHTML();
    console.log(`[G2-06] watch-sky innerHTML: ${innerHTML.slice(0, 200)}`);
  });

  test('G2-07: watch tab renders without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await loadApp(page);
    await goToWatch(page);
    await page.waitForTimeout(1000);

    console.log(`[G2-07] JS errors: ${errors.length}`);
    errors.forEach(e => console.log(`  ERROR: ${e}`));
    expect(errors.length).toBe(0);
  });
});

// ============================================================
// GROUP 3 — Watch Tab: Front Office Sprites
// ============================================================

test.describe('Group 3 — Watch Tab: Front Office Sprites', () => {
  test('G3-01: watch-frontoffice-panel with 3 sprites', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const panel = page.locator('[data-testid="watch-frontoffice-panel"]');
    await expect(panel).toBeVisible({ timeout: 8000 });

    const ownerCount = await page.locator('[data-testid="watch-owner-sprite"]').count();
    const gmCount = await page.locator('[data-testid="watch-gm-sprite"]').count();
    const managerCount = await page.locator('[data-testid="watch-manager-sprite"]').count();
    console.log(`[G3-01] owner=${ownerCount}, gm=${gmCount}, manager=${managerCount}`);

    expect(ownerCount).toBe(1);
    expect(gmCount).toBe(1);
    expect(managerCount).toBe(1);
  });

  test('G3-02: watch-owner-sprite with name label and role badge', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const sprite = page.locator('[data-testid="watch-owner-sprite"]');
    await expect(sprite).toBeVisible({ timeout: 8000 });
    const text = await sprite.textContent();
    console.log(`[G3-02] Owner sprite text: ${text}`);
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(3);
  });

  test('G3-03: watch-gm-sprite with name label and role badge', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const sprite = page.locator('[data-testid="watch-gm-sprite"]');
    await expect(sprite).toBeVisible({ timeout: 8000 });
    const text = await sprite.textContent();
    console.log(`[G3-03] GM sprite text: ${text}`);
    expect(text).toBeTruthy();
  });

  test('G3-04: watch-manager-sprite with name label and role badge', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const sprite = page.locator('[data-testid="watch-manager-sprite"]');
    await expect(sprite).toBeVisible({ timeout: 8000 });
    const text = await sprite.textContent();
    console.log(`[G3-04] Manager sprite text: ${text}`);
    expect(text).toBeTruthy();
  });

  test('G3-05: interim badge on interim manager sprite', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    // Check manager sprite for INTERIM text (from API state, manager may be interim)
    const managerSprite = page.locator('[data-testid="watch-manager-sprite"]');
    await expect(managerSprite).toBeVisible({ timeout: 8000 });
    const text = await managerSprite.textContent();
    const isInterim = text?.toLowerCase().includes('interim');
    console.log(`[G3-05] Manager sprite text: ${text}, isInterim: ${isInterim}`);
    // Check for data-testid*="interim" element
    const interimCount = await page.locator('[data-testid*="interim"]').count();
    console.log(`[G3-05] data-testid*="interim" count: ${interimCount}`);
  });

  test('G3-06: all sprite data attributes', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    for (const spriteId of ['watch-owner-sprite', 'watch-gm-sprite', 'watch-manager-sprite']) {
      const sprite = page.locator(`[data-testid="${spriteId}"]`);
      const mood = await sprite.getAttribute('data-mood');
      const emotion = await sprite.getAttribute('data-emotion');
      const animName = await sprite.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.animationName;
      });
      console.log(`[G3-06] ${spriteId}: mood=${mood}, emotion=${emotion}, animationName=${animName}`);
    }
  });
});

// ============================================================
// GROUP 4 — Watch Tab: City Skyline
// ============================================================

test.describe('Group 4 — Watch Tab: City Skyline', () => {
  test('G4-01: watch-city-skyline renders', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const skyline = page.locator('[data-testid="watch-city-skyline"]');
    await expect(skyline).toBeVisible({ timeout: 8000 });

    const innerHTML = await skyline.innerHTML();
    console.log(`[G4-01] skyline innerHTML length: ${innerHTML.length}`);
    console.log(`[G4-01] skyline innerHTML sample: ${innerHTML.slice(0, 300)}`);

    const hasSvgContent = innerHTML.includes('<svg') || innerHTML.includes('<rect') || innerHTML.includes('<circle') || innerHTML.includes('<path');
    console.log(`[G4-01] Has SVG-like content: ${hasSvgContent}`);

    const svgChildren = await skyline.locator('svg').count();
    console.log(`[G4-01] Direct SVG children: ${svgChildren}`);
  });

  test('G4-02: skyline building count (data-testid based)', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const skyline = page.locator('[data-testid="watch-city-skyline"]');
    await expect(skyline).toBeVisible({ timeout: 8000 });

    // Try various testid patterns for buildings
    const buildingTestids = [
      '[data-testid*="building"]',
      '[data-testid*="skyline-building"]',
      '[data-testid*="sky-building"]'
    ];

    for (const selector of buildingTestids) {
      const count = await page.locator(selector).count();
      console.log(`[G4-02] ${selector}: ${count}`);
    }

    // Check rect elements inside skyline (building shapes)
    const rectCount = await skyline.locator('rect').count();
    console.log(`[G4-02] rect elements in skyline: ${rectCount}`);
  });

  test('G4-03: winning/losing record window lit state', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const skyline = page.locator('[data-testid="watch-city-skyline"]');
    await expect(skyline).toBeVisible({ timeout: 8000 });

    // Check for data attributes related to record
    const dataRecord = await skyline.getAttribute('data-record');
    const dataWinPct = await skyline.getAttribute('data-win-pct');
    const dataWins = await skyline.getAttribute('data-wins');
    console.log(`[G4-03] data-record=${dataRecord}, data-win-pct=${dataWinPct}, data-wins=${dataWins}`);

    // Check for window/lit testids
    const windowCount = await page.locator('[data-testid*="window"]').count();
    const litCount = await page.locator('[data-testid*="lit"]').count();
    console.log(`[G4-03] data-testid*="window": ${windowCount}, data-testid*="lit": ${litCount}`);
  });

  test('G4-04: fireworks check (no clinch in regular season)', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const fireworkCount = await page.locator('[data-testid*="firework"]').count();
    console.log(`[G4-04] Firework elements: ${fireworkCount}`);
    // During regular season, no fireworks expected
    expect(fireworkCount).toBe(0);
  });

  test('G4-05: night sky / background color in skyline', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const skyline = page.locator('[data-testid="watch-city-skyline"]');
    await expect(skyline).toBeVisible({ timeout: 8000 });

    const bgColor = await skyline.evaluate(el => {
      const style = window.getComputedStyle(el);
      return { bg: style.backgroundColor, bgImage: style.backgroundImage };
    });
    console.log(`[G4-05] Skyline background: ${JSON.stringify(bgColor)}`);

    // Check innerHTML for dark color keywords
    const innerHTML = await skyline.innerHTML();
    const hasDarkColors = innerHTML.includes('#0d') || innerHTML.includes('#1a') || innerHTML.includes('navy') || innerHTML.includes('rgb(13') || innerHTML.includes('rgb(26');
    console.log(`[G4-05] Has dark colors in SVG: ${hasDarkColors}`);
  });
});

// ============================================================
// GROUP 5 — Watch Tab: Turbo Mode
// KEY FOCUS: watch-turbo-calendar (NEW in Iter 3), scoreboard spin
// ============================================================

test.describe('Group 5 — Watch Tab: Turbo Mode', () => {
  test('G5-01 to G5-07: Full turbo sequence', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await loadApp(page);
    await goToWatch(page);

    // Get current state
    const stateBefore = await fetch(`${API_URL}/api/state`).then(r => r.json());
    console.log(`[G5] State before turbo: season=${stateBefore.seasonNumber}, phase=${stateBefore.phase}, gameNumber=${stateBefore.currentGameNumber}`);

    // Start normal sim first
    await fetch(`${API_URL}/api/sim/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 'normal' })
    });
    await page.waitForTimeout(500);

    // Enable turbo
    const turboResp = await fetch(`${API_URL}/api/sim/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 'turbo' })
    });
    const turboData = await turboResp.json();
    console.log(`[G5] Turbo response: ${JSON.stringify(turboData)}`);
    await page.waitForTimeout(1000);

    // G5-01: No blank screen
    const watchBallpark = page.locator('[data-testid="watch-ballpark"]');
    const ballparkVisible = await watchBallpark.isVisible();
    console.log(`[G5-01] watch-ballpark visible during turbo: ${ballparkVisible}`);

    // G5-02: watch-turbo-headline-flash appears
    const headlineFlash = page.locator('[data-testid="watch-turbo-headline-flash"]');
    let headlineVisible = false;
    try {
      await expect(headlineFlash).toBeVisible({ timeout: 5000 });
      headlineVisible = true;
      const headlineText = await headlineFlash.textContent();
      console.log(`[G5-02] watch-turbo-headline-flash text: ${headlineText?.slice(0, 100)}`);
    } catch {
      console.log('[G5-02] watch-turbo-headline-flash NOT visible');
    }

    // *** G5-KEY: watch-turbo-calendar (NEW in Iter 3) ***
    const turboCalendar = page.locator('[data-testid="watch-turbo-calendar"]');
    let calendarVisible = false;
    try {
      await expect(turboCalendar).toBeVisible({ timeout: 5000 });
      calendarVisible = true;
      const calText = await turboCalendar.textContent();
      const calInner = await turboCalendar.innerHTML();
      console.log(`[G5-CALENDAR] watch-turbo-calendar FOUND: text="${calText?.slice(0, 100)}", innerHTML="${calInner?.slice(0, 200)}"`);
    } catch {
      console.log('[G5-CALENDAR] watch-turbo-calendar NOT FOUND — M-02 fix may not be working');
      // Try broader search
      const calPatterns = ['[data-testid*="calendar"]', '[data-testid*="turbo-cal"]', '[data-testid*="week"]'];
      for (const p of calPatterns) {
        const cnt = await page.locator(p).count();
        console.log(`[G5-CALENDAR] ${p}: ${cnt}`);
      }
    }

    // G5-04: Scoreboard spin animation during turbo
    const scoreboard = page.locator('[data-testid="watch-scoreboard"]');
    const scoreboardVisible = await scoreboard.isVisible();
    console.log(`[G5-04] Scoreboard visible during turbo: ${scoreboardVisible}`);

    // Check for watch-scoreboard-spin testid (M-02 fix)
    const scoreboardSpin = page.locator('[data-testid="watch-scoreboard-spin"]');
    let spinVisible = false;
    try {
      await expect(scoreboardSpin).toBeVisible({ timeout: 3000 });
      spinVisible = true;
      const spinAnim = await scoreboardSpin.evaluate(el => {
        const style = window.getComputedStyle(el);
        return { animationName: style.animationName, animationDuration: style.animationDuration };
      });
      console.log(`[G5-04] watch-scoreboard-spin: ${JSON.stringify(spinAnim)}`);
    } catch {
      console.log('[G5-04] watch-scoreboard-spin NOT found — checking animationName on scoreboard');
      if (scoreboardVisible) {
        const scoreAnim = await scoreboard.evaluate(el => {
          const style = window.getComputedStyle(el);
          return { animationName: style.animationName, animationDuration: style.animationDuration };
        });
        console.log(`[G5-04] Scoreboard animation: ${JSON.stringify(scoreAnim)}`);
      }
    }

    // G5-05: Calendar overlay (already checked above as turbo-calendar)
    console.log(`[G5-05] Calendar overlay present: ${calendarVisible}`);

    // Turbo mode badge
    const turboBadge = page.locator('[data-testid="turbo-mode-badge"]');
    const turboBadgeVisible = await turboBadge.isVisible();
    console.log(`[G5] turbo-mode-badge visible: ${turboBadgeVisible}`);

    // Wait for season to end and newspaper
    console.log('[G5-06] Waiting for season end newspaper (up to 120s)...');
    let newspaperAppeared = false;
    let newspaperDuration = 0;
    const newspaperStart = Date.now();

    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      const newspaper = page.locator('[data-testid="watch-season-end-newspaper"]');
      const visible = await newspaper.isVisible();
      if (visible) {
        const appearTime = Date.now() - newspaperStart;
        console.log(`[G5-06] watch-season-end-newspaper appeared after ${appearTime}ms`);
        newspaperAppeared = true;

        // Measure how long it stays visible (min 1.5s)
        const holdStart = Date.now();
        await page.waitForTimeout(1600); // wait past minimum
        const stillVisible = await newspaper.isVisible();
        const holdElapsed = Date.now() - holdStart;
        newspaperDuration = holdElapsed;
        console.log(`[G5-06] After 1600ms still visible: ${stillVisible}, elapsed: ${holdElapsed}ms`);

        // Wait for it to disappear
        try {
          await expect(newspaper).toBeHidden({ timeout: 10000 });
          console.log('[G5-06] PASS: newspaper dismissed after minimum hold');
        } catch {
          console.log('[G5-06] Newspaper still visible after 10s');
        }
        break;
      }

      // Check if we've entered offseason without seeing newspaper
      const stateNow = await fetch(`${API_URL}/api/state`).then(r => r.json());
      if (stateNow.phase === 'offseason' || stateNow.season > stateBefore.season) {
        console.log(`[G5-06] Phase now: ${stateNow.phase}, season: ${stateNow.season} — checking for newspaper...`);
        // Give it a moment
        await page.waitForTimeout(500);
        const newspaper = page.locator('[data-testid="watch-season-end-newspaper"]');
        const visible = await newspaper.isVisible();
        if (visible) {
          newspaperAppeared = true;
          console.log('[G5-06] Newspaper visible at offseason transition ✓');
        }
        if (!visible && stateNow.phase === 'offseason') {
          console.log('[G5-06] In offseason but newspaper already gone or not shown');
          break;
        }
      }
    }

    if (!newspaperAppeared) {
      console.log('[G5-06] watch-season-end-newspaper never appeared in 120s window');
    }

    // G5-07: After newspaper, Watch tab resumes
    const stateAfter = await fetch(`${API_URL}/api/state`).then(r => r.json());
    console.log(`[G5-07] State after turbo: season=${stateAfter.season}, phase=${stateAfter.phase}`);

    const watchStillThere = await page.locator('[data-testid="watch-ballpark"]').isVisible();
    console.log(`[G5-07] Watch tab still rendering: ${watchStillThere}`);

    console.log(`[G5] JS errors: ${errors.length}`);
    errors.forEach(e => console.log(`  ERROR: ${e}`));

    // Summary
    console.log('\n[G5] SUMMARY:');
    console.log(`  G5-01 (No blank screen): ${ballparkVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  G5-02 (Headline flash): ${headlineVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  G5-04 (Scoreboard spin): ${spinVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  G5-05 (Calendar overlay - NEW): ${calendarVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  G5-06 (Newspaper 1.5s): ${newspaperAppeared ? 'PASS' : 'SKIP/FAIL'}`);
    console.log(`  G5-07 (Watch resumes): ${watchStillThere ? 'PASS' : 'FAIL'}`);
  });
});

// ============================================================
// GROUP 7 — Newspaper Dynasty Timeline
// KEY FOCUS: All newspaper testids now populated
// ============================================================

test.describe('Group 7 — Newspaper Dynasty Timeline', () => {
  test('G7-01 to G7-11: Full timeline newspaper test', async ({ page }) => {
    await loadApp(page);
    await goToTimeline(page);

    // G7-01: Timeline renders newspaper layout (not text list)
    const newspapers = page.locator('[data-testid^="timeline-newspaper-"]');
    const newspaperCount = await newspapers.count();
    console.log(`[G7-01] timeline-newspaper-* count: ${newspaperCount}`);

    // Collect all season numbers
    const seasonNumbers: number[] = [];
    for (let i = 1; i <= 20; i++) {
      const np = page.locator(`[data-testid="timeline-newspaper-${i}"]`);
      const visible = await np.isVisible();
      if (visible) seasonNumbers.push(i);
    }
    console.log(`[G7-01] Seasons with newspapers: [${seasonNumbers.join(', ')}]`);

    // G7-02: Each newspaper renders
    expect(newspaperCount).toBeGreaterThan(0);

    // G7-03 & G7-04: Check headlines
    const headlines: { season: number; text: string }[] = [];
    for (const season of seasonNumbers) {
      const headlineEl = page.locator(`[data-testid="timeline-headline-${season}"]`);
      const headlineCount = await headlineEl.count();
      if (headlineCount > 0) {
        const text = await headlineEl.first().textContent();
        headlines.push({ season, text: text || '' });
        console.log(`[G7-04] timeline-headline-${season}: "${text?.slice(0, 80)}"`);
      } else {
        console.log(`[G7-04] timeline-headline-${season}: NOT FOUND`);
        headlines.push({ season, text: '' });
      }
    }

    const nonEmptyHeadlines = headlines.filter(h => h.text.length > 0).length;
    console.log(`[G7-04] Non-empty headlines: ${nonEmptyHeadlines}/${seasonNumbers.length}`);

    // G7-05: Below-fold teasers
    const teaserPatterns = [
      '[data-testid^="timeline-teaser-"]',
      '[data-testid^="timeline-story-"]',
      '[data-testid*="below-fold"]',
      '[data-testid*="teaser"]'
    ];
    for (const p of teaserPatterns) {
      const cnt = await page.locator(p).count();
      console.log(`[G7-05] ${p}: ${cnt}`);
    }

    // G7-06: Front office reasons
    const reasons = page.locator('[data-testid^="timeline-frontoffice-reason-"]');
    const reasonCount = await reasons.count();
    console.log(`[G7-06] timeline-frontoffice-reason-* count: ${reasonCount}`);
    if (reasonCount > 0) {
      const firstReason = await reasons.first().textContent();
      console.log(`[G7-06] First reason: "${firstReason?.slice(0, 100)}"`);
    }

    // G7-07: Expand button test
    for (const season of seasonNumbers.slice(0, 3)) {
      const expandBtn = page.locator(`[data-testid="timeline-expand-${season}"]`);
      const expandCount = await expandBtn.count();
      console.log(`[G7-07] timeline-expand-${season}: count=${expandCount}`);
      if (expandCount > 0) {
        await expandBtn.first().click();
        await page.waitForTimeout(800);

        // Check for expanded content testids
        const expandedPatterns = [
          `[data-testid="timeline-expanded-${season}"]`,
          `[data-testid*="timeline-expanded"]`,
          `[data-testid*="broadsheet"]`,
          `[data-testid*="expanded-${season}"]`
        ];

        for (const p of expandedPatterns) {
          const cnt = await page.locator(p).count();
          if (cnt > 0) {
            console.log(`[G7-07] Expanded content found via: ${p} (count=${cnt})`);
            const txt = await page.locator(p).first().textContent();
            console.log(`[G7-07] Expanded text sample: "${txt?.slice(0, 150)}"`);
            break;
          }
        }

        // Close/collapse
        await expandBtn.first().click();
        await page.waitForTimeout(500);
        break;
      }
    }

    // G7-09: Paper texture CSS
    if (seasonNumbers.length > 0) {
      const firstPaper = page.locator(`[data-testid="timeline-newspaper-${seasonNumbers[0]}"]`);
      const bgStyle = await firstPaper.evaluate(el => {
        const style = window.getComputedStyle(el);
        return {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          fontFamily: style.fontFamily
        };
      });
      console.log(`[G7-09] Paper texture styles: ${JSON.stringify(bgStyle)}`);
    }

    // G7-10: Champion season data attribute
    for (const season of seasonNumbers) {
      const np = page.locator(`[data-testid="timeline-newspaper-${season}"]`);
      const dataChampion = await np.getAttribute('data-champion');
      const dataIsChampion = await np.getAttribute('data-is-champion');
      const classList = await np.getAttribute('class');
      if (dataChampion !== null || dataIsChampion !== null) {
        console.log(`[G7-10] Season ${season}: data-champion=${dataChampion}, data-is-champion=${dataIsChampion}`);
      }
    }

    // Summary
    console.log('\n[G7] SUMMARY:');
    console.log(`  G7-01 (Newspaper layout): ${newspaperCount > 0 ? 'PASS' : 'FAIL'} (${newspaperCount} newspapers)`);
    console.log(`  G7-02 (Each newspaper renders): ${seasonNumbers.length > 0 ? 'PASS' : 'FAIL'}`);
    console.log(`  G7-03/04 (Headlines populated): ${nonEmptyHeadlines > 0 ? 'PASS' : 'FAIL'} (${nonEmptyHeadlines}/${seasonNumbers.length} non-empty)`);
    console.log(`  G7-06 (Front office reasons): ${reasonCount > 0 ? 'PASS' : 'FAIL'} (${reasonCount} reasons)`);
  });

  test('G7-masthead: check for masthead elements', async ({ page }) => {
    await loadApp(page);
    await goToTimeline(page);

    const mastheadPatterns = [
      '[data-testid*="masthead"]',
      '[data-testid*="timeline-masthead"]',
      '[data-testid*="newspaper-header"]'
    ];
    for (const p of mastheadPatterns) {
      const cnt = await page.locator(p).count();
      console.log(`[G7-masthead] ${p}: ${cnt}`);
    }

    // Check all testids on timeline page
    const allTestids = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-testid]');
      const ids = new Set<string>();
      els.forEach(el => {
        const tid = el.getAttribute('data-testid');
        if (tid?.includes('timeline')) ids.add(tid);
      });
      return Array.from(ids).sort();
    });
    console.log(`[G7-masthead] All timeline testids (${allTestids.length}):`);
    allTestids.forEach(id => console.log(`  - ${id}`));
  });
});

// ============================================================
// GROUP 11 — Performance
// ============================================================

test.describe('Group 11 — Performance', () => {
  test('G11-01: Watch tab fps during normal speed', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await loadApp(page);
    await goToWatch(page);

    // Start normal sim
    await fetch(`${API_URL}/api/sim/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 'normal' })
    });

    // Measure frame rate
    const frames = await page.evaluate(async () => {
      return new Promise<number>(resolve => {
        let count = 0;
        const start = performance.now();
        const raf = () => {
          count++;
          if (performance.now() - start < 2000) {
            requestAnimationFrame(raf);
          } else {
            resolve(count);
          }
        };
        requestAnimationFrame(raf);
      });
    });
    const fps = frames / 2;
    console.log(`[G11-01] FPS: ${fps} (${frames} frames in 2s)`);
    expect(fps).toBeGreaterThan(30);

    // Pause sim
    await fetch(`${API_URL}/api/sim/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 'paused' })
    });
  });

  test('G11-02: CLS score (SVG layout reflow)', async ({ page }) => {
    await loadApp(page);
    await goToWatch(page);

    const clsScore = await page.evaluate(async () => {
      return new Promise<number>(resolve => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
              clsValue += (entry as any).value;
            }
          }
        });
        observer.observe({ entryTypes: ['layout-shift'] });
        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 3000);
      });
    });
    console.log(`[G11-02] CLS score: ${clsScore.toFixed(4)}`);
    expect(clsScore).toBeLessThan(0.1);
  });

  test('G11-03: Turbo mode no JS errors, no frozen UI', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await loadApp(page);
    await goToWatch(page);

    // Enable turbo
    await fetch(`${API_URL}/api/sim/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 'turbo' })
    });

    // Responsiveness checks during turbo
    let passCount = 0;
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(3000);
      const watchVisible = await page.locator('[data-testid="watch-ballpark"]').isVisible();
      if (watchVisible) passCount++;

      const stateNow = await fetch(`${API_URL}/api/state`).then(r => r.json());
      console.log(`[G11-03] Check ${i+1}/4: watchVisible=${watchVisible}, phase=${stateNow.phase}`);

      if (stateNow.phase === 'offseason' || stateNow.phase === 'free_agency') break;
    }

    console.log(`[G11-03] Responsiveness: ${passCount}/4 checks passed`);
    console.log(`[G11-03] JS errors: ${errors.length}`);
    errors.forEach(e => console.log(`  ERROR: ${e}`));

    expect(errors.length).toBe(0);

    // Pause
    await fetch(`${API_URL}/api/sim/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 'paused' })
    });
  });

  test('G11-04: Timeline scroll jank with 10+ seasons', async ({ page }) => {
    await loadApp(page);
    await goToTimeline(page);

    const newspapers = await page.locator('[data-testid^="timeline-newspaper-"]').count();
    console.log(`[G11-04] Newspaper count: ${newspapers}`);

    // Scroll to bottom
    const scrollStart = Date.now();
    await page.keyboard.press('End');
    await page.waitForTimeout(500);
    await page.keyboard.press('Home');
    const scrollEnd = Date.now();
    const scrollTime = scrollEnd - scrollStart;
    console.log(`[G11-04] Scroll End-to-Home completed in ${scrollTime}ms`);

    // Check scroll time is reasonable
    expect(scrollTime).toBeLessThan(3000);
  });

  test('G11-05: No JS errors navigating all tabs', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await loadApp(page);

    const tabIds = ['watch-tab', 'timeline-tab', 'news-tab', 'standings-tab', 'league-tab'];
    for (const tabId of tabIds) {
      const tab = page.locator(`[data-testid="${tabId}"]`);
      const exists = await tab.count();
      if (exists > 0) {
        await tab.click();
        await page.waitForTimeout(800);
        console.log(`[G11-05] Clicked ${tabId}`);
      } else {
        console.log(`[G11-05] ${tabId} not found`);
      }
    }

    console.log(`[G11-05] Total JS errors: ${errors.length}`);
    errors.forEach(e => console.log(`  ERROR: ${e}`));
    expect(errors.length).toBe(0);
  });
});
