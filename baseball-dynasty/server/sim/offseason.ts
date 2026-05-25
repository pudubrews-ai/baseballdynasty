// Offseason module — stepwise with checkpointing via D26
// Steps: season_archive → retirement → development → non_tender → free_agency → hof_voting → financial_update → front_office → annual_draft → done

import { getDb, prepared, type LeagueRow, type TeamRow, type PlayerRow } from '../db.js';
import { seedFor, randInt, randNormal } from './prng.js';
import { runAnnualDraft } from './draft.js';
import { callSeasonNarrative } from '../services/llm.js';
import { insertTransactionNewsItem, insertFrontOfficeNewsItem, insertNewsItem } from './news.js';
import { getFranchiseState, resetGmConfidence } from './franchise.js';
import { classifySale, checkRelocationThreat, setRelocationThreat, resolveRelocation } from './sales.js';
import { assignInjury } from './injury.js';
import { computeAttendanceRate } from './attendanceCalc.js';

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

  // v0.5.0: Updated step order per Orchestrator Decision (Section 5.0)
  // arbitration REPLACES non_tender; new steps added for Rule 5, international, awards, rivalries, stadium
  const steps = [
    'season_archive', 'retirement', 'development',
    'arbitration', 'free_agency',
    'international_signing', 'annual_draft', 'rule5_protect', 'rule5_draft',
    'award_voting', 'rivalry_update', 'stadium_resolve', 'financial_update',
    'front_office', 'relocation_resolve', 'done',
  ];
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
        // Legacy step name — now handled by 'arbitration'; skip if reached via old checkpoint
        await runArbitrationStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'arbitration':
        await runArbitrationStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'free_agency':
        await runFreeAgencyStep(leagueId, league.season_number);
        break;
      case 'hof_voting':
        await runHofVotingStep(leagueId, league.season_number, league.worldgen_seed);
        break;
      case 'international_signing':
        await runInternationalSigningStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'rule5_protect':
        await runRule5ProtectStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'rule5_draft':
        await runRule5DraftStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'award_voting':
        await runAwardVotingStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'rivalry_update':
        await runRivalryUpdateStep(leagueId, league.season_number);
        break;
      case 'stadium_resolve':
        await runStadiumResolveStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'financial_update':
        await runFinancialUpdateStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'front_office':
        await runFrontOfficeStep(leagueId, league.season_number, league.worldgen_seed ^ league.season_number);
        break;
      case 'relocation_resolve':
        await runRelocationResolveStep(leagueId, league.season_number, league.worldgen_seed);
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

      // Compute actual payroll from live player salaries (avoids cumulative drift
      // from team.current_payroll which can accumulate across seasons)
      const actualPayroll = (db.prepare(
        'SELECT COALESCE(SUM(annual_salary), 0) AS total FROM players WHERE team_id = ? AND contract_years_remaining > 0 AND annual_salary > 0'
      ).get(team.id) as { total: number }).total;

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
        team.revenue ?? 0, actualPayroll, team.payroll_budget ?? 0,
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
// Step 7: HOF Voting — fully implemented below
// =========================================================
async function runHofVotingStep(leagueId: number, seasonNumber: number, worldgenSeed: number): Promise<void> {
  await runHofVoting(leagueId, seasonNumber, worldgenSeed);
}

// =========================================================
// Step 5: Financial Update — fully implemented below
// =========================================================
async function runFinancialUpdateStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  await runFinancialUpdate(leagueId, seasonNumber, seed);
}

// =========================================================
// Step 5: Financial Update — revenue model + budget updates + franchise valuation
// v0.5.0: PINNED constants (Section 5g). Do NOT change these values.
// =========================================================

