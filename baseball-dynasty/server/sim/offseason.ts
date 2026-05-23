// Offseason module — stepwise with checkpointing via D26
// Steps: retirement → development → free_agency → front_office → annual_draft → done

import { getDb, prepared, type LeagueRow, type TeamRow, type PlayerRow } from '../db.js';
import { seedFor, randInt, randNormal } from './prng.js';
import { runAnnualDraft } from './draft.js';
import { callSeasonNarrative } from '../services/llm.js';

const GM_PHILOSOPHIES: Array<'win-now' | 'rebuild' | 'balanced'> = ['win-now', 'rebuild', 'balanced'];
const GM_RISK_TOLERANCES: Array<'conservative' | 'moderate' | 'aggressive'> = ['conservative', 'moderate', 'aggressive'];
const GM_FOCUSES: Array<'hitting' | 'pitching' | 'defense'> = ['hitting', 'pitching', 'defense'];
const MANAGER_STYLES: Array<'aggressive' | 'balanced' | 'conservative'> = ['aggressive', 'balanced', 'conservative'];
const OWNER_PERSONALITIES: Array<'meddling' | 'hands-off' | 'moderate'> = ['meddling', 'hands-off', 'moderate'];

export async function runOffseason(league: LeagueRow, isTurbo: boolean): Promise<void> {
  const leagueId = league.id;
  const currentStep = league.offseason_step ?? 'retirement';

  console.log(`[offseason] Starting from step: ${currentStep}`);

  const steps = ['retirement', 'development', 'free_agency', 'front_office', 'annual_draft', 'done'];
  const startIdx = steps.indexOf(currentStep);

  for (let i = startIdx; i < steps.length; i++) {
    const step = steps[i]!;
    console.log(`[offseason] Running step: ${step}`);

    switch (step) {
      case 'retirement':
        await runRetirementStep(leagueId, league.season_number);
        break;
      case 'development':
        await runDevelopmentStep(leagueId, league.worldgen_seed ^ league.season_number);
        break;
      case 'free_agency':
        await runFreeAgencyStep(leagueId, league.season_number);
        break;
      case 'front_office':
        await runFrontOfficeStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'annual_draft':
        await runAnnualDraftStep(league, isTurbo);
        break;
      case 'done':
        await finalizeOffseason(leagueId, league.season_number);
        break;
    }

    // Checkpoint: update offseason_step
    if (step !== 'done') {
      prepared('UPDATE leagues SET offseason_step = ? WHERE id = ?').run(steps[i + 1] ?? 'done', leagueId);
    }
  }
}

// Step 1: Retirement — players age 40+ retire
async function runRetirementStep(leagueId: number, seasonNumber: number): Promise<void> {
  const db = getDb();

  const retirees = prepared(
    'SELECT * FROM players WHERE league_id = ? AND age >= 40'
  ).all(leagueId) as PlayerRow[];

  for (const player of retirees) {
    db.prepare('UPDATE players SET team_id = NULL, is_on_mlb_roster = 0 WHERE id = ?').run(player.id);
    db.prepare(
      'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      leagueId, seasonNumber, 'retirement',
      player.team_id,
      player.id,
      `${player.first_name} ${player.last_name} retires after a distinguished career.`,
      Date.now()
    );
  }

  console.log(`[offseason] Retirement: ${retirees.length} players retired`);
}

// Step 2: Development — age players, adjust ratings
async function runDevelopmentStep(leagueId: number, seed: number): Promise<void> {
  const rng = seedFor('development', seed);
  const players = prepared('SELECT * FROM players WHERE league_id = ?').all(leagueId) as PlayerRow[];

  const db = getDb();
  const devTx = db.transaction(() => {
    for (const player of players) {
      const newAge = player.age + 1;
      let ratingChange = 0;

      // Development model
      if (newAge <= 27 && player.minor_level !== null) {
        // Young minor leaguers grow: +1 to +3
        ratingChange = randInt(rng, 0, 3);
      } else if (newAge >= 28 && newAge <= 32) {
        // Stars in peak years: -1 to +1
        ratingChange = randInt(rng, -1, 1);
      } else if (newAge >= 33) {
        // Aging decline: -2 to 0
        ratingChange = randInt(rng, -2, 0);
      }

      const newRating = Math.max(25, Math.min(99, player.overall_rating + ratingChange));

      // 5% injury chance per season
      const injured = rng() < 0.05 ? 1 : 0;

      // Potential reveal at 25
      const potentialRevealed = (newAge >= 25 || player.potential_revealed === 1) ? 1 : 0;

      // Contract year reduction
      const newContractYears = Math.max(0, player.contract_years_remaining - 1);

      db.prepare(
        'UPDATE players SET age = ?, overall_rating = ?, is_injured = ?, potential_revealed = ?, contract_years_remaining = ? WHERE id = ?'
      ).run(newAge, newRating, injured, potentialRevealed, newContractYears, player.id);
    }
  });

  devTx();
  console.log(`[offseason] Development: ${players.length} players aged and developed`);
}

