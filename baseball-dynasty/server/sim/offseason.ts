// Offseason module — stepwise with checkpointing via D26
// Steps: season_archive → retirement → development → non_tender → free_agency → hof_voting → financial_update → front_office → annual_draft → done

import { getDb, prepared, type LeagueRow, type TeamRow, type PlayerRow } from '../db.js';
import { seedFor, randInt, randNormal } from './prng.js';
import { runAnnualDraft } from './draft.js';
import { callSeasonNarrative } from '../services/llm.js';
import { insertTransactionNewsItem, insertFrontOfficeNewsItem } from './news.js';
import { getFranchiseState, resetGmConfidence } from './franchise.js';

const GM_PHILOSOPHIES: Array<'win-now' | 'rebuild' | 'balanced'> = ['win-now', 'rebuild', 'balanced'];
const GM_RISK_TOLERANCES: Array<'conservative' | 'moderate' | 'aggressive'> = ['conservative', 'moderate', 'aggressive'];
const GM_FOCUSES: Array<'hitting' | 'pitching' | 'defense'> = ['hitting', 'pitching', 'defense'];
const MANAGER_STYLES: Array<'aggressive' | 'balanced' | 'conservative'> = ['aggressive', 'balanced', 'conservative'];
// v0.2.0: expanded owner_personality includes win-now and patient
const OWNER_PERSONALITIES: Array<'meddling' | 'hands-off' | 'moderate' | 'win-now' | 'patient'> = ['meddling', 'hands-off', 'moderate', 'win-now', 'patient'];

export async function runOffseason(league: LeagueRow, isTurbo: boolean): Promise<void> {
  const leagueId = league.id;
  const currentStep = league.offseason_step ?? 'season_archive';

  console.log(`[offseason] Starting from step: ${currentStep}`);

  const steps = ['season_archive', 'retirement', 'development', 'non_tender', 'free_agency', 'hof_voting', 'financial_update', 'front_office', 'annual_draft', 'done'];
  const startIdx = steps.indexOf(currentStep);

  // §1.2 Iter-5: Import pause-check for cooperative offseason cancellation
  const { isPaused } = await import('./engine.js');

  for (let i = startIdx; i < steps.length; i++) {
    const step = steps[i]!;
    console.log(`[offseason] Running step: ${step}`);

    switch (step) {
      case 'season_archive':
        await runSeasonArchiveStep(leagueId, league.season_number, league.worldgen_seed);
        break;
      case 'retirement':
        await runRetirementStep(leagueId, league.season_number);
        break;
      case 'development':
        await runDevelopmentStep(leagueId, league.worldgen_seed ^ league.season_number);
        break;
      case 'non_tender':
        await runNonTenderStep(leagueId, league.season_number);
        break;
      case 'free_agency':
        await runFreeAgencyStep(leagueId, league.season_number);
        break;
      case 'hof_voting':
        await runHofVotingStep(leagueId, league.season_number, league.worldgen_seed);
        break;
      case 'financial_update':
        await runFinancialUpdateStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'front_office':
        await runFrontOfficeStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'annual_draft':
        await runAnnualDraftStep(league, isTurbo);
        // §1.2 Iter-5: If runAnnualDraft was paused mid-draft (non-turbo only), runAnnualDraftStep
        // returns without completing all 600 picks. Do NOT advance offseason_step in that case;
        // the next tick (after resume) will re-enter with offseason_step='annual_draft'
        // and runAnnualDraft's resume logic picks up from max(pick_number)+1.
        // In turbo mode the draft runs in one atomic transaction so no pause is possible.
        if (!isTurbo && isPaused()) {
          console.log('[offseason] Paused at step annual_draft — preserving checkpoint');
          return;
        }
        break;
      case 'done':
        await finalizeOffseason(leagueId, league.season_number);
        break;
    }

    // Checkpoint: update offseason_step to the NEXT step
    if (step !== 'done') {
      prepared('UPDATE leagues SET offseason_step = ? WHERE id = ?').run(steps[i + 1] ?? 'done', leagueId);
    }
  }
}

// =========================================================
// Step 0: Season Archive — capture franchise history BEFORE W/L reset and BEFORE retirement
// =========================================================

// Compute division finish rank for a team within its division (1=first)
function computeDivisionFinish(leagueId: number, teamId: number): number {
  const teams = prepared(
    'SELECT id, wins, losses, runs_scored, runs_allowed, conference, division FROM teams WHERE league_id = ?'
  ).all(leagueId) as Array<{
    id: number; wins: number; losses: number; runs_scored: number; runs_allowed: number;
    conference: string; division: string;
  }>;

  const thisTeam = teams.find(t => t.id === teamId);
  if (!thisTeam) return 1;

  const divTeams = teams.filter(t => t.division === thisTeam.division);
  // Sort by win pct desc, then run differential, then wins
  divTeams.sort((a, b) => {
    const pctA = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
    const pctB = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
    if (pctB !== pctA) return pctB - pctA;
    const rdA = a.runs_scored - a.runs_allowed;
    const rdB = b.runs_scored - b.runs_allowed;
    if (rdB !== rdA) return rdB - rdA;
    return b.wins - a.wins;
  });

  const rank = divTeams.findIndex(t => t.id === teamId) + 1;
  return rank > 0 ? rank : 1;
}

// Determine how deep a team went in the playoffs this season
function computePlayoffRound(leagueId: number, teamId: number, seasonNumber: number): string {
  // Check if this team won the championship
  const champRow = prepared(
    'SELECT champion_team_id FROM season_narratives WHERE league_id = ? AND season_number = ?'
  ).get(leagueId, seasonNumber) as { champion_team_id: number | null } | undefined;

  if (champRow?.champion_team_id === teamId) return 'champion';

  // Check playoff series (uses team1_id/team2_id/winner_team_id/round_name columns from migration 002)
  const seriesRows = prepared(
    `SELECT team1_id, team2_id, winner_team_id, team1_wins, team2_wins, round_name
     FROM playoff_series
     WHERE league_id = ? AND season_number = ?
       AND (team1_id = ? OR team2_id = ?)`
  ).all(leagueId, seasonNumber, teamId, teamId) as Array<{
    team1_id: number; team2_id: number; winner_team_id: number;
    team1_wins: number; team2_wins: number; round_name: string;
  }>;

  if (seriesRows.length === 0) return 'missed';

  // Find the deepest round this team participated in
  let deepest = 'missed';
  const roundOrder = ['DS', 'CS', 'WS'];

  for (const series of seriesRows) {
    const wonSeries = series.winner_team_id === teamId;
    const round = series.round_name ?? 'DS';
    const currentIdx = roundOrder.indexOf(round);
    const deepestIdx = roundOrder.indexOf(deepest);

    if (wonSeries) {
      // Won this round — at minimum they appeared in the NEXT round
      const nextRound = roundOrder[currentIdx + 1] ?? round;
      if (roundOrder.indexOf(nextRound) > deepestIdx) {
        deepest = nextRound;
      }
    } else {
      // Lost this round
      if (currentIdx > deepestIdx) {
        deepest = round;
      }
    }
  }

  return deepest;
}

// Compute attendance average using the same formula as watch.ts
function computeAttendanceAvg(marketSize: string, wins: number, losses: number, teamId: number): number {
  const baseRates: Record<string, number> = {
    mega: 0.85, large: 0.75, medium: 0.65, small: 0.55,
  };
  const capacities: Record<string, number> = {
    mega: 48000, large: 42000, medium: 36000, small: 30000,
  };
  const baseRate = baseRates[marketSize] ?? 0.65;
  const capacity = capacities[marketSize] ?? 35000;
  const winPct = (wins + losses) > 0 ? wins / (wins + losses) : 0.5;
  const winPctBonus = (winPct - 0.5) * 0.4;
  // Use team ID as stable jitter (no game number — season average)
  const jitter = ((teamId * 31) % 11 - 5) / 100;
  const attendancePct = Math.max(0.35, Math.min(1.0, baseRate + winPctBonus + jitter));
  return Math.round(attendancePct * capacity);
}

