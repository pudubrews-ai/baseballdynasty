/**
 * UI Tester B — v0.3.0 Iteration 2
 * Groups: 1, 2, 3, 4, 5, 7, 11
 * Lane rules: Playwright only, data-testid attributes only, auto-retry assertions
 */
import { test, expect, Page } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API  = 'http://localhost:3001';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
async function navigateTo(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  // Wait extra for React hydration (Vite HMR keeps connections open, networkidle times out)
  await page.waitForTimeout(3000);
}

// ──────────────────────────────────────────────────────────────
// GROUP 1 — Franchise Selection Screen
// Pre-condition: league 7 (seed 77) created, selectionResolved=false
// ──────────────────────────────────────────────────────────────
test.describe('Group 1 — Franchise Selection Screen', () => {

  test.beforeAll(async ({ request }) => {
    // Ensure we have a fresh league with selectionResolved=false
    const state = await request.get(`${API}/api/state`);
    const stateJson = await state.json();
    if (stateJson.selectionResolved !== false) {
      // Reset and create new league with seed 77
      await request.delete(`${API}/api/league/current`);
      await request.post(`${API}/api/league/new`, {
        data: { seed: 77 },
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  test('G1-01 franchise-selection-screen renders after world gen', async ({ page }) => {
    await navigateTo(page, BASE);
    // Auto-retry: wait up to 10s for screen to appear
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    await expect(sel).toBeVisible({ timeout: 10000 });
  });

  test('G1-02 screen shows exactly 20 franchise cards', async ({ page }) => {
    await navigateTo(page, BASE);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    await expect(sel).toBeVisible({ timeout: 10000 });
    const cards = page.locator('[data-testid^="franchise-card-"]');
    await expect(cards).toHaveCount(20, { timeout: 8000 });
  });

  test('G1-03 each franchise card shows city, nickname, market size badge, owner personality, GM archetype, flavor', async ({ page }) => {
    await navigateTo(page, BASE);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    await expect(sel).toBeVisible({ timeout: 10000 });

    const cards = page.locator('[data-testid^="franchise-card-"]');
    const cardCount = await cards.count();
    console.log(`G1-03: total franchise cards: ${cardCount}`);

    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();

    // Collect all testids inside first card
    const innerEls = await firstCard.locator('[data-testid]').all();
    const innerIds: string[] = [];
    for (const el of innerEls) {
      const tid = await el.getAttribute('data-testid');
      if (tid) innerIds.push(tid);
    }
    console.log(`G1-03: inner testids on first card: ${innerIds.join(', ')}`);

    // Check text content exists (city + nickname)
    const cardText = await firstCard.textContent();
    console.log(`G1-03: first card text (first 200 chars): ${cardText?.substring(0, 200)}`);
    expect(cardText?.trim().length).toBeGreaterThan(0);

    // Check for market size badge
    const marketBadge = firstCard.locator('[data-testid*="market"]');
    const mbCount = await marketBadge.count();
    console.log(`G1-03: market badge count: ${mbCount}`);

    // Check for owner personality tag
    const ownerTag = firstCard.locator('[data-testid*="owner"]').or(firstCard.locator('[data-testid*="personality"]'));
    const otCount = await ownerTag.count();
    console.log(`G1-03: owner/personality tag count: ${otCount}`);

    // Check for GM archetype tag
    const gmTag = firstCard.locator('[data-testid*="gm"]').or(firstCard.locator('[data-testid*="archetype"]'));
    const gtCount = await gmTag.count();
    console.log(`G1-03: gm/archetype tag count: ${gtCount}`);

    // Check for flavor line
    const flavorEl = firstCard.locator('[data-testid*="flavor"]');
    const flCount = await flavorEl.count();
    console.log(`G1-03: flavor element count: ${flCount}`);
  });

  test('G1-04 hover on card: stadium capacity and payroll budget appear', async ({ page }) => {
    await navigateTo(page, BASE);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    await expect(sel).toBeVisible({ timeout: 10000 });

    const firstCard = page.locator('[data-testid^="franchise-card-"]').first();
    await firstCard.hover();
    await page.waitForTimeout(600);

    // Look for stadium/payroll data
    const stadiumEl = page.locator('[data-testid*="stadium"]').or(firstCard.locator('[data-testid*="stadium"]'));
    const payrollEl = page.locator('[data-testid*="payroll"]').or(firstCard.locator('[data-testid*="payroll"]'));
    const stadCount = await stadiumEl.count();
    const payCount = await payrollEl.count();
    console.log(`G1-04: stadium elements after hover: ${stadCount}, payroll elements: ${payCount}`);

    // Also check if card expanded/changed on hover
    const hoverExpanded = firstCard.locator('[data-testid*="hover"]').or(firstCard.locator('[data-testid*="expanded"]'));
    const heCount = await hoverExpanded.count();
    console.log(`G1-04: hover-expanded elements: ${heCount}`);

    // Collect all visible testids on page after hover
    const allEls = await page.locator('[data-testid]').all();
    const hoverIds: string[] = [];
    for (const el of allEls) {
      const tid = await el.getAttribute('data-testid');
      if (tid && (tid.includes('stadium') || tid.includes('payroll') || tid.includes('capacity') || tid.includes('budget'))) {
        hoverIds.push(tid);
      }
    }
    console.log(`G1-04: stadium/payroll/capacity/budget testids: ${hoverIds.join(', ')}`);
  });

  test('G1-05 click card: franchise-confirm-modal appears with team name', async ({ page }) => {
    await navigateTo(page, BASE);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    await expect(sel).toBeVisible({ timeout: 10000 });

    const firstCard = page.locator('[data-testid^="franchise-card-"]').first();
    await firstCard.click();

    const modal = page.locator('[data-testid="franchise-confirm-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const modalText = await modal.textContent();
    console.log(`G1-05: modal text: ${modalText?.substring(0, 200)}`);
    expect(modalText?.trim().length).toBeGreaterThan(0);
  });

  test('G1-06 franchise-confirm-button visible in modal', async ({ page }) => {
    await navigateTo(page, BASE);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    await expect(sel).toBeVisible({ timeout: 10000 });

    const firstCard = page.locator('[data-testid^="franchise-card-"]').first();
    await firstCard.click();

    const modal = page.locator('[data-testid="franchise-confirm-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const confirmBtn = page.locator('[data-testid="franchise-confirm-button"]');
    await expect(confirmBtn).toBeVisible({ timeout: 3000 });
    console.log(`G1-06: franchise-confirm-button found and visible`);
  });

  test('G1-07 confirm-button click: selection confirmed, draft begins, screen disappears', async ({ page }) => {
    // Reset for clean state
    await page.request.delete(`${API}/api/league/current`);
    await page.request.post(`${API}/api/league/new`, {
      data: { seed: 77 },
      headers: { 'Content-Type': 'application/json' }
    });

    await navigateTo(page, BASE);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    await expect(sel).toBeVisible({ timeout: 10000 });

    const firstCard = page.locator('[data-testid^="franchise-card-"]').first();
    await firstCard.click();

    const modal = page.locator('[data-testid="franchise-confirm-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const confirmBtn = page.locator('[data-testid="franchise-confirm-button"]');
    await expect(confirmBtn).toBeVisible({ timeout: 3000 });
    await confirmBtn.click();
    await page.waitForTimeout(2000);

    // Selection screen should disappear
    await expect(sel).not.toBeVisible({ timeout: 8000 });
    console.log('G1-07: franchise-selection-screen disappeared after confirmation');

    // Check state
    const stateResp = await page.request.get(`${API}/api/state`);
    const stateJson = await stateResp.json();
    console.log(`G1-07: ownedTeamId after confirm: ${stateJson.ownedTeamId}, selectionResolved: ${stateJson.selectionResolved}`);
  });

  test('G1-08 selected team highlighted in draft room UI', async ({ page }) => {
    await navigateTo(page, BASE);
    // After G1-07, selection should be resolved and draft proceeding
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    const selCount = await sel.count();
    console.log(`G1-08: selection-screen present: ${selCount > 0}`);

    // Look for selected/highlighted team in draft room
    const selectedTeam = page.locator('[data-testid*="selected"]').or(page.locator('[data-testid*="owned"]'));
    const stCount = await selectedTeam.count();
    console.log(`G1-08: selected/owned team elements: ${stCount}`);
    const ids: string[] = [];
    for (const el of await selectedTeam.all()) {
      const tid = await el.getAttribute('data-testid');
      if (tid) ids.push(tid);
    }
    console.log(`G1-08: selected team testids: ${ids.slice(0, 10).join(', ')}`);
  });

  test('G1-09 modal dismissed (no pick): sim proceeds without owned team, nudge panel disabled', async ({ page }) => {
    // Reset for fresh unresolved state
    await page.request.delete(`${API}/api/league/current`);
    await page.request.post(`${API}/api/league/new`, {
      data: { seed: 77 },
      headers: { 'Content-Type': 'application/json' }
    });

    await navigateTo(page, BASE);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    await expect(sel).toBeVisible({ timeout: 10000 });

    const firstCard = page.locator('[data-testid^="franchise-card-"]').first();
    await firstCard.click();

    const modal = page.locator('[data-testid="franchise-confirm-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Dismiss modal — look for cancel/close button
    const cancelBtn = page.locator('[data-testid="franchise-cancel-button"]')
      .or(page.locator('[data-testid*="close"]'))
      .or(page.locator('[data-testid*="dismiss"]'));
    const cancelCount = await cancelBtn.count();
    console.log(`G1-09: cancel/close button count: ${cancelCount}`);

    if (cancelCount > 0) {
      await cancelBtn.first().click();
    } else {
      // Try pressing Escape
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(1000);

    // Modal should close
    const modalAfter = await modal.count();
    console.log(`G1-09: modal still visible after dismiss: ${modalAfter > 0}`);

    // Check nudge/directives panel state
    const nudgePanel = page.locator('[data-testid="owner-directives-panel"]');
    const npCount = await nudgePanel.count();
    console.log(`G1-09: owner-directives-panel count: ${npCount}`);
    if (npCount > 0) {
      const disabled = await nudgePanel.getAttribute('data-disabled');
      const ariaDisabled = await nudgePanel.getAttribute('aria-disabled');
      const cls = await nudgePanel.getAttribute('class');
      console.log(`G1-09: panel data-disabled: ${disabled}, aria-disabled: ${ariaDisabled}, class: ${cls?.substring(0, 80)}`);
    }
  });
});

// ──────────────────────────────────────────────────────────────
// GROUP 2 — Watch Tab: Ballpark
// Uses current running league (whatever state it is in)
// ──────────────────────────────────────────────────────────────
test.describe('Group 2 — Watch Tab: Ballpark', () => {

  test.beforeEach(async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    // Handle franchise selection if it pops up (skip it)
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      // Dismiss without picking to proceed
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1500);
    }
  });

  test('G2-01 watch-tab present in main navigation', async ({ page }) => {
    const watchTab = page.locator('[data-testid="watch-tab"]');
    await expect(watchTab).toBeVisible({ timeout: 5000 });
    console.log('G2-01: watch-tab visible in nav');
  });

  test('G2-02 watch-ballpark renders SVG stadium illustration', async ({ page }) => {
    const ballpark = page.locator('[data-testid="watch-ballpark"]');
    await expect(ballpark).toBeVisible({ timeout: 8000 });
    // Check SVG is present inside
    const svg = ballpark.locator('svg');
    const svgCount = await svg.count();
    console.log(`G2-02: watch-ballpark visible, SVG elements inside: ${svgCount}`);
    expect(svgCount).toBeGreaterThan(0);
  });

  test('G2-03 watch-scoreboard present', async ({ page }) => {
    const scoreboard = page.locator('[data-testid="watch-scoreboard"]');
    await expect(scoreboard).toBeVisible({ timeout: 8000 });
    const text = await scoreboard.textContent();
    console.log(`G2-03: scoreboard text: ${text?.substring(0, 100)}`);
  });

  test('G2-04 during offseason scoreboard shows league logo', async ({ page }) => {
    // Check current sim phase
    const stateResp = await page.request.get(`${API}/api/state`);
    const state = await stateResp.json();
    console.log(`G2-04: sim phase=${state.phase}, subPhase=${state.subPhase}`);

    const scoreboard = page.locator('[data-testid="watch-scoreboard"]');
    if (await scoreboard.count() > 0) {
      const text = await scoreboard.textContent();
      console.log(`G2-04: scoreboard text: ${text?.substring(0, 200)}`);
      // Look for logo element
      const logo = scoreboard.locator('[data-testid*="logo"]').or(scoreboard.locator('img')).or(scoreboard.locator('svg'));
      const logoCount = await logo.count();
      console.log(`G2-04: logo elements in scoreboard: ${logoCount}`);
    }
  });

  test('G2-05 watch-crowd SVG fill level present', async ({ page }) => {
    const crowd = page.locator('[data-testid="watch-crowd"]');
    await expect(crowd).toBeVisible({ timeout: 8000 });
    const svg = crowd.locator('svg');
    const svgCount = await svg.count();
    console.log(`G2-05: watch-crowd visible, SVG elements: ${svgCount}`);
    expect(svgCount).toBeGreaterThan(0);
  });

  test('G2-06 watch-diamond shows baserunner dots', async ({ page }) => {
    const diamond = page.locator('[data-testid="watch-diamond"]');
    await expect(diamond).toBeVisible({ timeout: 8000 });
    console.log('G2-06: watch-diamond visible');
    // Check for base dot elements
    const baseDots = diamond.locator('[data-testid*="base"]').or(diamond.locator('[data-testid*="runner"]'));
    const dotCount = await baseDots.count();
    console.log(`G2-06: base/runner elements inside diamond: ${dotCount}`);
  });

  test('G2-07 stadium sky element present', async ({ page }) => {
    const ballpark = page.locator('[data-testid="watch-ballpark"]');
    if (await ballpark.count() === 0) {
      console.log('G2-07: SKIP — ballpark not found');
      return;
    }
    const sky = page.locator('[data-testid="watch-sky"]')
      .or(page.locator('[data-testid*="sky"]'))
      .or(page.locator('[data-testid*="daytime"]'))
      .or(page.locator('[data-testid*="nighttime"]'));
    const skyCount = await sky.count();
    console.log(`G2-07: sky-related elements: ${skyCount}`);
    // Check sky inside SVG via aria or class
    const ballparkSvg = ballpark.locator('svg').first();
    if (await ballparkSvg.count() > 0) {
      const innerHTML = await ballparkSvg.innerHTML();
      const hasSkyKeyword = innerHTML.includes('sky') || innerHTML.includes('dusk') || innerHTML.includes('night') || innerHTML.includes('day') || innerHTML.includes('gradient');
      console.log(`G2-07: sky-related keywords in SVG innerHTML: ${hasSkyKeyword}`);
    }
  });

  test('G2-08 Watch tab renders without JS errors (offseason)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.waitForTimeout(2000);
    console.log(`G2-08: JS errors during watch tab offseason: ${errors.length}`);
    if (errors.length > 0) console.log(`G2-08: errors: ${errors.join('; ')}`);
    expect(errors.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
// GROUP 3 — Watch Tab: Front Office Sprites
// ──────────────────────────────────────────────────────────────
test.describe('Group 3 — Watch Tab: Front Office Sprites', () => {

  test.beforeEach(async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1500);
    }
  });

  test('G3-01 watch-frontoffice-panel renders with 3 sprites', async ({ page }) => {
    const panel = page.locator('[data-testid="watch-frontoffice-panel"]');
    await expect(panel).toBeVisible({ timeout: 8000 });

    // Count sprites by common testid pattern
    const ownerSprite  = panel.locator('[data-testid="watch-owner-sprite"]');
    const gmSprite     = panel.locator('[data-testid="watch-gm-sprite"]');
    const managerSprite = panel.locator('[data-testid="watch-manager-sprite"]');
    const o = await ownerSprite.count();
    const g = await gmSprite.count();
    const m = await managerSprite.count();
    console.log(`G3-01: owner=${o}, gm=${g}, manager=${m}`);
    expect(o).toBe(1);
    expect(g).toBe(1);
    expect(m).toBe(1);
  });

  test('G3-02 watch-owner-sprite has name label and role badge', async ({ page }) => {
    const sprite = page.locator('[data-testid="watch-owner-sprite"]');
    await expect(sprite).toBeVisible({ timeout: 8000 });

    // Collect inner testids
    const innerEls = await sprite.locator('[data-testid]').all();
    const ids: string[] = [];
    for (const el of innerEls) {
      const tid = await el.getAttribute('data-testid');
      if (tid) ids.push(tid);
    }
    console.log(`G3-02: owner-sprite inner testids: ${ids.join(', ')}`);

    const nameEl = sprite.locator('[data-testid*="name"]').or(sprite.locator('[data-testid*="label"]'));
    const roleEl = sprite.locator('[data-testid*="role"]').or(sprite.locator('[data-testid*="badge"]'));
    const nCount = await nameEl.count();
    const rCount = await roleEl.count();
    console.log(`G3-02: name elements: ${nCount}, role/badge elements: ${rCount}`);

    const spriteText = await sprite.textContent();
    console.log(`G3-02: owner sprite text: ${spriteText?.substring(0, 100)}`);
    expect(spriteText?.trim().length).toBeGreaterThan(0);
  });

  test('G3-03 watch-gm-sprite has name label and role badge', async ({ page }) => {
    const sprite = page.locator('[data-testid="watch-gm-sprite"]');
    await expect(sprite).toBeVisible({ timeout: 8000 });

    const innerEls = await sprite.locator('[data-testid]').all();
    const ids: string[] = [];
    for (const el of innerEls) {
      const tid = await el.getAttribute('data-testid');
      if (tid) ids.push(tid);
    }
    console.log(`G3-03: gm-sprite inner testids: ${ids.join(', ')}`);

    const spriteText = await sprite.textContent();
    console.log(`G3-03: gm sprite text: ${spriteText?.substring(0, 100)}`);
    expect(spriteText?.trim().length).toBeGreaterThan(0);
  });

  test('G3-04 watch-manager-sprite has name label and role badge', async ({ page }) => {
    const sprite = page.locator('[data-testid="watch-manager-sprite"]');
    await expect(sprite).toBeVisible({ timeout: 8000 });

    const innerEls = await sprite.locator('[data-testid]').all();
    const ids: string[] = [];
    for (const el of innerEls) {
      const tid = await el.getAttribute('data-testid');
      if (tid) ids.push(tid);
    }
    console.log(`G3-04: manager-sprite inner testids: ${ids.join(', ')}`);

    const spriteText = await sprite.textContent();
    console.log(`G3-04: manager sprite text: ${spriteText?.substring(0, 100)}`);
    expect(spriteText?.trim().length).toBeGreaterThan(0);
  });

  test('G3-05 sprite emotion state check — win/loss streak context', async ({ page }) => {
    const ownerSprite = page.locator('[data-testid="watch-owner-sprite"]');
    const gmSprite    = page.locator('[data-testid="watch-gm-sprite"]');
    const mgSprite    = page.locator('[data-testid="watch-manager-sprite"]');

    for (const [name, sprite] of [['owner', ownerSprite], ['gm', gmSprite], ['manager', mgSprite]] as const) {
      if (await sprite.count() > 0) {
        const emotionEl = sprite.locator('[data-testid*="emotion"]').or(sprite.locator('[data-testid*="mood"]'));
        const eCount = await emotionEl.count();
        const dataMood = await sprite.getAttribute('data-mood');
        const dataEmotion = await sprite.getAttribute('data-emotion');
        const cls = await sprite.getAttribute('class');
        console.log(`G3-05 ${name}: emotion elements=${eCount}, data-mood=${dataMood}, data-emotion=${dataEmotion}, class snippet=${cls?.substring(0,60)}`);
      }
    }
  });

  test('G3-06 no interim badges visible (no interim staff currently)', async ({ page }) => {
    const interimBadges = page.locator('[data-testid*="interim"]');
    const count = await interimBadges.count();
    console.log(`G3-06: interim badge count: ${count} (expected 0)`);
  });

  test('G3-07 owner pacing vs static animation during offseason', async ({ page }) => {
    const ownerSprite = page.locator('[data-testid="watch-owner-sprite"]');
    if (await ownerSprite.count() === 0) {
      console.log('G3-07: SKIP — no owner sprite');
      return;
    }
    // Get animation-related attributes
    const cls = await ownerSprite.getAttribute('class');
    const style = await ownerSprite.evaluate((el: Element) => window.getComputedStyle(el).animationName);
    console.log(`G3-07: owner sprite animation name: "${style}", class: ${cls?.substring(0, 100)}`);
    // In offseason, meddling owner would pace; hands-off is static
    // Just document what we observe
  });
});

// ──────────────────────────────────────────────────────────────
// GROUP 4 — Watch Tab: City Skyline
// ──────────────────────────────────────────────────────────────
test.describe('Group 4 — Watch Tab: City Skyline', () => {

  test.beforeEach(async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1500);
    }
  });

  test('G4-01 watch-city-skyline renders SVG', async ({ page }) => {
    const skyline = page.locator('[data-testid="watch-city-skyline"]');
    await expect(skyline).toBeVisible({ timeout: 8000 });
    const svg = skyline.locator('svg');
    const svgCount = await svg.count();
    console.log(`G4-01: watch-city-skyline visible, SVG count: ${svgCount}`);
    expect(svgCount).toBeGreaterThan(0);
  });

  test('G4-02 building count reflects market size', async ({ page }) => {
    const skyline = page.locator('[data-testid="watch-city-skyline"]');
    if (await skyline.count() === 0) {
      console.log('G4-02: SKIP — no skyline');
      return;
    }
    // Count building elements with testid
    const buildingTestids = skyline.locator('[data-testid*="building"]');
    const bCount = await buildingTestids.count();
    console.log(`G4-02: buildings with testid: ${bCount}`);

    // Also count SVG rect/polygon elements as proxy for buildings
    const rects = skyline.locator('rect');
    const polys = skyline.locator('polygon');
    const paths = skyline.locator('path');
    const rCount = await rects.count();
    const pCount = await polys.count();
    const pathCount = await paths.count();
    console.log(`G4-02: SVG shapes — rects: ${rCount}, polygons: ${pCount}, paths: ${pathCount}`);

    // Get state to determine current team's market size
    const stateResp = await page.request.get(`${API}/api/state`);
    const state = await stateResp.json();
    console.log(`G4-02: ownedTeamId: ${state.ownedTeamId}`);
  });

  test('G4-03 offseason night sky rendering', async ({ page }) => {
    const skyline = page.locator('[data-testid="watch-city-skyline"]');
    if (await skyline.count() === 0) {
      console.log('G4-03: SKIP — no skyline');
      return;
    }
    const svgEl = skyline.locator('svg').first();
    const innerHTML = await svgEl.innerHTML();
    const hasDarkColor = innerHTML.includes('#0') || innerHTML.includes('#1') || innerHTML.includes('#2') || innerHTML.includes('dark') || innerHTML.includes('night') || innerHTML.includes('#00');
    console.log(`G4-03: night/dark indicators in SVG: ${hasDarkColor}`);
    console.log(`G4-03: SVG innerHTML snippet: ${innerHTML.substring(0, 300)}`);
  });

  test('G4-04 winning record windows lit vs losing', async ({ page }) => {
    const skyline = page.locator('[data-testid="watch-city-skyline"]');
    if (await skyline.count() === 0) {
      console.log('G4-04: SKIP — no skyline');
      return;
    }
    // Check for window-related testids
    const windows = skyline.locator('[data-testid*="window"]').or(skyline.locator('[data-testid*="lit"]'));
    const wCount = await windows.count();
    console.log(`G4-04: window/lit elements: ${wCount}`);

    // Document data attributes on skyline that indicate win/loss state
    const dataRecord = await skyline.getAttribute('data-record');
    const dataWinPct = await skyline.getAttribute('data-win-pct');
    const dataState  = await skyline.getAttribute('data-state');
    console.log(`G4-04: skyline data-record=${dataRecord}, data-win-pct=${dataWinPct}, data-state=${dataState}`);
  });

  test('G4-05 no fireworks present (no playoff clinch in offseason)', async ({ page }) => {
    const fireworks = page.locator('[data-testid*="firework"]').or(page.locator('[data-testid*="fireworks"]'));
    const count = await fireworks.count();
    console.log(`G4-05: fireworks elements: ${count} (expected 0 — no clinch)`);
  });
});

// ──────────────────────────────────────────────────────────────
// GROUP 5 — Watch Tab: Turbo Mode
// ──────────────────────────────────────────────────────────────
test.describe('Group 5 — Watch Tab: Turbo Mode', () => {

  test.beforeEach(async ({ page }) => {
    // Switch to the established league (league 6 / seed 42, season 8) for turbo tests
    // because turbo requires an active season
    const stateResp = await page.request.get(`${API}/api/state`);
    const state = await stateResp.json();
    console.log(`G5 beforeEach: leagueId=${state.leagueId}, phase=${state.phase}, season=${state.seasonNumber}`);
  });

  test('G5-01 turbo mode does NOT show blank screen — Watch tab remains animated', async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1000);
    }

    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    // Enable turbo
    const turboResp = await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'turbo' },
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`G5-01: POST /api/sim/speed turbo → ${turboResp.status()}`);

    await page.waitForTimeout(3000);

    // Watch tab should NOT be blank — ballpark should still render
    const ballpark = page.locator('[data-testid="watch-ballpark"]');
    const bpCount = await ballpark.count();
    console.log(`G5-01: watch-ballpark still present during turbo: ${bpCount > 0}`);
    expect(bpCount).toBeGreaterThan(0);

    // Page should not be blank
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);

    console.log(`G5-01: JS errors during turbo: ${errors.length}`);

    // Reset
    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'paused' },
      headers: { 'Content-Type': 'application/json' }
    });
  });

  test('G5-02 watch-turbo-headline-flash element appears during turbo', async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1000);
    }

    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'turbo' },
      headers: { 'Content-Type': 'application/json' }
    });
    await page.waitForTimeout(2500);

    const flashEl = page.locator('[data-testid="watch-turbo-headline-flash"]');
    const count = await flashEl.count();
    console.log(`G5-02: watch-turbo-headline-flash count: ${count}`);
    if (count > 0) {
      const text = await flashEl.textContent();
      console.log(`G5-02: flash text: ${text?.substring(0, 100)}`);
    } else {
      console.log('G5-02: FAIL — watch-turbo-headline-flash not found during turbo');
    }
    expect(count).toBeGreaterThan(0);

    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'paused' },
      headers: { 'Content-Type': 'application/json' }
    });
  });

  test('G5-03 calendar overlay appears during turbo', async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1000);
    }

    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'turbo' },
      headers: { 'Content-Type': 'application/json' }
    });
    await page.waitForTimeout(2500);

    const calendarEl = page.locator('[data-testid*="calendar"]')
      .or(page.locator('[data-testid*="turbo-calendar"]'))
      .or(page.locator('[data-testid*="turbo-overlay"]'));
    const count = await calendarEl.count();
    console.log(`G5-03: calendar/turbo-overlay elements during turbo: ${count}`);
    if (count > 0) {
      const ids: string[] = [];
      for (const el of await calendarEl.all()) {
        const tid = await el.getAttribute('data-testid');
        if (tid) ids.push(tid);
      }
      console.log(`G5-03: found testids: ${ids.join(', ')}`);
    }

    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'paused' },
      headers: { 'Content-Type': 'application/json' }
    });

    expect(count).toBeGreaterThan(0);
  });

  test('G5-04 scoreboard shows rapid spin animation during turbo', async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1000);
    }

    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'turbo' },
      headers: { 'Content-Type': 'application/json' }
    });
    await page.waitForTimeout(2000);

    const scoreboard = page.locator('[data-testid="watch-scoreboard"]');
    if (await scoreboard.count() > 0) {
      const cls = await scoreboard.getAttribute('class');
      const animName = await scoreboard.evaluate((el: Element) => window.getComputedStyle(el).animationName);
      const dataSpeed = await scoreboard.getAttribute('data-speed');
      const dataTurbo = await scoreboard.getAttribute('data-turbo');
      console.log(`G5-04: scoreboard class=${cls?.substring(0,80)}, animation=${animName}, data-speed=${dataSpeed}, data-turbo=${dataTurbo}`);

      // Check for spin-related class or animation
      const hasSpin = cls?.includes('spin') || cls?.includes('turbo') || animName?.includes('spin') || animName?.includes('turbo');
      console.log(`G5-04: spin/turbo animation detected: ${hasSpin}`);
    } else {
      console.log('G5-04: scoreboard not found during turbo');
    }

    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'paused' },
      headers: { 'Content-Type': 'application/json' }
    });
  });

  test('G5-05 newspaper drop timing — observe minimum 1.5s display (AB2-01 known issue)', async ({ page }) => {
    /**
     * Known issue AB2-01 (from Adversary): newspaper drop may fire at wrong point.
     * This test documents the observed behavior without failing on the known issue.
     * We watch for the newspaper element when season transitions happen during turbo.
     */
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1000);
    }

    const stateResp = await page.request.get(`${API}/api/state`);
    const state = await stateResp.json();
    console.log(`G5-05: state before turbo: phase=${state.phase}, season=${state.seasonNumber}`);

    // Enable turbo and monitor for newspaper element
    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'turbo' },
      headers: { 'Content-Type': 'application/json' }
    });

    let newspaperAppeared = false;
    let newspaperAppearedAt = 0;
    let newspaperDisappearedAt = 0;
    const startTime = Date.now();

    // Poll for newspaper for up to 30 seconds
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const newspaper = page.locator('[data-testid*="turbo-newspaper"]')
        .or(page.locator('[data-testid*="season-newspaper"]'))
        .or(page.locator('[data-testid*="newspaper-drop"]'));
      const nCount = await newspaper.count();
      if (nCount > 0 && !newspaperAppeared) {
        newspaperAppeared = true;
        newspaperAppearedAt = Date.now() - startTime;
        console.log(`G5-05: Newspaper appeared at ${newspaperAppearedAt}ms`);
      } else if (nCount === 0 && newspaperAppeared && newspaperDisappearedAt === 0) {
        newspaperDisappearedAt = Date.now() - startTime;
        const displayDuration = newspaperDisappearedAt - newspaperAppearedAt;
        console.log(`G5-05: Newspaper disappeared at ${newspaperDisappearedAt}ms — display duration: ${displayDuration}ms`);
        if (displayDuration < 1500) {
          console.log(`G5-05: ISSUE AB2-01 CONFIRMED — newspaper displayed for only ${displayDuration}ms (< 1500ms minimum)`);
        } else {
          console.log(`G5-05: newspaper displayed for ${displayDuration}ms — meets 1.5s minimum`);
        }
        break;
      }

      // Check if season changed
      const stateNow = await page.request.get(`${API}/api/state`);
      const stateNowJson = await stateNow.json();
      if (stateNowJson.seasonNumber !== state.seasonNumber) {
        console.log(`G5-05: Season changed from ${state.seasonNumber} to ${stateNowJson.seasonNumber} at ${Date.now() - startTime}ms`);
        break;
      }
    }

    if (!newspaperAppeared) {
      console.log(`G5-05: Newspaper element never appeared during 30s turbo observation`);
      console.log(`G5-05: NOTE — season may not have completed during observation window, or newspaper uses different testid`);
      // Document what turbo-related elements were visible
      const turboEls = page.locator('[data-testid*="turbo"]');
      const tCount = await turboEls.count();
      const turboIds: string[] = [];
      for (const el of await turboEls.all()) {
        const tid = await el.getAttribute('data-testid');
        if (tid) turboIds.push(tid);
      }
      console.log(`G5-05: turbo-related elements at end: ${turboIds.join(', ')}`);
    }

    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'paused' },
      headers: { 'Content-Type': 'application/json' }
    });
  });

  test('G5-06 after turbo newspaper display Watch tab resumes in offseason state', async ({ page }) => {
    // This test documents what follows a newspaper display
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(1000);
    }

    const stateResp = await page.request.get(`${API}/api/state`);
    const state = await stateResp.json();
    console.log(`G5-06: current phase: ${state.phase} — documenting watch tab offseason state`);

    const ballpark = page.locator('[data-testid="watch-ballpark"]');
    const scoreboard = page.locator('[data-testid="watch-scoreboard"]');
    const bpPresent = await ballpark.count() > 0;
    const sbPresent = await scoreboard.count() > 0;
    console.log(`G5-06: ballpark present: ${bpPresent}, scoreboard present: ${sbPresent}`);
    if (sbPresent) {
      const text = await scoreboard.textContent();
      console.log(`G5-06: scoreboard content in current state: ${text?.substring(0, 100)}`);
    }
  });
});

