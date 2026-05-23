// Schedule generation and season orchestration
// D4: Each team plays 50 games (36 intra-conference + 14 inter-conference)
// D5: Season starts 2026-04-01, date advances every 10 games (one "game-day" = 10 games)

import { getDb, prepared, type LeagueRow, type TeamRow } from '../db.js';
import { seedFor, shuffle } from './prng.js';

export interface ScheduleGame {
  gameNumber: number;
  dateMs: number;
  homeTeamId: number;
  awayTeamId: number;
}

const SEASON_START_DATE = new Date('2026-04-01T00:00:00Z').getTime();
const ONE_DAY_MS = 86_400_000;

// D4: Schedule generator
// Each team plays:
//   - 9 intra-conference opponents × 4 games = 36 games
//   - 10 inter-conference opponents: 4 of them twice + 6 of them once = 14 games
// Total: 50 games per team, 25 home + 25 away
// Total league games: 20 teams × 50 / 2 = 500
export function generateSchedule(leagueId: number, seed: number): ScheduleGame[] {
  const teams = prepared('SELECT * FROM teams WHERE league_id = ? ORDER BY id').all(leagueId) as TeamRow[];

  // Split into conferences of 10 teams each
  const americanConf = teams.filter(t => t.conference === 'American');
  const nationalConf = teams.filter(t => t.conference === 'National');

  const games: ScheduleGame[] = [];
  const rng = seedFor('schedule', seed);

  // Generate intra-conference games (4 per matchup)
  function generateIntraConferenceGames(confTeams: TeamRow[], allGames: ScheduleGame[]): void {
    for (let i = 0; i < confTeams.length; i++) {
      for (let j = i + 1; j < confTeams.length; j++) {
        const teamA = confTeams[i]!;
        const teamB = confTeams[j]!;
        // 4 games per pair, alternating home/away (2 home for each)
        allGames.push({ gameNumber: 0, dateMs: 0, homeTeamId: teamA.id, awayTeamId: teamB.id });
        allGames.push({ gameNumber: 0, dateMs: 0, homeTeamId: teamB.id, awayTeamId: teamA.id });
        allGames.push({ gameNumber: 0, dateMs: 0, homeTeamId: teamA.id, awayTeamId: teamB.id });
        allGames.push({ gameNumber: 0, dateMs: 0, homeTeamId: teamB.id, awayTeamId: teamA.id });
      }
    }
  }

  // D4: Inter-conference pairing algorithm
  // Each American team plays each National team. 4 NL opponents played twice (home+away), 6 once.
  // To ensure exactly 25H/25A per team (7H/7A inter-conference per team):
  // - Twice-played pairs: 1 home + 1 away → 4H+4A per team
  // - Single-played pairs: need exactly 3H+3A per team
  // Uses quota-based greedy assignment with retry-on-imbalance (§4.3)
  function tryAssignInterConference(
    americanTeams: TeamRow[],
    nationalTeams: TeamRow[],
    allGames: ScheduleGame[],
    attempt: number
  ): boolean {
    const interGamesStart = allGames.length;

    // Collect all single-game pairs first
    const singlePairs: Array<[TeamRow, TeamRow]> = [];

    for (const aTeam of americanTeams) {
      const opponents = [...nationalTeams].sort((a, b) => a.id - b.id);

      for (const nTeam of opponents) {
        const pairKey = (aTeam.id + nTeam.id) % 10;
        const playedTwice = pairKey < 4;

        if (playedTwice) {
          // 2 games: 1 home + 1 away — automatically balanced
          allGames.push({ gameNumber: 0, dateMs: 0, homeTeamId: aTeam.id, awayTeamId: nTeam.id });
          allGames.push({ gameNumber: 0, dateMs: 0, homeTeamId: nTeam.id, awayTeamId: aTeam.id });
        } else {
          singlePairs.push([aTeam, nTeam]);
        }
      }
    }

    // Sort single-game pairs — use sub-stream seed for retry attempts
    if (attempt === 0) {
      singlePairs.sort((a, b) => (a[0]?.id ?? 0) - (b[0]?.id ?? 0) || (a[1]?.id ?? 0) - (b[1]?.id ?? 0));
    } else {
      // Retry: shuffle pair iteration order with attempt-specific seed
      const retryRng = seedFor(`schedule_attempt_${attempt}`, seed);
      shuffle(retryRng, singlePairs);
    }

    // Quota-based greedy: each team needs exactly 3 home games from singles
    const homeQuota = new Map<number, number>();
    for (const team of [...americanTeams, ...nationalTeams]) {
      homeQuota.set(team.id, 3);
    }

    for (const [aTeam, nTeam] of singlePairs) {
      const aQuota = homeQuota.get(aTeam.id) ?? 0;
      const nQuota = homeQuota.get(nTeam.id) ?? 0;

      let homeTeam: TeamRow;
      let awayTeam: TeamRow;

      if (aQuota > 0 && nQuota > 0) {
        const aIsHome = (aTeam.id + nTeam.id * 7 + attempt) % 2 === 0;
        homeTeam = aIsHome ? aTeam : nTeam;
        awayTeam = aIsHome ? nTeam : aTeam;
      } else if (aQuota > 0) {
        homeTeam = aTeam;
        awayTeam = nTeam;
      } else if (nQuota > 0) {
        homeTeam = nTeam;
        awayTeam = aTeam;
      } else {
        // Both exhausted — assign American home as fallback (may break balance, caught by validator)
        homeTeam = aTeam;
        awayTeam = nTeam;
      }

      allGames.push({ gameNumber: 0, dateMs: 0, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id });
      homeQuota.set(homeTeam.id, (homeQuota.get(homeTeam.id) ?? 0) - 1);
    }

    // Validate balance for inter-conference games
    const interGames = allGames.slice(interGamesStart);
    const homeCounts = new Map<number, number>();
    const awayCounts = new Map<number, number>();
    for (const g of interGames) {
      homeCounts.set(g.homeTeamId, (homeCounts.get(g.homeTeamId) ?? 0) + 1);
      awayCounts.set(g.awayTeamId, (awayCounts.get(g.awayTeamId) ?? 0) + 1);
    }

    for (const team of [...americanTeams, ...nationalTeams]) {
      const h = homeCounts.get(team.id) ?? 0;
      const a = awayCounts.get(team.id) ?? 0;
      if (h + a !== 14 || h !== 7 || a !== 7) {
        // Remove inter-conference games added in this attempt
        allGames.splice(interGamesStart);
        return false;
      }
    }
    return true;
  }

  function generateInterConferenceGames(americanTeams: TeamRow[], nationalTeams: TeamRow[], allGames: ScheduleGame[]): void {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (tryAssignInterConference(americanTeams, nationalTeams, allGames, attempt)) return;
    }
    throw new Error('Inter-conference schedule could not balance 25H/25A within 5 attempts');
  }

  generateIntraConferenceGames(americanConf, games);
  generateIntraConferenceGames(nationalConf, games);
  generateInterConferenceGames(americanConf, nationalConf, games);

  // Validate home/away balance before shuffling
  // Each team should have exactly 25 home + 25 away
  const homeCount = new Map<number, number>();
  const awayCount = new Map<number, number>();
  for (const g of games) {
    homeCount.set(g.homeTeamId, (homeCount.get(g.homeTeamId) ?? 0) + 1);
    awayCount.set(g.awayTeamId, (awayCount.get(g.awayTeamId) ?? 0) + 1);
  }

  for (const team of teams) {
    const home = homeCount.get(team.id) ?? 0;
    const away = awayCount.get(team.id) ?? 0;
    if (home !== 25 || away !== 25) {
      console.warn(`[schedule] Team ${team.id} (${team.name}): home=${home}, away=${away} (expected 25/25)`);
    }
  }

  // Shuffle game order
  shuffle(rng, games);

  // Assign game numbers and dates
  // D5: Date advances once per 10 games (one "game-day" slate)
  for (let i = 0; i < games.length; i++) {
    const game = games[i]!;
    game.gameNumber = i + 1;
    const dayIndex = Math.floor(i / 10);
    game.dateMs = SEASON_START_DATE + dayIndex * ONE_DAY_MS;
  }

  return games;
}