async function runSeasonArchiveStep(leagueId: number, seasonNumber: number, worldgenSeed: number): Promise<void> {
  const db = getDb();

  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

  const archiveTx = db.transaction(() => {
    for (const team of teams) {
      const divisionFinish = computeDivisionFinish(leagueId, team.id);
      const playoffRound = computePlayoffRound(leagueId, team.id, seasonNumber);
      const madePlayoffs = playoffRound !== 'missed' ? 1 : 0;
      const wonChampionship = playoffRound === 'champion' ? 1 : 0;
      const attendanceAvg = computeAttendanceAvg(team.market_size, team.wins, team.losses, team.id);

      // Insert/upsert franchise_season_history (idempotent via INSERT OR REPLACE)
      db.prepare(
        `INSERT OR REPLACE INTO franchise_season_history
           (league_id, team_id, season_number, wins, losses, division_finish, playoff_round,
            made_playoffs, won_championship, attendance_avg, revenue, payroll_actual, payroll_budget,
            luxury_tax_paid, manager_name, gm_name, city_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        leagueId, team.id, seasonNumber,
        team.wins, team.losses, divisionFinish, playoffRound,
        madePlayoffs, wonChampionship, attendanceAvg,
        team.revenue ?? 0, team.current_payroll ?? 0, team.payroll_budget ?? 0,
        team.luxury_tax_paid ?? 0,
        team.manager_name ?? null,
        team.gm_name ?? null,
        team.city ?? null
      );
    }

    // Snapshot franchise_player_season for all players with season_stats this season
    // Spec interpretation (documented): we key by player's CURRENT team_id at season end.
    // Mid-season traded players' full season stats go to their end-of-season team.
    // This is an approximation; per-trade attribution is not available from season_stats schema.
    const statsRows = prepared(
      `SELECT ss.player_id, ss.team_id, ss.games_played, ss.at_bats, ss.hits, ss.home_runs,
              ss.rbi, ss.walks, ss.innings_pitched, ss.earned_runs, ss.strikeouts_pitching,
              ss.wins, ss.losses,
              p.team_id AS current_team_id, p.seasons_with_current_team
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND p.team_id IS NOT NULL`
    ).all(leagueId, seasonNumber) as Array<{
      player_id: number; team_id: number; games_played: number; at_bats: number;
      hits: number; home_runs: number; rbi: number; walks: number;
      innings_pitched: number; earned_runs: number; strikeouts_pitching: number;
      wins: number; losses: number; current_team_id: number | null; seasons_with_current_team: number;
    }>;

    for (const row of statsRows) {
      const effectiveTeamId = row.current_team_id ?? row.team_id;
      if (!effectiveTeamId) continue;

      db.prepare(
        `INSERT OR REPLACE INTO franchise_player_season
           (league_id, team_id, player_id, season_number, games_played, at_bats, hits, home_runs,
            rbi, walks, innings_pitched, earned_runs, strikeouts_pitching, wins, losses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        leagueId, effectiveTeamId, row.player_id, seasonNumber,
        row.games_played ?? 0, row.at_bats ?? 0, row.hits ?? 0, row.home_runs ?? 0,
        row.rbi ?? 0, row.walks ?? 0, row.innings_pitched ?? 0, row.earned_runs ?? 0,
        row.strikeouts_pitching ?? 0, row.wins ?? 0, row.losses ?? 0
      );
    }

    // Increment seasons_with_current_team for players who stayed with their team.
    // Check against prior franchise_player_season row — if team_id matches the prior season, increment.
    // New players or those with no prior record start at 1.
    const allTeamPlayers = prepared(
      `SELECT p.id, p.team_id, p.seasons_with_current_team,
              (SELECT fps.team_id FROM franchise_player_season fps
               WHERE fps.player_id = p.id AND fps.season_number = ? - 1
               ORDER BY fps.id DESC LIMIT 1) AS prior_team_id
       FROM players p
       WHERE p.league_id = ? AND p.team_id IS NOT NULL`
    ).all(seasonNumber, leagueId) as Array<{
      id: number; team_id: number; seasons_with_current_team: number; prior_team_id: number | null;
    }>;

    for (const p of allTeamPlayers) {
      let newCount: number;
      if (p.prior_team_id === null) {
        newCount = 1; // First season on record
      } else if (p.prior_team_id === p.team_id) {
        newCount = (p.seasons_with_current_team ?? 0) + 1; // Stayed
      } else {
        newCount = 1; // Changed teams
      }
      db.prepare('UPDATE players SET seasons_with_current_team = ? WHERE id = ?').run(newCount, p.id);
    }
  });

  archiveTx();
  console.log(`[offseason] Season archive: captured franchise history for season ${seasonNumber}`);
}

// =========================================================
// Step 7 stub: HOF Voting — filled in by Step 7 implementation
// =========================================================
async function runHofVotingStep(leagueId: number, seasonNumber: number, worldgenSeed: number): Promise<void> {
  await runHofVoting(leagueId, seasonNumber, worldgenSeed);
}

// =========================================================
// Step 5 stub: Financial Update — filled in by Step 5 implementation
// =========================================================
async function runFinancialUpdateStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  await runFinancialUpdate(leagueId, seasonNumber, seed);
}

// =========================================================
// Step 5: Financial Update — revenue model + budget updates + franchise valuation
// =========================================================

// Revenue constants (documented as tunable)
const BASE_MARKET_REVENUE: Record<string, number> = { mega: 300, large: 200, medium: 130, small: 90 };
const PERFORMANCE_BONUS_RATE = 200; // millions; (.600 - .500) * 200 = +20M
const CHAMPIONSHIP_BONUS = 40; // millions
const PLAYOFF_APPEARANCE_BONUS = 15; // millions
const LOSING_STREAK_PENALTY_PER_SEGMENT = 5; // millions per 10-game sub-.500 margin segment

