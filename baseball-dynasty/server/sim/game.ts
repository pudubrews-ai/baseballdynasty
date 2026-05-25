// Single game simulation
// D6: Lineup and rotation logic
// D9: All writes in one transaction
// D30: Per-game PRNG seed

import { getDb, prepared, type PlayerRow, type TeamRow } from '../db.js';
import { seedFor, randInt, randTriangular, shuffle } from './prng.js';
import type { NotableEvent } from '../../shared/types.js';
import { assignInjury } from './injury.js';

export interface BatterBoxLine {
  playerId: number;
  playerName: string;
  teamId: number;
  position: string;
  atBats: number;
  hits: number;
  homeRuns: number;
  rbi: number;
  walks: number;
  strikeouts: number;
}

export interface PitcherBoxLine {
  playerId: number;
  playerName: string;
  teamId: number;
  inningsPitched: number;
  hitsAllowed: number;
  earnedRuns: number;
  strikeouts: number;
  walks: number;
  win: boolean;
  loss: boolean;
  save: boolean;
}

export interface GameResult {
  homeScore: number;
  awayScore: number;
  homeHits: number;
  awayHits: number;
  homeErrors: number;
  awayErrors: number;
  homeWalks: number;
  awayWalks: number;
  notableEvents: NotableEvent[];
  batterLines: BatterBoxLine[];
  pitcherLines: PitcherBoxLine[];
  winningPitcherId: number | null;
  losingPitcherId: number | null;
  savePitcherId: number | null;
}

const POSITIONS_ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

// D6: Select lineup — top 9 position players by overall, one per position
// AB-11: use is_on_25man=1 for the active 25-man roster (not is_on_mlb_roster)
export function selectLineup(team: TeamRow): PlayerRow[] {
  const roster = prepared(
    'SELECT * FROM players WHERE team_id = ? AND is_on_25man = 1 AND position NOT IN (\'SP\',\'RP\',\'CL\') ORDER BY overall_rating DESC'
  ).all(team.id) as PlayerRow[];

  const lineup: PlayerRow[] = [];
  const filled = new Set<string>();
  const used = new Set<number>();

  // First pass: fill each position with best available player at that position
  for (const pos of POSITIONS_ORDER) {
    const player = roster.find(p => p.position === pos && !used.has(p.id));
    if (player) {
      lineup.push(player);
      filled.add(pos);
      used.add(player.id);
    }
  }

  // D6 position fallback: fill unfilled slots with next-best available player
  const unfilled = POSITIONS_ORDER.filter(p => !filled.has(p));
  if (unfilled.length > 0) {
    const bench = roster.filter(p => !used.has(p.id));
    for (const pos of unfilled) {
      const sub = bench.find(p => !used.has(p.id));
      if (sub) {
        lineup.push({ ...sub, position: pos }); // fake-fill the position
        used.add(sub.id);
      } else {
        // D6: validateLineupComplete — log warning if we can't fill
        console.warn(`[game] Team ${team.id} (${team.name}): cannot fill position ${pos}`);
      }
    }
  }

  // Ensure exactly 9 (or best we can do)
  return lineup.slice(0, 9);
}

// D6: Select starting pitcher — rotates by team game count mod 5
// AB-11: use is_on_25man=1 for active 25-man roster
export function selectStartingPitcher(team: TeamRow): PlayerRow | null {
  const starters = prepared(
    'SELECT * FROM players WHERE team_id = ? AND is_on_25man = 1 AND position = \'SP\' ORDER BY overall_rating DESC LIMIT 5'
  ).all(team.id) as PlayerRow[];

  if (starters.length === 0) return null;

  const rotationIdx = team.games_played % 5;
  return starters[rotationIdx % starters.length] ?? starters[0] ?? null;
}

// Win probability formula per spec, clamped [0.15, 0.85]
function winProbability(homeTeam: TeamRow, awayTeam: TeamRow, gameId: number): number {
  const homeLineup = selectLineup(homeTeam);
  const awayLineup = selectLineup(awayTeam);

  // Use mean overall of active lineup for batting_lineup_avg (per D6 code comment)
  const homeLineupAvg = homeLineup.length > 0
    ? homeLineup.reduce((s, p) => s + p.overall_rating, 0) / homeLineup.length
    : 50;
  const awayLineupAvg = awayLineup.length > 0
    ? awayLineup.reduce((s, p) => s + p.overall_rating, 0) / awayLineup.length
    : 50;

  const homeStarter = selectStartingPitcher(homeTeam);
  const awayStarter = selectStartingPitcher(awayTeam);
  const homeStarterRating = homeStarter?.overall_rating ?? 50;
  const awayStarterRating = awayStarter?.overall_rating ?? 50;

  // Use mean overall of RP+CL for bullpen_avg (per D6)
  const homeBullpen = prepared(
    "SELECT overall_rating FROM players WHERE team_id = ? AND is_on_25man = 1 AND position IN ('RP','CL')"
  ).all(homeTeam.id) as Array<{ overall_rating: number }>;
  const awayBullpen = prepared(
    "SELECT overall_rating FROM players WHERE team_id = ? AND is_on_25man = 1 AND position IN ('RP','CL')"
  ).all(awayTeam.id) as Array<{ overall_rating: number }>;

  const homeBullpenAvg = homeBullpen.length > 0
    ? homeBullpen.reduce((s, p) => s + p.overall_rating, 0) / homeBullpen.length
    : 50;
  const awayBullpenAvg = awayBullpen.length > 0
    ? awayBullpen.reduce((s, p) => s + p.overall_rating, 0) / awayBullpen.length
    : 50;

  let prob = 0.5
    + (homeStarterRating - awayStarterRating) * 0.003
    + (homeLineupAvg - awayLineupAvg) * 0.004
    + (homeBullpenAvg - awayBullpenAvg) * 0.002
    + 0.04; // home field advantage

  // Step 11/13 (O-7): morale_effect_bp — sum of active unexpired morale effects for each team
  // morale_effect_bp is in basis points; morale_effect_bp / 10000 = fractional probability
  // Expired when current_game_number > morale_effect_until_game
  const homeMorale = prepared(
    `SELECT COALESCE(AVG(morale_effect_bp), 0) as avg_bp
     FROM players
     WHERE team_id = ? AND is_on_25man = 1
       AND morale_effect_bp != 0
       AND (morale_effect_until_game IS NULL OR morale_effect_until_game >= ?)`
  ).get(homeTeam.id, gameId) as { avg_bp: number } | undefined;
  const awayMorale = prepared(
    `SELECT COALESCE(AVG(morale_effect_bp), 0) as avg_bp
     FROM players
     WHERE team_id = ? AND is_on_25man = 1
       AND morale_effect_bp != 0
       AND (morale_effect_until_game IS NULL OR morale_effect_until_game >= ?)`
  ).get(awayTeam.id, gameId) as { avg_bp: number } | undefined;

  prob += (homeMorale?.avg_bp ?? 0) / 10000;
  prob -= (awayMorale?.avg_bp ?? 0) / 10000; // away morale hurts home team

  // Clamp to [0.15, 0.85]
  return Math.max(0.15, Math.min(0.85, prob));
}

