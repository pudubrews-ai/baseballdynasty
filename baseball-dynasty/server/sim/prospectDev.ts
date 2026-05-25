// Prospect Development — Phase 7 (v0.2.0)
// Per [AB-10 RULING]: in-season dev replaces offseason young-minor-leaguer growth.
// Per [AB-02 RULING]: minor-league stat synthesizer (display stats, does NOT drive decisions).
// Called from rosterMaintenance when gameNumber % 10 === 0.

import { getDb, prepared, type PlayerRow, type TeamRow } from '../db.js';
import { seedFor } from './prng.js';

// Potential ceiling ratings
const POTENTIAL_CEILING: Record<string, number> = {
  'A': 99,
  'B': 85,
  'C': 70,
  'D': 60,
};

// Run prospect development for all eligible minor leaguers in the league.
// Eligibility: age 18-25, minor_level IN ('AA','A','Rookie') (NOT AAA, NOT 26+).
// AB-02: also runs minor-stat synthesizer for ALL minor leaguers (any age, any level).
export function runProspectDev(leagueId: number, currentGameNumber: number): void {
  const db = getDb();

  const league = prepared(
    'SELECT worldgen_seed, season_number FROM leagues WHERE id = ?'
  ).get(leagueId) as { worldgen_seed: number; season_number: number } | undefined;
  if (!league) return;

  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

  // Build a seeded RNG for this batch
  const batchRng = seedFor(`dev_tick_${leagueId}_${currentGameNumber}`, league.worldgen_seed);

  const devTx = db.transaction(() => {
    for (const team of teams) {
      const coachQuality = Math.round(
        (team.manager_tactics + team.manager_motivation + team.manager_communication) / 3
      ) / 10; // 4.0..7.0 range

      // Dev-eligible prospects: age 18-25, AA/A/Rookie only
      const prospects = prepared(
        `SELECT * FROM players
         WHERE team_id = ? AND age BETWEEN 18 AND 25
           AND minor_level IN ('AA','A','Rookie')
           AND is_drafted = 1`
      ).all(team.id) as PlayerRow[];

      for (const prospect of prospects) {
        const coachability = (prospect.coachability ?? 5) / 10;
        const workEthic = (prospect.work_ethic ?? 5) / 10;

        // AB-07 spec: p = 0.05 + (coachability/10) * (work_ethic/10) * (coachQuality/10) * 0.5
        // Note: coachability and workEthic are already /10 above; coachQuality is already /10
        const devProb = 0.05 + coachability * workEthic * coachQuality * 0.5;

        if (batchRng() < devProb) {
          // Rating tick: +0 or +1 only
          const increment = batchRng() < 0.5 ? 1 : 0;
          if (increment > 0) {
            const ceiling = POTENTIAL_CEILING[prospect.potential] ?? 70;
            const newRating = Math.min(prospect.overall_rating + increment, ceiling);

            if (newRating > prospect.overall_rating) {
              db.prepare(
                'UPDATE players SET overall_rating = ? WHERE id = ?'
              ).run(newRating, prospect.id);

              // Log dev_tick transaction (G6: at least one rating change logged)
              db.prepare(
                `INSERT INTO transactions
                   (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
                 VALUES (?, ?, 'dev_tick', ?, ?, NULL, ?)`
              ).run(leagueId, league.season_number, team.id, prospect.id, Date.now());
            }
          }
        }
      }

      // Minor-league stat synthesizer (AB-02): ALL minor leaguers (any age, any level)
      // Display-only stats — written to season_stats but MUST NOT drive decisions.
      synthesizeMinorStats(team, leagueId, league.season_number, currentGameNumber, league.worldgen_seed, db);
    }
  });

  devTx();
}