async function runFinancialUpdate(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const db = getDb();
  const rng = seedFor('financial_update', seed);
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

  // Get prior season from franchise_season_history for 2-season revenue trend
  const prevSeason = seasonNumber - 1;

  const financialTx = db.transaction(() => {
    for (const team of teams) {
      // Get this season's history (just archived)
      const thisHistory = prepared(
        'SELECT wins, losses, made_playoffs, won_championship, revenue, payroll_budget FROM franchise_season_history WHERE league_id = ? AND team_id = ? AND season_number = ?'
      ).get(leagueId, team.id, seasonNumber) as {
        wins: number; losses: number; made_playoffs: number; won_championship: number;
        revenue: number; payroll_budget: number;
      } | undefined;

      if (!thisHistory) continue; // no season data yet

      const gamesPlayed = thisHistory.wins + thisHistory.losses;
      const winPct = gamesPlayed > 0 ? thisHistory.wins / gamesPlayed : 0.5;

      // Revenue formula
      const baseRev = BASE_MARKET_REVENUE[team.market_size] ?? 90;
      const performanceBonus = Math.max(0, (winPct - 0.500)) * PERFORMANCE_BONUS_RATE;
      const champBonus = thisHistory.won_championship === 1 ? CHAMPIONSHIP_BONUS : 0;
      const playoffBonus = (thisHistory.made_playoffs === 1 && thisHistory.won_championship !== 1) ? PLAYOFF_APPEARANCE_BONUS : 0;
      const gamesUnder500 = Math.max(0, thisHistory.losses - thisHistory.wins);
      const losingPenalty = Math.floor(gamesUnder500 / 10) * LOSING_STREAK_PENALTY_PER_SEGMENT;

      const ownerMod: Record<string, number> = {
        'win-now': 1.2, meddling: 1.2, moderate: 1.05, patient: 1.0, 'hands-off': 0.9,
      };
      const modifier = ownerMod[team.owner_personality] ?? 1.0;

      const annualRevenue = Math.round((baseRev + performanceBonus + champBonus + playoffBonus - losingPenalty) * modifier);

      // Write revenue to teams.revenue (archived next season in archive step)
      db.prepare('UPDATE teams SET revenue = ? WHERE id = ?').run(annualRevenue * 1_000_000, team.id);

      // Budget update logic — reads prior season
      const priorHistory = prepared(
        'SELECT revenue, payroll_budget FROM franchise_season_history WHERE league_id = ? AND team_id = ? AND season_number = ?'
      ).get(leagueId, team.id, prevSeason) as { revenue: number; payroll_budget: number } | undefined;

      const currentBudget = team.payroll_budget;
      let newBudget = currentBudget;
      const revMillions = annualRevenue; // already in millions
      const budgetMillions = currentBudget / 1_000_000;

      if (revMillions > budgetMillions * 1.3) {
        // Increase budget 5-15% — analytics GM goes higher
        const isAnalytics = team.gm_archetype === 'analytics';
        const band = isAnalytics
          ? 0.05 + rng() * 0.10 // 5-15%
          : 0.05 + rng() * 0.05; // 5-10%

        // Small-market hands-off owner: least likely to reinvest
        if (team.owner_personality === 'hands-off' && team.market_size === 'small') {
          newBudget = Math.round(currentBudget * (1 + band * 0.3)); // barely reinvests
        } else {
          newBudget = Math.round(currentBudget * (1 + band));
        }
      } else if (priorHistory && revMillions < budgetMillions * 0.8) {
        const priorRevMillions = priorHistory.revenue / 1_000_000;
        const priorBudgetMillions = priorHistory.payroll_budget / 1_000_000;
        // Check if also below 0.8 last season (2 consecutive)
        if (priorRevMillions < priorBudgetMillions * 0.8) {
          const decreasePct = 0.05 + rng() * 0.05; // 5-10%
          newBudget = Math.round(currentBudget * (1 - decreasePct));
        }
      }

      // Mega-market floor: never below $120M
      if (team.market_size === 'mega') {
        newBudget = Math.max(newBudget, 120_000_000);
      }

      if (newBudget !== currentBudget) {
        db.prepare('UPDATE teams SET payroll_budget = ? WHERE id = ?').run(newBudget, team.id);
      }

      // Franchise valuation — store in millions
      const histRows = prepared(
        'SELECT SUM(wins) as total_wins, SUM(won_championship) as championships, COUNT(*) as seasons_count FROM franchise_season_history WHERE league_id = ? AND team_id = ?'
      ).get(leagueId, team.id) as { total_wins: number; championships: number; seasons_count: number } | undefined;

      const baseMkt: Record<string, number> = { mega: 400, large: 250, medium: 150, small: 100 };
      const baseVal = baseMkt[team.market_size] ?? 100;
      const totalWins = histRows?.total_wins ?? 0;
      const champs = histRows?.championships ?? 0;
      const seasonsInLeague = Math.max(1, (histRows?.seasons_count ?? 1));
      const attendancePremium: Record<string, number> = { mega: 100, large: 40, medium: 10, small: 0 };
      const aPremium = attendancePremium[team.market_size] ?? 0;

      const franchiseValue = Math.max(0, Math.round(
        baseVal
        + Math.round(totalWins * 0.1)
        + (champs * 50)
        + (seasonsInLeague * 2)
        + aPremium
      ));

      db.prepare('UPDATE teams SET franchise_value = ? WHERE id = ?').run(franchiseValue, team.id);
    }
  });

  financialTx();
  console.log(`[offseason] Financial update complete for season ${seasonNumber}`);
}

// =========================================================
// Step 7: Hall of Fame Voting
// =========================================================

async function runHofVoting(leagueId: number, seasonNumber: number, worldgenSeed: number): Promise<void> {
  const db = getDb();

  // Offseason note (A-7): finalizeOffseason increments season_number LAST.
  // We are in the offseason for `seasonNumber` (just completed). Veterans committee
  // fires at season 5, 10, 15 — check if seasonNumber % 5 === 0.

  // 1. Add newly eligible players to hof_ballot (1-year wait after retirement)
  // Find players who retired in (seasonNumber - 1), not yet on ballot, not gambling-banned,
  // and meet HOF thresholds.
  addEligibleToBallot(db, leagueId, seasonNumber);

  // 2. Run voting for all players currently on ballot
  runBallotVoting(db, leagueId, seasonNumber, worldgenSeed);

  // 3. Veterans committee (every 5 seasons)
  if (seasonNumber % 5 === 0) {
    runVeteransCommittee(db, leagueId, seasonNumber, worldgenSeed);
  }

  console.log(`[offseason] HOF voting complete for season ${seasonNumber}`);
}

function computeCareerStats(db: ReturnType<typeof getDb>, leagueId: number, playerId: number): {
  career_hr: number; career_hits: number; career_wins: number; career_k: number; career_ip: number;
  career_era: number; seasons_played: number; ops_above_900_seasons: number; era_below_250_seasons: number;
  position: string | null;
} {
  const player = prepared('SELECT position, career_hr, career_hits, career_k, career_ip, career_wins FROM players WHERE id = ?').get(playerId) as {
    position: string; career_hr: number; career_hits: number; career_k: number; career_ip: number; career_wins: number;
  } | undefined;

  const seasonAgg = prepared(
    `SELECT COUNT(DISTINCT season_number) as seasons,
            SUM(earned_runs) as total_er, SUM(innings_pitched) as total_ip,
            SUM(at_bats) as total_ab, SUM(hits) as total_hits,
            SUM(home_runs) as total_hr, SUM(walks) as total_walks
     FROM season_stats WHERE league_id = ? AND player_id = ?`
  ).get(leagueId, playerId) as {
    seasons: number; total_er: number; total_ip: number; total_ab: number;
    total_hits: number; total_hr: number; total_walks: number;
  } | undefined;

  const career_ip = seasonAgg?.total_ip ?? player?.career_ip ?? 0;
  const career_er = seasonAgg?.total_er ?? 0;
  const career_era = career_ip > 0 ? (career_er * 9.0) / career_ip : 0;

  // Count seasons with OPS > .900 (hitters) or ERA < 2.50 (pitchers)
  const opsSeasonsRow = prepared(
    `SELECT COUNT(*) as cnt FROM season_stats
     WHERE league_id = ? AND player_id = ? AND at_bats >= 100
       AND (CAST(hits AS REAL) / NULLIF(at_bats, 0) + CAST(walks AS REAL) / NULLIF(at_bats + walks, 0)
            + CAST(home_runs AS REAL) * 1.6 / NULLIF(at_bats, 0)) > 0.900`
  ).get(leagueId, playerId) as { cnt: number } | undefined;

  const eraSeasonsRow = prepared(
    `SELECT COUNT(*) as cnt FROM season_stats
     WHERE league_id = ? AND player_id = ? AND innings_pitched >= 50
       AND CAST(earned_runs AS REAL) * 9.0 / NULLIF(innings_pitched, 0) < 2.50`
  ).get(leagueId, playerId) as { cnt: number } | undefined;

  return {
    career_hr: seasonAgg?.total_hr ?? player?.career_hr ?? 0,
    career_hits: seasonAgg?.total_hits ?? player?.career_hits ?? 0,
    career_wins: player?.career_wins ?? 0,
    career_k: player?.career_k ?? 0,
    career_ip,
    career_era,
    seasons_played: seasonAgg?.seasons ?? 0,
    ops_above_900_seasons: opsSeasonsRow?.cnt ?? 0,
    era_below_250_seasons: eraSeasonsRow?.cnt ?? 0,
    position: player?.position ?? null,
  };
}