// §5.1: Box score consistency validator
export function validateBoxScore(
  result: {
    homeHits: number;
    awayHits: number;
    homeWalks: number;
    awayWalks: number;
    batterLines: BatterBoxLine[];
    pitcherLines: PitcherBoxLine[];
  },
  homeTeamId: number,
  awayTeamId: number,
  homeScore: number,
  awayScore: number,
  isWalkOff: boolean = false
): string[] {
  const errors: string[] = [];

  // Rule 1: team_hits >= team_runs - team_walks
  if (result.homeHits < homeScore - result.homeWalks) {
    errors.push(`Home hits ${result.homeHits} < runs ${homeScore} - walks ${result.homeWalks}`);
  }
  if (result.awayHits < awayScore - result.awayWalks) {
    errors.push(`Away hits ${result.awayHits} < runs ${awayScore} - walks ${result.awayWalks}`);
  }

  // Rule 2: total_rbi <= team_runs AND >= max(0, team_runs - 1)
  const homeRBI = result.batterLines.filter(b => b.teamId === homeTeamId).reduce((s, b) => s + b.rbi, 0);
  const awayRBI = result.batterLines.filter(b => b.teamId === awayTeamId).reduce((s, b) => s + b.rbi, 0);
  if (homeRBI > homeScore) errors.push(`Home RBI ${homeRBI} > runs ${homeScore}`);
  if (awayRBI > awayScore) errors.push(`Away RBI ${awayRBI} > runs ${awayScore}`);
  if (homeRBI < Math.max(0, homeScore - 1)) errors.push(`Home RBI ${homeRBI} < min ${Math.max(0, homeScore - 1)}`);
  if (awayRBI < Math.max(0, awayScore - 1)) errors.push(`Away RBI ${awayRBI} < min ${Math.max(0, awayScore - 1)}`);

  // Rule 3: starting pitcher IP between 4.0 and 9.0
  const homeStarterLine = result.pitcherLines.find(p => p.teamId === homeTeamId);
  const awayStarterLine = result.pitcherLines.find(p => p.teamId === awayTeamId);
  if (homeStarterLine && (homeStarterLine.inningsPitched < 4.0 || homeStarterLine.inningsPitched > 9.0)) {
    errors.push(`Home starter IP ${homeStarterLine.inningsPitched} out of range`);
  }
  if (awayStarterLine && (awayStarterLine.inningsPitched < 4.0 || awayStarterLine.inningsPitched > 9.0)) {
    errors.push(`Away starter IP ${awayStarterLine.inningsPitched} out of range`);
  }

  // §2.9 Rule 4: total IP = 9.0 (non-walk-off) or away=8.0/home=9.0 (walk-off home win)
  const homeIPTotal = result.pitcherLines
    .filter(p => p.teamId === homeTeamId)
    .reduce((s, p) => s + p.inningsPitched, 0);
  const awayIPTotal = result.pitcherLines
    .filter(p => p.teamId === awayTeamId)
    .reduce((s, p) => s + p.inningsPitched, 0);
  // Walk-off: home team pitches full 9.0, away team pitches 8.0
  const expectedHomeIP = 9.0;
  const expectedAwayIP = isWalkOff ? 8.0 : 9.0;
  if (Math.abs(homeIPTotal - expectedHomeIP) > 0.01) {
    errors.push(`Home total IP ${homeIPTotal.toFixed(2)} != expected ${expectedHomeIP}`);
  }
  if (Math.abs(awayIPTotal - expectedAwayIP) > 0.01) {
    errors.push(`Away total IP ${awayIPTotal.toFixed(2)} != expected ${expectedAwayIP}`);
  }

  return errors;
}

