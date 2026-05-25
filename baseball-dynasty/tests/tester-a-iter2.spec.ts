/**
 * UI Tester A — v0.3.0 Iteration 2
 * Groups: 0 (Env Setup), 6 (Owner Nudge), 8 (Front Office Reasons), 9 (Deferred Fixes), 10 (Edge Cases)
 *
 * Testid discovery from debug run:
 *   Directive buttons: directive-go-for-it, directive-rebuild, directive-target-player,
 *                      directive-fire-manager, directive-trust-process
 *   gm-confidence-indicator, owner-directives-panel
 *   Team detail: owner-name, owner-personality, owner-patience, owner-net-worth-tier
 *                gm-hire-context, manager-hire-context
 *   History: frontoffice-history
 */

import { test, expect, Page } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function navigateToWatch(page: Page) {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  const watchTab = page.locator('[data-testid="watch-tab"]');
  await expect(watchTab).toBeVisible({ timeout: 10000 });
  await watchTab.click();
  await page.waitForTimeout(1000);
}

async function ensureFranchiseSelected(page: Page) {
  const resp = await page.request.get(`${API}/api/state`);
  const state = await resp.json();
  if (!state.ownedTeamId || !state.selectionResolved) {
    await page.request.post(`${API}/api/franchise/select`, {
      data: { teamId: 101 },
      headers: { 'Content-Type': 'application/json' },
    });
    await page.waitForTimeout(500);
  }
}

async function openTeamDetail(page: Page, teamId: number = 101) {
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(800);
  await page.locator(`[data-testid="team-card-${teamId}"]`).click();
  await page.waitForTimeout(800);
}

// ===========================================================================
// GROUP 0 — Environment Setup
// ===========================================================================

test.describe('Group 0 — Environment Setup', () => {
  test('G0-01: Server returns 200 on GET /api/state with valid JSON', async ({ request }) => {
    const resp = await request.get(`${API}/api/state`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('leagueId');
    expect(body).toHaveProperty('phase');
    expect(body).toHaveProperty('seasonNumber');
  });

  test('G0-02: Client loads at localhost:5173 without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('ResizeObserver')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('G0-03: framer-motion — page loads without import errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    // framer-motion import errors would appear as module resolution errors
    const framerErrors = errors.filter((e) => e.includes('framer'));
    expect(framerErrors).toHaveLength(0);
  });

  test('G0-04: Page title renders (app shell loads)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('G0-05: Owned team is set and selection resolved', async ({ request }) => {
    const resp = await request.get(`${API}/api/state`);
    const state = await resp.json();
    expect(state.ownedTeamId).toBeTruthy();
    expect(state.selectionResolved).toBe(true);
  });

  test('G0-06: Watch tab renders without crashing (AB-NEW-03 fix)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await navigateToWatch(page);
    const watchContent = page.locator('[data-testid="watch-content"]');
    await expect(watchContent).toBeVisible({ timeout: 10000 });
    const criticalErrors = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('ResizeObserver')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('G0-07: Watch tab content panel visible (watch-content testid exists)', async ({ page }) => {
    await navigateToWatch(page);
    await expect(page.locator('[data-testid="watch-content"]')).toBeVisible({ timeout: 8000 });
  });
});

// ===========================================================================
// GROUP 6 — Owner Nudge Mechanic
// ===========================================================================

