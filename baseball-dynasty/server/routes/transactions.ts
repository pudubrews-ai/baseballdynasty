import { prepared, getActiveLeague } from '../db.js';

export async function getRecentTransactions(): Promise<object[]> {
  const league = getActiveLeague();
  if (!league) return [];

  const transactions = prepared(
    `SELECT t.*, p.first_name || ' ' || p.last_name as player_name, tm.city || ' ' || tm.name as team_name
     FROM transactions t
     LEFT JOIN players p ON p.id = t.player_id
     LEFT JOIN teams tm ON tm.id = t.team_id
     WHERE t.league_id = ?
     ORDER BY t.created_at DESC LIMIT 50`
  ).all(league.id) as Array<{
    id: number;
    season_number: number;
    transaction_type: string;
    player_name: string | null;
    team_name: string | null;
    narrative: string | null;
    created_at: number;
  }>;

  return transactions.map(t => ({
    id: t.id,
    seasonNumber: t.season_number,
    transactionType: t.transaction_type,
    playerName: t.player_name,
    teamName: t.team_name,
    narrative: t.narrative,
    createdAt: t.created_at,
  }));
}