// Step 3: Free agency — D20
async function runFreeAgencyStep(leagueId: number, seasonNumber?: number): Promise<void> {
  const db = getDb();

  // Players with 0 contract years remaining become free agents
  const freeAgents = prepared(
    'SELECT * FROM players WHERE league_id = ? AND contract_years_remaining <= 0 AND team_id IS NOT NULL'
  ).all(leagueId) as PlayerRow[];

  for (const fa of freeAgents) {
    prepared('UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, minor_level = NULL WHERE id = ?').run(fa.id);
  }

  const availableFAs = prepared(
    'SELECT * FROM players WHERE league_id = ? AND team_id IS NULL ORDER BY overall_rating DESC LIMIT 50'
  ).all(leagueId) as PlayerRow[];

  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

  // D20: bid = overall * 0.15M * needs_multiplier, capped at remaining payroll budget
  for (const fa of availableFAs) {
    let bestBid = 0;
    let bestTeamId: number | null = null;

    for (const team of teams) {
      // Check position need
      const posCount = prepared(
        'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position = ?'
      ).get(team.id, fa.position) as { cnt: number };

      let posNeedScore = 0;
      if (posCount.cnt === 0) posNeedScore = 1.0;
      else if (posCount.cnt === 1) posNeedScore = 0.5;

      const needsMultiplier = 1.0 + (0.5 * posNeedScore);
      const bid = Math.min(
        team.payroll_budget - team.current_payroll,
        Math.round(fa.overall_rating * 0.15 * 1_000_000 * needsMultiplier)
      );

      if (bid > bestBid) {
        bestBid = bid;
        bestTeamId = team.id;
      } else if (bid === bestBid && bestTeamId !== null && team.id < bestTeamId) {
        // Tie-break by team_id
        bestTeamId = team.id;
      }
    }

    if (bestTeamId !== null && bestBid > 0) {
      const signingTeam = teams.find(t => t.id === bestTeamId);
      // §4.1: Use deterministic seed (player id + season) instead of Date.now()
      const leagueRow = prepared('SELECT worldgen_seed, season_number FROM leagues WHERE id = ?').get(leagueId) as { worldgen_seed: number; season_number: number } | undefined;
      const fa_seed_base = (leagueRow?.worldgen_seed ?? 0) ^ (leagueRow?.season_number ?? 1);
      const contractYears = randInt(seedFor(`fa_contract_${fa.id}`, fa_seed_base), 1, 3);
      prepared('UPDATE players SET team_id = ?, is_on_mlb_roster = 1, annual_salary = ?, contract_years_remaining = ? WHERE id = ?')
        .run(bestTeamId, bestBid, contractYears, fa.id);
      prepared('UPDATE teams SET current_payroll = current_payroll + ? WHERE id = ?').run(bestBid, bestTeamId);

      // §4.2: Use actual season_number, not hardcoded 1
      const actualSeason = seasonNumber ?? leagueRow?.season_number ?? 1;
      db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, actualSeason, 'free_agent_signing',
        bestTeamId, fa.id,
        `${signingTeam?.city ?? 'Unknown'} signs ${fa.first_name} ${fa.last_name} for $${(bestBid / 1_000_000).toFixed(1)}M`,
        Date.now()
      );
    }
  }

  console.log(`[offseason] Free agency: ${freeAgents.length} released, ${availableFAs.length} FA pool`);
}