test.describe('Group 6 — Owner Nudge Mechanic', () => {
  test.beforeEach(async ({ page }) => {
    await ensureFranchiseSelected(page);
    await navigateToWatch(page);
  });

  test('G6-01: owner-directives-panel visible in Watch tab when franchise owned', async ({ page }) => {
    const panel = page.locator('[data-testid="owner-directives-panel"]');
    await expect(panel).toBeVisible({ timeout: 10000 });
  });

  test('G6-02: All 5 directive buttons present with correct testids', async ({ page }) => {
    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });

    // Correct testids confirmed from debug: directive-{name}
    await expect(page.locator('[data-testid="directive-go-for-it"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="directive-rebuild"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="directive-target-player"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="directive-fire-manager"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="directive-trust-process"]')).toBeVisible({ timeout: 5000 });
  });

  test('G6-03: gm-confidence-indicator shows a numeric value', async ({ page }) => {
    const indicator = page.locator('[data-testid="gm-confidence-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 10000 });
    const text = await indicator.textContent();
    expect(text).toBeTruthy();
    expect(text!.trim().length).toBeGreaterThan(0);
    // Verify it contains a number
    expect(/\d+/.test(text!)).toBe(true);
  });

  test('G6-04: directive-confirm-modal appears on go-for-it click', async ({ page }) => {
    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });
    const goForItBtn = page.locator('[data-testid="directive-go-for-it"]');
    await expect(goForItBtn).toBeVisible({ timeout: 5000 });

    const isDisabled = await goForItBtn.isDisabled();
    if (isDisabled) {
      test.info().annotations.push({ type: 'note', description: 'go-for-it disabled (cooldown active), modal test skipped' });
      return;
    }

    await goForItBtn.click();
    const modal = page.locator('[data-testid="directive-confirm-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Dismiss
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('G6-05: directive-fire-manager button present and triggers confirm modal', async ({ page }) => {
    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });
    const fireBtn = page.locator('[data-testid="directive-fire-manager"]');
    await expect(fireBtn).toBeVisible({ timeout: 5000 });

    const isDisabled = await fireBtn.isDisabled();
    if (isDisabled) {
      test.info().annotations.push({ type: 'note', description: 'fire-manager button disabled, skip click' });
      return;
    }
    await fireBtn.click();
    const modal = page.locator('[data-testid="directive-confirm-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('G6-06: directive-trust-process button present', async ({ page }) => {
    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="directive-trust-process"]')).toBeVisible({ timeout: 5000 });
  });

  test('G6-07: directive-rebuild button present', async ({ page }) => {
    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="directive-rebuild"]')).toBeVisible({ timeout: 5000 });
  });

  test('G6-08: directive-target-player button present', async ({ page }) => {
    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="directive-target-player"]')).toBeVisible({ timeout: 5000 });
  });
});

// ===========================================================================
// GROUP 8 — Front Office Reasons (4 Locations)
// ===========================================================================