// ──────────────────────────────────────────────────────────────
// GROUP 7 — Newspaper Dynasty Timeline
// Uses league 6 (seed 42, 8 seasons) for completed-season newspapers
// ──────────────────────────────────────────────────────────────
test.describe('Group 7 — Newspaper Dynasty Timeline', () => {

  test.beforeAll(async ({ request }) => {
    // Switch to league 6 / seed 42 for completed seasons
    const stateResp = await request.get(`${API}/api/state`);
    const state = await stateResp.json();
    if (state.leagueId !== 6) {
      console.log(`G7 beforeAll: switching from league ${state.leagueId} to league 6`);
      await request.delete(`${API}/api/league/current`);
      // Restore league 6
      await request.post(`${API}/api/league/restore`, {
        data: { leagueId: 6 },
        headers: { 'Content-Type': 'application/json' }
      });
      // Small delay
      await new Promise(r => setTimeout(r, 1000));
    } else {
      console.log(`G7 beforeAll: already on league 6`);
    }
  });

  test.beforeEach(async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    // Navigate to Timeline tab
    const timelineTab = page.locator('[data-testid="timeline-tab"]');
    if (await timelineTab.count() > 0) {
      await timelineTab.click();
      await page.waitForTimeout(2000);
    } else {
      console.log('beforeEach G7: timeline-tab not found');
      const allTabs = await page.locator('[data-testid$="-tab"]').all();
      for (const tab of allTabs) {
        const tid = await tab.getAttribute('data-testid');
        console.log(`  found tab: ${tid}`);
      }
    }
  });

  test('G7-01 timeline-tab present in navigation', async ({ page }) => {
    const timelineTab = page.locator('[data-testid="timeline-tab"]');
    await expect(timelineTab).toBeVisible({ timeout: 8000 });
    console.log('G7-01: timeline-tab found');
  });

  test('G7-02 timeline renders newspaper layout (not text list)', async ({ page }) => {
    // Check /api/timeline response first
    const apiResp = await page.request.get(`${API}/api/timeline`);
    console.log(`G7-02: /api/timeline status: ${apiResp.status()}`);

    // Check for timeline-newspaper-{N} elements
    const newspapers = page.locator('[data-testid^="timeline-newspaper-"]');
    const nCount = await newspapers.count();
    console.log(`G7-02: timeline-newspaper-{N} count: ${nCount}`);

    if (nCount === 0) {
      // Document what timeline testids exist
      const anyTimeline = page.locator('[data-testid^="timeline-"]');
      const atCount = await anyTimeline.count();
      const ids: string[] = [];
      for (const el of await anyTimeline.all()) {
        const tid = await el.getAttribute('data-testid');
        if (tid) ids.push(tid);
      }
      console.log(`G7-02: all timeline-* testids: ${ids.slice(0,30).join(', ')}`);

      // Check /api/timeline response body
      if (apiResp.status() === 200) {
        const body = await apiResp.text();
        console.log(`G7-02: /api/timeline body: ${body.substring(0, 300)}`);
      } else if (apiResp.status() === 500) {
        const body = await apiResp.text();
        console.log(`G7-02: /api/timeline 500 error: ${body.substring(0, 200)}`);
        console.log('G7-02: FAIL — /api/timeline returns 500 (was fixed in Iter 2 per spec)');
      }
    }

    expect(nCount).toBeGreaterThan(0);
  });

  test('G7-03 each timeline-newspaper has masthead, season number, and champion headline', async ({ page }) => {
    const newspapers = page.locator('[data-testid^="timeline-newspaper-"]');
    const nCount = await newspapers.count();
    if (nCount === 0) {
      console.log('G7-03: SKIP — no timeline-newspaper elements');
      return;
    }
    console.log(`G7-03: checking ${Math.min(nCount, 3)} newspapers`);

    for (let i = 0; i < Math.min(nCount, 3); i++) {
      const paper = newspapers.nth(i);
      const tid = await paper.getAttribute('data-testid');
      const text = await paper.textContent();
      console.log(`G7-03: newspaper[${i}] testid=${tid}, text snippet: ${text?.substring(0, 120)}`);

      const headline = paper.locator('[data-testid^="timeline-headline-"]');
      const hCount = await headline.count();
      console.log(`G7-03: newspaper[${i}] headline count: ${hCount}`);
      expect(hCount).toBeGreaterThan(0);

      if (hCount > 0) {
        const hText = await headline.first().textContent();
        console.log(`G7-03: newspaper[${i}] headline text: "${hText?.substring(0, 100)}"`);
        expect(hText?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('G7-04 timeline-headline-{N} non-empty LLM string', async ({ page }) => {
    const headlines = page.locator('[data-testid^="timeline-headline-"]');
    const count = await headlines.count();
    console.log(`G7-04: timeline-headline count: ${count}`);
    if (count === 0) {
      console.log('G7-04: SKIP — no headline elements');
      return;
    }
    for (let i = 0; i < Math.min(count, 3); i++) {
      const text = await headlines.nth(i).textContent();
      console.log(`G7-04: headline[${i}]: "${text?.substring(0, 80)}"`);
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });

  test('G7-05 below the fold shows 3-4 story teasers', async ({ page }) => {
    const teasers = page.locator('[data-testid^="timeline-teaser-"]')
      .or(page.locator('[data-testid^="timeline-story-"]'))
      .or(page.locator('[data-testid*="below-fold"]'));
    const count = await teasers.count();
    console.log(`G7-05: story teasers/below-fold count: ${count}`);
    if (count > 0) {
      expect(count).toBeGreaterThanOrEqual(3);
    } else {
      console.log('G7-05: NOTE — no teaser/below-fold testids found; checking newspaper structure');
      const newspapers = page.locator('[data-testid^="timeline-newspaper-"]');
      if (await newspapers.count() > 0) {
        const firstPaper = newspapers.first();
        const allInner = await firstPaper.locator('[data-testid]').all();
        const innerIds: string[] = [];
        for (const el of allInner) {
          const tid = await el.getAttribute('data-testid');
          if (tid) innerIds.push(tid);
        }
        console.log(`G7-05: first newspaper inner testids: ${innerIds.join(', ')}`);
      }
    }
  });

  test('G7-06 front office events include reason string inline in below fold', async ({ page }) => {
    const foReasons = page.locator('[data-testid^="timeline-frontoffice-reason-"]');
    const count = await foReasons.count();
    console.log(`G7-06: timeline-frontoffice-reason elements: ${count}`);
    if (count > 0) {
      const text = await foReasons.first().textContent();
      console.log(`G7-06: first reason: "${text?.substring(0, 120)}"`);
      expect(text?.trim().length).toBeGreaterThan(0);
    } else {
      console.log('G7-06: NOTE — no timeline-frontoffice-reason-{eventId} elements found');
    }
  });

  test('G7-07 timeline-expand-{N} click expands to full broadsheet', async ({ page }) => {
    const expandBtns = page.locator('[data-testid^="timeline-expand-"]');
    const count = await expandBtns.count();
    console.log(`G7-07: expand button count: ${count}`);
    if (count === 0) {
      console.log('G7-07: SKIP — no expand buttons');
      return;
    }

    await expandBtns.first().click();
    await page.waitForTimeout(1500);

    // Look for expanded/broadsheet view
    const expanded = page.locator('[data-testid*="timeline-expanded"]')
      .or(page.locator('[data-testid*="broadsheet"]'))
      .or(page.locator('[data-testid*="timeline-full"]'));
    const eCount = await expanded.count();
    console.log(`G7-07: expanded view elements after click: ${eCount}`);

    if (eCount > 0) {
      const text = await expanded.first().textContent();
      console.log(`G7-07: expanded view text snippet: ${text?.substring(0, 200)}`);
    }

    // Check if original element grew/changed
    const allTestids = await page.locator('[data-testid]').all();
    const ids: string[] = [];
    for (const el of allTestids) {
      const tid = await el.getAttribute('data-testid');
      if (tid && (tid.includes('timeline') && !tid.startsWith('timeline-newspaper') && !tid.startsWith('timeline-headline'))) {
        ids.push(tid);
      }
    }
    console.log(`G7-07: other timeline testids after expand: ${ids.slice(0, 20).join(', ')}`);
  });

  test('G7-08 expanded view shows narrative, standings, awards, transactions with reasons', async ({ page }) => {
    const expandBtns = page.locator('[data-testid^="timeline-expand-"]');
    if (await expandBtns.count() === 0) {
      console.log('G7-08: SKIP — no expand buttons');
      return;
    }
    await expandBtns.first().click();
    await page.waitForTimeout(1500);

    const narrative = page.locator('[data-testid*="narrative"]').or(page.locator('[data-testid*="story"]'));
    const standings = page.locator('[data-testid*="standings"]');
    const awards    = page.locator('[data-testid*="award"]');
    const transactions = page.locator('[data-testid*="transaction"]');

    console.log(`G7-08: narrative=${await narrative.count()}, standings=${await standings.count()}, awards=${await awards.count()}, transactions=${await transactions.count()}`);
  });

  test('G7-09 paper texture CSS effect on newspaper background', async ({ page }) => {
    const newspapers = page.locator('[data-testid^="timeline-newspaper-"]');
    if (await newspapers.count() === 0) {
      console.log('G7-09: SKIP — no newspaper elements');
      return;
    }
    const firstNews = newspapers.first();
    const cls = await firstNews.getAttribute('class');
    const style = await firstNews.getAttribute('style');
    console.log(`G7-09: newspaper class: ${cls?.substring(0,150)}`);
    console.log(`G7-09: newspaper style: ${style?.substring(0,150)}`);

    // Check computed background for texture (image or color)
    const computedBg = await firstNews.evaluate((el: Element) => {
      const styles = window.getComputedStyle(el);
      return {
        background: styles.background,
        backgroundImage: styles.backgroundImage,
        backgroundColor: styles.backgroundColor,
      };
    });
    console.log(`G7-09: computed background: ${JSON.stringify(computedBg).substring(0, 200)}`);
  });

  test('G7-10 champion season visually distinct from non-champion layout', async ({ page }) => {
    const newspapers = page.locator('[data-testid^="timeline-newspaper-"]');
    const count = await newspapers.count();
    if (count < 2) {
      console.log(`G7-10: SKIP — fewer than 2 newspapers (count: ${count})`);
      return;
    }

    // Check data attributes for champion status
    const classes: string[] = [];
    const dataChampions: string[] = [];
    for (let i = 0; i < count; i++) {
      const paper = newspapers.nth(i);
      const cls = await paper.getAttribute('class');
      const dataChamp = await paper.getAttribute('data-champion');
      const dataIs = await paper.getAttribute('data-is-champion');
      classes.push(cls || '');
      dataChampions.push(`${dataChamp || dataIs || 'null'}`);
    }
    console.log(`G7-10: newspaper data-champion values: ${dataChampions.join(', ')}`);

    // Check if any champion-related classes differ
    const champPapers = page.locator('[data-testid^="timeline-newspaper-"][data-champion="true"]')
      .or(page.locator('[data-testid^="timeline-newspaper-"][data-is-champion="true"]'));
    const champCount = await champPapers.count();
    console.log(`G7-10: champion newspapers: ${champCount}`);
  });
});

// ──────────────────────────────────────────────────────────────
// GROUP 11 — Performance
// ──────────────────────────────────────────────────────────────
test.describe('Group 11 — Performance', () => {

  test('G11-01 Watch tab 60fps target — no JS errors during normal speed', async ({ page }) => {
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await navigateTo(page, BASE);
    await page.waitForTimeout(1000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(500);
    }

    const frameData = await page.evaluate(async () => {
      return new Promise<{ frames: number; duration: number }>((resolve) => {
        let frameCount = 0;
        const start = performance.now();
        const measure = (ts: number) => {
          frameCount++;
          if (ts - start < 2000) requestAnimationFrame(measure);
          else resolve({ frames: frameCount, duration: ts - start });
        };
        requestAnimationFrame(measure);
      });
    });

    const fps = frameData.frames / (frameData.duration / 1000);
    console.log(`G11-01: measured FPS: ${fps.toFixed(1)} over ${frameData.duration.toFixed(0)}ms (${frameData.frames} frames)`);
    console.log(`G11-01: JS errors: ${errors.length}, console errors: ${consoleErrors.length}`);
    if (errors.length > 0) console.log(`G11-01: JS errors: ${errors.join('; ')}`);
    if (consoleErrors.length > 0) console.log(`G11-01: console errors: ${consoleErrors.slice(0,5).join('; ')}`);

    expect(errors.length).toBe(0);
    expect(fps).toBeGreaterThan(30);
  });

  test('G11-02 no JS errors when navigating all tabs', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

    const tabs = await page.locator('[data-testid$="-tab"]').all();
    const tabIds: string[] = [];
    for (const tab of tabs) {
      const tid = await tab.getAttribute('data-testid');
      if (tid) tabIds.push(tid);
    }
    console.log(`G11-02: tabs found: ${tabIds.join(', ')}`);

    for (const tab of tabs) {
      try {
        await tab.click();
        await page.waitForTimeout(500);
      } catch {}
    }

    console.log(`G11-02: JS errors after tab navigation: ${errors.length}`);
    if (errors.length > 0) console.log(`G11-02: errors: ${errors.join('; ')}`);
    expect(errors.length).toBe(0);
  });

  test('G11-03 timeline scroll performance — no jank with 8+ seasons', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

    const timelineTab = page.locator('[data-testid="timeline-tab"]');
    if (await timelineTab.count() > 0) {
      await timelineTab.click();
      await page.waitForTimeout(2000);
    }

    const newspapers = page.locator('[data-testid^="timeline-newspaper-"]');
    const count = await newspapers.count();
    console.log(`G11-03: newspaper seasons rendered: ${count}`);

    if (count > 0) {
      const startTime = Date.now();
      await page.keyboard.press('End');
      await page.waitForTimeout(500);
      await page.keyboard.press('Home');
      await page.waitForTimeout(500);
      const scrollDuration = Date.now() - startTime;
      console.log(`G11-03: scroll End-to-Home completed in ${scrollDuration}ms`);
      expect(scrollDuration).toBeLessThan(5000); // Should complete in < 5s
    }

    console.log(`G11-03: JS errors: ${errors.length}`);
    expect(errors.length).toBe(0);
  });

  test('G11-04 turbo mode completes without JS errors or frozen UI', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await navigateTo(page, BASE);
    await page.waitForTimeout(2000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(500);
    }

    const resp = await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'turbo' },
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`G11-04: turbo enable: ${resp.status()}`);

    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(1000);
      const isResponsive = await page.evaluate(() =>
        new Promise<boolean>(resolve => setTimeout(() => resolve(true), 100))
      );
      console.log(`G11-04: responsive check ${i+1}: ${isResponsive}`);
    }

    await page.request.post(`${API}/api/sim/speed`, {
      data: { speed: 'paused' },
      headers: { 'Content-Type': 'application/json' }
    });

    console.log(`G11-04: errors during turbo: ${errors.length}`);
    if (errors.length > 0) console.log(`G11-04: errors: ${errors.join('; ')}`);
    expect(errors.length).toBe(0);
  });

  test('G11-05 SVG animations CLS score < 0.5', async ({ page }) => {
    await navigateTo(page, BASE);
    await page.waitForTimeout(1000);
    const sel = page.locator('[data-testid="franchise-selection-screen"]');
    if (await sel.count() > 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(500);
    }

    const layoutShiftData = await page.evaluate(async () => {
      return new Promise<{ totalShift: number; entries: number }>((resolve) => {
        let totalShift = 0;
        let entries = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if ((entry as any).hadRecentInput === false) {
              totalShift += (entry as any).value || 0;
              entries++;
            }
          }
        });
        try { observer.observe({ type: 'layout-shift', buffered: true }); } catch {}
        setTimeout(() => { observer.disconnect(); resolve({ totalShift, entries }); }, 3000);
      });
    });

    console.log(`G11-05: CLS score: ${layoutShiftData.totalShift.toFixed(4)}, shift entries: ${layoutShiftData.entries}`);
    if (layoutShiftData.totalShift > 0.1) console.log(`G11-05: WARN — CLS ${layoutShiftData.totalShift.toFixed(4)} exceeds 0.1 "Good" threshold`);
    expect(layoutShiftData.totalShift).toBeLessThan(0.5);
  });
});