// PINNED revenue constants — Section 5g
const REVENUE_BASE_MARKET: Record<string, number> = {
  mega: 40_000_000, large: 25_000_000, medium: 15_000_000, small: 8_000_000,
};
const REVENUE_AVG_TICKET: Record<string, number> = {
  mega: 45, large: 35, medium: 25, small: 20,
};
const REVENUE_BROADCASTING_BASE = 25_000_000;
const REVENUE_BROADCASTING_PLAYOFF_BONUS = 5_000_000; // per playoff round
const REVENUE_BROADCASTING_CHAMPIONSHIP = 25_000_000;
const REVENUE_MERCH_STAR_BONUS = 2_000_000;
const REVENUE_MERCH_CHAMPIONSHIP = 8_000_000;

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
        `SELECT wins, losses, made_playoffs, won_championship, playoff_round,
                revenue, payroll_budget FROM franchise_season_history
         WHERE league_id = ? AND team_id = ? AND season_number = ?`
      ).get(leagueId, team.id, seasonNumber) as {
        wins: number; losses: number; made_playoffs: number; won_championship: number;
        playoff_round: string | null; revenue: number; payroll_budget: number;
      } | undefined;

      if (!thisHistory) continue; // no season data yet

      const gamesPlayed = thisHistory.wins + thisHistory.losses;
      const winPct = gamesPlayed > 0 ? thisHistory.wins / gamesPlayed : 0.5;

      // Compute season attendance using shared computeAttendanceRate
      const capacities: Record<string, number> = {
        mega: 50000, large: 42000, medium: 35000, small: 28000,
      };
      const capacity = team.stadium_capacity > 0 ? team.stadium_capacity : (capacities[team.market_size] ?? 35000);
      const homeGames = Math.round(gamesPlayed / 2); // approx home games

      // Check rivalries for this team
      const rivals = prepared(
        `SELECT team_a_id, team_b_id FROM rivalries WHERE league_id = ? AND rivalry_score > 0`
      ).all(leagueId) as Array<{ team_a_id: number; team_b_id: number }>;
      const rivalIds = rivals
        .filter(r => r.team_a_id === team.id || r.team_b_id === team.id)
        .map(r => r.team_a_id === team.id ? r.team_b_id : r.team_a_id);

      // Check for star player
      const starCheck = prepared(
        `SELECT 1 FROM players WHERE team_id = ? AND is_on_25man = 1 AND overall_rating >= 85 LIMIT 1`
      ).get(team.id) as unknown | undefined;
      const hasStarPlayer = !!starCheck;

      // Playoff race: within 5 games of top 4 in conference
      const confRow = prepared('SELECT conference FROM teams WHERE id = ?').get(team.id) as { conference: string } | undefined;
      let isPlayoffRace = false;
      if (confRow) {
        const confTeams = prepared(
          `SELECT wins, losses FROM teams WHERE league_id = ? AND conference = ? ORDER BY wins DESC LIMIT 4`
        ).all(leagueId, confRow.conference) as Array<{ wins: number; losses: number }>;
        if (confTeams.length >= 4) {
          const cutoff = confTeams[3];
          if (cutoff) {
            const cutoffPct = (cutoff.wins + cutoff.losses) > 0 ? cutoff.wins / (cutoff.wins + cutoff.losses) : 0.5;
            isPlayoffRace = winPct >= cutoffPct - 0.1; // within ~5 games on 50-game schedule
          }
        }
      }

      const attendanceRate = computeAttendanceRate(
        team, rivalIds, isPlayoffRace,
        false, // honeymoon handled by column in team
        hasStarPlayer,
        false  // per-season average: no specific rivalry game
      );
      const avgGameAttendance = Math.round(attendanceRate * capacity);
      const seasonAttendanceTotal = avgGameAttendance * homeGames;

      // PINNED revenue formula
      const ticketPrice = REVENUE_AVG_TICKET[team.market_size] ?? 25;
      const attendanceRevenue = seasonAttendanceTotal * ticketPrice;
      const premiumSeatingRevenue = Math.round(attendanceRevenue * 0.08);
      const concessionsRevenue = Math.round(attendanceRevenue * 0.12);

      // Broadcasting
      const playoffRound = thisHistory.playoff_round ?? 'missed';
      const playoffRoundsAdvanced = playoffRound === 'champion' ? 3
        : playoffRound === 'finalist' ? 2
        : playoffRound === 'semis' ? 1
        : 0;
      const broadcastingRevenue = REVENUE_BROADCASTING_BASE
        + (playoffRoundsAdvanced * REVENUE_BROADCASTING_PLAYOFF_BONUS)
        + (thisHistory.won_championship === 1 ? REVENUE_BROADCASTING_CHAMPIONSHIP : 0);

      // Merchandise
      const merchandiseBase = Math.round(attendanceRevenue * 0.02);
      const merchandiseStarBonus = hasStarPlayer ? REVENUE_MERCH_STAR_BONUS : 0;
      const merchandiseChampBonus = thisHistory.won_championship === 1 ? REVENUE_MERCH_CHAMPIONSHIP : 0;
      const merchandiseRevenue = merchandiseBase + merchandiseStarBonus + merchandiseChampBonus;

      // Luxury tax — read existing payroll
      const actualPayroll = (db.prepare(
        'SELECT COALESCE(SUM(annual_salary), 0) AS total FROM players WHERE team_id = ? AND contract_years_remaining > 0 AND annual_salary > 0'
      ).get(team.id) as { total: number }).total;
      const luxuryThreshold = 220_000_000;
      const luxuryTaxPayments = actualPayroll > luxuryThreshold
        ? Math.round((actualPayroll - luxuryThreshold) * 0.20)
        : 0;

      // Base market revenue
      const baseMarketRevenue = REVENUE_BASE_MARKET[team.market_size] ?? 8_000_000;

      const annualRevenueDollars = Math.max(0,
        baseMarketRevenue
        + attendanceRevenue
        + premiumSeatingRevenue
        + concessionsRevenue
        + broadcastingRevenue
        + merchandiseRevenue
        - luxuryTaxPayments
      );

      // Guard: never NaN/Infinity
      const safeRevenue = Number.isFinite(annualRevenueDollars) ? annualRevenueDollars : 0;

      // Write revenue to teams.revenue (archived next season in archive step)
      db.prepare('UPDATE teams SET revenue = ? WHERE id = ?').run(safeRevenue, team.id);

      // Budget update logic — reads prior season
      const priorHistory = prepared(
        'SELECT revenue, payroll_budget FROM franchise_season_history WHERE league_id = ? AND team_id = ? AND season_number = ?'
      ).get(leagueId, team.id, prevSeason) as { revenue: number; payroll_budget: number } | undefined;

      const currentBudget = team.payroll_budget;
      let newBudget = currentBudget;
      const revMillions = safeRevenue / 1_000_000;
      const budgetMillions = currentBudget > 0 ? currentBudget / 1_000_000 : 1;

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
        const priorRevMillions = priorHistory.revenue > 0 ? priorHistory.revenue / 1_000_000 : 0;
        const priorBudgetMillions = priorHistory.payroll_budget > 0 ? priorHistory.payroll_budget / 1_000_000 : 1;
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
      // Revenue premium: scale franchise value with annualized revenue
      const revPremium = Math.round(safeRevenue / 1_000_000 * 2); // 2x revenue multiple

      const franchiseValue = Math.max(0, Math.round(
        baseVal
        + Math.round(totalWins * 0.1)
        + (champs * 50)
        + (seasonsInLeague * 2)
        + revPremium
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
  const inductedPlayerIds = new Set(toInduct.map(c => c.player_id));

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

  // E-2: unconditionally remove any ballot player at years_on_ballot >= 10 who was NOT inducted
  // (covers the case where a year-10 player cleared 75% but was cut by the max-3 cap)
  // Query the post-update values since the DB was already updated above.
  db.prepare(
    'DELETE FROM hof_ballot WHERE league_id = ? AND years_on_ballot >= 10'
  ).run(leagueId);
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

// NF-7: Try to hire a franchise legend (coaching candidate with 10+ seasons on this team) as manager.
// Returns the candidate's name if hired (and updates coaching_candidates), or null if none found.
function tryHireFranchiseLegendManager(
  db: ReturnType<typeof getDb>,
  leagueId: number,
  teamId: number,
  seasonNumber: number
): string | null {
  // Find coaching candidates who played 10+ seasons for this team (franchise legend)
  // Use franchise_player_season to count seasons as a member of this franchise.
  const legend = db.prepare(
    `SELECT cc.id, cc.player_id, p.first_name, p.last_name, cc.coaching_rating
     FROM coaching_candidates cc
     JOIN players p ON p.id = cc.player_id
     WHERE cc.league_id = ? AND cc.available = 1
       AND (
         SELECT COUNT(DISTINCT fps.season_number)
         FROM franchise_player_season fps
         WHERE fps.player_id = cc.player_id AND fps.team_id = ?
       ) >= 10
     ORDER BY cc.coaching_rating DESC
     LIMIT 1`
  ).get(leagueId, teamId) as { id: number; player_id: number; first_name: string; last_name: string; coaching_rating: number } | undefined;

  if (!legend) return null;

  // Mark as hired
  db.prepare(
    'UPDATE coaching_candidates SET available = 0, hired_team_id = ?, hired_season = ? WHERE id = ?'
  ).run(teamId, seasonNumber, legend.id);

  return `${legend.first_name} ${legend.last_name}`;
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
      // P3: use career_overall (peak rating) if available, fall back to current overall_rating
      const careerOverall = player.career_overall ?? player.overall_rating;
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

  // Build a map of team_id → medical_staff_rating for the offseason injury rolls
  const teamRows = prepared('SELECT id, medical_staff_rating FROM teams WHERE league_id = ?').all(leagueId) as Array<{ id: number; medical_staff_rating: number }>;
  const medStaffByTeam = new Map<number, number>();
  for (const t of teamRows) {
    medStaffByTeam.set(t.id, t.medical_staff_rating ?? 5);
  }

  const devTx = db.transaction(() => {
    for (const player of players) {
      const newAge = player.age + 1;
      let ratingChange = 0;

      // Development model — AB-10 RULING: young minor leaguer growth (+0..+3) REMOVED.
      // Minor leaguer growth now happens ONLY in-season via prospectDev.ts.
      // Keep: peak/decline curves for 28+ players (applies to MLB and AAA players).
      //
      // Step 13: Work-ethic aging modifications (L2: seeded, once per season per player)
      const workEthic = player.work_ethic ?? 50;
      const declineStartAge = workEthic >= 75 ? 34 : (workEthic <= 35 ? 31 : 33);
      const declineRateBonus = workEthic <= 35 ? 1.5 : (workEthic >= 75 ? 0.5 : 1.0);

      if (newAge >= 28 && newAge < declineStartAge) {
        // Stars in peak years: -1 to +1
        ratingChange = randInt(rng, -1, 1);
      } else if (newAge >= declineStartAge) {
        // Aging decline: modified by work ethic
        const baseDecline = randInt(rng, -2, 0);
        ratingChange = Math.min(0, Math.round(baseDecline * declineRateBonus));
      }

      // Fountain of youth (20%/season at age 36-38 with work_ethic >= 80)
      if (workEthic >= 80 && newAge >= 36 && newAge <= 38) {
        const wfRng = seedFor(`fountain_${leagueId}_${player.id}`, seed ^ player.id);
        if (wfRng() < 0.20) {
          ratingChange = Math.max(ratingChange, randInt(rng, 1, 2));
        }
      }

      let newRating = Math.max(25, Math.min(99, player.overall_rating + ratingChange));

      // 5% injury chance per season — P1.3 fix: assign full injury type/tier, not just is_injured flag
      const injured = rng() < 0.05 ? 1 : 0;
      let injType: string | null = null;
      let injTier: string | null = null;
      let injReturnGame: number | null = null;
      let injRehab = 0;
      if (injured === 1) {
        const medStaff = player.team_id != null ? (medStaffByTeam.get(player.team_id) ?? 5) : 5;
        // Offseason injury carries into early next season (up to 162 games remaining)
        const a = assignInjury(player.position, medStaff, 0, player.id, 162);
        injType = a.type;
        injTier = a.tier;
        injReturnGame = a.ilGames;
        injRehab = Math.min(a.rehabGames, 15); // enforce CHECK constraint rehab_games_remaining <= 15
      }

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

      // Step 13: Late-bloomer upgrade (10%/season): coachability >= 75 AND potential='B'
      if (player.coachability >= 75 && newPotential === 'B') {
        const lbRng = seedFor(`late_bloomer_${leagueId}_${player.id}`, seed ^ player.id);
        if (lbRng() < 0.10) {
          newPotential = 'A';
        }
      }

      // P1.3: include injury fields in update; increment career_injuries when newly injured
      const careerInjuries = injured === 1 ? (player.career_injuries ?? 0) + 1 : (player.career_injuries ?? 0);
      // P3: track career_overall as running peak (MAX of existing career_overall and new rating)
      const existingCareerOverall = player.career_overall ?? player.overall_rating;
      const newCareerOverall = Math.max(existingCareerOverall, newRating);
      db.prepare(
        `UPDATE players
         SET age = ?, overall_rating = ?, potential = ?, is_injured = ?,
             injury_type = ?, injury_tier = ?, injury_return_game = ?, rehab_games_remaining = ?,
             career_injuries = ?,
             career_overall = ?,
             potential_revealed = ?, contract_years_remaining = ?
         WHERE id = ?`
      ).run(
        newAge, newRating, newPotential, injured,
        injType, injTier, injReturnGame, injRehab,
        careerInjuries,
        newCareerOverall,
        potentialRevealed, newContractYears, player.id
      );
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

// Step 3 (v0.5.0): Arbitration — REPLACES runNonTenderStep (Section 5a)
// Derives arb_year from service_time, computes arb salary, makes non-tender/tender decisions,
// and processes opt-out clauses. The legacy force-non-tender block is REMOVED (X-F4a).
async function runArbitrationStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const { getArchetype } = await import('./archetypes.js');
  const db = getDb();
  const rng = seedFor('arbitration', seed);
  let totalNonTenders = 0;
  let totalTendered = 0;

  // PINNED position multipliers (Section 5a.2)
  const POSITION_MULTIPLIERS: Record<string, number> = {
    'C': 1.3, 'SS': 1.25, '2B': 1.15, 'CF': 1.15, 'SP': 1.2, 'RP': 0.9,
    '3B': 1.05, 'LF': 1.05, 'RF': 1.05, '1B': 1.0, 'DH': 1.0, 'CL': 0.9,
  };

  const arbTx = db.transaction(() => {
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

    for (const team of teams) {
      if (team.interim_gm === 1) continue;
      const archetype = getArchetype(team.gm_archetype ?? 'balanced');

      // Get all players with 3-5 years of service time (arb eligible)
      const players = prepared(
        `SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1`
      ).all(team.id) as PlayerRow[];

      for (const player of players) {
        const st = player.service_time ?? 0;

        // Derive arb_year (Section 5a.1 - PINNED mapping)
        let arbYear: number | null = null;
        if (st === 3) arbYear = 1;
        else if (st === 4) arbYear = 2;
        else if (st === 5) arbYear = 3;
        // else: not arb eligible (< 3 = too young, >= 6 = FA eligible)

        // Guard (X-F4c): never write arb_year outside {1,2,3} or null
        if (arbYear !== null && ![1, 2, 3].includes(arbYear)) arbYear = null;

        // Update arb_year column
        db.prepare('UPDATE players SET arb_year = ? WHERE id = ?').run(arbYear, player.id);

        if (arbYear === null) continue; // not arb eligible

        // Compute market value and arb salary
        const posMult = POSITION_MULTIPLIERS[player.position] ?? 1.0;
        const ageMod = Math.max(0.7, 1.0 - Math.max(0, player.age - 30) * 0.05);
        const marketValue = player.overall_rating * posMult * ageMod * 10000;

        const arbSalary = arbYear === 1 ? marketValue * 0.40
          : arbYear === 2 ? marketValue * 0.60
          : marketValue * 0.80;

        // Non-tender decision
        const gmType = team.gm_archetype ?? 'balanced';
        let shouldNonTender = false;
        if (gmType === 'analytics') {
          // Analytics GM: non-tender if arb_salary > market_value * 1.1
          shouldNonTender = arbSalary > marketValue * 1.1;
        } else if (gmType === 'old-school') {
          // Old-school GM: non-tender only if arb_salary > market_value * 1.5
          shouldNonTender = arbSalary > marketValue * 1.5;
        } else {
          // Balanced
          shouldNonTender = arbSalary > marketValue * 1.25;
        }

        if (shouldNonTender) {
          // Non-tender: player becomes free agent
          db.prepare(
            'UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, is_on_25man = 0, is_on_40man = 0, minor_level = NULL, arb_year = NULL WHERE id = ?'
          ).run(player.id);

          const ntResult = db.prepare(
            `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
             VALUES (?, ?, 'non_tender', ?, ?, NULL, ?)`
          ).run(leagueId, seasonNumber, team.id, player.id, Date.now());

          insertTransactionNewsItem({
            leagueId, seasonNumber, gameNumber: 0, eventType: 'non_tender',
            teamId: team.id, playerId: player.id,
            sourceTable: 'transactions', sourceId: ntResult.lastInsertRowid as number,
          });
          totalNonTenders++;
        } else {
          // Tender: offer arb salary or multi-year deal
          // Multi-year option: 2-3 year deal at arb_salary * 0.9 per year (slight discount)
          const offerMultiYear = player.overall_rating >= 65 && rng() < 0.3;
          const contractYears = offerMultiYear ? (rng() < 0.5 ? 2 : 3) : 1;
          const annualSalary = Math.round(offerMultiYear ? arbSalary * 0.9 : arbSalary);

          // Opt-out clause for stars on multi-year deals (Section 5a.5)
          let hasOptOut = 0;
          let optOutAfterYear: number | null = null;
          if (offerMultiYear && player.overall_rating >= 80) {
            const optOutChance = (team.gm_archetype ?? 'balanced') === 'analytics' ? 0.4 : 0.2;
            if (rng() < optOutChance) {
              hasOptOut = 1;
              optOutAfterYear = contractYears >= 3 ? (rng() < 0.5 ? 2 : 3) : 2;
            }
          }

          db.prepare(
            `UPDATE players SET annual_salary = ?, contract_years_remaining = ?,
             has_opt_out = ?, opt_out_after_year = ?
             WHERE id = ?`
          ).run(annualSalary, contractYears, hasOptOut, optOutAfterYear, player.id);
          totalTendered++;
        }
      }
    }

    // Process existing opt-outs (offseason only — spec line 516)
    const optOutPlayers = prepared(
      `SELECT p.*, t.gm_archetype
       FROM players p JOIN teams t ON t.id = p.team_id
       WHERE p.league_id = ? AND p.has_opt_out = 1 AND p.opted_out = 0
         AND p.contract_years_remaining > 0`
    ).all(leagueId) as Array<PlayerRow & { gm_archetype: string }>;

    for (const player of optOutPlayers) {
      const posMult = POSITION_MULTIPLIERS[player.position] ?? 1.0;
      const ageMod = Math.max(0.7, 1.0 - Math.max(0, player.age - 30) * 0.05);
      const marketValue = player.overall_rating * posMult * ageMod * 10000;
      const remainingContractValue = player.annual_salary * player.contract_years_remaining;

      // Opt-out fires if market_value > remaining_contract_value * 1.2
      if (marketValue > remainingContractValue * 1.2) {
        // Loyalty modifier: leadership >= 70 reduces opt-out chance by 50%
        const loyaltyModifier = (player.leadership ?? 0) >= 70 ? 0.5 : 1.0;
        if (rng() < loyaltyModifier) {
          // Fire opt-out
          db.prepare(
            `UPDATE players SET opted_out = 1, team_id = NULL, is_on_mlb_roster = 0,
             is_on_25man = 0, is_on_40man = 0, minor_level = NULL WHERE id = ?`
          ).run(player.id);

          const headlineText = `${player.first_name} ${player.last_name} exercises opt-out clause, re-enters free agency`;
          insertNewsItem({
            leagueId, seasonNumber, gameNumber: 0,
            eventType: 'opt_out',
            teamId: player.team_id,
            playerId: player.id,
            headlineText,
          });
        }
      }
    }
  });

  arbTx();
  console.log(`[offseason] Arbitration step: ${totalNonTenders} non-tendered, ${totalTendered} tendered`);
}

// =========================================================
// v0.5.0 Step: International Signing (Feature 3, Section 5b)
// =========================================================
async function runInternationalSigningStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const { getArchetype } = await import('./archetypes.js');
  const db = getDb();
  const rng = seedFor('intl_signing', seed);
  // Use existing name pools from worldgen
  const { NAME_POOLS: namePools } = await import('../data/names.js');

  const intlTx = db.transaction(() => {
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

    // 1. Generate 30-50 international prospects
    const prospectCount = randInt(rng, 30, 50);
    const originDist = [
      { key: 'dominican', weight: 35 },
      { key: 'venezuela', weight: 25 },
      { key: 'cuba', weight: 15 },
      { key: 'japan', weight: 10 },
      { key: 'south_korea', weight: 5 },
      { key: 'other', weight: 10 },
    ] as const;
    const totalWeight = 100;

    // Origin country pick by weighted distribution
    function pickOrigin(): 'dominican' | 'venezuela' | 'cuba' | 'japan' | 'south_korea' | 'other' {
      let r = rng() * totalWeight;
      for (const { key, weight } of originDist) {
        r -= weight;
        if (r <= 0) return key;
      }
      return 'dominican';
    }

    // Name helper — pick from the name pool using the international pool (use us pool as fallback)
    function pickName(origin: string): string {
      const pool = (namePools as Record<string, { first: string[]; last: string[] } | undefined>)[origin]
        ?? (namePools as Record<string, { first: string[]; last: string[] } | undefined>)['us']
        ?? { first: ['Carlos'], last: ['Rodriguez'] };
      const first = pool.first[Math.floor(rng() * pool.first.length)] ?? 'Carlos';
      const last = pool.last[Math.floor(rng() * pool.last.length)] ?? 'Rodriguez';
      return `${first} ${last}`;
    }

    const prospects: Array<{
      id: number; name: string; age: number; origin_country: string;
      true_overall: number; potential: string; signed: number;
    }> = [];

    for (let pi = 0; pi < prospectCount; pi++) {
      const age = rng() < 0.5 ? 16 : 17;
      const origin = pickOrigin();
      const name = pickName(origin);
      const trueOverall = randInt(rng, 30, 75); // raw talent range
      const potential = rng() < 0.1 ? 'A' : rng() < 0.25 ? 'B' : rng() < 0.55 ? 'C' : 'D';

      // scouted_overall is computed per-team when evaluating bids; store with a "neutral" scout value
      // Each team will apply their own scout accuracy — use the midpoint as stored value
      const scoutedOverall = Math.max(20, Math.min(99, trueOverall + Math.round((rng() - 0.5) * 20)));

      const result = db.prepare(
        `INSERT INTO international_prospects
           (league_id, season_number, name, age, origin_country, scouted_overall, true_overall, potential, signed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(leagueId, seasonNumber, name, age, origin, scoutedOverall, trueOverall, potential, Date.now());

      prospects.push({
        id: result.lastInsertRowid as number,
        name, age, origin_country: origin, true_overall: trueOverall, potential, signed: 0,
      });
    }

    // Sort prospects by stored scouted_overall DESC (bid order per X-F3a)
    prospects.sort((a, b) => b.true_overall - a.true_overall);

    // 2. Bid resolution prospect-by-prospect
    for (const prospect of prospects) {
      let bestBid = 0;
      let bestTeamId: number | null = null;

      for (const team of teams) {
        if (team.interim_gm === 1) continue;
        const archetype = getArchetype(team.gm_archetype ?? 'balanced');
        const pool = team.international_bonus_pool ?? 0;
        if (pool <= 0) continue; // exhausted pool — hard cap

        // Team-specific scouted overall (apply scouting accuracy)
        const scoutingRating = team.scouting_rating ?? 5;
        const noiseRange = scoutingRating >= 7 ? 10 : 20; // high rating → ±5-10, low → ±15-20
        const noise = Math.round((rng() - 0.5) * noiseRange);
        const teamScout = Math.max(20, Math.min(99, prospect.true_overall + noise));

        // Bid based on archetype
        let bidAmount: number;
        const isAnalytics = (team.gm_archetype ?? 'balanced') === 'analytics';
        const isMegaLarge = team.market_size === 'mega' || team.market_size === 'large';

        if (isAnalytics) {
          // Analytics: weight high-upside (potential A/B)
          const potentialWeight = prospect.potential === 'A' ? 2.0 : prospect.potential === 'B' ? 1.5 : 1.0;
          bidAmount = Math.round(teamScout * 5000 * potentialWeight);
        } else {
          // Old-school: target current rating
          bidAmount = Math.round(teamScout * 4000);
        }

        // Mega/large market teams outbid for top prospects
        if (isMegaLarge && prospect.true_overall >= 60) bidAmount = Math.round(bidAmount * 1.3);
        // Small market: target undervalued
        if (team.market_size === 'small' && prospect.true_overall <= 50) bidAmount = Math.round(bidAmount * 1.2);

        // Hard cap: never exceed remaining pool
        bidAmount = Math.min(bidAmount, pool);

        if (bidAmount > bestBid) {
          bestBid = bidAmount;
          bestTeamId = team.id;
        }
      }

      if (bestTeamId === null || bestBid <= 0) continue;

      const signingTeam = teams.find(t => t.id === bestTeamId);
      if (!signingTeam) continue;

      // Hard cap check: ensure signing team has enough pool (in-memory, updated per signing)
      if ((signingTeam.international_bonus_pool ?? 0) < bestBid) continue;

      // Debit the team's international_bonus_pool — update in-memory value to prevent over-spend
      signingTeam.international_bonus_pool = (signingTeam.international_bonus_pool ?? 0) - bestBid;
      db.prepare('UPDATE teams SET international_bonus_pool = ? WHERE id = ?')
        .run(signingTeam.international_bonus_pool, bestTeamId);
      // Update prospect as signed
      db.prepare('UPDATE international_prospects SET signed = 1, signing_team_id = ? WHERE id = ?')
        .run(bestTeamId, prospect.id);

      // Insert prospect into players table (Section 5b.5)
      const nameParts = prospect.name.split(' ');
      const firstName = nameParts[0] ?? 'Carlos';
      const lastName = nameParts.slice(1).join(' ') || 'Rodriguez';

      // Displayed overall starts as scouted proxy
      const displayOverall = Math.max(20, Math.min(70, prospect.true_overall + Math.round((rng() - 0.5) * 15)));

      const playerResult = db.prepare(
        `INSERT INTO players
           (league_id, team_id, first_name, last_name, age, position, overall_rating, potential,
            potential_revealed, contact, power, speed, fielding, arm, pitching_velocity,
            pitching_control, pitching_stamina, is_on_mlb_roster, is_on_25man, is_on_40man,
            annual_salary, contract_years_remaining, service_time, service_time_days,
            injury_prone, coachability, work_ethic, leadership, origin, birthplace_city,
            birthplace_country, is_drafted, career_hits, career_hr, career_rbi, career_ip,
            career_k, career_wins, options_remaining, is_international_signee, signing_bonus,
            true_overall, signed_age, years_in_org, bats, throws, vs_lefty_modifier, vs_righty_modifier)
         VALUES (?, ?, ?, ?, ?, 'OF', ?, ?, 0,
            ?, ?, ?, ?, ?, ?,
            ?, ?, 0, 0, 0,
            0, 0, 0, 0,
            ?, ?, ?, ?, ?, '',
            ?, 1, 0, 0, 0, 0,
            0, 0, 3, 1, ?,
            ?, ?, 0, 'R', 'R', ?, ?)`
      ).run(
        leagueId, bestTeamId, firstName, lastName, prospect.age,
        displayOverall, prospect.potential,
        // contact, power, speed, fielding, arm
        displayOverall, displayOverall, displayOverall, displayOverall, displayOverall,
        // pitching velocity/control/stamina
        30, 30, 30,
        // injury_prone, coachability, work_ethic, leadership, origin
        randInt(rng, 3, 7), randInt(rng, 1, 10), randInt(rng, 1, 10), randInt(rng, 1, 10),
        prospect.origin_country,
        // birthplace_country
        prospect.origin_country,
        // signing_bonus
        bestBid,
        // true_overall, signed_age
        prospect.true_overall, prospect.age,
        // vs_lefty_modifier, vs_righty_modifier
        randInt(rng, -10, 10), randInt(rng, -10, 10)
      );

      const newPlayerId = playerResult.lastInsertRowid as number;

      // Insert news item
      const headlineText = `${firstName} ${lastName} (${prospect.origin_country}, age ${prospect.age}) signed as international prospect for $${(bestBid / 1_000_000).toFixed(1)}M`;
      insertNewsItem({
        leagueId, seasonNumber, gameNumber: 0,
        eventType: 'international_signing',
        teamId: bestTeamId,
        playerId: newPlayerId,
        headlineText,
      });
    }
  });

  intlTx();
  console.log(`[offseason] International signing step complete for season ${seasonNumber}`);
}

// =========================================================
// v0.5.0 Step: Rule 5 Protect (Feature 2, Section 5c)
// =========================================================
async function runRule5ProtectStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const { getArchetype } = await import('./archetypes.js');
  const db = getDb();
  const rng = seedFor('rule5_protect', seed);

  const rule5ProtectTx = db.transaction(() => {
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

    for (const team of teams) {
      if (team.interim_gm === 1) continue;
      const isAnalytics = (team.gm_archetype ?? 'balanced') === 'analytics';

      // Find eligible-to-protect prospects (not yet on 40-man, on this team's minor league)
      const minorLeaguers = prepared(
        `SELECT * FROM players WHERE team_id = ? AND is_on_40man = 0 AND is_on_mlb_roster = 0
         ORDER BY overall_rating DESC LIMIT 30`
      ).all(team.id) as PlayerRow[];

      // Check current 40-man count
      const current40man = (prepared(
        'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_40man = 1'
      ).get(team.id) as { cnt: number }).cnt;
      let slots40man = 40 - current40man;

      for (const player of minorLeaguers) {
        if (slots40man <= 0) break;

        // Determine if this player is Rule 5 eligible
        const signedAge = player.signed_age ?? 18;
        const yio = player.years_in_org ?? 0;
        const isEligible = (signedAge <= 20 && yio >= 4) || (signedAge >= 21 && yio >= 3);

        if (!isEligible) continue;

        // Analytics GM: aggressively protect top prospects (any overall >= 50)
        // Old-school GM: slower to protect (only overall >= 60)
        const protectThreshold = isAnalytics ? 50 : 60;
        if (player.overall_rating < protectThreshold) {
          // Also protect based on RNG (simulate GM judgment)
          if (rng() > 0.3) continue;
        }

        // Add to 40-man
        db.prepare('UPDATE players SET is_on_40man = 1 WHERE id = ?').run(player.id);
        slots40man--;
      }
    }
  });

  rule5ProtectTx();
  console.log(`[offseason] Rule 5 protect step complete for season ${seasonNumber}`);
}

// =========================================================
// v0.5.0 Step: Rule 5 Draft (Feature 2, Section 5c)
// =========================================================
async function runRule5DraftStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const db = getDb();
  const rng = seedFor('rule5_draft', seed);

  const rule5DraftTx = db.transaction(() => {
    const teams = prepared(
      `SELECT t.*, fs.wins + fs.losses as gp, fs.wins
       FROM teams t
       LEFT JOIN franchise_season_history fs ON fs.team_id = t.id AND fs.season_number = ? - 1
       WHERE t.league_id = ?
       ORDER BY COALESCE(fs.wins * 1.0 / NULLIF(fs.wins + fs.losses, 0), 0) ASC` // reverse standings order
    ).all(seasonNumber, leagueId) as TeamRow[];

    let pickNumber = 0;

    for (const team of teams) {
      if (team.interim_gm === 1) continue;

      // Check 25-man capacity (X-F2b)
      const on25man = (prepared(
        'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1'
      ).get(team.id) as { cnt: number }).cnt;
      if (on25man >= 25) continue; // no 25-man slot available

      // Find eligible players from OTHER teams' minor leagues
      const eligible = prepared(
        `SELECT p.* FROM players p
         JOIN teams t2 ON t2.id = p.team_id
         WHERE t2.league_id = ? AND p.team_id != ? AND p.is_on_40man = 0
           AND p.is_on_mlb_roster = 0
           AND (
             (p.signed_age <= 20 AND p.years_in_org >= 4)
             OR
             (p.signed_age >= 21 AND p.years_in_org >= 3)
           )
         ORDER BY p.overall_rating DESC
         LIMIT 20`
      ).all(leagueId, team.id) as PlayerRow[];

      if (eligible.length === 0) continue;

      // Select 0-3 players (GM decides based on archetype)
      const isAnalytics = (team.gm_archetype ?? 'balanced') === 'analytics';
      const isSmallMkt = team.market_size === 'small';
      const maxSelections = isSmallMkt ? 3 : isAnalytics ? 2 : 1;
      const numSelections = Math.min(maxSelections, eligible.length, Math.round(rng() * maxSelections));

      for (let si = 0; si < numSelections; si++) {
        const player = eligible[si];
        if (!player) break;

        const originalTeamId = player.team_id;
        if (!originalTeamId) continue;

        pickNumber++;

        // Transfer player to selecting team's 25-man
        db.prepare(
          `UPDATE players SET team_id = ?, is_on_mlb_roster = 1, is_on_25man = 1, is_on_40man = 1,
           rule5_drafted = 1, rule5_from_team_id = ?, minor_level = NULL WHERE id = ?`
        ).run(team.id, originalTeamId, player.id);

        // $100K to original team
        db.prepare(
          'UPDATE teams SET revenue = revenue + 100000 WHERE id = ?'
        ).run(originalTeamId);

        // Insert transaction (note: transactions table has no from_team_id/amount columns; use details_json)
        db.prepare(
          `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id,
           details_json, narrative, created_at)
           VALUES (?, ?, 'rule5_draft', ?, ?, ?, ?, ?)`
        ).run(
          leagueId, seasonNumber, team.id, player.id,
          JSON.stringify({ from_team_id: originalTeamId, amount: 100000 }),
          `${player.first_name} ${player.last_name} selected in Rule 5 Draft`,
          Date.now()
        );

        // Insert news item
        const headlineText = `${player.first_name} ${player.last_name} selected in Rule 5 Draft by ${team.city} ${team.name}`;
        insertNewsItem({
          leagueId, seasonNumber, gameNumber: 0,
          eventType: 'rule5_draft',
          teamId: team.id,
          playerId: player.id,
          headlineText,
        });
      }
    }
  });

  rule5DraftTx();
  console.log(`[offseason] Rule 5 draft step complete for season ${seasonNumber}`);
}

// =========================================================
// v0.5.0 Step: Award Voting (Feature 6, Section 5d)
// =========================================================
async function runAwardVotingStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const { getArchetype } = await import('./archetypes.js');
  const db = getDb();
  const rng = seedFor('award_voting', seed);

  const awardTx = db.transaction(() => {
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

    // Award types per conference
    const conferences = ['American', 'National'];
    const awardTypes = ['mvp', 'cy_young', 'roy'] as const;

    for (const conference of conferences) {
      // Get teams in this conference
      const confTeams = teams.filter(t => t.conference === conference);
      const confTeamIds = confTeams.map(t => t.id);
      if (confTeamIds.length === 0) continue;

      for (const awardType of awardTypes) {
        // Compute stat totals from season_stats for this conference
        let candidates: Array<{
          player_id: number; first_name: string; last_name: string; team_id: number | null;
          ops: number; hr: number; rbi: number; era: number; wins: number; strikeouts: number;
          whip: number; service_time: number; team_wins: number; overall_score: number;
        }> = [];

        if (awardType === 'mvp' || awardType === 'roy') {
          // Position players: OPS (40%), RBI (20%), HR (20%), team wins (20%)
          candidates = db.prepare(
            `SELECT p.id as player_id, p.first_name, p.last_name, p.team_id, p.service_time,
                    ss.at_bats, ss.hits, ss.home_runs as hr, ss.rbi, ss.walks,
                    t.wins as team_wins,
                    CASE WHEN ss.at_bats > 0
                         THEN (CAST(ss.hits AS REAL) / ss.at_bats) + (CAST(ss.home_runs + ss.walks AS REAL) / (ss.at_bats + ss.walks))
                         ELSE 0 END as ops
             FROM season_stats ss
             JOIN players p ON p.id = ss.player_id
             JOIN teams t ON t.id = p.team_id
             WHERE ss.league_id = ? AND ss.season_number = ? AND t.id IN (${confTeamIds.map(() => '?').join(',')})
               AND p.position NOT IN ('SP','RP','CL')
               AND ss.at_bats >= 50
             ORDER BY ops DESC LIMIT 30`
          ).all(leagueId, seasonNumber, ...confTeamIds) as any[];

          // ROY eligibility: service_time < 1
          if (awardType === 'roy') {
            candidates = candidates.filter(c => (c.service_time ?? 0) < 1);
          }

          // Score: OPS 40%, RBI 20%, HR 20%, team wins 20%
          const maxRBI = Math.max(...candidates.map(c => c.rbi ?? 0), 1);
          const maxHR = Math.max(...candidates.map(c => c.hr ?? 0), 1);
          const maxTeamWins = Math.max(...candidates.map(c => c.team_wins ?? 0), 1);
          for (const c of candidates) {
            c.overall_score = (c.ops ?? 0) * 0.4 + ((c.rbi ?? 0) / maxRBI) * 0.2 + ((c.hr ?? 0) / maxHR) * 0.2 + ((c.team_wins ?? 0) / maxTeamWins) * 0.2;
          }
        } else {
          // Cy Young: ERA (35%), wins (20%), SO (25%), WHIP (20%)
          candidates = db.prepare(
            `SELECT p.id as player_id, p.first_name, p.last_name, p.team_id, p.service_time,
                    ss.wins, ss.strikeouts_pitching as strikeouts,
                    CASE WHEN ss.innings_pitched > 0 THEN CAST(ss.earned_runs AS REAL) * 9 / ss.innings_pitched ELSE 99 END as era,
                    CASE WHEN ss.innings_pitched > 0 THEN (CAST(ss.hits AS REAL) + ss.walks) / ss.innings_pitched ELSE 99 END as whip,
                    t.wins as team_wins, 0 as hr, 0 as rbi, 0 as ops
             FROM season_stats ss
             JOIN players p ON p.id = ss.player_id
             JOIN teams t ON t.id = p.team_id
             WHERE ss.league_id = ? AND ss.season_number = ? AND t.id IN (${confTeamIds.map(() => '?').join(',')})
               AND p.position = 'SP'
               AND ss.innings_pitched >= 20
             ORDER BY era ASC LIMIT 20`
          ).all(leagueId, seasonNumber, ...confTeamIds) as any[];

          const maxWins = Math.max(...candidates.map(c => c.wins ?? 0), 1);
          const maxK = Math.max(...candidates.map(c => c.strikeouts ?? 0), 1);
          const minERA = Math.min(...candidates.map(c => c.era ?? 99), 99);
          const minWHIP = Math.min(...candidates.map(c => c.whip ?? 99), 99);
          for (const c of candidates) {
            const eraScore = minERA > 0 ? minERA / Math.max(c.era ?? 99, 0.1) : 0;
            const whipScore = minWHIP > 0 ? minWHIP / Math.max(c.whip ?? 99, 0.1) : 0;
            c.overall_score = eraScore * 0.35 + ((c.wins ?? 0) / maxWins) * 0.20 + ((c.strikeouts ?? 0) / maxK) * 0.25 + whipScore * 0.20;
          }
        }

        if (candidates.length === 0) continue;

        // Sort by score DESC, then player_id ASC for tie-breaking (deterministic X-F6a)
        candidates.sort((a, b) => {
          const scoreDiff = (b.overall_score ?? 0) - (a.overall_score ?? 0);
          if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
          return a.player_id - b.player_id;
        });

        // 20 voters (X-F6c — not 30): one per franchise in the whole league
        // Old-school voters: favor counting stats; analytics: favor efficiency
        let voteTally = new Map<number, number>();

        const voters = teams.slice(0, 20); // 20 voters
        for (const voter of voters) {
          if (voter.interim_gm === 1) continue;
          const isAnalyticsVoter = (voter.gm_archetype ?? 'balanced') === 'analytics';
          const isOldSchoolVoter = (voter.gm_archetype ?? 'balanced') === 'old-school';

          // Rank candidates by voter preference
          const ranked = [...candidates];
          if (isOldSchoolVoter) {
            // Old-school: weight counting stats (HR, RBI, wins)
            ranked.sort((a, b) => {
              const aCount = (a.hr ?? 0) + (a.rbi ?? 0) + (a.wins ?? 0) * 3;
              const bCount = (b.hr ?? 0) + (b.rbi ?? 0) + (b.wins ?? 0) * 3;
              if (bCount !== aCount) return bCount - aCount;
              return a.player_id - b.player_id;
            });
          } else if (isAnalyticsVoter) {
            // Analytics: weight efficiency
            ranked.sort((a, b) => {
              const scoreDiff = (b.overall_score ?? 0) - (a.overall_score ?? 0);
              if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
              return a.player_id - b.player_id;
            });
          }
          // Vote for top 3
          const voteWeights = [5, 3, 1];
          for (let vi = 0; vi < Math.min(3, ranked.length); vi++) {
            const c = ranked[vi];
            if (!c) continue;
            voteTally.set(c.player_id, (voteTally.get(c.player_id) ?? 0) + (voteWeights[vi] ?? 1));
          }
        }

        // Sort by vote tally DESC, player_id ASC for determinism
        const sortedVotes = [...voteTally.entries()].sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          return a[0] - b[0];
        });

        if (sortedVotes.length === 0) continue;

        // Winner must be an active player (re-rank on retirement — X-F6b/CISO V5-9)
        let winnerId: number | null = null;
        for (const [pid] of sortedVotes) {
          const pRow = prepared('SELECT id, team_id FROM players WHERE id = ?').get(pid) as { id: number; team_id: number | null } | undefined;
          if (pRow && pRow.team_id !== null) {
            winnerId = pid;
            break;
          }
        }
        if (winnerId === null) continue;

        const totalVotes = sortedVotes.reduce((s, [, v]) => s + v, 0);
        const winnerVotes = voteTally.get(winnerId) ?? 0;
        const voteShare = totalVotes > 0 ? winnerVotes / totalVotes : 0;

        // Insert/upsert award winner (idempotent — UPSERT on UNIQUE constraint)
        db.prepare(
          `INSERT OR REPLACE INTO award_winners
             (league_id, season_number, award_type, league, player_id, vote_share)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(leagueId, seasonNumber, awardType, conference, winnerId, voteShare);

        // Insert award winner news item (LLM flavor — use pending)
        const winner = candidates.find(c => c.player_id === winnerId);
        const winnerName = winner ? `${winner.first_name} ${winner.last_name}` : 'Unknown';
        const awardName = awardType === 'mvp' ? 'MVP' : awardType === 'cy_young' ? 'Cy Young' : 'Rookie of the Year';
        insertNewsItem({
          leagueId, seasonNumber, gameNumber: 0,
          eventType: 'award_winner',
          teamId: winner?.team_id ?? null,
          playerId: winnerId,
          headlineText: `${winnerName} wins the ${conference} League ${awardName}`,
        });
      }
    }
  });

  awardTx();
  console.log(`[offseason] Award voting step complete for season ${seasonNumber}`);
}

// =========================================================
// v0.5.0 Step: Rivalry Update (Feature 5, Section 5e)
// =========================================================
async function runRivalryUpdateStep(leagueId: number, seasonNumber: number): Promise<void> {
  const db = getDb();

  // No-op cleanly when season_number === 1
  if (seasonNumber <= 1) {
    console.log(`[offseason] Rivalry update: skipped (season ${seasonNumber})`);
    return;
  }

  const rivalryTx = db.transaction(() => {
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
    const lookbackSeason = Math.max(1, seasonNumber - 5);

    // Helper: canonicalize pair to (smaller_id, larger_id)
    function canonical(a: number, b: number): [number, number] {
      return a < b ? [a, b] : [b, a];
    }

    function upsertRivalry(teamA: number, teamB: number, deltaScore: number, originType: string): void {
      const [aId, bId] = canonical(teamA, teamB);
      const existing = db.prepare(
        'SELECT * FROM rivalries WHERE league_id = ? AND team_a_id = ? AND team_b_id = ?'
      ).get(leagueId, aId, bId) as { id: number; rivalry_score: number } | undefined;

      if (existing) {
        const newScore = Math.min(100, Math.max(0, existing.rivalry_score + deltaScore));
        db.prepare(
          'UPDATE rivalries SET rivalry_score = ?, last_updated_season = ? WHERE id = ?'
        ).run(newScore, seasonNumber, existing.id);
      } else if (deltaScore > 0) {
        db.prepare(
          `INSERT INTO rivalries (league_id, team_a_id, team_b_id, rivalry_score, formed_season, last_updated_season, origin_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(leagueId, aId, bId, Math.min(100, deltaScore), seasonNumber, seasonNumber, originType);
      }
    }

    // 1. Playoff series: +20 for each pair that met in playoffs this season
    const playoffSeries = prepared(
      `SELECT team1_id, team2_id FROM playoff_series WHERE league_id = ? AND season_number = ?`
    ).all(leagueId, seasonNumber) as Array<{ team1_id: number; team2_id: number }>;

    for (const series of playoffSeries) {
      upsertRivalry(series.team1_id, series.team2_id, 20, 'playoff_series');
    }

    // 2. Division block: from franchise_season_history over last 5 seasons
    // Count how many times team X won division while team Y finished 2nd in same division
    const divHistory = prepared(
      `SELECT team_id, division_finish, season_number,
              (SELECT t2.division FROM teams t2 WHERE t2.id = fsh.team_id) as division
       FROM franchise_season_history fsh
       WHERE fsh.league_id = ? AND fsh.season_number >= ?
         AND fsh.division_finish IN (1, 2)`
    ).all(leagueId, lookbackSeason) as Array<{
      team_id: number; division_finish: number; season_number: number; division: string;
    }>;

    // Group by division + season, check if there's a 1st and 2nd place team
    const divMap = new Map<string, Array<{ team_id: number; finish: number }>>();
    for (const row of divHistory) {
      const key = `${row.division}:${row.season_number}`;
      if (!divMap.has(key)) divMap.set(key, []);
      divMap.get(key)!.push({ team_id: row.team_id, finish: row.division_finish });
    }

    // For each division-season pair where there's a 1st and 2nd place:
    // count how many times the same 1st-2nd pair occurred
    const blockCounts = new Map<string, number>();
    for (const [, entries] of divMap) {
      const first = entries.find(e => e.finish === 1);
      const second = entries.find(e => e.finish === 2);
      if (first && second) {
        const [a, b] = canonical(first.team_id, second.team_id);
        const key = `${a}:${b}`;
        blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1);
      }
    }

    for (const [key, count] of blockCounts) {
      if (count >= 3) {
        const parts = key.split(':');
        const aId = parseInt(parts[0] ?? '0', 10);
        const bId = parseInt(parts[1] ?? '0', 10);
        if (aId > 0 && bId > 0) {
          upsertRivalry(aId, bId, 10, 'division_block');
        }
      }
    }

    // 3. Decay: -5 for every existing rivalry with no meaningful interaction this season
    const allRivalries = prepared(
      'SELECT * FROM rivalries WHERE league_id = ?'
    ).all(leagueId) as Array<{ id: number; team_a_id: number; team_b_id: number; rivalry_score: number; last_updated_season: number }>;

    for (const rivalry of allRivalries) {
      if (rivalry.last_updated_season < seasonNumber) {
        const newScore = Math.max(0, rivalry.rivalry_score - 5);
        db.prepare('UPDATE rivalries SET rivalry_score = ?, last_updated_season = ? WHERE id = ?')
          .run(newScore, seasonNumber, rivalry.id);
      }
    }
  });

  rivalryTx();
  console.log(`[offseason] Rivalry update complete for season ${seasonNumber}`);
}

// =========================================================
// v0.5.0 Step: Stadium Resolve (Feature 11, Section 5f)
// =========================================================
async function runStadiumResolveStep(leagueId: number, seasonNumber: number, seed: number): Promise<void> {
  const { getArchetype } = await import('./archetypes.js');
  const db = getDb();
  const rng = seedFor('stadium_resolve', seed);

  // UPGRADE constants per spec §11
  const UPGRADE_DEFS: Record<string, { cost: number; capacity_delta: number; revenue_delta: number; build_time: number }> = {
    premium_seating: { cost: 20_000_000, capacity_delta: 2000, revenue_delta: 5_000_000, build_time: 1 },
    scoreboard:      { cost: 10_000_000, capacity_delta: 0,    revenue_delta: 0,          build_time: 1 }, // +3% attendance rate effect (not tracked as revenue_delta)
    concessions:     { cost: 8_000_000,  capacity_delta: 0,    revenue_delta: 3_000_000,  build_time: 1 },
    new_stadium_small:  { cost: 150_000_000, capacity_delta: 0, revenue_delta: 20_000_000, build_time: 3 }, // capacity ×1.5 computed separately
    new_stadium_medium: { cost: 300_000_000, capacity_delta: 0, revenue_delta: 40_000_000, build_time: 3 }, // capacity ×1.4 computed separately
  };

  const stadiumTx = db.transaction(() => {
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
    const relocatingTeams = new Set(
      (prepared('SELECT id FROM teams WHERE league_id = ? AND relocation_threat_active = 1').all(leagueId) as Array<{ id: number }>)
        .map(t => t.id)
    );

    for (const team of teams) {
      // Gate: if team is relocating this offseason, cancel in-progress upgrade (X-F11a)
      if (relocatingTeams.has(team.id) && team.stadium_upgrade_in_progress === 1) {
        db.prepare(`UPDATE teams SET stadium_upgrade_in_progress = 0, stadium_upgrade_complete_season = NULL, stadium_upgrade_type = NULL WHERE id = ?`)
          .run(team.id);
        // Forfeit cost logged as transaction (simplified: just clear the upgrade)
        console.log(`[offseason] Stadium upgrade cancelled for team ${team.id} (relocation)`);
        continue;
      }

      // 1. Complete in-progress upgrades (X-F11b: use PRE-increment season_number)
      if (team.stadium_upgrade_in_progress === 1) {
        const completeSeason = team.stadium_upgrade_complete_season ?? (seasonNumber + 1);
        if (completeSeason <= seasonNumber) {
          const upgradeType = team.stadium_upgrade_type;
          if (upgradeType) {
            const upgDef = UPGRADE_DEFS[upgradeType];
            if (upgDef) {
              // Apply capacity delta
              let newCapacity = team.stadium_capacity;
              if (upgradeType === 'new_stadium_small') newCapacity = Math.round(team.stadium_capacity * 1.5);
              else if (upgradeType === 'new_stadium_medium') newCapacity = Math.round(team.stadium_capacity * 1.4);
              else newCapacity = team.stadium_capacity + upgDef.capacity_delta;

              db.prepare(
                `UPDATE teams SET stadium_capacity = ?, stadium_upgrade_in_progress = 0,
                 stadium_upgrade_complete_season = NULL, stadium_upgrade_type = NULL,
                 new_stadium_honeymoon_seasons_remaining = ?
                 WHERE id = ?`
              ).run(newCapacity, upgradeType.startsWith('new_stadium') ? 2 : 0, team.id);

              // Mark complete in stadium_upgrades table
              db.prepare(
                `UPDATE stadium_upgrades SET season_completed = ? WHERE team_id = ? AND season_completed IS NULL`
              ).run(seasonNumber, team.id);

              insertNewsItem({
                leagueId, seasonNumber, gameNumber: 0,
                eventType: 'stadium_upgrade_complete',
                teamId: team.id,
                headlineText: `${team.city} ${team.name} complete stadium upgrade: ${upgradeType.replace('_', ' ')}`,
              });
            }
          }
        }
      }

      // Decrement honeymoon counter
      if ((team.new_stadium_honeymoon_seasons_remaining ?? 0) > 0) {
        db.prepare('UPDATE teams SET new_stadium_honeymoon_seasons_remaining = new_stadium_honeymoon_seasons_remaining - 1 WHERE id = ?').run(team.id);
      }

      // 2. New upgrade decisions (only if no upgrade in progress, not relocating)
      if (team.stadium_upgrade_in_progress === 1 || relocatingTeams.has(team.id)) continue;
      if (team.interim_gm === 1) continue;

      const archetype = getArchetype(team.gm_archetype ?? 'balanced');
      const isAnalytics = (team.gm_archetype ?? 'balanced') === 'analytics';
      const isOldSchool = (team.gm_archetype ?? 'balanced') === 'old-school';
      const isPatientOwner = team.owner_personality === 'patient';
      const isMeddlingOwner = team.owner_personality === 'meddling' || team.owner_personality === 'win-now';

      // Only decide upgrade if RNG says it's time (20% chance per offseason)
      if (rng() > 0.2) continue;

      // Pick upgrade type
      const upgradeType = (['premium_seating', 'scoreboard', 'concessions'] as const)[Math.floor(rng() * 3)] ?? 'scoreboard';
      const upgDef = UPGRADE_DEFS[upgradeType];
      if (!upgDef) continue;

      // ROI check
      const roiSeasons = upgDef.revenue_delta > 0 ? upgDef.cost / upgDef.revenue_delta : 999;

      let approve = false;
      if (isAnalytics && roiSeasons <= 5) approve = true;
      else if (isOldSchool) approve = rng() < 0.6; // always approves prestige
      else if (isPatientOwner) approve = roiSeasons <= 7;
      else if (isMeddlingOwner) approve = upgDef.revenue_delta >= 2_000_000; // prefer payroll but accepts high revenue
      else approve = roiSeasons <= 6;

      if (!approve) continue;

      // Ensure franchise_value can cover the cost
      if ((team.franchise_value ?? 0) * 1_000_000 < upgDef.cost) continue;

      // Start upgrade
      db.prepare(
        `UPDATE teams SET stadium_upgrade_in_progress = 1, stadium_upgrade_complete_season = ?,
         stadium_upgrade_type = ? WHERE id = ?`
      ).run(seasonNumber + upgDef.build_time, upgradeType, team.id);

      // Insert stadium_upgrades record
      db.prepare(
        `INSERT INTO stadium_upgrades
           (league_id, team_id, upgrade_type, cost, season_started, capacity_delta, revenue_delta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(leagueId, team.id, upgradeType, upgDef.cost, seasonNumber, upgDef.capacity_delta, upgDef.revenue_delta);
    }
  });

  stadiumTx();
  console.log(`[offseason] Stadium resolve step complete for season ${seasonNumber}`);
}

// Step 4 (was 3): Free agency — D20
async function runFreeAgencyStep(leagueId: number, seasonNumber?: number): Promise<void> {
  const db = getDb();

  // Players with 0 contract years remaining become free agents
  const freeAgents = prepared(
    'SELECT * FROM players WHERE league_id = ? AND contract_years_remaining <= 0 AND team_id IS NOT NULL'
  ).all(leagueId) as PlayerRow[];

  // Step 13 (A-6): Capture prior team BEFORE nulling team_id (loyalty discount check)
  // Player with leadership >= 75 AND seasons_with_current_team >= 5 accepts 10-15% below market.
  const leagueRowForFA = prepared('SELECT worldgen_seed, season_number FROM leagues WHERE id = ?').get(leagueId) as { worldgen_seed: number; season_number: number } | undefined;
  const loyaltyDiscountIds = new Set<number>();

  for (const fa of freeAgents) {
    const leadership = fa.leadership ?? 0;
    const seasonsHere = fa.seasons_with_current_team ?? 0;
    if (leadership >= 75 && seasonsHere >= 5 && fa.team_id !== null) {
      // Loyalty discount eligible — flag for later bidding
      loyaltyDiscountIds.add(fa.id);
      prepared('UPDATE players SET loyalty_discount_eligible = 1 WHERE id = ?').run(fa.id);
    }
    // AB-NULL FIX §2.1: also clear is_on_25man so free agents don't appear as phantom 25-man members.
    prepared('UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, is_on_25man = 0, minor_level = NULL WHERE id = ?').run(fa.id);
  }

  const availableFAs = prepared(
    'SELECT * FROM players WHERE league_id = ? AND team_id IS NULL ORDER BY overall_rating DESC LIMIT 50'
  ).all(leagueId) as PlayerRow[];

  // Recompute current_payroll from actual player salaries before FA bidding
  // (prevents cumulative drift from multi-season accumulation where dequeued FAs
  // leave stale salary amounts in current_payroll)
  db.prepare(
    `UPDATE teams SET current_payroll = (
       SELECT COALESCE(SUM(p.annual_salary), 0)
       FROM players p
       WHERE p.team_id = teams.id
         AND p.contract_years_remaining > 0
         AND p.annual_salary > 0
     ) WHERE league_id = ?`
  ).run(leagueId);
  // Re-fetch teams after payroll recompute so bidding uses fresh values
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

  // D20: bid = overall * 0.15M * needs_multiplier, capped at remaining payroll budget
  for (const fa of availableFAs) {
    let bestBid = 0;
    let bestTeamId: number | null = null;

    // Step 13 (A-6): loyalty discount applies if eligible — player accepts 10-15% below market
    const hasLoyaltyDiscount = loyaltyDiscountIds.has(fa.id);
    // Loyalty discount: player's market value reduced by 12% (midpoint of 10-15%)
    const loyaltyDiscountFactor = hasLoyaltyDiscount ? 0.88 : 1.0;

    for (const team of teams) {
      // Check position need
      const posCount = prepared(
        'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position = ?'
      ).get(team.id, fa.position) as { cnt: number };

      let posNeedScore = 0;
      if (posCount.cnt === 0) posNeedScore = 1.0;
      else if (posCount.cnt === 1) posNeedScore = 0.5;

      const needsMultiplier = 1.0 + (0.5 * posNeedScore);
      const marketBid = Math.round(fa.overall_rating * 0.15 * 1_000_000 * needsMultiplier * loyaltyDiscountFactor);
      const bid = Math.min(
        team.payroll_budget - team.current_payroll,
        marketBid
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
      // NF-7: First check if a franchise legend (10+ seasons) is available in coaching pool
      const legendName = tryHireFranchiseLegendManager(db, leagueId, team.id, seasonNumber);
      let newFirst: string;
      let newLast: string;
      let hiredContext: string;
      let isReturningHero = false;

      if (legendName) {
        const parts = legendName.split(' ');
        newFirst = parts[0] ?? 'Legend';
        newLast = parts.slice(1).join(' ') || 'Manager';
        hiredContext = 'Returning franchise legend';
        isReturningHero = true;
      } else {
        newFirst = ['Bob', 'Tom', 'Mike', 'Dave', 'Jim'][Math.floor(rng() * 5)] ?? 'Bob';
        newLast = ['Johnson', 'Smith', 'Williams', 'Brown', 'Jones'][Math.floor(rng() * 5)] ?? 'Johnson';
        hiredContext = 'Hired in offseason';
      }
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
        mgrReason, hiredContext, Date.now()
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

      // NF-7: "returning hero" news item for franchise legend hired as manager
      if (isReturningHero) {
        insertFrontOfficeNewsItem({
          leagueId, seasonNumber, gameNumber: 0, eventType: 'manager_fired', teamId: team.id,
          headlineText: `${newFirst} ${newLast} returns home — franchise legend hired as manager of ${team.city} ${team.name}.`,
          detailsJson: JSON.stringify({ kind: 'returning_hero_hire', managerName: `${newFirst} ${newLast}`, teamId: team.id }),
        });
      }
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

      // Step 14: Classify the sale type and compute sale price
      const saleClassification = classifySale(team, leagueId, seasonNumber, false, seed);
      const saleReason = `Sold franchise after Season ${seasonNumber} (${saleClassification.saleType} sale, $${saleClassification.salePrice}M). New ownership group takes control.`;
      const saleHeadline = `${team.owner_name} sells franchise, ${team.city} ${team.name} — ${saleClassification.saleType} sale`;
      const soldFoeResult = db.prepare(
        'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)'
      ).run(
        leagueId, seasonNumber, team.id, 'owner_sold_team',
        team.owner_name, `${newFirst} ${newLast}`,
        `${team.owner_name} sells the franchise to ${newFirst} ${newLast} for $${saleClassification.salePrice}M (${saleClassification.saleType} sale).`,
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
        detailsJson: JSON.stringify({
          reason: saleReason, eventType: 'owner_sold_team', teamId: team.id,
          saleType: saleClassification.saleType, salePrice: saleClassification.salePrice,
        }),
      });

      // D6a: transaction parity row
      db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)'
      ).run(leagueId, seasonNumber, 'owner_sold_team', team.id, saleHeadline, Date.now());

      db.prepare('UPDATE teams SET owner_name = ?, owner_personality = ? WHERE id = ?')
        .run(`${newFirst} ${newLast}`, newPersonality, team.id);

      // Step 14: Check if new owner triggers a relocation threat (H-1: flag only, resolve at season end)
      if (checkRelocationThreat(team, leagueId, seasonNumber)) {
        setRelocationThreat(team.id, leagueId, seasonNumber, 0);
      }
    }

    // §5.9: 0.5% owner death (weighted by age)
    const ageFactor = team.owner_age > 70 ? 0.02 : 0.005;
    if (rng() < ageFactor) {
      const heirFirst = ['Robert', 'Henry', 'Arthur', 'Charles', 'Winston'][Math.floor(rng() * 5)] ?? 'Robert';
      const heirLast = team.owner_name.split(' ')[1] ?? 'Heir'; // Same surname for heir

      // Step 14: Classify as succession sale (owner death)
      const deathSaleClassification = classifySale(team, leagueId, seasonNumber, true, seed);
      const deathReason = `Passed away during Season ${seasonNumber}. Succeeded by ${heirFirst} ${heirLast}. Franchise valued at $${deathSaleClassification.salePrice}M (succession).`;
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
        detailsJson: JSON.stringify({
          reason: deathReason, eventType: 'owner_died', teamId: team.id,
          saleType: deathSaleClassification.saleType, salePrice: deathSaleClassification.salePrice,
        }),
      });

      // D6a: transaction parity row
      db.prepare(
        'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)'
      ).run(leagueId, seasonNumber, 'owner_died', team.id, deathHeadline, Date.now());

      const heirPersonality = OWNER_PERSONALITIES[Math.floor(rng() * OWNER_PERSONALITIES.length)] ?? 'moderate';
      db.prepare('UPDATE teams SET owner_name = ?, owner_personality = ? WHERE id = ?').run(`${heirFirst} ${heirLast}`, heirPersonality, team.id);

      // Step 14: Check relocation threat after succession (heir may face same market pressures)
      if (checkRelocationThreat(team, leagueId, seasonNumber)) {
        setRelocationThreat(team.id, leagueId, seasonNumber, 0);
      }
    }
  }

  // NOTE: W/L reset moved to finalizeOffseason() — must happen AFTER annual_draft reads standings (§2.6)
  console.log(`[offseason] Front office changes complete`);
}

// Step 14: Relocation resolution — fires at season end for all teams with active threats (H-1)
async function runRelocationResolveStep(leagueId: number, seasonNumber: number, worldgenSeed: number): Promise<void> {
  const db = getDb();
  const threatenedTeams = prepared(
    'SELECT * FROM teams WHERE league_id = ? AND relocation_threat_active = 1'
  ).all(leagueId) as TeamRow[];

  if (threatenedTeams.length === 0) {
    console.log(`[offseason] Relocation resolve: no threatened teams for season ${seasonNumber}`);
    return;
  }

  for (const team of threatenedTeams) {
    resolveRelocation(team, leagueId, seasonNumber, worldgenSeed);
  }

  // Also check for NEW threats arising mid-offseason (teams that just sold but weren't flagged yet)
  // Re-run checkRelocationThreat for all teams — the function guards against double-flagging.
  const allTeams = prepared(
    'SELECT * FROM teams WHERE league_id = ? AND relocation_threat_active = 0'
  ).all(leagueId) as TeamRow[];

  let newThreats = 0;
  for (const team of allTeams) {
    if (checkRelocationThreat(team, leagueId, seasonNumber)) {
      setRelocationThreat(team.id, leagueId, seasonNumber, 0);
      newThreats++;
    }
  }

  console.log(`[offseason] Relocation resolve: resolved ${threatenedTeams.length} threat(s), flagged ${newThreats} new threat(s) for season ${seasonNumber}`);
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
    // Also reset all last_xxx_game counters so game-loop timers fire correctly in season N+1.
    // Without this, the counters retain end-of-season values from the prior season while
    // games_played resets to 0, causing cascade eval, chemistry, call-up, and firing checks
    // to silently stop firing for the entire new season.
    // v0.5.0: also reset winning_streak and losing_streak (new columns)
    db.prepare('UPDATE teams SET wins = 0, losses = 0, runs_scored = 0, runs_allowed = 0, games_played = 0, last_call_up_check_game = 0, last_firing_check_game = 0, last_gm_firing_check_game = 0, last_service_time_update_game = 0, last_cascade_check_game = 0, last_chemistry_calc_game = 0, winning_streak = 0, losing_streak = 0 WHERE league_id = ?').run(leagueId);

    // v0.5.0 (Section 2.6b): Per-player reset — CRITICAL load-bearing rule #1
    // Must reset per-season counters and increment years_in_org
    // arb_year is NOT reset here — it is RECOMPUTED each offseason in arbitration step
    db.prepare(`UPDATE players SET
      appearances_this_season = 0,
      consecutive_days_used = 0,
      streak_type = NULL,
      streak_games_remaining = 0,
      rule5_return_checked = 0,
      years_in_org = years_in_org + 1
    WHERE league_id = ?`).run(leagueId);

    // D21: Remaining undrafted players from original pool become free agents
    db.prepare(
      'UPDATE players SET team_id = NULL WHERE league_id = ? AND is_drafted = 0 AND team_id IS NULL'
    ).run(leagueId);

    // P1.4: Clear stale news pins at season boundary — tragedy pins are within-season only.
    // current_game_number just reset to 0 above; pins referencing old game numbers would bleed
    // into the new season if not cleared here.
    db.prepare('UPDATE news_items SET pinned_until_game = NULL WHERE league_id = ?').run(leagueId);
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