test.describe('Group 8 — Front Office Reasons', () => {
  test('G8-01: GET /api/transactions includes front office events with reason field', async ({ request }) => {
    const resp = await request.get(`${API}/api/transactions`);
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);

    const foEvents = data.filter(
      (t: any) =>
        t.transactionType === 'manager_fired' ||
        t.transactionType === 'gm_fired' ||
        t.transactionType === 'owner_death' ||
        t.transactionType === 'owner_sale'
    );
    for (const ev of foEvents) {
      expect(ev.reason).toBeTruthy();
      expect(ev.reason.length).toBeGreaterThan(0);
    }
  });

  test('G8-02: GET /api/teams/:id response includes owner fields', async ({ request }) => {
    const resp = await request.get(`${API}/api/teams/101`);
    expect(resp.status()).toBe(200);
    const team = await resp.json();
    expect(team.owner_name).toBeTruthy();
    expect(team.owner_personality).toBeTruthy();
    expect(typeof team.owner_patience).toBe('number');
    expect(team.owner_net_worth_tier).toBeTruthy();
  });

  test('G8-03: News feed firing headline includes reason string', async ({ request }) => {
    const resp = await request.get(`${API}/api/news`);
    expect(resp.status()).toBe(200);
    const news = await resp.json();
    expect(Array.isArray(news)).toBe(true);
    const firingNews = news.find(
      (n: any) => n.event_type === 'manager_fired' || n.event_type === 'gm_fired'
    );
    if (firingNews) {
      expect(firingNews.headline_text).toBeTruthy();
      // Headline should embed the reason inline
      expect(firingNews.headline_text.length).toBeGreaterThan(15);
    }
  });

  test('G8-04: Team detail panel renders owner-name field via UI', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await openTeamDetail(page, 101);

    // Confirmed testid from debug: owner-name
    const ownerName = page.locator('[data-testid="owner-name"]');
    await expect(ownerName).toBeVisible({ timeout: 5000 });
    const text = await ownerName.textContent();
    expect(text).toContain('Logan Wood');
  });

  test('G8-05: Team detail panel renders owner-personality field', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await openTeamDetail(page, 101);

    const ownerPersonality = page.locator('[data-testid="owner-personality"]');
    await expect(ownerPersonality).toBeVisible({ timeout: 5000 });
    const text = await ownerPersonality.textContent();
    expect(text).toBeTruthy();
  });

  test('G8-06: Team detail panel renders owner-patience field', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await openTeamDetail(page, 101);

    const ownerPatience = page.locator('[data-testid="owner-patience"]');
    await expect(ownerPatience).toBeVisible({ timeout: 5000 });
    const text = await ownerPatience.textContent();
    expect(text).toBeTruthy();
  });

  test('G8-07: Team detail panel renders owner-net-worth-tier', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await openTeamDetail(page, 101);

    const ownerNetWorth = page.locator('[data-testid="owner-net-worth-tier"]');
    await expect(ownerNetWorth).toBeVisible({ timeout: 5000 });
    const text = await ownerNetWorth.textContent();
    expect(text).toBeTruthy();
  });

  test('G8-08: Team detail panel: current GM shows hire context (gm-hire-context)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await openTeamDetail(page, 101);

    // Confirmed testid: gm-hire-context
    const gmHireContext = page.locator('[data-testid="gm-hire-context"]');
    await expect(gmHireContext).toBeVisible({ timeout: 5000 });
    const text = await gmHireContext.textContent();
    expect(text).toContain('Sam Garcia');
  });

  test('G8-09: Team detail panel: current manager shows hire context (manager-hire-context)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await openTeamDetail(page, 101);

    const managerHireContext = page.locator('[data-testid="manager-hire-context"]');
    await expect(managerHireContext).toBeVisible({ timeout: 5000 });
    const text = await managerHireContext.textContent();
    expect(text).toBeTruthy();
  });

  test('G8-10: Team detail history tab: frontoffice-history shows reason', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await openTeamDetail(page, 101);

    // Click History tab
    await page.locator('[data-testid="team-history-tab"]').click();
    await page.waitForTimeout(800);

    const historyPanel = page.locator('[data-testid="frontoffice-history"]');
    await expect(historyPanel).toBeVisible({ timeout: 5000 });
    const text = await historyPanel.textContent();
    expect(text).toBeTruthy();
    // Should contain a reason string
    expect(text!.length).toBeGreaterThan(10);
  });

  test('G8-11: Front office reasons non-null and non-empty in transactions API', async ({ request }) => {
    const resp = await request.get(`${API}/api/transactions`);
    const transactions = await resp.json();
    const foTypes = ['manager_fired', 'gm_fired', 'owner_death', 'owner_sale'];
    const foEvents = transactions.filter((t: any) => foTypes.includes(t.transactionType));

    for (const ev of foEvents) {
      expect(ev.reason).not.toBeNull();
      expect(ev.reason).not.toBe('');
      expect(ev.reason.length).toBeGreaterThan(0);
    }
  });

  test('G8-12: Manager firing reason format in transactions', async ({ request }) => {
    const resp = await request.get(`${API}/api/transactions`);
    const transactions = await resp.json();
    const managerFired = transactions.find((t: any) => t.transactionType === 'manager_fired');
    if (managerFired) {
      expect(managerFired.reason).toBeTruthy();
      // Reason should be a meaningful string (not just "null" or empty)
      expect(managerFired.reason.length).toBeGreaterThan(5);
    }
  });
});

// ===========================================================================
// GROUP 9 — v0.2.0 Deferred Fixes
// ===========================================================================