export async function simulateGame(
  gameId: number,
  homeTeam: TeamRow,
  awayTeam: TeamRow,
  gameNumber: number,
  dateMs: number,
  seasonNumber: number,
  leagueId: number,
  isPlayoff: boolean = false
): Promise<void> {
  // D30: Per-game PRNG seed
  const rng = seedFor(`game:${gameId}`, homeTeam.id ^ awayTeam.id);

  const homeWinProb = winProbability(homeTeam, awayTeam, gameId);
  const homeWins = rng() < homeWinProb;

  // Score generation: triangular base 3..9 mode=4, plus 10% tail for high blowouts (§2.12)
  // Yields ~14% blowouts (winner >= 8), within spec target 12-18%
  let winnerScore = Math.round(randTriangular(rng, 3, 4, 9));
  if (rng() < 0.10) {
    winnerScore = Math.min(12, winnerScore + randInt(rng, 1, 3));
  }
  const loserScore = randInt(rng, 0, Math.max(0, winnerScore - 1));

  const homeScore = homeWins ? winnerScore : loserScore;
  const awayScore = homeWins ? loserScore : winnerScore;
  // Walk-off: only ~18% of home wins (yields ~9.7% of all games — within MLB-typical 8-11%)
  const isWalkOff = homeWins && (rng() < 0.18);

  // Get lineups and pitchers
  const homeLineup = selectLineup(homeTeam);
  const awayLineup = selectLineup(awayTeam);
  const homeStarter = selectStartingPitcher(homeTeam);
  const awayStarter = selectStartingPitcher(awayTeam);

  // §1.1 Iter-5: If either team has no starting pitcher on the MLB roster,
  // skip this game with a warning. This shouldn't happen if
  // validatePostDraftRosters ran after each draft, but guard defensively.
  if (!homeStarter || !awayStarter) {
    console.error(`[game ${gameId}] Missing starting pitcher (home=${!!homeStarter}, away=${!!awayStarter}); advancing schedule without playing game ${gameNumber}`);
    const db = getDb();
    db.prepare('UPDATE leagues SET current_game_number = ? WHERE id = ?').run(gameNumber, leagueId);
    return;
  }

  // Get bullpens
  const homeBullpen = prepared(
    "SELECT * FROM players WHERE team_id = ? AND is_on_25man = 1 AND position IN ('RP','CL') ORDER BY overall_rating DESC"
  ).all(homeTeam.id) as PlayerRow[];
  const awayBullpen = prepared(
    "SELECT * FROM players WHERE team_id = ? AND is_on_25man = 1 AND position IN ('RP','CL') ORDER BY overall_rating DESC"
  ).all(awayTeam.id) as PlayerRow[];

  // Generate batter box lines
  const homeBatterLines = generateBatterLines(rng, homeLineup, homeTeam.id, homeScore);
  const awayBatterLines = generateBatterLines(rng, awayLineup, awayTeam.id, awayScore);

  // Calculate team-level stats
  let homeHits = homeBatterLines.reduce((s, b) => s + b.hits, 0);
  let awayHits = awayBatterLines.reduce((s, b) => s + b.hits, 0);
  let homeWalks = homeBatterLines.reduce((s, b) => s + b.walks, 0);
  let awayWalks = awayBatterLines.reduce((s, b) => s + b.walks, 0);

  // §5.1 Rule 1: ensure hits >= runs - walks (generate extra walks if needed)
  if (homeHits < homeScore - homeWalks) {
    const deficit = (homeScore - homeWalks) - homeHits;
    distributeExtraWalks(homeBatterLines, deficit, rng);
    homeWalks = homeBatterLines.reduce((s, b) => s + b.walks, 0);
  }
  if (awayHits < awayScore - awayWalks) {
    const deficit = (awayScore - awayWalks) - awayHits;
    distributeExtraWalks(awayBatterLines, deficit, rng);
    awayWalks = awayBatterLines.reduce((s, b) => s + b.walks, 0);
  }

  // §5.1 Rule 2: clamp RBI (pass seeded rng for determinism)
  clampRBI(homeBatterLines, homeScore, rng);
  clampRBI(awayBatterLines, awayScore, rng);

  // §4.1: Walk-off semantics — home team pitches full 9, away team gets truncated 8.0 IP
  // Real baseball: home wins walk-off in bottom of last inning → away's top-of-inning was already done
  const homePitcherLines = generatePitcherLines(
    rng, homeStarter, homeBullpen, homeTeam.id, awayScore, false  // home always pitches 9.0
  );
  const awayPitcherLines = generatePitcherLines(
    rng, awayStarter, awayBullpen, awayTeam.id, homeScore, isWalkOff  // away gets 8.0 on walk-off
  );

  // §5.1 Rule 5: Assign W/L
  const { winnerPitcherId, loserPitcherId } = assignWinLoss(
    homeWins, homePitcherLines, awayPitcherLines
  );

  // §5.1 Rule 6: Assign Save
  const savePitcherId = assignSave(
    homeWins, homePitcherLines, awayPitcherLines, homeScore, awayScore, winnerPitcherId
  );

  // Update pitcher win/loss/save flags
  for (const p of homePitcherLines) {
    p.win = p.playerId === winnerPitcherId;
    p.loss = p.playerId === loserPitcherId;
    p.save = p.playerId === savePitcherId;
  }
  for (const p of awayPitcherLines) {
    p.win = p.playerId === winnerPitcherId;
    p.loss = p.playerId === loserPitcherId;
    p.save = p.playerId === savePitcherId;
  }

  // Generate notable events (gameNumber passed for injury seeding and season-ending duration)
  const totalSeasonGames = 500; // 20 teams × 50 games / 2
  const notableEvents = generateNotableEvents(
    rng, homeBatterLines, awayBatterLines, homeTeam, awayTeam,
    homeScore, awayScore, homePitcherLines, awayPitcherLines,
    isWalkOff, leagueId, seasonNumber, gameNumber, totalSeasonGames
  );

  // §5.8: In-game injury truncation
  applyInjuryTruncation(notableEvents, homeBatterLines, awayBatterLines, rng);

  // §5.3: Cap individual event descriptions at 500 chars
  notableEvents.forEach((e: NotableEvent) => {
    if (typeof e.description === 'string' && e.description.length > 500) {
      e.description = e.description.slice(0, 500);
    }
  });

  // Clamp notable events to 20 (CISO F23, §5.1 Rule 8)
  while (notableEvents.length > 20) notableEvents.pop();

  const homeErrors = randInt(rng, 0, 2);
  const awayErrors = randInt(rng, 0, 2);

  // §5.1 Box-score consistency gate (run before the transaction)
  {
    // Refresh hits/walks from current lines before validation
    homeHits = homeBatterLines.reduce((s, b) => s + b.hits, 0);
    awayHits = awayBatterLines.reduce((s, b) => s + b.hits, 0);
    homeWalks = homeBatterLines.reduce((s, b) => s + b.walks, 0);
    awayWalks = awayBatterLines.reduce((s, b) => s + b.walks, 0);

    const allBatterLinesForValidation = [...homeBatterLines, ...awayBatterLines];
    const allPitcherLinesForValidation = [...homePitcherLines, ...awayPitcherLines];

    let validationErrors = validateBoxScore(
      { homeHits, awayHits, homeWalks, awayWalks,
        batterLines: allBatterLinesForValidation, pitcherLines: allPitcherLinesForValidation },
      homeTeam.id, awayTeam.id, homeScore, awayScore, isWalkOff
    );

    if (validationErrors.length > 0) {
      console.warn(`[game ${gameId}] box-score validation failed: ${validationErrors.join('; ')}`);
      for (let attempt = 0; attempt < 3 && validationErrors.length > 0; attempt++) {
        // Re-apply rule 1 fix if needed
        if (homeHits < homeScore - homeWalks) {
          distributeExtraWalks(homeBatterLines, (homeScore - homeWalks) - homeHits, rng);
          homeWalks = homeBatterLines.reduce((s, b) => s + b.walks, 0);
        }
        if (awayHits < awayScore - awayWalks) {
          distributeExtraWalks(awayBatterLines, (awayScore - awayWalks) - awayHits, rng);
          awayWalks = awayBatterLines.reduce((s, b) => s + b.walks, 0);
        }
        // Re-clamp RBI for rule 2
        clampRBI(homeBatterLines, homeScore, rng);
        clampRBI(awayBatterLines, awayScore, rng);

        homeHits = homeBatterLines.reduce((s, b) => s + b.hits, 0);
        awayHits = awayBatterLines.reduce((s, b) => s + b.hits, 0);
        homeWalks = homeBatterLines.reduce((s, b) => s + b.walks, 0);
        awayWalks = awayBatterLines.reduce((s, b) => s + b.walks, 0);

        validationErrors = validateBoxScore(
          { homeHits, awayHits, homeWalks, awayWalks,
            batterLines: allBatterLinesForValidation, pitcherLines: allPitcherLinesForValidation },
          homeTeam.id, awayTeam.id, homeScore, awayScore, isWalkOff
        );
      }
      if (validationErrors.length > 0) {
        // §1.1 Iter-5: Fail-closed but ADVANCE current_game_number so the engine
        // does not stall on the same game forever. The game is recorded as a no-op
        // (no W/L change, no stats) but the schedule pointer moves forward.
        console.error(`[game ${gameId}] box-score validation failed after retries; SKIPPING game ${gameNumber}: ${validationErrors.join('; ')}`);
        const db = getDb();
        db.prepare('UPDATE leagues SET current_game_number = ? WHERE id = ?').run(gameNumber, leagueId);
        return;
      }
    }
  }

  // D9: All writes in one transaction including cache update
  const db = getDb();
  const allBatterLines = [...homeBatterLines, ...awayBatterLines];
  const allPitcherLines = [...homePitcherLines, ...awayPitcherLines];

  const writeGame = db.transaction(() => {
    // Insert game log
    const gameResult = db.prepare(
      `INSERT INTO game_log (league_id, season_number, game_number, game_date, home_team_id, away_team_id,
       home_score, away_score, home_hits, away_hits, home_errors, away_errors, home_walks, away_walks,
       notable_events_json, winning_pitcher_id, losing_pitcher_id, save_pitcher_id, is_complete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      leagueId, seasonNumber, gameNumber, dateMs,
      homeTeam.id, awayTeam.id,
      homeScore, awayScore, homeHits, awayHits, homeErrors, awayErrors, homeWalks, awayWalks,
      JSON.stringify(notableEvents),
      winnerPitcherId, loserPitcherId, savePitcherId
    );

    const actualGameId = gameResult.lastInsertRowid as number;

    // AB-10 Part A + Step 10: Vacate 25-man slot and set all injury fields atomically.
    // This fires whether called from runGameTick (engine) or directly from tests.
    // Guard with is_on_25man=1 so we never double-injure or touch minor leaguers.
    // engine.ts write site is suppressed for is_on_25man=0 (already updated here).
    for (const ev of notableEvents) {
      if (ev.type === 'injury' && ev.playerId) {
        const ilGames = ev.recoveryGames ?? 7;
        const injuryType = ev.injuryType ?? 'hamstring';
        const injuryTier = ev.injuryTier ?? 'standard_il';
        const rehabGames = ev.rehabGames ?? 0;
        db.prepare(
          `UPDATE players
           SET is_injured = 1, is_on_25man = 0,
               injury_return_game = ?,
               injury_type = ?,
               injury_tier = ?,
               rehab_games_remaining = ?,
               career_injuries = career_injuries + 1
           WHERE id = ? AND is_on_25man = 1`
        ).run(gameNumber + ilGames, injuryType, injuryTier, rehabGames, ev.playerId);
      }
    }

    // Update season stats for batters
    for (const batter of allBatterLines) {
      upsertBatterStats(db, leagueId, seasonNumber, batter);
    }

    // Update season stats for pitchers
    for (const pitcher of allPitcherLines) {
      upsertPitcherStats(db, leagueId, seasonNumber, pitcher);
    }

    // Update team W/L records — only for regular season games (not playoffs)
    if (!isPlayoff) {
      if (homeWins) {
        db.prepare('UPDATE teams SET wins = wins + 1, runs_scored = runs_scored + ?, runs_allowed = runs_allowed + ?, games_played = games_played + 1 WHERE id = ?')
          .run(homeScore, awayScore, homeTeam.id);
        db.prepare('UPDATE teams SET losses = losses + 1, runs_scored = runs_scored + ?, runs_allowed = runs_allowed + ?, games_played = games_played + 1 WHERE id = ?')
          .run(awayScore, homeScore, awayTeam.id);
      } else {
        db.prepare('UPDATE teams SET losses = losses + 1, runs_scored = runs_scored + ?, runs_allowed = runs_allowed + ?, games_played = games_played + 1 WHERE id = ?')
          .run(homeScore, awayScore, homeTeam.id);
        db.prepare('UPDATE teams SET wins = wins + 1, runs_scored = runs_scored + ?, runs_allowed = runs_allowed + ?, games_played = games_played + 1 WHERE id = ?')
          .run(awayScore, homeScore, awayTeam.id);
      }
    }

    // Update league state
    db.prepare('UPDATE leagues SET current_game_number = ?, current_game_date = ?, last_game_id = ? WHERE id = ?')
      .run(gameNumber, dateMs, actualGameId, leagueId);

    return actualGameId;
  });

  writeGame();
}

function generateBatterLines(
  rng: () => number,
  lineup: PlayerRow[],
  teamId: number,
  teamScore: number
): BatterBoxLine[] {
  const lines: BatterBoxLine[] = [];
  let remainingRBI = teamScore;

  for (const player of lineup) {
    // §5.1 Rule 7: Each starter gets 3-5 ABs
    const atBats = randInt(rng, 3, 5);
    // §2.5 Iter-5: Tightened to keep top AVG leaders under 0.400 spec ceiling.
    // contact=50 → 0.255, contact=80 → 0.31, contact=99 → 0.348 (cap 0.36)
    // Top 10 of 100-AB qualifiers should land in 0.300-0.395 range.
    const hitProb = Math.max(0.15, Math.min(0.36, player.contact / 500 + 0.13));
    let hits = 0;
    for (let ab = 0; ab < atBats; ab++) {
      if (rng() < hitProb) hits++;
    }

    // HRs based on power rating
    const hrProb = Math.max(0, (player.power - 50) / 300);
    let homeRuns = 0;
    for (let h = 0; h < hits; h++) {
      if (rng() < hrProb) homeRuns++;
    }
    homeRuns = Math.min(homeRuns, hits);

    // RBI (will be clamped later)
    const rbi = Math.min(remainingRBI, homeRuns + Math.floor(rng() * 3));
    remainingRBI = Math.max(0, remainingRBI - rbi);

    const walks = rng() < 0.1 ? randInt(rng, 0, 2) : 0;
    const strikeouts = Math.min(atBats - hits, randInt(rng, 0, 3));

    lines.push({
      playerId: player.id,
      playerName: `${player.first_name} ${player.last_name}`,
      teamId,
      position: player.position,
      atBats,
      hits,
      homeRuns,
      rbi,
      walks,
      strikeouts,
    });
  }

  return lines;
}

function distributeExtraWalks(lines: BatterBoxLine[], extra: number, rng: () => number): void {
  for (let i = 0; i < extra; i++) {
    const idx = Math.floor(rng() * lines.length);
    if (lines[idx]) lines[idx].walks++;
  }
}

function clampRBI(lines: BatterBoxLine[], teamRuns: number, rng: () => number): void {
  // §5.1 Rule 2 (corrected): RBI <= runs, >= max(0, runs - 1)
  let totalRBI = lines.reduce((s, b) => s + b.rbi, 0);

  // Clamp down if over
  while (totalRBI > teamRuns) {
    const highRBI = lines.filter(b => b.rbi > 0);
    if (highRBI.length === 0) break;
    const idx = Math.floor(rng() * highRBI.length);
    const player = highRBI[idx];
    if (player && player.rbi > 0) {
      player.rbi--;
      totalRBI--;
    }
  }

  // Ensure at least max(0, runs - 1) RBI if we have enough hits
  const minRBI = Math.max(0, teamRuns - 1);
  while (totalRBI < minRBI && totalRBI < teamRuns) {
    const hasHits = lines.filter(b => b.hits > 0);
    if (hasHits.length === 0) break;
    const idx = Math.floor(rng() * hasHits.length);
    const player = hasHits[idx];
    if (player) {
      player.rbi++;
      totalRBI++;
    } else {
      break;
    }
  }
}

function generatePitcherLines(
  rng: () => number,
  starter: PlayerRow | null,
  bullpen: PlayerRow[],
  teamId: number,
  runsAllowed: number,
  isWalkOff: boolean
): PitcherBoxLine[] {
  const lines: PitcherBoxLine[] = [];

  // §5.1 Rule 3: SP pitches 4.0 - 9.0 innings
  const spIP = starter
    ? Math.round((4 + rng() * 5) * 3) / 3  // 4.0 to 9.0 in thirds
    : 0;

  // §5.1 Rule 4: Total IP
  // Walk-off home win: visiting team batted top of 9, home team pitched 8.0 IP (didn't finish bottom 9)
  // Non-walk-off: 9.0 IP
  const totalIP = isWalkOff ? 8.0 : 9.0;

  if (starter) {
    const starterIP = Math.min(spIP, totalIP);
    const hitsAllowed = randInt(rng, Math.max(0, runsAllowed - 1), Math.min(12, runsAllowed + 4));
    const starterER = Math.min(runsAllowed, Math.round(runsAllowed * (starterIP / totalIP)));
    const starterK = Math.round(starter.pitching_control / 10 + rng() * 5);
    const starterBB = Math.round(Math.max(0, (50 - starter.pitching_control) / 15) + rng() * 2);

    lines.push({
      playerId: starter.id,
      playerName: `${starter.first_name} ${starter.last_name}`,
      teamId,
      inningsPitched: Math.round(starterIP * 3) / 3,
      hitsAllowed,
      earnedRuns: starterER,
      strikeouts: starterK,
      walks: starterBB,
      win: false,
      loss: false,
      save: false,
    });

    // Bullpen covers remaining innings
    let remainingIP = totalIP - starterIP;
    let remainingER = runsAllowed - starterER;
    const bullpenToUse = bullpen.slice(0, 3); // use up to 3 relievers

    if (remainingIP > 0 && bullpenToUse.length > 0) {
      const ipPerReliever = remainingIP / bullpenToUse.length;
      for (let ri = 0; ri < bullpenToUse.length; ri++) {
        const reliever = bullpenToUse[ri]!;
        const isLast = ri === bullpenToUse.length - 1;
        // §2.9 Rule 4: last reliever gets exactly the remaining IP to ensure total = totalIP
        const relIP = isLast
          ? Math.round(remainingIP * 3) / 3  // ensure exact thirds
          : Math.min(remainingIP, Math.round(ipPerReliever * 3) / 3);
        const relER = Math.min(remainingER, Math.round(rng() * 2));
        lines.push({
          playerId: reliever.id,
          playerName: `${reliever.first_name} ${reliever.last_name}`,
          teamId,
          inningsPitched: relIP,
          hitsAllowed: randInt(rng, 0, 3),
          earnedRuns: relER,
          strikeouts: randInt(rng, 0, 3),
          walks: randInt(rng, 0, 2),
          win: false,
          loss: false,
          save: false,
        });
        remainingIP -= relIP;
        remainingER -= relER;
        if (remainingIP <= 0.001) break;
      }
    } else if (remainingIP > 0 && bullpenToUse.length === 0) {
      // No bullpen available — add a placeholder to satisfy total IP
      // This handles edge case where team has no relievers
      lines[0]!.inningsPitched = Math.round(totalIP * 3) / 3;
    }
  }

  // §2.9 Rule 4: Final correction — ensure total IP is exactly right (handle rounding edge cases)
  if (lines.length > 0) {
    const currentTotal = lines.reduce((s, l) => s + l.inningsPitched, 0);
    const diff = Math.round((totalIP - currentTotal) * 3) / 3;
    if (Math.abs(diff) > 0.001 && lines.length > 0) {
      const lastLine = lines[lines.length - 1]!;
      lastLine.inningsPitched = Math.round((lastLine.inningsPitched + diff) * 3) / 3;
    }
  }

  return lines;
}

// §5.1 Rule 5: Win/Loss assignment
function assignWinLoss(
  homeWins: boolean,
  homePitchers: PitcherBoxLine[],
  awayPitchers: PitcherBoxLine[]
): { winnerPitcherId: number | null; loserPitcherId: number | null } {
  const winnerPitchers = homeWins ? homePitchers : awayPitchers;
  const loserPitchers = homeWins ? awayPitchers : homePitchers;

  let winnerPitcherId: number | null = null;
  let loserPitcherId: number | null = null;

  // Winner: SP gets W if >= 5 IP, else first reliever who took the lead
  const sp = winnerPitchers[0];
  if (sp && sp.inningsPitched >= 5) {
    winnerPitcherId = sp.playerId;
  } else {
    // First reliever
    const reliever = winnerPitchers.find((p, i) => i > 0 && p.inningsPitched > 0);
    winnerPitcherId = reliever?.playerId ?? sp?.playerId ?? null;
  }

  // Loser: SP or first reliever to give up the lead
  const loserSP = loserPitchers[0];
  loserPitcherId = loserSP?.playerId ?? null;

  return { winnerPitcherId, loserPitcherId };
}

// §5.1 Rule 6: Save assignment
function assignSave(
  homeWins: boolean,
  homePitchers: PitcherBoxLine[],
  awayPitchers: PitcherBoxLine[],
  homeScore: number,
  awayScore: number,
  winnerPitcherId: number | null
): number | null {
  const winnerPitchers = homeWins ? homePitchers : awayPitchers;
  const margin = Math.abs(homeScore - awayScore);

  // Only save if game was within 3 runs and final pitcher is not the winning pitcher
  if (margin > 3) return null;

  const lastPitcher = winnerPitchers[winnerPitchers.length - 1];
  if (!lastPitcher || lastPitcher.playerId === winnerPitcherId) return null;
  if (lastPitcher.inningsPitched <= 0) return null;

  return lastPitcher.playerId;
}

function generateNotableEvents(
  rng: () => number,
  homeBatterLines: BatterBoxLine[],
  awayBatterLines: BatterBoxLine[],
  homeTeam: TeamRow,
  awayTeam: TeamRow,
  homeScore: number,
  awayScore: number,
  homePitcherLines: PitcherBoxLine[],
  awayPitcherLines: PitcherBoxLine[],
  isWalkOff: boolean,
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  totalSeasonGames: number
): NotableEvent[] {
  const events: NotableEvent[] = [];

  // Home runs by power > 80 batters
  for (const batter of [...homeBatterLines, ...awayBatterLines]) {
    if (batter.homeRuns > 0) {
      const player = prepared('SELECT * FROM players WHERE id = ?').get(batter.playerId) as PlayerRow | undefined;
      if (player && player.power > 80) {
        events.push({
          type: 'home_run',
          playerId: batter.playerId,
          playerName: batter.playerName,
          description: `${batter.playerName} hit a home run with power rating ${player.power}`,
        });
      }
    }
  }

  // Shutout check (SP, 0 runs, >= 6 IP)
  for (const pitcher of [...homePitcherLines, ...awayPitcherLines]) {
    if (pitcher.earnedRuns === 0 && pitcher.inningsPitched >= 6) {
      // Verify it's the starting pitcher (first in list)
      const isStarter = homePitcherLines[0]?.playerId === pitcher.playerId ||
                        awayPitcherLines[0]?.playerId === pitcher.playerId;
      if (isStarter) {
        const oppScore = homePitcherLines[0]?.playerId === pitcher.playerId ? awayScore : homeScore;
        if (oppScore === 0) {
          events.push({
            type: 'shutout',
            playerId: pitcher.playerId,
            playerName: pitcher.playerName,
            description: `${pitcher.playerName} threw a shutout (${pitcher.inningsPitched} IP, 0 ER)`,
          });
        }
      }
    }
  }

  // Walk-off win
  if (isWalkOff && homeScore > awayScore) {
    events.push({
      type: 'walk_off',
      description: `Walk-off win for the home team, ${homeScore}-${awayScore}`,
    });
  }

  // In-game injury (based on injury_prone attribute) — Step 10: include tier/type/rehab
  for (const batter of [...homeBatterLines, ...awayBatterLines]) {
    const player = prepared('SELECT id, injury_prone, position, team_id FROM players WHERE id = ?').get(batter.playerId) as {
      id: number; injury_prone: number; position: string; team_id: number | null;
    } | undefined;
    if (player && player.injury_prone >= 7 && rng() < 0.05) {
      // Find the team's medical staff rating (home or away)
      const playerTeam = player.team_id === homeTeam.id ? homeTeam : awayTeam;
      const medStaff = (playerTeam as TeamRow & { medical_staff_rating?: number }).medical_staff_rating ?? 5;
      const seasonGamesRemaining = Math.max(1, totalSeasonGames - gameNumber);
      const injury = assignInjury(player.position, medStaff, gameNumber, player.id, seasonGamesRemaining);

      events.push({
        type: 'injury',
        playerId: batter.playerId,
        playerName: batter.playerName,
        description: `${batter.playerName} left the game with a ${injury.type} injury (${injury.tier})`,
        recoveryGames: injury.ilGames, // kept for backward compat (old write sites use this)
        injuryType: injury.type,
        injuryTier: injury.tier,
        rehabGames: injury.rehabGames,
      });
    }
  }

  // Career milestone checks
  const milestones = checkCareerMilestones(leagueId, seasonNumber, [...homeBatterLines, ...awayBatterLines], [...homePitcherLines, ...awayPitcherLines]);
  events.push(...milestones);

  return events.slice(0, 20); // CISO F23
}

function checkCareerMilestones(
  leagueId: number,
  seasonNumber: number,
  batterLines: BatterBoxLine[],
  pitcherLines: PitcherBoxLine[]
): NotableEvent[] {
  const milestones: NotableEvent[] = [];

  for (const batter of batterLines) {
    const player = prepared('SELECT * FROM players WHERE id = ?').get(batter.playerId) as PlayerRow | undefined;
    if (!player) continue;

    const prevHR = player.career_hr;
    const newHR = prevHR + batter.homeRuns;

    // §5.1 Rule 9: Use prev < threshold && new >= threshold
    if (prevHR < 100 && newHR >= 100) {
      milestones.push({ type: 'milestone', playerId: player.id, playerName: `${player.first_name} ${player.last_name}`, description: `${player.first_name} ${player.last_name} reached 100 career home runs!` });
    }
    if (prevHR < 200 && newHR >= 200) {
      milestones.push({ type: 'milestone', playerId: player.id, playerName: `${player.first_name} ${player.last_name}`, description: `${player.first_name} ${player.last_name} reached 200 career home runs!` });
    }

    const prevHits = player.career_hits;
    const newHits = prevHits + batter.hits;
    if (prevHits < 2000 && newHits >= 2000) {
      milestones.push({ type: 'milestone', playerId: player.id, playerName: `${player.first_name} ${player.last_name}`, description: `${player.first_name} ${player.last_name} reached 2000 career hits!` });
    }

    // Update career stats
    prepared('UPDATE players SET career_hits = career_hits + ?, career_hr = career_hr + ?, career_rbi = career_rbi + ? WHERE id = ?')
      .run(batter.hits, batter.homeRuns, batter.rbi, batter.playerId);
  }

  for (const pitcher of pitcherLines) {
    const player = prepared('SELECT * FROM players WHERE id = ?').get(pitcher.playerId) as PlayerRow | undefined;
    if (!player) continue;

    const prevK = player.career_k;
    const newK = prevK + pitcher.strikeouts;
    if (prevK < 1000 && newK >= 1000) {
      milestones.push({ type: 'milestone', playerId: player.id, playerName: `${player.first_name} ${player.last_name}`, description: `${player.first_name} ${player.last_name} reached 1000 career strikeouts!` });
    }

    prepared('UPDATE players SET career_ip = career_ip + ?, career_k = career_k + ? WHERE id = ?')
      .run(pitcher.inningsPitched, pitcher.strikeouts, pitcher.playerId);
  }

  return milestones;
}

// §5.8: In-game injury truncation
function applyInjuryTruncation(
  events: NotableEvent[],
  homeBatterLines: BatterBoxLine[],
  awayBatterLines: BatterBoxLine[],
  rng: () => number
): void {
  const injuryEvents = events.filter(e => e.type === 'injury');
  for (const injEvent of injuryEvents) {
    if (!injEvent.playerId) continue;
    const allBatters = [...homeBatterLines, ...awayBatterLines];
    const batter = allBatters.find(b => b.playerId === injEvent.playerId);
    if (batter) {
      const truncFactor = 0.2 + rng() * 0.4; // 0.2 to 0.6
      batter.atBats = Math.max(1, Math.floor(batter.atBats * truncFactor));
      batter.hits = Math.min(batter.hits, batter.atBats);
      batter.homeRuns = Math.min(batter.homeRuns, batter.hits);
      batter.rbi = Math.min(batter.rbi, batter.hits);
    }
  }
}

function upsertBatterStats(
  db: ReturnType<typeof import('../db.js').getDb>,
  leagueId: number,
  seasonNumber: number,
  batter: BatterBoxLine
): void {
  const existing = db.prepare(
    'SELECT id FROM season_stats WHERE league_id = ? AND season_number = ? AND player_id = ?'
  ).get(leagueId, seasonNumber, batter.playerId);

  if (existing) {
    // Also update recent_* rolling stats for call-up/send-down triggers (AB-02)
    db.prepare(
      `UPDATE season_stats SET
        games_played = games_played + 1,
        at_bats = at_bats + ?,
        hits = hits + ?,
        home_runs = home_runs + ?,
        rbi = rbi + ?,
        walks = walks + ?,
        strikeouts_batting = strikeouts_batting + ?,
        recent_ab = recent_ab + ?,
        recent_hits = recent_hits + ?,
        recent_hr = recent_hr + ?,
        recent_walks = recent_walks + ?
       WHERE league_id = ? AND season_number = ? AND player_id = ?`
    ).run(
      batter.atBats, batter.hits, batter.homeRuns, batter.rbi, batter.walks, batter.strikeouts,
      batter.atBats, batter.hits, batter.homeRuns, batter.walks,
      leagueId, seasonNumber, batter.playerId
    );
  } else {
    db.prepare(
      `INSERT INTO season_stats (league_id, season_number, player_id, team_id, games_played,
        at_bats, hits, home_runs, rbi, walks, strikeouts_batting,
        recent_ab, recent_hits, recent_hr, recent_walks)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      leagueId, seasonNumber, batter.playerId, batter.teamId,
      batter.atBats, batter.hits, batter.homeRuns, batter.rbi, batter.walks, batter.strikeouts,
      batter.atBats, batter.hits, batter.homeRuns, batter.walks
    );
  }
}

function upsertPitcherStats(
  db: ReturnType<typeof import('../db.js').getDb>,
  leagueId: number,
  seasonNumber: number,
  pitcher: PitcherBoxLine
): void {
  const existing = db.prepare(
    'SELECT id FROM season_stats WHERE league_id = ? AND season_number = ? AND player_id = ?'
  ).get(leagueId, seasonNumber, pitcher.playerId);

  const wins = pitcher.win ? 1 : 0;
  const losses = pitcher.loss ? 1 : 0;
  const saves = pitcher.save ? 1 : 0;

  if (existing) {
    // AB-21: persist hits_allowed; also update rolling recent_* stats for call-up/send-down triggers
    db.prepare(
      `UPDATE season_stats SET
        games_played = games_played + 1,
        innings_pitched = innings_pitched + ?,
        earned_runs = earned_runs + ?,
        strikeouts_pitching = strikeouts_pitching + ?,
        walks_pitching = walks_pitching + ?,
        wins = wins + ?,
        losses = losses + ?,
        saves = saves + ?,
        hits_allowed = hits_allowed + ?,
        recent_er = recent_er + ?,
        recent_ip = recent_ip + ?,
        recent_starts = recent_starts + 1
       WHERE league_id = ? AND season_number = ? AND player_id = ?`
    ).run(
      pitcher.inningsPitched, pitcher.earnedRuns, pitcher.strikeouts, pitcher.walks,
      wins, losses, saves, pitcher.hitsAllowed,
      pitcher.earnedRuns, pitcher.inningsPitched,
      leagueId, seasonNumber, pitcher.playerId
    );
  } else {
    db.prepare(
      `INSERT INTO season_stats (league_id, season_number, player_id, team_id, games_played,
        innings_pitched, earned_runs, strikeouts_pitching, walks_pitching, wins, losses, saves,
        hits_allowed, recent_er, recent_ip, recent_starts)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      leagueId, seasonNumber, pitcher.playerId, pitcher.teamId,
      pitcher.inningsPitched, pitcher.earnedRuns, pitcher.strikeouts, pitcher.walks,
      wins, losses, saves, pitcher.hitsAllowed,
      pitcher.earnedRuns, pitcher.inningsPitched
    );
  }
}
