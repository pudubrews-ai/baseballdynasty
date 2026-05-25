// Minor League Cascading — Step 8
// Performance-based live in-season promotions/demotions per the Step 8 spec.
//
// Cadence: per-team clock — `team.games_played - team.last_cascade_check_game >= 5`.
// Called from rosterMaintenance.ts per-team loop (NOT from inside runProspectDev's transaction).
//
// Transaction scope (D-2): runs in its OWN synchronous db.transaction(), never nested.
// Ordering (D-3): called before checkRosterInvariant so settled moves are respected.
// Rehab exclusion (B-6): queries exclude rehab_games_remaining > 0 and suspension_games_remaining > 0.
//
// Empty-level backfill (D-5): stripped-down inline generator using deterministic seeded rolls.
// Does NOT call worldgen.ts (heavyweight). Names drawn from data/names.ts.

import { getDb, prepared, type TeamRow } from '../db.js';
import { seedFor, randInt } from './prng.js';
import { insertNewsItem } from './news.js';
import { NAME_POOLS } from '../data/names.js';

// ─────────────────────────────────────────────────────────────────────────────
// Promotion / demotion thresholds per spec
// ─────────────────────────────────────────────────────────────────────────────

interface LevelThresholds {
  promoAvgMinAB: number;
  promoAvgThreshold: number;
  promoEraMaxIP: number;
  promoEraThreshold: number;
  demoteAvgMinAB: number;
  demoteAvgThreshold: number;
  demoteEraMaxIP: number;
  demoteEraThreshold: number;
}

const THRESHOLDS: Record<string, LevelThresholds> = {
  // Promotions to next level
  AA: {   // AA → AAA
    promoAvgMinAB: 20, promoAvgThreshold: 0.310,
    promoEraMaxIP: 15, promoEraThreshold: 2.40,
    demoteAvgMinAB: 25, demoteAvgThreshold: 0.200,
    demoteEraMaxIP: 20, demoteEraThreshold: 6.50,
  },
  A: {    // A → AA
    promoAvgMinAB: 20, promoAvgThreshold: 0.320,
    promoEraMaxIP: 15, promoEraThreshold: 2.20,
    demoteAvgMinAB: 25, demoteAvgThreshold: 0.190,
    demoteEraMaxIP: 20, demoteEraThreshold: 7.00,
  },
  Rookie: {  // Rookie → A
    promoAvgMinAB: 15, promoAvgThreshold: 0.330,
    promoEraMaxIP: 10, promoEraThreshold: 2.00,
    demoteAvgMinAB: 0, demoteAvgThreshold: 0,   // no demotion from Rookie
    demoteEraMaxIP: 0, demoteEraThreshold: 9999,
  },
};

const LEVEL_ORDER = ['Rookie', 'A', 'AA', 'AAA'] as const;
type MinorLevel = typeof LEVEL_ORDER[number];

function levelUp(level: MinorLevel): MinorLevel | null {
  const idx = LEVEL_ORDER.indexOf(level);
  return idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] ?? null : null;
}