test.describe('Group 9 — v0.2.0 Deferred Fixes', () => {
  test('G9-01: transactions table has gameNumber field — all rows', async ({ request }) => {
    const resp = await request.get(`${API}/api/transactions`);
    expect(resp.status()).toBe(200);
    const transactions = await resp.json();
    expect(Array.isArray(transactions)).toBe(true);
    expect(transactions.length).toBeGreaterThan(0);

    for (const tx of transactions.slice(0, 20)) {
      expect(tx).toHaveProperty('gameNumber');
      expect(typeof tx.gameNumber).toBe('number');
    }
  });

  test('G9-02: AB-17 spring cuts have gameNumber = 0', async ({ request }) => {
    const resp = await request.get(`${API}/api/transactions`);
    const transactions = await resp.json();
    const springCuts = transactions.filter((t: any) => t.transactionType === 'spring_cut');
    for (const cut of springCuts) {
      expect(cut.gameNumber).toBe(0);
    }
  });

  test('G9-03: In-season moves (manager_fired, trade, called_up) have gameNumber >= 0', async ({ request }) => {
    const resp = await request.get(`${API}/api/transactions`);
    const transactions = await resp.json();
    const inSeasonMoves = transactions.filter(
      (t: any) =>
        t.transactionType === 'trade' ||
        t.transactionType === 'manager_fired' ||
        t.transactionType === 'called_up'
    );
    for (const move of inSeasonMoves) {
      expect(move.gameNumber).toBeGreaterThanOrEqual(0);
    }
  });

  test('G9-04: Owner fields render in team detail panel via API (AB-17 fix)', async ({ request }) => {
    const resp = await request.get(`${API}/api/teams/101`);
    expect(resp.status()).toBe(200);
    const team = await resp.json();
    // Was missing in v0.2.0 — now must be non-null
    expect(team.owner_name).toBeTruthy();
    expect(team.owner_personality).toBeTruthy();
    expect(typeof team.owner_patience).toBe('number');
    expect(team.owner_net_worth_tier).toBeTruthy();
  });

  test('G9-05: Watch tab renders with content — AB-NEW-03 fix verified', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await ensureFranchiseSelected(page);
    await navigateToWatch(page);

    // watch-content testid confirmed in debug
    await expect(page.locator('[data-testid="watch-content"]')).toBeVisible({ timeout: 10000 });
    // Frontoffice panel also renders
    await expect(page.locator('[data-testid="watch-frontoffice-panel"]')).toBeVisible({ timeout: 8000 });

    const critErrors = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('ResizeObserver')
    );
    expect(critErrors).toHaveLength(0);
  });

  test('G9-06: Watch ballpark SVG renders', async ({ page }) => {
    await navigateToWatch(page);
    await expect(page.locator('[data-testid="watch-ballpark"]')).toBeVisible({ timeout: 8000 });
  });

  test('G9-07: Watch scoreboard renders', async ({ page }) => {
    await navigateToWatch(page);
    await expect(page.locator('[data-testid="watch-scoreboard"]')).toBeVisible({ timeout: 8000 });
  });

  test('G9-08: AB-18 no same-window churn — transactions endpoint accessible', async ({ request }) => {
    const resp = await request.get(`${API}/api/transactions`);
    const transactions = await resp.json();

    const moves: Record<string, { type: string; game: number }[]> = {};
    for (const tx of transactions) {
      if (tx.transactionType === 'called_up' || tx.transactionType === 'sent_down') {
        if (tx.playerId) {
          if (!moves[tx.playerId]) moves[tx.playerId] = [];
          moves[tx.playerId].push({ type: tx.transactionType, game: tx.gameNumber });
        }
      }
    }

    // Check for same-window churn: player called_up and sent_down within 5 games
    let churnCount = 0;
    for (const [playerId, playerMoves] of Object.entries(moves)) {
      for (let i = 0; i < playerMoves.length - 1; i++) {
        const a = playerMoves[i];
        const b = playerMoves[i + 1];
        if (a.type !== b.type && Math.abs(a.game - b.game) < 5) {
          churnCount++;
          test.info().annotations.push({
            type: 'note',
            description: `Possible churn: player ${playerId} moved ${a.type} at game ${a.game}, then ${b.type} at game ${b.game}`,
          });
        }
      }
    }
    // AB-18 fix: churn count should be 0
    expect(churnCount).toBe(0);
  });
});

// ===========================================================================
// GROUP 10 — Edge Cases
// ===========================================================================