function meetsHofThresholds(stats: ReturnType<typeof computeCareerStats>): boolean {
  const isPitcher = stats.position && ['SP', 'RP', 'CL'].includes(stats.position);
  if (isPitcher) {
    return stats.career_wins >= 250
      || stats.career_k >= 3000
      || (stats.career_era < 3.00 && stats.seasons_played >= 10)
      || stats.era_below_250_seasons >= 5;
  } else {
    return stats.career_hr >= 400
      || stats.career_hits >= 3000
      // OPS+ > 130 approximated as OPS > .900 over many seasons (simplified — documented)
      || (stats.ops_above_900_seasons >= 10 && stats.seasons_played >= 10)
      || stats.ops_above_900_seasons >= 8;
  }
}

function addEligibleToBallot(db: ReturnType<typeof getDb>, leagueId: number, seasonNumber: number): void {
  // Find players retired in season (seasonNumber - 1), not yet on ballot
  const retiredLastSeason = prepared(
    `SELECT DISTINCT p.id, p.ped_offenses, p.gambling_ban
     FROM players p
     JOIN transactions t ON t.player_id = p.id
     WHERE t.league_id = ? AND t.transaction_type = 'retirement' AND t.season_number = ?
       AND p.gambling_ban = 0
       AND NOT EXISTS (SELECT 1 FROM hof_ballot hb WHERE hb.league_id = ? AND hb.player_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM hall_of_fame hof WHERE hof.league_id = ? AND hof.player_id = p.id)`
  ).all(leagueId, seasonNumber - 1, leagueId, leagueId) as Array<{ id: number; ped_offenses: number; gambling_ban: number }>;

  for (const player of retiredLastSeason) {
    const stats = computeCareerStats(db, leagueId, player.id);
    if (!meetsHofThresholds(stats)) continue;

    const pedFlag = player.ped_offenses > 0 ? 1 : 0;
    db.prepare(
      `INSERT OR IGNORE INTO hof_ballot (league_id, player_id, ballot_since_season, years_on_ballot, best_vote_share, current_vote_share, ped_flag)
       VALUES (?, ?, ?, 0, 0, 0, ?)`
    ).run(leagueId, player.id, seasonNumber, pedFlag);
  }
}

function runBallotVoting(db: ReturnType<typeof getDb>, leagueId: number, seasonNumber: number, worldgenSeed: number): void {
  const ballotPlayers = prepared(
    'SELECT * FROM hof_ballot WHERE league_id = ? ORDER BY player_id ASC'
  ).all(leagueId) as Array<{ id: number; player_id: number; ballot_since_season: number; years_on_ballot: number; best_vote_share: number; current_vote_share: number; ped_flag: number }>;

  if (ballotPlayers.length === 0) return;

  // 30 procedural voters — deterministic personality via seed
  const NUM_VOTERS = 30;
  const voterPersonalities: Array<'old-school' | 'analytics'> = [];
  for (let i = 0; i < NUM_VOTERS; i++) {
    const voterRng = seedFor(`hof_voter_${i}`, worldgenSeed);
    voterPersonalities.push(voterRng() < 0.5 ? 'old-school' : 'analytics');
  }

  const inductionCandidates: Array<{ player_id: number; vote_share: number; ballot_since: number }> = [];

  for (const ballot of ballotPlayers) {
    const stats = computeCareerStats(db, leagueId, ballot.player_id);
    const isPitcher = stats.position && ['SP', 'RP', 'CL'].includes(stats.position);

    // Count votes
    let yesVotes = 0;
    for (let i = 0; i < NUM_VOTERS; i++) {
      const personality = voterPersonalities[i]!;
      const voteRng = seedFor(`hof_vote_${i}_${ballot.player_id}_s${seasonNumber}`, worldgenSeed);
      let probability = 0.5;

      // Old-school: favor counting stats
      if (personality === 'old-school') {
        if (!isPitcher) {
          if (stats.career_hr >= 400) probability += 0.25;
          if (stats.career_hits >= 3000) probability += 0.30;
          if (stats.career_hr >= 300) probability += 0.10;
        } else {
          if (stats.career_wins >= 250) probability += 0.30;
          if (stats.career_k >= 3000) probability += 0.20;
        }
        // PED: old-school split (50/50)
        if (ballot.ped_flag === 1) probability -= 0.15;
      } else {
        // Analytics: favor efficiency
        if (!isPitcher) {
          if (stats.ops_above_900_seasons >= 8) probability += 0.25;
          if (stats.career_hr >= 400) probability += 0.15;
        } else {
          if (stats.career_era < 3.00 && stats.seasons_played >= 10) probability += 0.30;
          if (stats.era_below_250_seasons >= 5) probability += 0.20;
        }
        // PED: analytics penalize heavily
        if (ballot.ped_flag === 1) probability -= 0.35;
      }

      probability = Math.max(0, Math.min(1, probability));
      if (voteRng() < probability) yesVotes++;
    }

    const voteShare = (yesVotes / NUM_VOTERS) * 100;
    const newBestVoteShare = Math.max(ballot.best_vote_share, voteShare);
    const newYearsOnBallot = ballot.years_on_ballot + 1;

    // Update ballot
    db.prepare(
      'UPDATE hof_ballot SET current_vote_share = ?, best_vote_share = ?, years_on_ballot = ? WHERE id = ?'
    ).run(voteShare, newBestVoteShare, newYearsOnBallot, ballot.id);

    // Check for induction (>= 75%)
    if (voteShare >= 75) {
      inductionCandidates.push({ player_id: ballot.player_id, vote_share: voteShare, ballot_since: ballot.ballot_since_season });
    } else if (newYearsOnBallot >= 10) {
      // Remove from ballot after year 10 if not inducted
      db.prepare('DELETE FROM hof_ballot WHERE id = ?').run(ballot.id);
    }
  }

  // Induct at most 3 per offseason
  // Tiebreaker: highest vote_share → earliest ballot_since_season → lowest player_id
  inductionCandidates.sort((a, b) => {
    if (b.vote_share !== a.vote_share) return b.vote_share - a.vote_share;
    if (a.ballot_since !== b.ballot_since) return a.ballot_since - b.ballot_since;
    return a.player_id - b.player_id;
  });

  const toInduct = inductionCandidates.slice(0, 3);
  for (const c of toInduct) {
    const stats = computeCareerStats(db, leagueId, c.player_id);
    const pedFlag = ballotPlayers.find(b => b.player_id === c.player_id)?.ped_flag ?? 0;
    db.prepare(
      `INSERT OR IGNORE INTO hall_of_fame
         (league_id, player_id, induction_season, vote_share, veterans_committee, ped_flag, wing, memorial, career_stats_at_induction, created_at)
       VALUES (?, ?, ?, ?, 0, ?, 'player', 0, ?, ?)`
    ).run(
      leagueId, c.player_id, seasonNumber, c.vote_share, pedFlag,
      JSON.stringify({ career_hr: stats.career_hr, career_hits: stats.career_hits, career_wins: stats.career_wins, career_k: stats.career_k, career_era: Math.round(stats.career_era * 100) / 100, seasons: stats.seasons_played, position: stats.position }),
      Date.now()
    );
    // Remove from ballot
    db.prepare('DELETE FROM hof_ballot WHERE league_id = ? AND player_id = ?').run(leagueId, c.player_id);
  }
}

