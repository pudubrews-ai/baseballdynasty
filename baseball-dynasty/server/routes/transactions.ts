import { prepared, getActiveLeague } from '../db.js';

export async function getRecentTransactions(): Promise<object[]> {
  const league = getActiveLeague();
  if (!league) return [];

  const transactions = prepared(
    `SELECT t.id, t.season_number, t.transaction_type, t.team_id, t.player_id,
            t.narrative, t.game_number, t.created_at,
            p.first_name || ' ' || p.last_name AS player_name,
            tm.city || ' ' || tm.name AS team_name,
            foe.reason AS fo_reason
     FROM transactions t
     LEFT JOIN players p ON p.id = t.player_id
     LEFT JOIN teams tm ON tm.id = t.team_id
     LEFT JOIN front_office_events foe
       ON foe.team_id = t.team_id
      AND foe.season_number = t.season_number
      AND foe.event_type = t.transaction_type
     WHERE t.league_id = ?
     ORDER BY t.created_at DESC
     LIMIT 50`
  ).all(league.id) as Array<{
    id: number;
    season_number: number;
    transaction_type: string;
    team_id: number | null;
    player_id: number | null;
    player_name: string | null;
    team_name: string | null;
    narrative: string | null;
    game_number: number;
    created_at: number;
    fo_reason: string | null;
  }>;

  return transactions.map(t => ({
    id: t.id,
    seasonNumber: t.season_number,
    transactionType: t.transaction_type,
    teamId: t.team_id,
    teamName: t.team_name,
    playerId: t.player_id,
    playerName: t.player_name,
    narrative: t.narrative,
    gameNumber: t.game_number,
    createdAt: t.created_at,
    reason: t.fo_reason ?? null,
  }));
}
