// GET /api/watch — v0.3.0 §3
// Returns owned-team-aware derived watch state. All derived fields deterministic (no Math.random).

import { Router, Request, Response, NextFunction } from 'express';
import { getActiveLeague, prepared } from '../db.js';
import { getFranchiseState } from '../sim/franchise.js';
import { computeTeamStreak } from '../sim/streak.js';

export const watchRouter = Router();

// Derived attendance — D2
function computeAttendance(
  marketSize: string,
  winPct: number,
  homeTeamId: number,
  gameNumber: number
): { attendancePct: number; stadiumCapacity: number } {
  const baseRates: Record<string, number> = {
    mega: 0.85, large: 0.75, medium: 0.65, small: 0.55,
  };
  const capacities: Record<string, number> = {
    mega: 50000, large: 42000, medium: 35000, small: 28000,
  };
  const baseRate = baseRates[marketSize] ?? 0.65;
  const capacity = capacities[marketSize] ?? 35000;
  const winPctBonus = (winPct - 0.5) * 0.4;
  const jitter = (((homeTeamId * 31 + gameNumber * 17) % 11) - 5) / 100;
  const attendancePct = Math.max(0.35, Math.min(1.0, baseRate + winPctBonus + jitter));
  return { attendancePct: Math.round(attendancePct * 1000) / 1000, stadiumCapacity: capacity };
}

// Derived weather and daypart — D3-REV
function computeWeatherDaypart(
  gameNumber: number,
  teamId: number
): { weather: 'clear' | 'cloudy' | 'overcast'; daypart: 'day' | 'twilight' | 'night' } {
  const mod = (gameNumber + teamId) % 3;
  const weatherMap: ('clear' | 'cloudy' | 'overcast')[] = ['clear', 'cloudy', 'overcast'];
  const daypartMap: ('day' | 'twilight' | 'night')[] = ['day', 'twilight', 'night'];
  return {
    weather: weatherMap[mod] ?? 'clear',
    daypart: daypartMap[mod] ?? 'night',
  };
}

// Derived owner patience — §9
function ownerPatience(personality: string): number {
  const map: Record<string, number> = {
    meddling: 2, 'win-now': 4, moderate: 6, patient: 8, 'hands-off': 10,
  };
  return map[personality] ?? 6;
}

// Derived owner net worth tier — §9
function ownerNetWorthTier(marketSize: string, ownerAge: number): string {
  const baseTier: Record<string, string> = {
    mega: 'billionaire', large: 'wealthy', medium: 'wealthy', small: 'modest',
  };
  const tierOrder = ['modest', 'wealthy', 'billionaire', 'mega'];
  let tier = baseTier[marketSize] ?? 'wealthy';
  if (ownerAge >= 65) {
    const idx = tierOrder.indexOf(tier);
    tier = tierOrder[Math.min(idx + 1, tierOrder.length - 1)] ?? tier;
  }
  return tier;
}

watchRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) {
      res.json({
        ownedTeamId: null, phase: 'no_league', latestGame: null,
        ownedTeam: null, gmConfidence: null, fireworks: false,
      });
      return;
    }

    const fs = getFranchiseState(league.id);
    const ownedTeamId: number | null = fs?.owned_team_id ?? null;
    const gmConfidence: number | null = fs ? fs.gm_confidence : null;

    // Map phase
    const dbPhase = league.phase;
    type WatchPhase = 'draft' | 'regular_season' | 'playoffs' | 'offseason';
    const phaseMap: Record<string, WatchPhase> = {
      expansion_draft: 'draft', annual_draft: 'draft',
      regular_season: 'regular_season', playoffs: 'playoffs', offseason: 'offseason',
    };
    const phase: WatchPhase = phaseMap[dbPhase] ?? 'offseason';

    // Get latest game
    let latestGameRow: {
      id: number; home_team_id: number; away_team_id: number;
      home_score: number; away_score: number; game_number: number; game_date: number;
      home_city: string; home_name: string; away_city: string; away_name: string;
    } | undefined;

    if (ownedTeamId !== null) {
      latestGameRow = prepared(
        `SELECT gl.id, gl.home_team_id, gl.away_team_id, gl.home_score, gl.away_score,
                gl.game_number, gl.game_date,
                ht.city as home_city, ht.name as home_name,
                at2.city as away_city, at2.name as away_name
         FROM game_log gl
         JOIN teams ht ON ht.id = gl.home_team_id
         JOIN teams at2 ON at2.id = gl.away_team_id
         WHERE gl.league_id = ? AND gl.is_complete = 1
           AND (gl.home_team_id = ? OR gl.away_team_id = ?)
         ORDER BY gl.id DESC LIMIT 1`
      ).get(league.id, ownedTeamId, ownedTeamId) as typeof latestGameRow;
    } else {
      latestGameRow = prepared(
        `SELECT gl.id, gl.home_team_id, gl.away_team_id, gl.home_score, gl.away_score,
                gl.game_number, gl.game_date,
                ht.city as home_city, ht.name as home_name,
                at2.city as away_city, at2.name as away_name
         FROM game_log gl
         JOIN teams ht ON ht.id = gl.home_team_id
         JOIN teams at2 ON at2.id = gl.away_team_id
         WHERE gl.league_id = ? AND gl.is_complete = 1
         ORDER BY gl.id DESC LIMIT 1`
      ).get(league.id) as typeof latestGameRow;
    }

    const latestGame = latestGameRow ? {
      gameId: latestGameRow.id,
      homeTeamId: latestGameRow.home_team_id,
      awayTeamId: latestGameRow.away_team_id,
      homeTeamName: `${latestGameRow.home_city} ${latestGameRow.home_name}`,
      awayTeamName: `${latestGameRow.away_city} ${latestGameRow.away_name}`,
      homeScore: latestGameRow.home_score,
      awayScore: latestGameRow.away_score,
      gameNumber: latestGameRow.game_number,
      gameDate: latestGameRow.game_date,
    } : null;

    let ownedTeam = null;
    let fireworks = false;

    if (ownedTeamId !== null) {
      const teamRow = prepared(
        `SELECT t.id, t.name, t.city, t.color, t.market_size,
                t.owner_name, t.owner_personality, t.owner_age,
                t.gm_name, t.gm_archetype, t.manager_name,
                t.interim_gm, t.interim_manager, t.wins, t.losses, t.games_played
         FROM teams t WHERE t.id = ?`
      ).get(ownedTeamId) as {
        id: number; name: string; city: string; color: string; market_size: string;
        owner_name: string; owner_personality: string; owner_age: number;
        gm_name: string; gm_archetype: string; manager_name: string;
        interim_gm: number; interim_manager: number; wins: number; losses: number; games_played: number;
      } | undefined;

      if (teamRow) {
        const gamesPlayed = teamRow.wins + teamRow.losses;
        const winPct = gamesPlayed > 0
          ? Math.round((teamRow.wins / gamesPlayed) * 1000) / 1000
          : 0;

        const { streak, last10 } = computeTeamStreak(league.id, ownedTeamId, league.season_number);

        const gameNumber = latestGame?.gameNumber ?? 0;
        const homeTeamIdForDerived = latestGame?.homeTeamId ?? ownedTeamId;
        const { attendancePct, stadiumCapacity } = computeAttendance(
          teamRow.market_size, winPct, homeTeamIdForDerived, gameNumber
        );

        const seedTeamId = ownedTeamId;
        const { weather, daypart } = latestGame
          ? computeWeatherDaypart(latestGame.gameNumber, seedTeamId)
          : { weather: 'clear' as const, daypart: 'night' as const };

        // fireworks: D3a — playoffs AND owned team in top 4 of conference
        if (phase === 'playoffs') {
          const confRow = prepared(
            'SELECT conference FROM teams WHERE id = ?'
          ).get(ownedTeamId) as { conference: string } | undefined;
          if (confRow) {
            const confTeams = prepared(
              `SELECT id, wins, losses, runs_scored, runs_allowed
               FROM teams WHERE league_id = ? AND conference = ?`
            ).all(league.id, confRow.conference) as Array<{
              id: number; wins: number; losses: number; runs_scored: number; runs_allowed: number;
            }>;
            const sorted = confTeams.sort((a, b) => {
              const pctA = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
              const pctB = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
              if (pctB !== pctA) return pctB - pctA;
              const rdA = a.runs_scored - a.runs_allowed;
              const rdB = b.runs_scored - b.runs_allowed;
              if (rdB !== rdA) return rdB - rdA;
              return b.wins - a.wins;
            });
            const rank = sorted.findIndex(t => t.id === ownedTeamId);
            fireworks = rank >= 0 && rank < 4;
          }
        }

        ownedTeam = {
          id: teamRow.id,
          name: teamRow.name,
          city: teamRow.city,
          color: teamRow.color,
          market_size: teamRow.market_size,
          owner_name: teamRow.owner_name,
          owner_personality: teamRow.owner_personality,
          owner_patience: ownerPatience(teamRow.owner_personality),
          owner_net_worth_tier: ownerNetWorthTier(teamRow.market_size, teamRow.owner_age),
          gm_name: teamRow.gm_name,
          gm_archetype: teamRow.gm_archetype,
          manager_name: teamRow.manager_name,
          interim_gm: teamRow.interim_gm,
          interim_manager: teamRow.interim_manager,
          wins: teamRow.wins,
          losses: teamRow.losses,
          winPct,
          streak,
          last10,
          attendancePct,
          stadiumCapacity,
          weather,
          daypart,
        };
      }
    }

    res.json({ ownedTeamId, phase, latestGame, ownedTeam, gmConfidence, fireworks });
  } catch (err) { next(err); }
});