// Synthesize minor-league display stats for a team's minor leaguers.
// Stats are cumulative and derived from ratings — purely for display flavor.
// AB-02: "synthesized stat deltas derived from seedFor(...)".
function synthesizeMinorStats(
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number,
  worldgenSeed: number,
  db: ReturnType<typeof import('../db.js').getDb>
): void {
  const minorLeaguers = db.prepare(
    `SELECT * FROM players
     WHERE team_id = ? AND minor_level IS NOT NULL AND is_drafted = 1
       AND rehab_games_remaining = 0`
  ).all(team.id) as PlayerRow[]; // Step 10 F-3: exclude rehab players from stat synthesis

  for (const player of minorLeaguers) {
    const statRng = seedFor(`minor_stat_${player.id}_${currentGameNumber}`, worldgenSeed);

    // Generate "games played" this batch (8-18 plate appearances / 4-9 IP)
    const isPitcher = ['SP', 'RP', 'CL'].includes(player.position);

    // Get or create season_stats row
    const existing = db.prepare(
      'SELECT id FROM season_stats WHERE league_id = ? AND season_number = ? AND player_id = ? AND team_id = ?'
    ).get(leagueId, seasonNumber, player.id, team.id) as { id: number } | undefined;

    if (!existing) {
      db.prepare(
        `INSERT OR IGNORE INTO season_stats
           (league_id, season_number, team_id, player_id,
            at_bats, hits, home_runs, rbi, walks, strikeouts_batting,
            innings_pitched, earned_runs, strikeouts_pitching, walks_pitching, games_played)
         VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`
      ).run(leagueId, seasonNumber, team.id, player.id);
    }

    if (isPitcher) {
      // IP: 4-9, ER scaled to inverse of pitching_control
      const ip = Math.floor(statRng() * 6) + 4;
      const erRate = 1.0 - (player.pitching_control ?? 50) / 100;
      const er = Math.round(ip * erRate * 0.6);
      const kRate = (player.pitching_velocity ?? 50) / 100;
      const kPerIp = kRate * 1.2;
      const k = Math.round(ip * kPerIp);
      const bb = Math.round(ip * (1.0 - (player.pitching_control ?? 50) / 100) * 0.4);

      db.prepare(
        `UPDATE season_stats
         SET innings_pitched = innings_pitched + ?,
             earned_runs = earned_runs + ?,
             strikeouts_pitching = strikeouts_pitching + ?,
             walks_pitching = walks_pitching + ?,
             games_played = games_played + 1
         WHERE league_id = ? AND season_number = ? AND player_id = ? AND team_id = ?`
      ).run(ip, er, k, bb, leagueId, seasonNumber, player.id, team.id);
    } else {
      // Batters: AB 8-18, hits based on contact
      const ab = Math.floor(statRng() * 11) + 8;
      const contactRate = (player.contact ?? 50) / 300; // roughly .167 to .333
      const hits = Math.round(ab * contactRate);
      const hrRate = (player.power ?? 50) / 1500;
      const hr = Math.floor(ab * hrRate);
      const walkRate = 0.08 + (player.coachability ?? 5) / 100;
      const walks = Math.round(ab * walkRate);
      const rbi = Math.round(hits * 0.4 + hr * 1.5);

      // Hit streak detection: update hit_streak
      const gotHit = hits > 0 ? 1 : 0;
      const hitStreakSql = gotHit
        ? 'hit_streak = hit_streak + 1'
        : 'hit_streak = 0';

      db.prepare(
        `UPDATE season_stats
         SET at_bats = at_bats + ?,
             hits = hits + ?,
             home_runs = home_runs + ?,
             rbi = rbi + ?,
             walks = walks + ?,
             games_played = games_played + 1,
             ${hitStreakSql}
         WHERE league_id = ? AND season_number = ? AND player_id = ? AND team_id = ?`
      ).run(ab, hits, hr, rbi, walks, leagueId, seasonNumber, player.id, team.id);

      // Hot streak detection: 5+ consecutive simulated games with hits
      const streak = (db.prepare(
        'SELECT hit_streak FROM season_stats WHERE league_id = ? AND season_number = ? AND player_id = ? AND team_id = ?'
      ).get(leagueId, seasonNumber, player.id, team.id) as { hit_streak: number } | undefined)?.hit_streak ?? 0;

      if (streak >= 5 && !(player.prospect_visible)) {
        db.prepare(
          'UPDATE players SET prospect_visible = 1 WHERE id = ?'
        ).run(player.id);
      }
    }
  }
}