function runVeteransCommittee(db: ReturnType<typeof getDb>, leagueId: number, seasonNumber: number, worldgenSeed: number): void {
  // E-3: tragedy victims — query via memorial=1 OR tragedy_victim=1 (no retirement required)
  // Exclude gambling_ban=1 or ped_offenses>=3
  // Also include ballot washouts (years_on_ballot >= 10 removed from ballot)

  // Collect candidates:
  // 1. Tragedy victims not yet inducted
  const tragedyVictims = prepared(
    `SELECT p.id FROM players p
     WHERE p.league_id = ? AND (p.memorial = 1 OR p.tragedy_victim = 1)
       AND p.gambling_ban = 0 AND p.ped_offenses < 3
       AND NOT EXISTS (SELECT 1 FROM hall_of_fame hof WHERE hof.league_id = ? AND hof.player_id = p.id)`
  ).all(leagueId, leagueId) as Array<{ id: number }>;

  // Pick one — prioritize tragedy victims, then any available
  if (tragedyVictims.length > 0) {
    const rng = seedFor(`vet_committee_${seasonNumber}`, worldgenSeed);
    const pick = tragedyVictims[Math.floor(rng() * tragedyVictims.length)]!;
    const stats = computeCareerStats(db, leagueId, pick.id);

    db.prepare(
      `INSERT OR IGNORE INTO hall_of_fame
         (league_id, player_id, induction_season, vote_share, veterans_committee, ped_flag, wing, memorial, career_stats_at_induction, created_at)
       VALUES (?, ?, ?, 0, 1, 0, 'player', 1, ?, ?)`
    ).run(
      leagueId, pick.id, seasonNumber,
      JSON.stringify({ career_hr: stats.career_hr, career_hits: stats.career_hits, position: stats.position, note: 'Special Induction — Veterans Committee' }),
      Date.now()
    );
    console.log(`[offseason] Veterans committee inducted tragedy victim player ${pick.id} for season ${seasonNumber}`);
  }
}

// Step 1: Retirement — players age 40+ retire
// Determine coaching specialty from player position
function coachingSpecialty(position: string, speed: number): 'pitching_coach' | 'hitting_coach' | 'bench_coach' | 'third_base_coach' | 'manager' {
  if (position === 'C' || position === 'SP' || position === 'RP') return 'pitching_coach';
  if (position === 'SS' || position === '2B') return 'bench_coach';
  if ((position === 'LF' || position === 'CF' || position === 'RF') && speed >= 70) return 'third_base_coach';
  if (position === '1B' || position === 'DH') return 'hitting_coach';
  return 'hitting_coach'; // default fallback for remaining positions (3B, OF without speed)
}

async function runRetirementStep(leagueId: number, seasonNumber: number): Promise<void> {
  const db = getDb();

  const retirees = prepared(
    'SELECT * FROM players WHERE league_id = ? AND age >= 40'
  ).all(leagueId) as PlayerRow[];

  let coachingCount = 0;
  for (const player of retirees) {
    // AB-NULL FIX §2.1: also clear is_on_25man and minor_level so retired players don't
    // appear as phantom 25-man members (was creating 717+ ghost rows after 11 seasons).
    db.prepare('UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, is_on_25man = 0, minor_level = NULL WHERE id = ?').run(player.id);
    db.prepare(
      'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      leagueId, seasonNumber, 'retirement',
      player.team_id,
      player.id,
      `${player.first_name} ${player.last_name} retires after a distinguished career.`,
      Date.now()
    );

    // Step 6: Player-to-Coach Pipeline
    // Retired player with leadership >= 70 AND coachability >= 65 enters coaching_candidates
    const leadership = player.leadership ?? 0;
    const coachability = player.coachability ?? 0;
    if (leadership >= 70 && coachability >= 65) {
      const careerOverall = player.overall_rating; // use retirement rating as career overall proxy
      // Coaching rating = leadership × 0.5 + coachability × 0.3 + career_overall × 0.2
      let coachingRating = Math.round(leadership * 0.5 + coachability * 0.3 + careerOverall * 0.2);
      // Former stars (career overall 80+): +10 bonus
      if (careerOverall >= 80) coachingRating += 10;
      coachingRating = Math.min(110, Math.max(0, coachingRating));

      const specialty = coachingSpecialty(player.position, player.speed ?? 0);

      // Idempotent: skip if player already in coaching_candidates
      const existing = db.prepare('SELECT id FROM coaching_candidates WHERE player_id = ?').get(player.id) as { id: number } | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO coaching_candidates (league_id, player_id, specialty, coaching_rating, available, available_since, created_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        ).run(leagueId, player.id, specialty, coachingRating, seasonNumber, Date.now());
        coachingCount++;
      }
    }
  }

  console.log(`[offseason] Retirement: ${retirees.length} players retired, ${coachingCount} entered coaching pool`);
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

      // Development model — AB-10 RULING: young minor leaguer growth (+0..+3) REMOVED.
      // Minor leaguer growth now happens ONLY in-season via prospectDev.ts.
      // Keep: peak/decline curves for 28+ players (applies to MLB and AAA players).
      if (newAge >= 28 && newAge <= 32) {
        // Stars in peak years: -1 to +1
        ratingChange = randInt(rng, -1, 1);
      } else if (newAge >= 33) {
        // Aging decline: -2 to 0
        ratingChange = randInt(rng, -2, 0);
      }

      let newRating = Math.max(25, Math.min(99, player.overall_rating + ratingChange));

      // 5% injury chance per season
      const injured = rng() < 0.05 ? 1 : 0;

      // Potential reveal at 25
      const potentialRevealed = (newAge >= 25 || player.potential_revealed === 1) ? 1 : 0;

      // Contract year reduction
      const newContractYears = Math.max(0, player.contract_years_remaining - 1);

      // AB-10: Bust downgrade — once per player per season, AFTER aging.
      // If newAge === 26 AND minor_level IN ('AA','A','Rookie') AND potential IN ('C','D'):
      // potential='D', overall_rating = MIN(overall_rating, 65).
      let newPotential = player.potential;
      const bustLevels = ['AA', 'A', 'Rookie'];
      if (newAge === 26 && player.minor_level !== null && bustLevels.includes(player.minor_level) &&
          (player.potential === 'C' || player.potential === 'D')) {
        newPotential = 'D';
        newRating = Math.min(newRating, 65);
      }

      db.prepare(
        'UPDATE players SET age = ?, overall_rating = ?, potential = ?, is_injured = ?, potential_revealed = ?, contract_years_remaining = ? WHERE id = ?'
      ).run(newAge, newRating, newPotential, injured, potentialRevealed, newContractYears, player.id);
    }
  });

  devTx();
  console.log(`[offseason] Development: ${players.length} players aged and developed`);

  // AB-10 FIX §1.1b: Promote prospects up a level when they outgrow their current one.
  // This keeps AAA stocked over multi-season play after the initial worldgen cohort graduates.
  runProspectPromotionStep(leagueId, db);
}

