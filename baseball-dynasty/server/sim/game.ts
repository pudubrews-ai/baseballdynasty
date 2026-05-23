// Single game simulation
// D6: Lineup and rotation logic
// D9: All writes in one transaction
// D30: Per-game PRNG seed

import { getDb, prepared, type PlayerRow, type TeamRow } from '../db.js';
import { seedFor, randInt, randTriangular, shuffle } from './prng.js';
import type { NotableEvent } from '../../shared/types.js';

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
export function selectLineup(team: TeamRow): PlayerRow[] {
  const roster = prepared(
    'SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position NOT IN (\'SP\',\'RP\',\'CL\') ORDER BY overall_rating DESC'
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
export function selectStartingPitcher(team: TeamRow): PlayerRow | null {
  const starters = prepared(
    'SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position = \'SP\' ORDER BY overall_rating DESC LIMIT 5'
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
    "SELECT overall_rating FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position IN ('RP','CL')"
  ).all(homeTeam.id) as Array<{ overall_rating: number }>;
  const awayBullpen = prepared(
    "SELECT overall_rating FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position IN ('RP','CL')"
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

  // Clamp to [0.15, 0.85]
  return Math.max(0.15, Math.min(0.85, prob));
}

// §5.1: Box score consistency validator
export function validateBoxScore(result: GameResult, homeScore: number, awayScore: number): string[] {
  const errors: string[] = [];

  // Rule 1: hits >= runs - walks
  const homeRuns = homeScore;
  const awayRuns = awayScore;

  if (result.homeHits < homeRuns - result.homeWalks) {
    errors.push(`Home hits ${result.homeHits} < runs ${homeRuns} - walks ${result.homeWalks}`);
  }
  if (result.awayHits < awayRuns - result.awayWalks) {
    errors.push(`Away hits ${result.awayHits} < runs ${awayRuns} - walks ${result.awayWalks}`);
  }

  // Rule 2: RBI constraints
  const homeRBI = result.batterLines.filter(b => b.teamId === homeScore).reduce((s, b) => s + b.rbi, 0);
  const awayRBI = result.batterLines.filter(b => b.teamId !== homeScore).reduce((s, b) => s + b.rbi, 0);

  // Note: corrected rule from §5.1: total_rbi <= total_runs AND >= max(0, total_runs - 1)

  return errors;
}

export async function simulateGame(
  gameId: number,
  homeTeam: TeamRow,
  awayTeam: TeamRow,
  gameNumber: number,
  dateMs: number,
  seasonNumber: number,
  leagueId: number
): Promise<void> {
  // D30: Per-game PRNG seed
  const rng = seedFor(`game:${gameId}`, homeTeam.id ^ awayTeam.id);

  const homeWinProb = winProbability(homeTeam, awayTeam, gameId);
  const homeWins = rng() < homeWinProb;

  // Score generation: triangular distribution, mode=4, winner 3-12, loser 0..winner-1
  const winnerScore = Math.round(randTriangular(rng, 3, 4, 12));
  const loserScore = randInt(rng, 0, Math.max(0, winnerScore - 1));

  const homeScore = homeWins ? winnerScore : loserScore;
  const awayScore = homeWins ? loserScore : winnerScore;
  const isWalkOff = homeWins; // home team winning = potential walk-off

  // Get lineups and pitchers
  const homeLineup = selectLineup(homeTeam);
  const awayLineup = selectLineup(awayTeam);
  const homeStarter = selectStartingPitcher(homeTeam);
  const awayStarter = selectStartingPitcher(awayTeam);

  // Get bullpens
  const homeBullpen = prepared(
    "SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position IN ('RP','CL') ORDER BY overall_rating DESC"
  ).all(homeTeam.id) as PlayerRow[];
  const awayBullpen = prepared(
    "SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position IN ('RP','CL') ORDER BY overall_rating DESC"
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
    const deficit = homeScore - homeWalks - homeHits;
    homeWalks += deficit;
    // Distribute extra walks to batters
    distributeExtraWalks(homeBatterLines, deficit, rng);
  }
  if (awayHits < awayScore - awayWalks) {
    const deficit = awayScore - awayWalks - awayHits;
    awayWalks += deficit;
    distributeExtraWalks(awayBatterLines, deficit, rng);
  }

  // §5.1 Rule 2: clamp RBI
  clampRBI(homeBatterLines, homeScore);
  clampRBI(awayBatterLines, awayScore);

  // Generate pitcher lines
  const homePitcherLines = generatePitcherLines(
    rng, homeStarter, homeBullpen, homeTeam.id, awayScore, isWalkOff
  );
  const awayPitcherLines = generatePitcherLines(
    rng, awayStarter, awayBullpen, awayTeam.id, homeScore, false
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

  // Generate notable events
  const notableEvents = generateNotableEvents(
    rng, homeBatterLines, awayBatterLines, homeTeam, awayTeam,
    homeScore, awayScore, homePitcherLines, awayPitcherLines,
    isWalkOff, leagueId, seasonNumber
  );

  // §5.8: In-game injury truncation
  applyInjuryTruncation(notableEvents, homeBatterLines, awayBatterLines, rng);

  // Clamp notable events to 20 (CISO F23, §5.1 Rule 8)
  while (notableEvents.length > 20) notableEvents.pop();

  const homeErrors = randInt(rng, 0, 2);
  const awayErrors = randInt(rng, 0, 2);

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

    // Update season stats for batters
    for (const batter of allBatterLines) {
      upsertBatterStats(db, leagueId, seasonNumber, batter);
    }

    // Update season stats for pitchers
    for (const pitcher of allPitcherLines) {
      upsertPitcherStats(db, leagueId, seasonNumber, pitcher);
    }

    // Update team W/L records
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
    const hitProb = Math.max(0.15, Math.min(0.45, player.contact / 200 + 0.1));
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

function clampRBI(lines: BatterBoxLine[], teamRuns: number): void {
  // §5.1 Rule 2 (corrected): RBI <= runs, >= max(0, runs - 1)
  let totalRBI = lines.reduce((s, b) => s + b.rbi, 0);

  // Clamp down if over
  while (totalRBI > teamRuns) {
    const highRBI = lines.filter(b => b.rbi > 0);
    if (highRBI.length === 0) break;
    const idx = Math.floor(Math.random() * highRBI.length);
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
    const idx = Math.floor(Math.random() * hasHits.length);
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
  // Visiting team: 9.0 IP
  // Home team winning (walk-off): 8.5 IP (treat as 8.5 rounded)
  // We'll use isWalkOff to determine home team pitching total
  const totalIP = isWalkOff ? 8.5 : 9.0;

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
      for (const reliever of bullpenToUse) {
        const relIP = Math.min(remainingIP, Math.round(ipPerReliever * 3) / 3);
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
        if (remainingIP <= 0) break;
      }
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
  seasonNumber: number
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

  // In-game injury (based on injury_prone attribute)
  for (const batter of [...homeBatterLines, ...awayBatterLines]) {
    const player = prepared('SELECT * FROM players WHERE id = ?').get(batter.playerId) as PlayerRow | undefined;
    if (player && player.injury_prone >= 7 && rng() < 0.05) {
      events.push({
        type: 'injury',
        playerId: batter.playerId,
        playerName: batter.playerName,
        description: `${batter.playerName} left the game with an injury`,
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
    db.prepare(
      'UPDATE season_stats SET games_played = games_played + 1, at_bats = at_bats + ?, hits = hits + ?, home_runs = home_runs + ?, rbi = rbi + ?, walks = walks + ?, strikeouts_batting = strikeouts_batting + ? WHERE league_id = ? AND season_number = ? AND player_id = ?'
    ).run(batter.atBats, batter.hits, batter.homeRuns, batter.rbi, batter.walks, batter.strikeouts, leagueId, seasonNumber, batter.playerId);
  } else {
    db.prepare(
      'INSERT INTO season_stats (league_id, season_number, player_id, team_id, games_played, at_bats, hits, home_runs, rbi, walks, strikeouts_batting) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)'
    ).run(leagueId, seasonNumber, batter.playerId, batter.teamId, batter.atBats, batter.hits, batter.homeRuns, batter.rbi, batter.walks, batter.strikeouts);
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
    db.prepare(
      'UPDATE season_stats SET games_played = games_played + 1, innings_pitched = innings_pitched + ?, earned_runs = earned_runs + ?, strikeouts_pitching = strikeouts_pitching + ?, walks_pitching = walks_pitching + ?, wins = wins + ?, losses = losses + ?, saves = saves + ? WHERE league_id = ? AND season_number = ? AND player_id = ?'
    ).run(pitcher.inningsPitched, pitcher.earnedRuns, pitcher.strikeouts, pitcher.walks, wins, losses, saves, leagueId, seasonNumber, pitcher.playerId);
  } else {
    db.prepare(
      'INSERT INTO season_stats (league_id, season_number, player_id, team_id, games_played, innings_pitched, earned_runs, strikeouts_pitching, walks_pitching, wins, losses, saves) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)'
    ).run(leagueId, seasonNumber, pitcher.playerId, pitcher.teamId, pitcher.inningsPitched, pitcher.earnedRuns, pitcher.strikeouts, pitcher.walks, wins, losses, saves);
  }
}
