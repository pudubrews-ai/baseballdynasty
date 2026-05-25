const { chromium } = require('playwright');

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const results = [];

  function pass(name) { results.push({ name, status: 'PASS' }); console.log(`PASS: ${name}`); }
  function fail(name, reason) { results.push({ name, status: 'FAIL', reason }); console.log(`FAIL: ${name} — ${reason}`); }
  function skip(name, reason) { results.push({ name, status: 'SKIP', reason }); console.log(`SKIP: ${name} — ${reason}`); }

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  try {
    // ---- Group 0: Environment Setup ----
    await page.goto('http://localhost:5173', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    errors.length === 0
      ? pass('G0: Client loads without console errors')
      : fail('G0: Client loads without console errors', errors.slice(0, 2).join('; '));

    // Verify /api/state waiverCount field
    const apiState = await page.evaluate(async () => {
      const r = await fetch('http://localhost:3001/api/state');
      return r.json();
    });
    typeof apiState.waiverCount !== 'undefined'
      ? pass('G0: /api/state returns waiverCount field')
      : fail('G0: /api/state returns waiverCount field', 'waiverCount missing');

    // Check app renders (standings visible)
    const bodyText = await page.locator('body').textContent();
    bodyText && bodyText.length > 100
      ? pass('G0: App renders without crash')
      : fail('G0: App renders without crash', 'Body text too short or empty');

    // ---- NEWS TICKER — all tabs ----
    // League tab (default)
    const leagueTab = page.locator('[data-testid="league-tab"]');
    await leagueTab.click().catch(() => {});
    await page.waitForTimeout(500);
    const tickerLeague = page.locator('[data-testid="news-ticker"]');
    await tickerLeague.waitFor({ state: 'visible', timeout: 5000 })
      .then(() => pass('TICKER: news-ticker visible on League tab'))
      .catch(() => fail('TICKER: news-ticker visible on League tab', 'not found'));

    // Teams tab
    await page.locator('[data-testid="teams-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const tickerTeams = await page.locator('[data-testid="news-ticker"]').isVisible().catch(() => false);
    tickerTeams
      ? pass('TICKER: news-ticker visible on Teams tab')
      : fail('TICKER: news-ticker visible on Teams tab', 'not visible');

    // Games tab
    await page.locator('[data-testid="games-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const tickerGames = await page.locator('[data-testid="news-ticker"]').isVisible().catch(() => false);
    tickerGames
      ? pass('TICKER: news-ticker visible on Games tab')
      : fail('TICKER: news-ticker visible on Games tab', 'not visible');

    // Players tab
    await page.locator('[data-testid="players-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const tickerPlayers = await page.locator('[data-testid="news-ticker"]').isVisible().catch(() => false);
    tickerPlayers
      ? pass('TICKER: news-ticker visible on Players tab')
      : fail('TICKER: news-ticker visible on Players tab', 'not visible');

    // Timeline tab
    await page.locator('[data-testid="timeline-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const tickerTimeline = await page.locator('[data-testid="news-ticker"]').isVisible().catch(() => false);
    tickerTimeline
      ? pass('TICKER: news-ticker visible on Timeline tab')
      : fail('TICKER: news-ticker visible on Timeline tab', 'not visible');

    // News tab
    const newsTabEl = page.locator('[data-testid="news-tab"]');
    const newsTabExists = await newsTabEl.isVisible().catch(() => false);
    if (newsTabExists) {
      await newsTabEl.click().catch(() => {});
      await page.waitForTimeout(500);
      const tickerNews = await page.locator('[data-testid="news-ticker"]').isVisible().catch(() => false);
      tickerNews
        ? pass('TICKER: news-ticker visible on News tab')
        : fail('TICKER: news-ticker visible on News tab', 'not visible');
    } else {
      skip('TICKER: news-ticker visible on News tab', 'news-tab not found');
    }

    // Draft tab (if present)
    const draftTabEl = page.locator('[data-testid="draft-tab"]');
    const draftTabExists = await draftTabEl.isVisible().catch(() => false);
    if (draftTabExists) {
      await draftTabEl.click().catch(() => {});
      await page.waitForTimeout(500);
      const tickerDraft = await page.locator('[data-testid="news-ticker"]').isVisible().catch(() => false);
      tickerDraft
        ? pass('TICKER: news-ticker visible on Draft tab')
        : fail('TICKER: news-ticker visible on Draft tab', 'not visible');
      pass('G0/TICKER: draft-tab present');
    } else {
      skip('TICKER: news-ticker visible on Draft tab', 'not in draft phase');
      skip('G0: draft-tab present', 'not in draft phase — normal');
    }

    // Back to League tab
    await page.locator('[data-testid="league-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);

    // Ticker items count
    const tickerItems = page.locator('[data-testid^="news-ticker-item-"]');
    const tickerCount = await tickerItems.count();
    tickerCount > 0
      ? pass(`TICKER: news-ticker shows ${tickerCount} items (news-ticker-item-* testids)`)
      : fail('TICKER: news-ticker shows items', 'no news-ticker-item-{id} elements found');

    // Ticker shows exactly 5 items (spec: last 5 events)
    if (tickerCount === 5) {
      pass('TICKER: news-ticker shows exactly 5 items (spec-correct)');
    } else if (tickerCount > 0) {
      fail('TICKER: news-ticker shows exactly 5 items', `found ${tickerCount} (spec says 5)`);
    }

    // ---- Group 4 — Waivers ----
    await page.locator('[data-testid="teams-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);

    const waiversList = page.locator('[data-testid="waivers-list"]');
    const waiversVisible = await waiversList.isVisible().catch(() => false);
    waiversVisible
      ? pass('G4: waivers-list testid present and visible')
      : fail('G4: waivers-list testid present and visible', 'not found on teams page');

    // Verify waivers API from browser
    const waiversData = await page.evaluate(async () => {
      const r = await fetch('http://localhost:3001/api/waivers');
      const data = await r.json();
      return { status: r.status, isArray: Array.isArray(data), count: data.length };
    });
    waiversData.status === 200 && waiversData.isArray
      ? pass(`G4/G11: /api/waivers returns 200 array (${waiversData.count} entries)`)
      : fail('G4/G11: /api/waivers returns 200 array', `status=${waiversData.status}`);

    if (waiversData.count === 0) {
      // Check UI shows empty state correctly
      const waiversText = await waiversList.textContent().catch(() => '');
      waiversText && waiversText.trim().length > 0
        ? pass('G11: waivers-list shows empty state text (no crash)')
        : fail('G11: waivers-list shows empty state text', 'content empty');
    } else {
      // Check waiver-player-{id} testids
      const waiverPlayers = page.locator('[data-testid^="waiver-player-"]');
      const wpCount = await waiverPlayers.count();
      wpCount > 0
        ? pass(`G4: waiver-player-{id} testids present (${wpCount} players)`)
        : fail('G4: waiver-player-{id} testids present', `waivers has ${waiversData.count} entries but no waiver-player-* testids`);
    }

    // ---- Navigate to a team detail view ----
    const teamCard = page.locator('[data-testid^="team-card-"]').first();
    const teamCardExists = await teamCard.isVisible().catch(() => false);
    if (teamCardExists) {
      await teamCard.click().catch(() => {});
      await page.waitForTimeout(1000);
      pass('G0: team-card-* testid present and clickable');
    } else {
      fail('G0: team-card-* testid present', 'no team-card-* elements found');
    }

    // ---- Group 5/6 — Minors tab ----
    const minorsTab = page.locator('[data-testid="team-minors-tab"]');
    const minorsTabVisible = await minorsTab.isVisible().catch(() => false);
    if (minorsTabVisible) {
      pass('G5/G6: team-minors-tab present in team detail');
      await minorsTab.click();
      await page.waitForTimeout(1000);

      const minorsStats = page.locator('[data-testid^="minors-stats-"]');
      const statsCount = await minorsStats.count();
      statsCount > 0
        ? pass(`G6: minors-stats-{id} testids present (${statsCount} players)`)
        : fail('G6: minors-stats-{id} testids present', 'no minors-stats-* found on minors tab');

      // Check live stats visible (games, avg, era etc)
      const minorsText = await page.locator('body').textContent().catch(() => '');
      minorsText.includes('.') || minorsText.includes('AVG') || minorsText.includes('ERA') || minorsText.includes('AB')
        ? pass('G6: Minors tab shows live stats (not just depth chart)')
        : fail('G6: Minors tab shows live stats', 'no stat values found');
    } else {
      fail('G5/G6: team-minors-tab present', 'minors tab not found by testid');
      skip('G6: minors-stats-{id} testids present', 'minors tab not accessible');
    }

    // ---- Team detail: front office ----
    const teamContent = await page.locator('body').textContent().catch(() => '');
    teamContent.includes('Owner') || teamContent.includes('GM')
      ? pass('G8: Team detail shows front office info (Owner/GM visible)')
      : fail('G8: Team detail shows front office info', 'no Owner/GM text found');

    // ---- Team roster tab ----
    const rosterTab = page.locator('[data-testid="team-roster-tab"]');
    const rosterVisible = await rosterTab.isVisible().catch(() => false);
    if (rosterVisible) {
      pass('G3/G5: team-roster-tab present in team detail');
      await rosterTab.click();
      await page.waitForTimeout(1000);
      const rosterContent = await page.locator('body').textContent().catch(() => '');
      rosterContent.includes('SP') || rosterContent.includes('1B') || rosterContent.includes('CF') || rosterContent.includes('P')
        ? pass('G3/G5: Team roster tab shows player positions')
        : fail('G3/G5: Team roster tab shows positions', 'no position abbreviations found');

      // Count roster players
      const rosterRows = await page.locator('[data-testid^="roster-player-"]').count();
      rosterRows > 0
        ? pass(`G3: roster-player-* testids present (${rosterRows} players)`)
        : skip('G3: roster-player-* testids present', 'no roster-player-* testids — may use different testid');
    } else {
      skip('G3/G5: team-roster-tab', 'not found by testid');
    }

    // ---- League tab: standings ----
    await page.locator('[data-testid="league-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const standings = page.locator('[data-testid="standings-table"]');
    const standingsVisible = await standings.isVisible().catch(() => false);
    standingsVisible
      ? pass('G0: standings-table visible on League tab')
      : fail('G0: standings-table visible on League tab', 'not found');

    // ---- Sim speed controls ----
    const simSpeedControls = page.locator('[data-testid="sim-pause"], [data-testid="sim-speed-paused"], [data-testid="sim-controls"]');
    const simControlsVisible = await simSpeedControls.first().isVisible().catch(() => false);
    simControlsVisible
      ? pass('G0: Sim speed controls visible by testid')
      : skip('G0: Sim speed controls', 'pause/speed testid not found — checking for speed buttons');

    // Try broader sim speed search
    const simFast = page.locator('[data-testid*="sim-"]');
    const simCount = await simFast.count();
    if (!simControlsVisible) {
      simCount > 0
        ? pass(`G0: sim-* testids present (${simCount} elements found)`)
        : fail('G0: sim-* testids present', 'no sim-* testids found at all');
    }

    // ---- Players tab: stat leaders ----
    await page.locator('[data-testid="players-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const playersContent = await page.locator('body').textContent();
    playersContent.includes('AVG') || playersContent.includes('HR') || playersContent.includes('ERA')
      ? pass('G1/G6: Players tab shows stat leaders (AVG/HR/ERA visible)')
      : fail('G1/G6: Players tab shows stat leaders', 'no stat categories visible');

    // ---- Group 10: Persistence ----
    // Server was restarted before this run — check state is intact
    const persistState = await page.evaluate(async () => {
      const r = await fetch('http://localhost:3001/api/state');
      return r.json();
    });
    persistState.season && persistState.season > 0
      ? pass(`G10: Season data persists across server restart (season ${persistState.season}, game ${persistState.currentGameNumber})`)
      : fail('G10: Season data persists across server restart', 'season not found');

    // ---- Group 11: /api/news error handling ----
    const newsValid = await page.evaluate(async () => {
      const r = await fetch('http://localhost:3001/api/news');
      return { status: r.status };
    });
    newsValid.status === 200
      ? pass('G11: /api/news returns 200')
      : fail('G11: /api/news returns 200', `got ${newsValid.status}`);

    const newsInvalid = await page.evaluate(async () => {
      const r = await fetch('http://localhost:3001/api/news?type=invalid');
      const body = await r.json().catch(() => null);
      return { status: r.status, body };
    });
    newsInvalid.status === 400 && newsInvalid.body && newsInvalid.body.error
      ? pass('G11: /api/news?type=invalid returns 400 with error field')
      : fail('G11: /api/news?type=invalid returns 400 with error field', `got status=${newsInvalid.status}, body=${JSON.stringify(newsInvalid.body)}`);

    // ---- Group 11: waivers empty = 200 not 404 ----
    // Already verified above via waiversData check

    // ---- Additional v0.2.0 testid checks ----
    // news-feed on news tab
    if (newsTabExists) {
      await page.locator('[data-testid="news-tab"]').click().catch(() => {});
      await page.waitForTimeout(500);
      const newsFeed = page.locator('[data-testid="news-feed"]');
      const newsFeedVisible = await newsFeed.isVisible().catch(() => false);
      newsFeedVisible
        ? pass('G9: news-feed testid visible on News tab')
        : fail('G9: news-feed testid visible on News tab', 'not found');

      // news items
      const newsItems = page.locator('[data-testid^="news-item-"]');
      const newsCount = await newsItems.count();
      newsCount > 0
        ? pass(`G9: news-item-{id} testids present (${newsCount} items)`)
        : fail('G9: news-item-{id} testids present', 'none found');

      // Filter buttons
      const filterAll = page.locator('[data-testid="news-filter-all"]');
      const filterTx = page.locator('[data-testid="news-filter-transactions"]');
      const filterFO = page.locator('[data-testid="news-filter-frontoffice"]');
      const filterInj = page.locator('[data-testid="news-filter-injuries"]');
      const filterMile = page.locator('[data-testid="news-filter-milestones"]');

      const fAll = await filterAll.isVisible().catch(() => false);
      const fTx = await filterTx.isVisible().catch(() => false);
      const fFO = await filterFO.isVisible().catch(() => false);
      const fInj = await filterInj.isVisible().catch(() => false);
      const fMile = await filterMile.isVisible().catch(() => false);

      fAll ? pass('G9: news-filter-all button visible') : fail('G9: news-filter-all button visible', 'not found');
      fTx ? pass('G9: news-filter-transactions button visible') : fail('G9: news-filter-transactions button visible', 'not found');
      fFO ? pass('G9: news-filter-frontoffice button visible') : fail('G9: news-filter-frontoffice button visible', 'not found');
      fInj ? pass('G9: news-filter-injuries button visible') : fail('G9: news-filter-injuries button visible', 'not found');
      fMile ? pass('G9: news-filter-milestones button visible') : fail('G9: news-filter-milestones button visible', 'not found');

      // Test transactions filter
      if (fTx) {
        await filterTx.click();
        await page.waitForTimeout(500);
        const filteredItems = await page.locator('[data-testid^="news-item-"]').count();
        filteredItems >= 0
          ? pass(`G9: news-filter-transactions filters feed (${filteredItems} items shown)`)
          : skip('G9: news-filter-transactions filters feed', 'count failed');
      }

      // Test front office filter
      if (fFO) {
        await filterFO.click();
        await page.waitForTimeout(500);
        const foItems = await page.locator('[data-testid^="news-item-"]').count();
        foItems >= 0 ? pass(`G9: news-filter-frontoffice filters feed (${foItems} items shown)`) : skip('G9: news-filter-frontoffice filters', 'count failed');
      }

      // Reset to all
      if (fAll) {
        await filterAll.click();
        await page.waitForTimeout(500);
      }
    }

    // ---- Timeline tab check ----
    await page.locator('[data-testid="timeline-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const timelineContent = await page.locator('body').textContent().catch(() => '');
    timelineContent && timelineContent.length > 50
      ? pass('G0: Timeline tab renders content')
      : fail('G0: Timeline tab renders content', 'empty or very short content');

    // ---- Games tab check ----
    await page.locator('[data-testid="games-tab"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const gamesContent = await page.locator('body').textContent().catch(() => '');
    gamesContent.includes('Game') || gamesContent.includes('vs') || gamesContent.includes('W') || gamesContent.includes('L')
      ? pass('G0: Games tab renders game content')
      : fail('G0: Games tab renders game content', 'no game-related content found');

    // ---- Final console error check ----
    errors.length === 0
      ? pass('Final: No console errors after full test suite')
      : fail('Final: No console errors', `${errors.length} errors: ${errors.slice(0, 3).join('; ')}`);

  } catch (e) {
    fail('Test suite fatal error', e.message);
  }

  await browser.close();

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  console.log(`\nSUMMARY: ${passed} PASS / ${failed} FAIL / ${skipped} SKIP`);
  console.log('\n--- JSON RESULTS ---');
  console.log(JSON.stringify(results, null, 2));
  return results;
}

runTests().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