// AB-10 §1.1b: Offseason prospect level promotion pass.
// Runs once per offseason (not per tick) to avoid churn.
// Rules:
//   A  with overall_rating >= 50 AND age <= 25 → promote to AA
//   AA with overall_rating >= 58 AND age <= 27 → promote to AAA
// Cap: team's AAA count must not exceed 40-man space minus 25-man (i.e., 15 max).
function runProspectPromotionStep(leagueId: number, db: ReturnType<typeof getDb>): void {
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
  let promoted = 0;

  const promotionTx = db.transaction(() => {
    for (const team of teams) {
      // Count current AAA on this team
      const aaaCount = (prepared(
        `SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND minor_level = 'AAA'`
      ).get(team.id) as { cnt: number }).cnt;

      const aaaCapacity = Math.max(0, 15 - aaaCount); // Max 15 AAA slots (40-man minus 25-man)

      // Promote AA → AAA (highest rated eligible first, within capacity)
      if (aaaCapacity > 0) {
        const aaToAaa = prepared(
          `SELECT * FROM players WHERE team_id = ? AND minor_level = 'AA'
           AND overall_rating >= 58 AND age <= 27
           ORDER BY overall_rating DESC LIMIT ?`
        ).all(team.id, aaaCapacity) as PlayerRow[];

        for (const p of aaToAaa) {
          prepared(`UPDATE players SET minor_level = 'AAA' WHERE id = ?`).run(p.id);
          promoted++;
        }
      }

      // Promote A → AA (no cap needed on AA, just promote eligible)
      const aToAa = prepared(
        `SELECT * FROM players WHERE team_id = ? AND minor_level = 'A'
         AND overall_rating >= 50 AND age <= 25
         ORDER BY overall_rating DESC LIMIT 10`
      ).all(team.id) as PlayerRow[];

      for (const p of aToAa) {
        prepared(`UPDATE players SET minor_level = 'AA' WHERE id = ?`).run(p.id);
        promoted++;
      }
    }
  });

  promotionTx();
  console.log(`[offseason] Prospect promotion: ${promoted} players promoted`);
}

// Step 3: Non-tender — analytics/small-market GMs non-tender high-arb players
// Per §6 [AB-12]: runs before free_agency; at least one non-tender forced if zero natural.
async function runNonTenderStep(leagueId: number, seasonNumber: number): Promise<void> {
  const { getArchetype } = await import('./archetypes.js');
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
  const db = getDb();
  let totalNonTenders = 0;

  const nonTenderTx = db.transaction(() => {
    for (const team of teams) {
      if (team.interim_gm === 1) continue;

      const archetype = getArchetype(team.gm_archetype ?? 'balanced');
      if (!archetype.nontender_arb_year || !archetype.nontender_salary_threshold) continue;

      // Non-tender players with arb-year >= 3 (approx: service_time_days >= 3*30=90)
      // and salary > threshold
      const candidates = prepared(
        `SELECT * FROM players
         WHERE team_id = ? AND is_on_mlb_roster = 1
           AND service_time_days >= ? AND annual_salary > ?
         ORDER BY annual_salary DESC`
      ).all(
        team.id,
        archetype.nontender_arb_year * 30,
        archetype.nontender_salary_threshold
      ) as PlayerRow[];

      for (const player of candidates) {
        // Non-tender: release to FA pool
        db.prepare(
          'UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, is_on_25man = 0, minor_level = NULL WHERE id = ?'
        ).run(player.id);

        const ntResult = db.prepare(
          `INSERT INTO transactions
             (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
           VALUES (?, ?, 'non_tender', ?, ?, NULL, ?)`
        ).run(leagueId, seasonNumber, team.id, player.id, Date.now());

        // §1.1(e): Insert non-tender news item
        insertTransactionNewsItem({
          leagueId,
          seasonNumber,
          gameNumber: 0,
          eventType: 'non_tender',
          teamId: team.id,
          playerId: player.id,
          sourceTable: 'transactions',
          sourceId: ntResult.lastInsertRowid as number,
        });

        totalNonTenders++;
      }
    }

    // Force at least one non-tender if zero natural candidates (eval G23)
    if (totalNonTenders === 0) {
      // Find highest-salary player with service_time_days >= 4*30 AND age >= 30
      // on any small/medium market team
      const forcedCandidate = db.prepare(
        `SELECT p.* FROM players p
         JOIN teams t ON t.id = p.team_id
         WHERE t.league_id = ? AND t.market_size IN ('small','medium') AND t.interim_gm = 0
           AND p.is_on_mlb_roster = 1 AND p.service_time_days >= 120 AND p.age >= 30
         ORDER BY p.annual_salary DESC
         LIMIT 1`
      ).get(leagueId) as PlayerRow | undefined;

      if (forcedCandidate) {
        db.prepare(
          'UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, is_on_25man = 0, minor_level = NULL WHERE id = ?'
        ).run(forcedCandidate.id);

        const forcedNtResult = db.prepare(
          `INSERT INTO transactions
             (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
           VALUES (?, ?, 'non_tender', ?, ?, NULL, ?)`
        ).run(leagueId, seasonNumber, forcedCandidate.team_id, forcedCandidate.id, Date.now());

        // §1.1(e): Insert forced non-tender news item
        insertTransactionNewsItem({
          leagueId,
          seasonNumber,
          gameNumber: 0,
          eventType: 'non_tender',
          teamId: forcedCandidate.team_id,
          playerId: forcedCandidate.id,
          sourceTable: 'transactions',
          sourceId: forcedNtResult.lastInsertRowid as number,
        });

        totalNonTenders++;
        console.log(`[offseason] Forced non-tender: ${forcedCandidate.first_name} ${forcedCandidate.last_name}`);
      }
    }
  });

  nonTenderTx();
  console.log(`[offseason] Non-tender step: ${totalNonTenders} players non-tendered`);
}

// Step 4 (was 3): Free agency — D20
async function runFreeAgencyStep(leagueId: number, seasonNumber?: number): Promise<void> {
  const db = getDb();

  // Players with 0 contract years remaining become free agents
  const freeAgents = prepared(
    'SELECT * FROM players WHERE league_id = ? AND contract_years_remaining <= 0 AND team_id IS NOT NULL'
  ).all(leagueId) as PlayerRow[];

  for (const fa of freeAgents) {
    // AB-NULL FIX §2.1: also clear is_on_25man so free agents don't appear as phantom 25-man members.
    prepared('UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, is_on_25man = 0, minor_level = NULL WHERE id = ?').run(fa.id);
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
      const faSignResult = db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, actualSeason, 'free_agent_signing',
        bestTeamId, fa.id,
        `${signingTeam?.city ?? 'Unknown'} signs ${fa.first_name} ${fa.last_name} for $${(bestBid / 1_000_000).toFixed(1)}M`,
        Date.now()
      );

      // §1.1(e): Insert FA signing news item
      insertTransactionNewsItem({
        leagueId,
        seasonNumber: actualSeason,
        gameNumber: 0,
        eventType: 'free_agent_signing',
        teamId: bestTeamId,
        playerId: fa.id,
        sourceTable: 'transactions',
        sourceId: faSignResult.lastInsertRowid as number,
      });
    }
  }

  console.log(`[offseason] Free agency: ${freeAgents.length} released, ${availableFAs.length} FA pool`);
}