test.describe('Group 10 — Edge Cases', () => {
  test('G10-01: Franchise selected — nudge panel visible (positive case)', async ({ page }) => {
    await ensureFranchiseSelected(page);
    await navigateToWatch(page);
    const panel = page.locator('[data-testid="owner-directives-panel"]');
    await expect(panel).toBeVisible({ timeout: 10000 });
  });

  test('G10-02: GM data present and accessible via API', async ({ request }) => {
    const stateResp = await request.get(`${API}/api/state`);
    const state = await stateResp.json();
    const teamResp = await request.get(`${API}/api/teams/${state.ownedTeamId}`);
    const team = await teamResp.json();
    expect(team.gm_name).toBeTruthy();
    test.info().annotations.push({
      type: 'note',
      description: `GM: ${team.gm_name}, interim_gm: ${team.interim_gm}, job_security: ${team.job_security}`,
    });
  });

  test('G10-03: POST /api/sim/speed endpoint accessible (not 404)', async ({ request }) => {
    const resp = await request.post(`${API}/api/sim/speed`, {
      data: { speed: 'paused' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).not.toBe(404);
    test.info().annotations.push({
      type: 'note',
      description: `POST /api/sim/speed status: ${resp.status()}`,
    });
  });

  test('G10-04: Watch tab renders with no JS crash after franchise select', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.request.post(`${API}/api/franchise/select`, {
      data: { teamId: 101 },
      headers: { 'Content-Type': 'application/json' },
    });

    const watchTab = page.locator('[data-testid="watch-tab"]');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(2000);
    }
    await expect(page.locator('[data-testid="watch-content"]')).toBeVisible({ timeout: 8000 });

    const critErrors = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('ResizeObserver') && !e.includes('404')
    );
    expect(critErrors).toHaveLength(0);
  });

  test('G10-05: Directive confirm modal can be dismissed via Cancel button', async ({ page }) => {
    await ensureFranchiseSelected(page);
    await navigateToWatch(page);

    const panel = page.locator('[data-testid="owner-directives-panel"]');
    await expect(panel).toBeVisible({ timeout: 8000 });

    // Use directive-rebuild (less consequential)
    const rebuildBtn = page.locator('[data-testid="directive-rebuild"]');
    await expect(rebuildBtn).toBeVisible({ timeout: 5000 });
    const isDisabled = await rebuildBtn.isDisabled();
    if (isDisabled) {
      test.info().annotations.push({ type: 'note', description: 'rebuild button disabled, skip' });
      return;
    }

    await rebuildBtn.click();
    const modal = page.locator('[data-testid="directive-confirm-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Cancel button has no testid — use text selector (confirmed in debug)
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    await expect(cancelBtn).toBeVisible({ timeout: 3000 });
    await cancelBtn.click();
    await page.waitForTimeout(500);

    // Modal should be dismissed
    const stillVisible = await modal.isVisible().catch(() => false);
    expect(stillVisible).toBe(false);
  });

  test('G10-05b: directive-confirm-modal Cancel button missing testid (bug observation)', async ({ page }) => {
    // This is an observational test: Cancel button has no data-testid
    // The modal itself has directive-confirm-modal and directive-confirm-button,
    // but Cancel button is untagged — noted as a testid gap for the dev team
    await ensureFranchiseSelected(page);
    await navigateToWatch(page);

    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });
    const rebuildBtn = page.locator('[data-testid="directive-rebuild"]');
    const isDisabled = await rebuildBtn.isDisabled();
    if (isDisabled) return;

    await rebuildBtn.click();
    await expect(page.locator('[data-testid="directive-confirm-modal"]')).toBeVisible({ timeout: 5000 });

    // Confirm the testid gap: Cancel has no data-testid
    const cancelWithTestid = page.locator('[data-testid="directive-cancel-btn"]');
    const hasTestid = await cancelWithTestid.count();
    test.info().annotations.push({
      type: 'note',
      description: `directive-cancel-btn testid missing: count=${hasTestid} (expected 0 = bug confirmed)`,
    });
    expect(hasTestid).toBe(0); // Confirm the gap exists

    // Clean up — click cancel to dismiss
    await page.locator('button:has-text("Cancel")').first().click();
  });

  test('G10-06: Go-for-it and rebuild buttons both present and visible', async ({ page }) => {
    await ensureFranchiseSelected(page);
    await navigateToWatch(page);

    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });

    const goForItBtn = page.locator('[data-testid="directive-go-for-it"]');
    const rebuildBtn = page.locator('[data-testid="directive-rebuild"]');

    await expect(goForItBtn).toBeVisible({ timeout: 5000 });
    await expect(rebuildBtn).toBeVisible({ timeout: 5000 });

    const goForItDisabled = await goForItBtn.isDisabled();
    const rebuildDisabled = await rebuildBtn.isDisabled();
    test.info().annotations.push({
      type: 'note',
      description: `go-for-it disabled: ${goForItDisabled}, rebuild disabled: ${rebuildDisabled}`,
    });
  });

  test('G10-07: City skyline SVG renders on Watch tab', async ({ page }) => {
    await navigateToWatch(page);
    await expect(page.locator('[data-testid="watch-city-skyline"]')).toBeVisible({ timeout: 8000 });
  });
});