// Step 4: Front office changes
async function runFrontOfficeStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const rng = seedFor('front_office', seed);
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
  const db = getDb();

  for (const team of teams) {
    // Manager fired if job_security < 3 (60% chance)
    if (team.job_security < 3 && rng() < 0.6) {
      const newFirst = ['Bob', 'Tom', 'Mike', 'Dave', 'Jim'][Math.floor(rng() * 5)] ?? 'Bob';
      const newLast = ['Johnson', 'Smith', 'Williams', 'Brown', 'Jones'][Math.floor(rng() * 5)] ?? 'Johnson';
      const newStyle = MANAGER_STYLES[Math.floor(rng() * 3)] ?? 'balanced';

      db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'manager_fired',
        team.manager_name,
        `${newFirst} ${newLast}`,
        `${team.manager_name} fired after poor performance. ${newFirst} ${newLast} hired as new manager.`,
        Date.now()
      );

      db.prepare(
        'UPDATE teams SET manager_name = ?, manager_style = ?, job_security = 5 WHERE id = ?'
      ).run(`${newFirst} ${newLast}`, newStyle, team.id);
    } else {
      // Reduce job security by win rate
      const winPct = team.wins / Math.max(1, team.wins + team.losses);
      const securityDelta = winPct > 0.55 ? 1 : winPct < 0.45 ? -1 : 0;
      const newSecurity = Math.max(1, Math.min(10, team.job_security + securityDelta));
      db.prepare('UPDATE teams SET job_security = ? WHERE id = ?').run(newSecurity, team.id);
    }

    // GM fired if owner meddling (40% if win_pct < 0.45)
    const winPct = team.wins / Math.max(1, team.wins + team.losses);
    if (team.owner_personality === 'meddling' && winPct < 0.45 && rng() < 0.4) {
      const newFirst = ['Alex', 'Chris', 'Pat', 'Sam', 'Terry'][Math.floor(rng() * 5)] ?? 'Alex';
      const newLast = ['Martinez', 'Garcia', 'Wilson', 'Davis', 'Miller'][Math.floor(rng() * 5)] ?? 'Garcia';
      const newPhilosophy = GM_PHILOSOPHIES[Math.floor(rng() * 3)] ?? 'balanced';
      const newRisk = GM_RISK_TOLERANCES[Math.floor(rng() * 3)] ?? 'moderate';
      const newFocus = GM_FOCUSES[Math.floor(rng() * 3)] ?? 'hitting';

      db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'gm_fired',
        team.gm_name, `${newFirst} ${newLast}`,
        `${team.gm_name} dismissed. ${newFirst} ${newLast} takes over as GM with a ${newPhilosophy} philosophy.`,
        Date.now()
      );

      db.prepare(
        'UPDATE teams SET gm_name = ?, gm_philosophy = ?, gm_risk_tolerance = ?, gm_focus = ? WHERE id = ?'
      ).run(`${newFirst} ${newLast}`, newPhilosophy, newRisk, newFocus, team.id);
    }

    // 2% owner sell
    if (rng() < 0.02) {
      const newFirst = ['Richard', 'William', 'James', 'George', 'Edward'][Math.floor(rng() * 5)] ?? 'Richard';
      const newLast = ['Thompson', 'Anderson', 'Taylor', 'Moore', 'Jackson'][Math.floor(rng() * 5)] ?? 'Thompson';
      const newPersonality = OWNER_PERSONALITIES[Math.floor(rng() * 3)] ?? 'moderate';

      db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'owner_sold_team',
        team.owner_name, `${newFirst} ${newLast}`,
        `${team.owner_name} sells the franchise to ${newFirst} ${newLast}.`,
        Date.now()
      );

      db.prepare('UPDATE teams SET owner_name = ?, owner_personality = ? WHERE id = ?')
        .run(`${newFirst} ${newLast}`, newPersonality, team.id);
    }

    // §5.9: 0.5% owner death (weighted by age)
    const ageFactor = team.owner_age > 70 ? 0.02 : 0.005;
    if (rng() < ageFactor) {
      const heirFirst = ['Robert', 'Henry', 'Arthur', 'Charles', 'Winston'][Math.floor(rng() * 5)] ?? 'Robert';
      const heirLast = team.owner_name.split(' ')[1] ?? 'Heir'; // Same surname for heir

      db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'owner_died',
        team.owner_name, `${heirFirst} ${heirLast}`,
        `${team.owner_name} passed away. Heir ${heirFirst} ${heirLast} takes control of the franchise.`,
        Date.now()
      );

      db.prepare('UPDATE teams SET owner_name = ? WHERE id = ?').run(`${heirFirst} ${heirLast}`, team.id);
    }
  }

  // NOTE: W/L reset moved to finalizeOffseason() — must happen AFTER annual_draft reads standings (§2.6)
  console.log(`[offseason] Front office changes complete`);
}