// Step 4: Front office changes
async function runFrontOfficeStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const rng = seedFor('front_office', seed);
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
  const db = getDb();

  // Check gm_resign_pending_season for owned team
  const fs = getFranchiseState(leagueId);

  for (const team of teams) {
    // L5: Track whether this team had its GM replaced via resign path (to skip meddling-owner re-fire)
    let gmJustReplaced = false;

    // Handle GM resignation pending (low-confidence, owned team)
    if (fs && fs.owned_team_id === team.id && fs.gm_resign_pending_season === seasonNumber) {
      const newFirst = ['Alex', 'Chris', 'Pat', 'Sam', 'Terry'][Math.floor(rng() * 5)] ?? 'Alex';
      const newLast = ['Martinez', 'Garcia', 'Wilson', 'Davis', 'Miller'][Math.floor(rng() * 5)] ?? 'Garcia';
      const newPhilosophy = GM_PHILOSOPHIES[Math.floor(rng() * 3)] ?? 'balanced';
      const newRisk = GM_RISK_TOLERANCES[Math.floor(rng() * 3)] ?? 'moderate';
      const newFocus = GM_FOCUSES[Math.floor(rng() * 3)] ?? 'hitting';

      const resignReason = 'Resigned citing philosophical differences with ownership';
      const resignHeadline = `${team.gm_name} resigned, ${team.city} ${team.name} — ${resignReason}`;
      const resignFoeResult = db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'gm_fired',
        team.gm_name, `${newFirst} ${newLast}`,
        `${team.gm_name} resigned. ${newFirst} ${newLast} takes over as GM.`,
        resignReason, 'Hired in offseason', Date.now()
      );
      insertFrontOfficeNewsItem({
        leagueId, seasonNumber, gameNumber: 0, eventType: 'gm_fired',
        teamId: team.id, sourceTable: 'front_office_events',
        sourceId: resignFoeResult.lastInsertRowid as number,
        headlineText: resignHeadline,
        detailsJson: JSON.stringify({ reason: resignReason, eventType: 'gm_fired', teamId: team.id }),
      });
      db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)'
      ).run(leagueId, seasonNumber, 'gm_fired', team.id, resignHeadline, Date.now());
      db.prepare(
        'UPDATE teams SET gm_name = ?, gm_philosophy = ?, gm_risk_tolerance = ?, gm_focus = ?, interim_gm = 0 WHERE id = ?'
      ).run(`${newFirst} ${newLast}`, newPhilosophy, newRisk, newFocus, team.id);
      resetGmConfidence(leagueId);
      db.prepare('UPDATE franchise_state SET gm_resign_pending_season = NULL WHERE league_id = ?').run(leagueId);
      gmJustReplaced = true; // L5: skip meddling-owner re-fire for this team this pass
    }

    // Manager fired if job_security < 3 (60% chance)
    if (team.job_security < 3 && rng() < 0.6) {
      const newFirst = ['Bob', 'Tom', 'Mike', 'Dave', 'Jim'][Math.floor(rng() * 5)] ?? 'Bob';
      const newLast = ['Johnson', 'Smith', 'Williams', 'Brown', 'Jones'][Math.floor(rng() * 5)] ?? 'Johnson';
      const newStyle = MANAGER_STYLES[Math.floor(rng() * 3)] ?? 'balanced';

      const mgrReason = `Fired after going ${team.wins}-${team.losses} through ${team.games_played} games (Season ${seasonNumber})`;
      const mgrHeadline = `${team.manager_name} fired, ${team.city} ${team.name} — ${mgrReason}`;
      const mgrFoeResult = db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'manager_fired',
        team.manager_name,
        `${newFirst} ${newLast}`,
        `${team.manager_name} fired after poor performance. ${newFirst} ${newLast} hired as new manager.`,
        mgrReason, 'Hired in offseason', Date.now()
      );

      // §1.1(e): Insert offseason manager firing news item
      insertFrontOfficeNewsItem({
        leagueId,
        seasonNumber,
        gameNumber: 0,
        eventType: 'manager_fired',
        teamId: team.id,
        sourceTable: 'front_office_events',
        sourceId: mgrFoeResult.lastInsertRowid as number,
        headlineText: mgrHeadline,
        detailsJson: JSON.stringify({ reason: mgrReason, eventType: 'manager_fired', teamId: team.id }),
      });

      // D6a: transaction parity row
      db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)'
      ).run(leagueId, seasonNumber, 'manager_fired', team.id, mgrHeadline, Date.now());

      db.prepare(
        'UPDATE teams SET manager_name = ?, manager_style = ?, job_security = 5, interim_manager = 0 WHERE id = ?'
      ).run(`${newFirst} ${newLast}`, newStyle, team.id);
    } else {
      // Reduce job security by win rate; clear interim_manager flag at offseason
      const winPct = team.wins / Math.max(1, team.wins + team.losses);
      const securityDelta = winPct > 0.55 ? 1 : winPct < 0.45 ? -1 : 0;
      const newSecurity = Math.max(1, Math.min(10, team.job_security + securityDelta));

      // §3.5: If clearing interim_manager but manager_name is still 'Interim Manager',
      // assign a fresh permanent manager name/ratings so no team ends up with
      // interim_manager=0 AND manager_name='Interim Manager'.
      if (team.interim_manager === 1 && team.manager_name === 'Interim Manager') {
        const permFirst = ['Bob', 'Tom', 'Mike', 'Dave', 'Jim'][Math.floor(rng() * 5)] ?? 'Bob';
        const permLast = ['Johnson', 'Smith', 'Williams', 'Brown', 'Jones'][Math.floor(rng() * 5)] ?? 'Johnson';
        const permStyle = MANAGER_STYLES[Math.floor(rng() * 3)] ?? 'balanced';
        db.prepare(
          'UPDATE teams SET manager_name = ?, manager_style = ?, job_security = ?, interim_manager = 0 WHERE id = ?'
        ).run(`${permFirst} ${permLast}`, permStyle, newSecurity, team.id);
      } else {
        db.prepare('UPDATE teams SET job_security = ?, interim_manager = 0 WHERE id = ?').run(newSecurity, team.id);
      }
    }

    // GM fired if owner meddling (40% if win_pct < 0.45)
    // L5: Skip if GM was just replaced via resign path this same offseason pass
    const winPct = team.wins / Math.max(1, team.wins + team.losses);
    if (!gmJustReplaced && team.owner_personality === 'meddling' && winPct < 0.45 && rng() < 0.4) {
      const newFirst = ['Alex', 'Chris', 'Pat', 'Sam', 'Terry'][Math.floor(rng() * 5)] ?? 'Alex';
      const newLast = ['Martinez', 'Garcia', 'Wilson', 'Davis', 'Miller'][Math.floor(rng() * 5)] ?? 'Garcia';
      const newPhilosophy = GM_PHILOSOPHIES[Math.floor(rng() * 3)] ?? 'balanced';
      const newRisk = GM_RISK_TOLERANCES[Math.floor(rng() * 3)] ?? 'moderate';
      const newFocus = GM_FOCUSES[Math.floor(rng() * 3)] ?? 'hitting';

      const gmUnder500 = Math.max(0, team.losses - team.wins);
      const gmReason = `Fired after team went ${team.wins}-${team.losses}, ${gmUnder500} games under .500 at time of dismissal`;
      const gmHeadline = `${team.gm_name} fired, ${team.city} ${team.name} — ${gmReason}`;
      const gmFoeResult = db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'gm_fired',
        team.gm_name, `${newFirst} ${newLast}`,
        `${team.gm_name} dismissed. ${newFirst} ${newLast} takes over as GM with a ${newPhilosophy} philosophy.`,
        gmReason, 'Hired in offseason', Date.now()
      );

      // §1.1(e): Insert offseason GM firing news item
      insertFrontOfficeNewsItem({
        leagueId,
        seasonNumber,
        gameNumber: 0,
        eventType: 'gm_fired',
        teamId: team.id,
        sourceTable: 'front_office_events',
        sourceId: gmFoeResult.lastInsertRowid as number,
        headlineText: gmHeadline,
        detailsJson: JSON.stringify({ reason: gmReason, eventType: 'gm_fired', teamId: team.id }),
      });

      // D6a: transaction parity row
      db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)'
      ).run(leagueId, seasonNumber, 'gm_fired', team.id, gmHeadline, Date.now());

      db.prepare(
        'UPDATE teams SET gm_name = ?, gm_philosophy = ?, gm_risk_tolerance = ?, gm_focus = ?, interim_gm = 0 WHERE id = ?'
      ).run(`${newFirst} ${newLast}`, newPhilosophy, newRisk, newFocus, team.id);

      // Reset GM confidence if owned team
      if (fs && fs.owned_team_id === team.id) {
        resetGmConfidence(leagueId);
      }
    }

    // If team still has interim GM at offseason (fired mid-season, non-meddling owner),
    // hire a permanent GM now. Also clear interim flags universally at offseason end.
    if (team.interim_gm === 1) {
      const newFirst = ['Alex', 'Chris', 'Pat', 'Sam', 'Terry'][Math.floor(rng() * 5)] ?? 'Alex';
      const newLast = ['Martinez', 'Garcia', 'Wilson', 'Davis', 'Miller'][Math.floor(rng() * 5)] ?? 'Garcia';
      const newPhilosophy = GM_PHILOSOPHIES[Math.floor(rng() * 3)] ?? 'balanced';
      const newRisk = GM_RISK_TOLERANCES[Math.floor(rng() * 3)] ?? 'moderate';
      const newFocus = GM_FOCUSES[Math.floor(rng() * 3)] ?? 'hitting';
      db.prepare(
        'UPDATE teams SET gm_name = ?, gm_philosophy = ?, gm_risk_tolerance = ?, gm_focus = ?, interim_gm = 0 WHERE id = ?'
      ).run(`${newFirst} ${newLast}`, newPhilosophy, newRisk, newFocus, team.id);
      // D6a: write FO event for interim→permanent conversion
      db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'gm_fired',
        'Interim GM', `${newFirst} ${newLast}`,
        `Interim GM replaced by permanent hire ${newFirst} ${newLast}.`,
        'Hired in offseason', 'Hired in offseason', Date.now()
      );
      if (fs && fs.owned_team_id === team.id) {
        resetGmConfidence(leagueId);
      }
    }

    // 2% owner sell
    if (rng() < 0.02) {
      const newFirst = ['Richard', 'William', 'James', 'George', 'Edward'][Math.floor(rng() * 5)] ?? 'Richard';
      const newLast = ['Thompson', 'Anderson', 'Taylor', 'Moore', 'Jackson'][Math.floor(rng() * 5)] ?? 'Thompson';
      const newPersonality = OWNER_PERSONALITIES[Math.floor(rng() * OWNER_PERSONALITIES.length)] ?? 'moderate';

      const saleReason = `Sold franchise after Season ${seasonNumber}. New ownership group takes control.`;
      const saleHeadline = `${team.owner_name} sells franchise, ${team.city} ${team.name} — ${saleReason}`;
      const soldFoeResult = db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'owner_sold_team',
        team.owner_name, `${newFirst} ${newLast}`,
        `${team.owner_name} sells the franchise to ${newFirst} ${newLast}.`,
        saleReason, Date.now()
      );

      // §1.1(e): Insert owner sold team news item
      insertFrontOfficeNewsItem({
        leagueId,
        seasonNumber,
        gameNumber: 0,
        eventType: 'owner_sold_team',
        teamId: team.id,
        sourceTable: 'front_office_events',
        sourceId: soldFoeResult.lastInsertRowid as number,
        headlineText: saleHeadline,
        detailsJson: JSON.stringify({ reason: saleReason, eventType: 'owner_sold_team', teamId: team.id }),
      });

      // D6a: transaction parity row
      db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)'
      ).run(leagueId, seasonNumber, 'owner_sold_team', team.id, saleHeadline, Date.now());

      db.prepare('UPDATE teams SET owner_name = ?, owner_personality = ? WHERE id = ?')
        .run(`${newFirst} ${newLast}`, newPersonality, team.id);
    }

    // §5.9: 0.5% owner death (weighted by age)
    const ageFactor = team.owner_age > 70 ? 0.02 : 0.005;
    if (rng() < ageFactor) {
      const heirFirst = ['Robert', 'Henry', 'Arthur', 'Charles', 'Winston'][Math.floor(rng() * 5)] ?? 'Robert';
      const heirLast = team.owner_name.split(' ')[1] ?? 'Heir'; // Same surname for heir

      const deathReason = `Passed away during Season ${seasonNumber}. Succeeded by ${heirFirst} ${heirLast}.`;
      const deathHeadline = `${team.owner_name} passes away, ${team.city} ${team.name} — ${deathReason}`;
      const diedFoeResult = db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'owner_died',
        team.owner_name, `${heirFirst} ${heirLast}`,
        `${team.owner_name} passed away. Heir ${heirFirst} ${heirLast} takes control of the franchise.`,
        deathReason, Date.now()
      );

      // §1.1(e): Insert owner died news item
      insertFrontOfficeNewsItem({
        leagueId,
        seasonNumber,
        gameNumber: 0,
        eventType: 'owner_died',
        teamId: team.id,
        sourceTable: 'front_office_events',
        sourceId: diedFoeResult.lastInsertRowid as number,
        headlineText: deathHeadline,
        detailsJson: JSON.stringify({ reason: deathReason, eventType: 'owner_died', teamId: team.id }),
      });

      // D6a: transaction parity row
      db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)'
      ).run(leagueId, seasonNumber, 'owner_died', team.id, deathHeadline, Date.now());

      const heirPersonality = OWNER_PERSONALITIES[Math.floor(rng() * OWNER_PERSONALITIES.length)] ?? 'moderate';
      db.prepare('UPDATE teams SET owner_name = ?, owner_personality = ? WHERE id = ?').run(`${heirFirst} ${heirLast}`, heirPersonality, team.id);
    }
  }

  // NOTE: W/L reset moved to finalizeOffseason() — must happen AFTER annual_draft reads standings (§2.6)
  console.log(`[offseason] Front office changes complete`);
}