// Store schedule in the league row
export function saveSchedule(leagueId: number, schedule: ScheduleGame[]): void {
  prepared('UPDATE leagues SET schedule_json = ? WHERE id = ?').run(
    JSON.stringify(schedule),
    leagueId
  );
}

// Load schedule from DB
export function loadSchedule(league: LeagueRow): ScheduleGame[] {
  if (!league.schedule_json) return [];
  try {
    return JSON.parse(league.schedule_json) as ScheduleGame[];
  } catch {
    return [];
  }
}

// Get the next unplayed game
export function getNextGame(leagueId: number): ScheduleGame | null {
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow | undefined;
  if (!league?.schedule_json) return null;

  const schedule = loadSchedule(league);
  const lastGameNum = league.current_game_number;

  return schedule.find(g => g.gameNumber > lastGameNum) ?? null;
}

// Check if season is complete (median team has played 50 games)
export function isSeasonComplete(leagueId: number): boolean {
  const counts = prepared(
    `SELECT COUNT(*) as cnt FROM game_log
     WHERE league_id = ? AND is_complete = 1 AND season_number = (SELECT season_number FROM leagues WHERE id = ?)`
  ).get(leagueId, leagueId) as { cnt: number };

  return counts.cnt >= 500; // All 500 games played
}

// Check if trade deadline should fire (median team at game 35)
export function shouldFireTradeDeadline(leagueId: number, seasonNumber: number): boolean {
  // Count total games per team (home + away), then count teams at >= 35
  const teamsAt35 = prepared(
    `SELECT COUNT(*) as cnt FROM (
       SELECT team_id, SUM(cnt) as gc FROM (
         SELECT home_team_id as team_id, COUNT(*) as cnt
         FROM game_log
         WHERE league_id = ? AND season_number = ? AND is_complete = 1
         GROUP BY home_team_id
         UNION ALL
         SELECT away_team_id as team_id, COUNT(*) as cnt
         FROM game_log
         WHERE league_id = ? AND season_number = ? AND is_complete = 1
         GROUP BY away_team_id
       )
       GROUP BY team_id
       HAVING gc >= 35
     )`
  ).get(leagueId, seasonNumber, leagueId, seasonNumber) as { cnt: number };

  // Also check if trade deadline already fired this season
  const alreadyFired = prepared(
    "SELECT id FROM transactions WHERE league_id = ? AND season_number = ? AND transaction_type = 'trade_deadline'"
  ).get(leagueId, seasonNumber);

  return teamsAt35.cnt >= 10 && !alreadyFired;
}

// Fire trade deadline (procedural in v0.1.0)
export function fireTradeDeadline(leagueId: number, seasonNumber: number): void {
  const db = getDb();
  // Mark that trade deadline fired
  db.prepare(
    "INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, 'trade_deadline', NULL, NULL, 'Trade deadline passed.', ?)"
  ).run(leagueId, seasonNumber, Date.now());

  console.log(`[season] Trade deadline fired for season ${seasonNumber}`);
}