// Step 5: Annual draft
async function runAnnualDraftStep(league: LeagueRow, isTurbo: boolean): Promise<void> {
  await runAnnualDraft(league, isTurbo);
  console.log(`[offseason] Annual draft complete`);
}

// Step 6: Finalize — transition to new season
async function finalizeOffseason(leagueId: number, previousSeason: number): Promise<void> {
  const db = getDb();
  const newSeason = previousSeason + 1;

  // Generate season narrative from DB data (CISO F11: never feed prior LLM output back)
  const narrative = await generateSeasonNarrative(leagueId, previousSeason);

  // Generate new schedule
  const { generateSchedule, saveSchedule } = await import('./season.js');
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow;
  const newSchedule = generateSchedule(leagueId, league.worldgen_seed ^ newSeason);
  saveSchedule(leagueId, newSchedule);

  db.prepare(
    'UPDATE leagues SET season_number = ?, phase = ?, offseason_step = NULL, current_game_number = 0, current_game_date = 0, last_game_id = 0 WHERE id = ?'
  ).run(newSeason, 'regular_season', leagueId);

  // Reset W/L/runs/games_played for the new season — must happen AFTER annual_draft (§2.6)
  db.prepare('UPDATE teams SET wins = 0, losses = 0, runs_scored = 0, runs_allowed = 0, games_played = 0 WHERE league_id = ?').run(leagueId);

  // D21: Remaining undrafted players from original pool become free agents
  db.prepare(
    'UPDATE players SET team_id = NULL WHERE league_id = ? AND is_drafted = 0 AND team_id IS NULL'
  ).run(leagueId);

  console.log(`[offseason] Season ${previousSeason} complete. Season ${newSeason} begins.`);
}

async function generateSeasonNarrative(leagueId: number, seasonNumber: number): Promise<string | null> {
  const champRow = prepared(
    'SELECT t.city, t.name FROM season_narratives sn JOIN teams t ON t.id = sn.champion_team_id WHERE sn.league_id = ? AND sn.season_number = ?'
  ).get(leagueId, seasonNumber) as { city: string; name: string } | undefined;

  if (!champRow) return null;

  const league = prepared('SELECT name FROM leagues WHERE id = ?').get(leagueId) as { name: string } | undefined;
  const leagueName = league?.name ?? 'Baseball Dynasty';

  // Get key transactions for context
  const txns = prepared(
    'SELECT narrative FROM transactions WHERE league_id = ? AND season_number = ? AND transaction_type != \'trade_deadline\' ORDER BY created_at DESC LIMIT 5'
  ).all(leagueId, seasonNumber) as Array<{ narrative: string | null }>;
  const txnText = txns.map(t => t.narrative).filter(Boolean).join('; ');

  const result = await callSeasonNarrative(
    leagueName, seasonNumber,
    `${champRow.city} ${champRow.name}`,
    null,
    txnText
  );

  if (result.ok) {
    prepared('UPDATE season_narratives SET narrative = ? WHERE league_id = ? AND season_number = ?')
      .run(result.narrative, leagueId, seasonNumber);
    return result.narrative;
  }

  // Procedural fallback
  const fallbackNarrative = `The ${champRow.city} ${champRow.name} won the championship in season ${seasonNumber} in a memorable campaign.`;
  prepared('UPDATE season_narratives SET narrative = ? WHERE league_id = ? AND season_number = ?')
    .run(fallbackNarrative, leagueId, seasonNumber);

  return fallbackNarrative;
}