// Step 5: Annual draft
async function runAnnualDraftStep(league: LeagueRow, isTurbo: boolean): Promise<void> {
  await runAnnualDraft(league, isTurbo);
  // §1.1 Iter-5: After annual draft, ensure all teams meet position minimums
  // (C, SS, CF, SP>=2, CL>=1). This prevents Season N+1's game sim from stalling
  // on teams with zero starting pitchers after retirement+FA depletion.
  const { validatePostDraftRosters } = await import('./worldgen.js');
  validatePostDraftRosters(league.id);
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

  // §2.8: Wrap all offseason finalization writes in a transaction (atomic)
  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE leagues SET season_number = ?, phase = ?, offseason_step = NULL, current_game_number = 0, current_game_date = 0, last_game_id = 0 WHERE id = ?'
    ).run(newSeason, 'regular_season', leagueId);

    // Reset W/L/runs/games_played for the new season — must happen AFTER annual_draft (§2.6)
    db.prepare('UPDATE teams SET wins = 0, losses = 0, runs_scored = 0, runs_allowed = 0, games_played = 0 WHERE league_id = ?').run(leagueId);

    // D21: Remaining undrafted players from original pool become free agents
    db.prepare(
      'UPDATE players SET team_id = NULL WHERE league_id = ? AND is_drafted = 0 AND team_id IS NULL'
    ).run(leagueId);
  });

  tx();

  // §1.1 Iter-5: Final roster validation before season N+1 starts
  // Belt-and-suspenders alongside the validator call after the annual draft step
  const { validatePostDraftRosters } = await import('./worldgen.js');
  validatePostDraftRosters(leagueId);

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