function levelDown(level: MinorLevel): MinorLevel | null {
  const idx = LEVEL_ORDER.indexOf(level);
  return idx > 0 ? LEVEL_ORDER[idx - 1] ?? null : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minor stat row shape from season_stats
// ─────────────────────────────────────────────────────────────────────────────

interface MinorStatRow {
  player_id: number;
  recent_ab: number;
  recent_hits: number;
  recent_ip: number;
  recent_er: number;
  promo_eval_streak: number;
  position: string;
  minor_level: string;
  overall_rating: number;
  team_id: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluate promotion/demotion pass for a single player
// Returns: 'promote' | 'demote' | 'neutral'
// ─────────────────────────────────────────────────────────────────────────────

function evaluatePerformance(row: MinorStatRow): 'promote' | 'demote' | 'neutral' {
  const level = row.minor_level as MinorLevel;
  const thresholds = THRESHOLDS[level];
  if (!thresholds) return 'neutral';

  const isPitcher = row.position === 'SP' || row.position === 'RP';

  if (isPitcher) {
    const hasEnoughIP_promo = row.recent_ip >= thresholds.promoEraMaxIP;
    const hasEnoughIP_demote = row.recent_ip >= thresholds.demoteEraMaxIP;
    const era = row.recent_ip > 0 ? (row.recent_er * 9) / row.recent_ip : 99;

    if (hasEnoughIP_promo && era < thresholds.promoEraThreshold) return 'promote';
    if (hasEnoughIP_demote && era > thresholds.demoteEraThreshold && thresholds.demoteEraMaxIP > 0) return 'demote';
  } else {
    const hasEnoughAB_promo = row.recent_ab >= thresholds.promoAvgMinAB;
    const hasEnoughAB_demote = row.recent_ab >= thresholds.demoteAvgMinAB;
    const avg = row.recent_ab > 0 ? row.recent_hits / row.recent_ab : 0;

    if (hasEnoughAB_promo && avg > thresholds.promoAvgThreshold) return 'promote';
    if (hasEnoughAB_demote && avg < thresholds.demoteAvgThreshold && thresholds.demoteAvgMinAB > 0) return 'demote';
  }

  return 'neutral';
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty-level backfill (D-5): stripped-down inline generator
// Does NOT use worldgen.ts. Only required columns filled.
// ─────────────────────────────────────────────────────────────────────────────

function generateReplacementPlayers(
  db: ReturnType<typeof getDb>,
  leagueId: number,
  teamId: number,
  level: MinorLevel,
  count: number,
  seed: number
): void {
  const rng = seedFor(`empty_level_${level}_${teamId}`, seed);
  const firstNames = NAME_POOLS.us.first;
  const lastNames = NAME_POOLS.us.last;
  const positions = ['OF', '1B', '2B', 'SS', '3B', 'C', 'SP', 'RP'];

  for (let i = 0; i < count; i++) {
    const firstName = firstNames[Math.floor(rng() * firstNames.length)] ?? 'Juan';
    const lastName = lastNames[Math.floor(rng() * lastNames.length)] ?? 'Smith';
    const position = positions[Math.floor(rng() * positions.length)] ?? 'OF';
    const overall = randInt(rng, 35, 45);

    db.prepare(
      `INSERT INTO players
         (league_id, team_id, first_name, last_name, age, position, overall_rating,
          potential, is_drafted, minor_level, is_on_mlb_roster, is_on_25man,
          contact, power, speed, fielding, arm,
          pitching_velocity, pitching_control, pitching_stamina,
          annual_salary, contract_years_remaining, service_time,
          rehab_games_remaining, suspension_games_remaining,
          coachability, work_ethic, leadership)
       VALUES (?, ?, ?, ?, ?, ?, ?,
               'D', 1, ?, 0, 0,
               ?, ?, ?, ?, ?,
               ?, ?, ?,
               400000, 1, 0,
               0, 0,
               50, 50, 50)`
    ).run(
      leagueId, teamId, firstName, lastName,
      randInt(rng, 18, 22), position, overall,
      level,
      overall, overall, overall, overall, overall,
      overall, overall, overall
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main cascade entry point — called per-team, SYNCHRONOUS, no async escapes
// ─────────────────────────────────────────────────────────────────────────────

export function runCascadeEval(
  leagueId: number,
  teamId: number,
  seasonNumber: number,
  gameNumber: number,
  gmArchetype: string
): void {
  const db = getDb();

  // Seed combining teamId + gameNumber for determinism
  const seed = leagueId ^ (teamId * 1000) ^ gameNumber;

  const cascadeTx = db.transaction(() => {
    // ── Fetch all active minor leaguers for this team (excluding rehab and suspended) ──
    const players = db.prepare(
      `SELECT ss.player_id, ss.recent_ab, ss.recent_hits, ss.recent_ip, ss.recent_er,
              p.promo_eval_streak, p.position, p.minor_level, p.overall_rating, p.team_id
       FROM players p
       LEFT JOIN season_stats ss ON ss.player_id = p.id AND ss.league_id = ? AND ss.season_number = ?
       WHERE p.league_id = ? AND p.team_id = ? AND p.minor_level IS NOT NULL
         AND p.is_on_mlb_roster = 0
         AND p.rehab_games_remaining = 0
         AND p.suspension_games_remaining = 0`
    ).all(leagueId, seasonNumber, leagueId, teamId) as MinorStatRow[];

    // Group by level for cascading and empty-level detection
    const byLevel: Record<string, MinorStatRow[]> = { Rookie: [], A: [], AA: [], AAA: [] };
    for (const p of players) {
      if (p.minor_level && byLevel[p.minor_level]) {
        byLevel[p.minor_level]!.push(p);
      }
    }

    // ── Process promotion/demotion per player ──
    // Cascade: when a promotion opens a slot, evaluate best eligible at the level below (same tx)
    // Bound cascade depth to one promotion per slot per tick.

    for (const level of ['Rookie', 'A', 'AA'] as MinorLevel[]) {
      const levelPlayers = byLevel[level] ?? [];
      const nextLevel = levelUp(level as MinorLevel)!;

      for (const player of levelPlayers) {
        const result = evaluatePerformance(player);

        if (result === 'promote') {
          const newStreak = (player.promo_eval_streak ?? 0) + 1;
          if (newStreak >= 2) {
            // Execute promotion
            db.prepare(
              'UPDATE players SET minor_level = ?, promo_eval_streak = 0 WHERE id = ?'
            ).run(nextLevel, player.player_id);

            // News item for the promotion
            insertNewsItem({
              leagueId,
              seasonNumber,
              gameNumber,
              eventType: 'call_up',
              teamId,
              playerId: player.player_id,
              headlineText: `Minor league promotion: Player moved from ${level} to ${nextLevel}`,
            });

            // Update byLevel for cascade: add to next level, remove from current
            const playerWithNewLevel = { ...player, minor_level: nextLevel, promo_eval_streak: 0 };
            byLevel[nextLevel]!.push(playerWithNewLevel);
            byLevel[level] = byLevel[level]!.filter(p => p.player_id !== player.player_id);

            // Cascade: evaluate the best player at the level below to fill the vacated slot
            // (one cascade step per slot per tick)
            if (level !== 'Rookie') {
              const prevLevel = levelDown(level as MinorLevel) as MinorLevel;
              const prevLevelPlayers = byLevel[prevLevel] ?? [];
              if (prevLevelPlayers.length > 0) {
                // Best eligible player at the level below (highest overall)
                const best = prevLevelPlayers.reduce((a, b) => a.overall_rating >= b.overall_rating ? a : b);
                const bestResult = evaluatePerformance(best);
                if (bestResult === 'promote') {
                  const bestStreak = (best.promo_eval_streak ?? 0) + 1;
                  if (bestStreak >= 2) {
                    db.prepare(
                      'UPDATE players SET minor_level = ?, promo_eval_streak = 0 WHERE id = ?'
                    ).run(level, best.player_id);

                    insertNewsItem({
                      leagueId,
                      seasonNumber,
                      gameNumber,
                      eventType: 'call_up',
                      teamId,
                      playerId: best.player_id,
                      headlineText: `Cascading promotion: Player moved from ${prevLevel} to ${level}`,
                    });

                    byLevel[level]!.push({ ...best, minor_level: level, promo_eval_streak: 0 });
                    byLevel[prevLevel] = byLevel[prevLevel]!.filter(p => p.player_id !== best.player_id);
                  } else {
                    db.prepare('UPDATE players SET promo_eval_streak = ? WHERE id = ?').run(bestStreak, best.player_id);
                  }
                }
              }
            }
          } else {
            // Increment streak toward promotion
            db.prepare('UPDATE players SET promo_eval_streak = ? WHERE id = ?').run(newStreak, player.player_id);
          }
        } else if (result === 'demote') {
          const newStreak = (player.promo_eval_streak ?? 0) - 1;
          if (newStreak <= -2) {
            const prevLevel = levelDown(level as MinorLevel);
            if (prevLevel) {
              db.prepare(
                'UPDATE players SET minor_level = ?, promo_eval_streak = 0 WHERE id = ?'
              ).run(prevLevel, player.player_id);

              insertNewsItem({
                leagueId,
                seasonNumber,
                gameNumber,
                eventType: 'send_down',
                teamId,
                playerId: player.player_id,
                headlineText: `Minor league demotion: Player moved from ${level} to ${prevLevel}`,
              });
            }
          } else {
            db.prepare('UPDATE players SET promo_eval_streak = ? WHERE id = ?').run(newStreak, player.player_id);
          }
        } else {
          // Neutral — decay streak toward zero (don't reset outright)
          const currentStreak = player.promo_eval_streak ?? 0;
          if (currentStreak !== 0) {
            const decayed = currentStreak > 0 ? currentStreak - 1 : currentStreak + 1;
            db.prepare('UPDATE players SET promo_eval_streak = ? WHERE id = ?').run(decayed, player.player_id);
          }
        }
      }
    }

    // ── AAA logjam check ──
    // AAA player meets promotion criteria but they have no open MLB spot (is_on_mlb_roster=0
    // means they're already in minors). The "MLB slot" logjam: if the AAA player's promotion
    // streak hits >=2 but no MLB vacancy exists, emit logjam news.
    // Analytics GM acts after 1 failed window; old-school waits 2.
    const aaaTriggerStreakThreshold = gmArchetype === 'analytics' ? 1 : 2;

    const aaaPlayers = byLevel['AAA'] ?? [];
    for (const player of aaaPlayers) {
      const result = evaluatePerformance(player);
      if (result === 'promote') {
        const newStreak = (player.promo_eval_streak ?? 0) + 1;
        if (newStreak >= aaaTriggerStreakThreshold) {
          // Logjam: AAA player ready but no MLB slot cascade yet (that's handled by callup.ts)
          // Emit the news item and reset streak so it doesn't double-fire
          insertNewsItem({
            leagueId,
            seasonNumber,
            gameNumber,
            eventType: 'call_up',
            teamId,
            playerId: player.player_id,
            headlineText: `Logjam: ${player.position} prospect ready for MLB call-up but roster full`,
          });
          // Don't promote here — callup.ts handles actual MLB movement
          db.prepare('UPDATE players SET promo_eval_streak = ? WHERE id = ?').run(newStreak, player.player_id);
        } else {
          db.prepare('UPDATE players SET promo_eval_streak = ? WHERE id = ?').run(newStreak, player.player_id);
        }
      }
    }

    // ── Empty-level backfill (D-5) ──
    // After all moves, check if any level has been emptied — generate 2-3 replacement players.
    const rng = seedFor(`empty_level_check_${teamId}`, seed);
    for (const level of ['Rookie', 'A', 'AA', 'AAA'] as MinorLevel[]) {
      // Re-count players at this level after all moves
      const remaining = db.prepare(
        `SELECT COUNT(*) as cnt FROM players
         WHERE league_id = ? AND team_id = ? AND minor_level = ?
           AND is_on_mlb_roster = 0
           AND rehab_games_remaining = 0
           AND suspension_games_remaining = 0`
      ).get(leagueId, teamId, level) as { cnt: number } | undefined;

      if ((remaining?.cnt ?? 0) === 0) {
        const fillCount = 2 + Math.floor(rng() * 2); // 2 or 3
        generateReplacementPlayers(db, leagueId, teamId, level, fillCount, seed ^ level.charCodeAt(0));
      }
    }

    // ── Update last_cascade_check_game ──
    // (Caller updates this outside the transaction — see rosterMaintenance.ts call site)
  });

  cascadeTx();
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 9: Synthetic Minor League Standings Generator
// Updated every 5 games per the cascade clock (same cadence).
// Rolls W/L for each team's affiliate based on mean overall vs league-average baseline.
// Writes to minor_league_standings (UNIQUE on league+team+season+level).
// ─────────────────────────────────────────────────────────────────────────────

export function updateMinorStandings(
  leagueId: number,
  teamId: number,
  seasonNumber: number,
  gameNumber: number
): void {
  const db = getDb();

  // Compute league-average overall for the minor leagues overall baseline
  const leagueAvg = (db.prepare(
    `SELECT AVG(overall_rating) as avg_overall FROM players
     WHERE league_id = ? AND minor_level IS NOT NULL AND is_on_mlb_roster = 0`
  ).get(leagueId) as { avg_overall: number | null } | undefined)?.avg_overall ?? 60;

  const LEVELS = ['AAA', 'AA', 'A', 'Rookie'] as const;
  const seed = leagueId ^ (teamId * 1337) ^ gameNumber;

  const standingsTx = db.transaction(() => {
    for (const level of LEVELS) {
      // Compute mean overall for this team at this level
      const stats = db.prepare(
        `SELECT AVG(overall_rating) as mean_overall, COUNT(*) as cnt
         FROM players
         WHERE league_id = ? AND team_id = ? AND minor_level = ?
           AND is_on_mlb_roster = 0`
      ).get(leagueId, teamId, level) as { mean_overall: number | null; cnt: number } | undefined;

      const meanOverall = stats?.mean_overall ?? leagueAvg;
      const cnt = stats?.cnt ?? 0;

      if (cnt === 0) {
        // No players at this level — 0-0 row (do NOT upsert wins, leave existing unchanged)
        db.prepare(
          `INSERT OR IGNORE INTO minor_league_standings
             (league_id, team_id, season_number, level, wins, losses, last_updated_game)
           VALUES (?, ?, ?, ?, 0, 0, ?)`
        ).run(leagueId, teamId, seasonNumber, level, gameNumber);
        continue;
      }

      // Win probability based on relative talent advantage
      // p_win = 0.5 + (meanOverall - leagueAvg) / 100 (clamped 0.25–0.75)
      const pWin = Math.max(0.25, Math.min(0.75, 0.5 + (meanOverall - leagueAvg) / 100));

      // Each 5-game window: roll ~5 simulated games
      const rng = seedFor(`standings_${level}_${teamId}`, seed);
      let wins = 0;
      let losses = 0;
      for (let g = 0; g < 5; g++) {
        if (rng() < pWin) wins++; else losses++;
      }

      // Upsert: increment wins/losses (UNIQUE on league+team+season+level)
      db.prepare(
        `INSERT INTO minor_league_standings (league_id, team_id, season_number, level, wins, losses, last_updated_game)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(league_id, team_id, season_number, level)
         DO UPDATE SET wins = wins + excluded.wins,
                       losses = losses + excluded.losses,
                       last_updated_game = excluded.last_updated_game`
      ).run(leagueId, teamId, seasonNumber, level, wins, losses, gameNumber);
    }
  });

  standingsTx();
}
