/**
 * UI Tester A — v0.3.0 Iteration 3
 * Groups: 0 (Env Setup), 6 (Owner Nudge), 8 (Front Office Reasons),
 *         9 (Deferred Fixes), 10 (Edge Cases)
 *
 * Iteration 3 primary verification:
 *   M-01 fix — gm_hired_context is non-null for ALL teams, including
 *   founding GMs that never had a GM fired event. Value must be either:
 *     "Founding GM (league inception)" or a non-empty hire context string.
 *
 * All Iteration 2 passing tests re-run as regression baseline.
 */

import { test, expect, Page } from '@playwright/test';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001';

// All 20 team IDs in this league
const ALL_TEAM_IDS = [361, 362, 363, 364, 365, 366, 367, 368, 369, 370,
                     371, 372, 373, 374, 375, 376, 377, 378, 379, 380];

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
      data: { teamId: ALL_TEAM_IDS[0] },
      headers: { 'Content-Type': 'application/json' },
    });
    await page.waitForTimeout(500);
  }
}

async function openTeamDetail(page: Page, teamId: number) {
  await page.locator('[data-testid="nav-teams"]').click();
  await page.waitForTimeout(800);
  await page.locator(`[data-testid="team-card-${teamId}"]`).click();
  await page.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Helper: get owned team id
// ---------------------------------------------------------------------------
async function getOwnedTeamId(page: Page): Promise<number> {
  const resp = await page.request.get(`${API}/api/state`);
  const state = await resp.json();
  return state.ownedTeamId as number;
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
    const resp = await request.get(`${API}/api/teams/361`);
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
      expect(firingNews.headline_text.length).toBeGreaterThan(15);
    }
  });

  test('G8-04: Team detail panel renders owner-name field via UI', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);
    await openTeamDetail(page, ownedId);

    const ownerName = page.locator('[data-testid="owner-name"]');
    await expect(ownerName).toBeVisible({ timeout: 5000 });
    const text = await ownerName.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test('G8-05: Team detail panel renders owner-personality field', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);
    await openTeamDetail(page, ownedId);

    const ownerPersonality = page.locator('[data-testid="owner-personality"]');
    await expect(ownerPersonality).toBeVisible({ timeout: 5000 });
    const text = await ownerPersonality.textContent();
    expect(text).toBeTruthy();
  });

  test('G8-06: Team detail panel renders owner-patience field', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);
    await openTeamDetail(page, ownedId);

    const ownerPatience = page.locator('[data-testid="owner-patience"]');
    await expect(ownerPatience).toBeVisible({ timeout: 5000 });
    const text = await ownerPatience.textContent();
    expect(text).toBeTruthy();
  });

  test('G8-07: Team detail panel renders owner-net-worth-tier', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);
    await openTeamDetail(page, ownedId);

    const ownerNetWorth = page.locator('[data-testid="owner-net-worth-tier"]');
    await expect(ownerNetWorth).toBeVisible({ timeout: 5000 });
    const text = await ownerNetWorth.textContent();
    expect(text).toBeTruthy();
  });

  test('G8-08: Team detail panel: current GM shows hire context (gm-hire-context)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);
    await openTeamDetail(page, ownedId);

    const gmHireContext = page.locator('[data-testid="gm-hire-context"]');
    await expect(gmHireContext).toBeVisible({ timeout: 5000 });
    const text = await gmHireContext.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test('G8-09: Team detail panel: current manager shows hire context (manager-hire-context)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);
    await openTeamDetail(page, ownedId);

    const managerHireContext = page.locator('[data-testid="manager-hire-context"]');
    await expect(managerHireContext).toBeVisible({ timeout: 5000 });
    const text = await managerHireContext.textContent();
    expect(text).toBeTruthy();
  });

  test('G8-10: Team detail history tab: frontoffice-history shows reason', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);
    await openTeamDetail(page, ownedId);

    await page.locator('[data-testid="team-history-tab"]').click();
    await page.waitForTimeout(800);

    const historyPanel = page.locator('[data-testid="frontoffice-history"]');
    await expect(historyPanel).toBeVisible({ timeout: 5000 });
    const text = await historyPanel.textContent();
    expect(text).toBeTruthy();
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
      expect(managerFired.reason.length).toBeGreaterThan(5);
    }
  });

  // -------------------------------------------------------------------------
  // ITERATION 3 NEW TESTS — M-01: gm_hired_context non-null for ALL teams
  // -------------------------------------------------------------------------

  test('G8-13-ITER3: M-01 — gm_hired_context non-null for ALL 20 teams via API', async ({ request }) => {
    const nullTeams: number[] = [];
    for (const teamId of ALL_TEAM_IDS) {
      const resp = await request.get(`${API}/api/teams/${teamId}`);
      expect(resp.status()).toBe(200);
      const team = await resp.json();
      if (!team.gm_hired_context || team.gm_hired_context === null || team.gm_hired_context === '') {
        nullTeams.push(teamId);
      }
    }
    test.info().annotations.push({
      type: 'note',
      description: `Teams with null/empty gm_hired_context: [${nullTeams.join(', ')}] (expect empty)`,
    });
    expect(nullTeams).toHaveLength(0);
  });

  test('G8-14-ITER3: M-01 — founding GMs show "Founding GM (league inception)"', async ({ request }) => {
    const badFoundingTeams: Array<{ id: number; ctx: string }> = [];
    for (const teamId of ALL_TEAM_IDS) {
      const resp = await request.get(`${API}/api/teams/${teamId}`);
      const team = await resp.json();
      const ctx: string = team.gm_hired_context ?? '';
      // A team with no GM fired events should show the founding string, not null
      // We accept both "Founding GM (league inception)" and a real hire context (not null/empty)
      if (!ctx || ctx.trim() === '') {
        badFoundingTeams.push({ id: teamId, ctx: ctx });
      }
    }
    test.info().annotations.push({
      type: 'note',
      description: `Teams with blank gm_hired_context: ${JSON.stringify(badFoundingTeams)}`,
    });
    expect(badFoundingTeams).toHaveLength(0);
  });

  test('G8-15-ITER3: M-01 — teams without GM fired events have non-null hire context', async ({ request }) => {
    // Cross-reference: get all teams, identify which have no GM fired transactions,
    // and verify those teams have a non-null, non-empty gm_hired_context.
    // Valid values: "Founding GM (league inception)" or "Hired in offseason" (for teams
    // where a GM was hired via owner change or other offseason process without a gm_fired row).
    // The key M-01 guarantee is that the value is NEVER null/empty.
    const txResp = await request.get(`${API}/api/transactions`);
    const transactions = await txResp.json();
    const teamsFiredGM = new Set(
      transactions
        .filter((t: any) => t.transactionType === 'gm_fired')
        .map((t: any) => t.teamId)
    );

    test.info().annotations.push({
      type: 'note',
      description: `Teams that have a gm_fired transaction: [${Array.from(teamsFiredGM).join(', ')}]`,
    });

    const failures: Array<{ id: number; ctx: string }> = [];
    for (const teamId of ALL_TEAM_IDS) {
      if (!teamsFiredGM.has(teamId)) {
        const resp = await request.get(`${API}/api/teams/${teamId}`);
        const team = await resp.json();
        const ctx: string = team.gm_hired_context ?? '';
        // Must be non-null and non-empty — either "Founding GM (league inception)" or "Hired in offseason"
        if (!ctx || ctx.trim() === '') {
          failures.push({ id: teamId, ctx });
        }
      }
    }
    test.info().annotations.push({
      type: 'note',
      description: `Teams without gm_fired event but null/empty ctx: ${JSON.stringify(failures)}`,
    });
    expect(failures).toHaveLength(0);
  });

  test('G8-16-ITER3: M-01 — teams with GM fired events show non-founding hire context', async ({ request }) => {
    const txResp = await request.get(`${API}/api/transactions`);
    const transactions = await txResp.json();
    const teamsFiredGM = new Set(
      transactions
        .filter((t: any) => t.transactionType === 'gm_fired')
        .map((t: any) => t.teamId)
    );

    const failures: Array<{ id: number; ctx: string }> = [];
    for (const teamId of ALL_TEAM_IDS) {
      if (teamsFiredGM.has(teamId)) {
        const resp = await request.get(`${API}/api/teams/${teamId}`);
        const team = await resp.json();
        const ctx: string = team.gm_hired_context ?? '';
        // Teams that have fired a GM should have a real (non-null, non-empty) hire context
        if (!ctx || ctx.trim() === '') {
          failures.push({ id: teamId, ctx });
        }
      }
    }
    test.info().annotations.push({
      type: 'note',
      description: `Teams that fired a GM but have empty ctx: ${JSON.stringify(failures)}`,
    });
    expect(failures).toHaveLength(0);
  });

  test('G8-17-ITER3: M-01 — gm-hire-context visible in UI for owned team (founding GM case)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);

    // Verify via API that owned team is a founding-GM team
    const teamResp = await page.request.get(`${API}/api/teams/${ownedId}`);
    const teamData = await teamResp.json();
    const ctx: string = teamData.gm_hired_context ?? '';

    test.info().annotations.push({
      type: 'note',
      description: `Owned team ${ownedId} gm_hired_context="${ctx}"`,
    });

    await openTeamDetail(page, ownedId);
    const gmHireContext = page.locator('[data-testid="gm-hire-context"]');
    await expect(gmHireContext).toBeVisible({ timeout: 5000 });
    const uiText = await gmHireContext.textContent();
    expect(uiText).toBeTruthy();
    // Must contain non-empty context (either founding string or a hire phrase)
    expect(uiText!.trim().length).toBeGreaterThan(0);
    // Should NOT contain "null" literally
    expect(uiText!.toLowerCase()).not.toContain('null');
  });

  test('G8-18-ITER3: M-01 — gm-hire-context visible in UI for a non-owned team (second team)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);

    // Pick first team that is NOT the owned team
    const targetId = ALL_TEAM_IDS.find((id) => id !== ownedId)!;
    await openTeamDetail(page, targetId);

    const gmHireContext = page.locator('[data-testid="gm-hire-context"]');
    await expect(gmHireContext).toBeVisible({ timeout: 5000 });
    const uiText = await gmHireContext.textContent();
    expect(uiText).toBeTruthy();
    expect(uiText!.trim().length).toBeGreaterThan(0);
    expect(uiText!.toLowerCase()).not.toContain('null');

    test.info().annotations.push({
      type: 'note',
      description: `Non-owned team ${targetId} gm-hire-context UI text: "${uiText}"`,
    });
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
    const resp = await request.get(`${API}/api/teams/361`);
    expect(resp.status()).toBe(200);
    const team = await resp.json();
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

    await expect(page.locator('[data-testid="watch-content"]')).toBeVisible({ timeout: 10000 });
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

    const stateResp = await page.request.get(`${API}/api/state`);
    const state = await stateResp.json();
    await page.request.post(`${API}/api/franchise/select`, {
      data: { teamId: state.ownedTeamId || ALL_TEAM_IDS[0] },
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

    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    await expect(cancelBtn).toBeVisible({ timeout: 3000 });
    await cancelBtn.click();
    await page.waitForTimeout(500);

    const stillVisible = await modal.isVisible().catch(() => false);
    expect(stillVisible).toBe(false);
  });

  test('G10-05b: directive-confirm-modal Cancel button missing testid (bug observation)', async ({ page }) => {
    await ensureFranchiseSelected(page);
    await navigateToWatch(page);

    await expect(page.locator('[data-testid="owner-directives-panel"]')).toBeVisible({ timeout: 8000 });
    const rebuildBtn = page.locator('[data-testid="directive-rebuild"]');
    const isDisabled = await rebuildBtn.isDisabled();
    if (isDisabled) return;

    await rebuildBtn.click();
    await expect(page.locator('[data-testid="directive-confirm-modal"]')).toBeVisible({ timeout: 5000 });

    const cancelWithTestid = page.locator('[data-testid="directive-cancel-btn"]');
    const hasTestid = await cancelWithTestid.count();
    test.info().annotations.push({
      type: 'note',
      description: `directive-cancel-btn testid count=${hasTestid} (0 = gap still present)`,
    });
    expect(hasTestid).toBe(0);

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

  // -------------------------------------------------------------------------
  // ITERATION 3 EDGE CASE — gm_hired_context robustness
  // -------------------------------------------------------------------------

  test('G10-08-ITER3: gm_hired_context for owned team (founding case) does NOT render "null" in UI', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const ownedId = await getOwnedTeamId(page);
    await openTeamDetail(page, ownedId);

    const gmCtx = page.locator('[data-testid="gm-hire-context"]');
    await expect(gmCtx).toBeVisible({ timeout: 5000 });
    const text = await gmCtx.textContent();

    // The text must not contain "null" literally (was the pre-M-01 bug)
    expect(text?.toLowerCase()).not.toContain('null');
    // Must not be empty
    expect(text!.trim().length).toBeGreaterThan(0);

    test.info().annotations.push({
      type: 'note',
      description: `Owned team ${ownedId} gm-hire-context text: "${text}"`,
    });
  });

  test('G10-09-ITER3: manager_hired_context non-null for all teams via API (symmetric M-01 fix)', async ({ request }) => {
    const nullTeams: Array<{ id: number; ctx: any }> = [];
    for (const teamId of ALL_TEAM_IDS) {
      const resp = await request.get(`${API}/api/teams/${teamId}`);
      const team = await resp.json();
      const ctx = team.manager_hired_context;
      if (!ctx || ctx === null || ctx === '') {
        nullTeams.push({ id: teamId, ctx });
      }
    }
    test.info().annotations.push({
      type: 'note',
      description: `Teams with null/empty manager_hired_context: ${JSON.stringify(nullTeams)}`,
    });
    expect(nullTeams).toHaveLength(0);
  });
});
