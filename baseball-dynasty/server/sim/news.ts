// News Feed System — Phase 10 (v0.2.0)
// Creates news_items rows for all non-GAME events.
// LLM headlines are generated asynchronously (is_headline_pending=1 until filled).
// GAME events are inserted synchronously with no LLM (headline_text = score string).

import { getDb, prepared } from '../db.js';
import {
  breakerOpen,
  callNewsHeadlinesBatch,
  callTransactionFlavorsBatch,
  NEWS_CALL_CAP,
  getNewsCallsRemaining,
  sanitizeNarrative,
  type NewsBatchInput,
  type TxFlavorInput,
} from '../services/llm.js';

export type NewsBadge = 'ROSTER' | 'TRANSACTION' | 'FRONT OFFICE' | 'INJURY' | 'MILESTONE' | 'GAME';

export type NewsEventType =
  | 'call_up'
  | 'send_down'
  | 'dfa'
  | 'waiver_claim'
  | 'trade'
  | 'free_agent_signing'
  | 'release'
  | 'non_tender'
  | 'manager_fired'
  | 'gm_fired'
  | 'manager_resigned'
  | 'owner_sold_team'
  | 'owner_died'
  | 'injury'
  | 'milestone'
  | 'game_result';

const BADGE_MAP: Record<NewsEventType, NewsBadge> = {
  call_up: 'ROSTER',
  send_down: 'ROSTER',
  dfa: 'ROSTER',
  waiver_claim: 'TRANSACTION',
  trade: 'TRANSACTION',
  free_agent_signing: 'TRANSACTION',
  release: 'TRANSACTION',
  non_tender: 'TRANSACTION',
  manager_fired: 'FRONT OFFICE',
  gm_fired: 'FRONT OFFICE',
  manager_resigned: 'FRONT OFFICE',
  owner_sold_team: 'FRONT OFFICE',
  owner_died: 'FRONT OFFICE',
  injury: 'INJURY',
  milestone: 'MILESTONE',
  game_result: 'GAME',
};

// Insert a news item. Game results are inserted with headline_text immediately.
// All other events are pending LLM generation (is_headline_pending=1).
export function insertNewsItem(params: {
  leagueId: number;
  seasonNumber: number;
  gameNumber: number;
  eventType: NewsEventType;
  teamId?: number | null;
  secondaryTeamId?: number | null;
  playerId?: number | null;
  sourceTable?: string | null;
  sourceId?: number | null;
  headlineText?: string | null;
  detailsJson?: string | null;
}): number {
  const db = getDb();
  const badge = BADGE_MAP[params.eventType];
  const isPending = params.eventType === 'game_result' ? 0 : (params.headlineText ? 0 : 1);

  const result = db.prepare(
    `INSERT INTO news_items
       (league_id, season_number, game_number, created_at, event_type, badge,
        team_id, secondary_team_id, player_id, source_table, source_id,
        headline_text, is_headline_pending, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.leagueId,
    params.seasonNumber,
    params.gameNumber,
    Date.now(),
    params.eventType,
    badge,
    params.teamId ?? null,
    params.secondaryTeamId ?? null,
    params.playerId ?? null,
    params.sourceTable ?? null,
    params.sourceId ?? null,
    params.headlineText ?? null,
    isPending,
    params.detailsJson ?? null
  );

  return result.lastInsertRowid as number;
}

// Insert a GAME news item (score-only, no LLM, immediate headline).
export function insertGameNewsItem(params: {
  leagueId: number;
  seasonNumber: number;
  gameNumber: number;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  homeTeamName: string;
  awayTeamName: string;
}): void {
  const headline = `${params.awayTeamName} ${params.awayScore}, ${params.homeTeamName} ${params.homeScore}`;
  insertNewsItem({
    leagueId: params.leagueId,
    seasonNumber: params.seasonNumber,
    gameNumber: params.gameNumber,
    eventType: 'game_result',
    teamId: params.homeTeamId,
    secondaryTeamId: params.awayTeamId,
    headlineText: headline,
    detailsJson: JSON.stringify({
      home_team_id: params.homeTeamId,
      away_team_id: params.awayTeamId,
      home_score: params.homeScore,
      away_score: params.awayScore,
    }),
  });
}

// Insert a roster change news item (call-up, send-down, DFA).
export function insertRosterNewsItem(params: {
  leagueId: number;
  seasonNumber: number;
  gameNumber: number;
  eventType: 'call_up' | 'send_down' | 'dfa';
  teamId: number;
  playerId: number;
  sourceTable?: string;
  sourceId?: number;
}): void {
  insertNewsItem({
    leagueId: params.leagueId,
    seasonNumber: params.seasonNumber,
    gameNumber: params.gameNumber,
    eventType: params.eventType,
    teamId: params.teamId,
    playerId: params.playerId,
    sourceTable: params.sourceTable ?? 'transactions',
    sourceId: params.sourceId ?? null,
  });
}

// Insert a transaction news item (trade, waiver claim, FA signing, release, non-tender).
export function insertTransactionNewsItem(params: {
  leagueId: number;
  seasonNumber: number;
  gameNumber: number;
  eventType: 'waiver_claim' | 'trade' | 'free_agent_signing' | 'release' | 'non_tender';
  teamId?: number | null;
  secondaryTeamId?: number | null;
  playerId?: number | null;
  sourceTable?: string;
  sourceId?: number;
}): void {
  insertNewsItem({
    leagueId: params.leagueId,
    seasonNumber: params.seasonNumber,
    gameNumber: params.gameNumber,
    eventType: params.eventType,
    teamId: params.teamId ?? null,
    secondaryTeamId: params.secondaryTeamId ?? null,
    playerId: params.playerId ?? null,
    sourceTable: params.sourceTable ?? 'transactions',
    sourceId: params.sourceId ?? null,
  });
}

// Insert a front office news item (firing, owner events).
export function insertFrontOfficeNewsItem(params: {
  leagueId: number;
  seasonNumber: number;
  gameNumber: number;
  eventType: 'manager_fired' | 'gm_fired' | 'manager_resigned' | 'owner_sold_team' | 'owner_died';
  teamId: number;
  sourceTable?: string;
  sourceId?: number;
  headlineText?: string | null;
  detailsJson?: string | null;
}): void {
  insertNewsItem({
    leagueId: params.leagueId,
    seasonNumber: params.seasonNumber,
    gameNumber: params.gameNumber,
    eventType: params.eventType,
    teamId: params.teamId,
    sourceTable: params.sourceTable ?? 'front_office_events',
    sourceId: params.sourceId ?? null,
    headlineText: params.headlineText ?? null,
    detailsJson: params.detailsJson ?? null,
  });
}

// Insert a milestone news item.
export function insertMilestoneNewsItem(params: {
  leagueId: number;
  seasonNumber: number;
  gameNumber: number;
  teamId: number;
  playerId: number;
  headlineText?: string;
  detailsJson?: string;
  sourceTable?: string;
  sourceId?: number;
}): void {
  insertNewsItem({
    leagueId: params.leagueId,
    seasonNumber: params.seasonNumber,
    gameNumber: params.gameNumber,
    eventType: 'milestone',
    teamId: params.teamId,
    playerId: params.playerId,
    headlineText: params.headlineText ?? null,
    detailsJson: params.detailsJson ?? null,
    sourceTable: params.sourceTable ?? null,
    sourceId: params.sourceId ?? null,
  });
}

// Get recent news items for the ticker (last N items).
export function getRecentNewsItems(leagueId: number, limit = 5): Array<{
  id: number;
  event_type: string;
  badge: string;
  headline_text: string | null;
  game_number: number;
  created_at: number;
}> {
  return prepared(
    `SELECT id, event_type, badge, headline_text, game_number, created_at
     FROM news_items
     WHERE league_id = ?
     ORDER BY id DESC
     LIMIT ?`
  ).all(leagueId, limit) as any[];
}

// Valid filter types for /api/news
export const VALID_NEWS_FILTERS = [
  'all',
  'roster',
  'transactions',
  'frontoffice',
  'injuries',
  'milestones',
] as const;

export type NewsFilter = typeof VALID_NEWS_FILTERS[number];

const FILTER_BADGE_MAP: Record<Exclude<NewsFilter, 'all'>, NewsBadge[]> = {
  roster: ['ROSTER'],
  transactions: ['TRANSACTION'],
  frontoffice: ['FRONT OFFICE'],
  injuries: ['INJURY'],
  milestones: ['MILESTONE'],
};

// Build a procedural fallback headline for a news item when LLM is unavailable.
function proceduralHeadline(eventType: string, badge: string): string {
  switch (eventType) {
    case 'call_up': return 'Player called up to the MLB roster.';
    case 'send_down': return 'Player optioned to the minor leagues.';
    case 'dfa': return 'Player designated for assignment.';
    case 'waiver_claim': return 'Player claimed off waivers.';
    case 'trade': return 'Trade completed between two teams.';
    case 'free_agent_signing': return 'Free agent signs with new team.';
    case 'release': return 'Player released.';
    case 'non_tender': return 'Player non-tendered.';
    case 'manager_fired': return 'Manager fired; interim takes over.';
    case 'gm_fired': return 'GM fired; interim installed.';
    case 'manager_resigned': return 'Manager resigns.';
    case 'owner_sold_team': return 'Franchise ownership changes hands.';
    case 'owner_died': return 'Owner passes away; heir takes control.';
    case 'injury': return 'Player placed on injured list.';
    case 'milestone': return 'Player reaches a career milestone.';
    default: return `${badge} event occurred.`;
  }
}

// §1.1(g): Fill pending headlines via LLM batch (up to 10 at a time).
// Called once per game tick and at phase transitions.
export async function fillPendingHeadlines(leagueId: number): Promise<void> {
  const pending = prepared(
    `SELECT id, event_type, badge, team_id, secondary_team_id, player_id, game_number, details_json
     FROM news_items WHERE league_id = ? AND is_headline_pending = 1 ORDER BY id LIMIT 10`
  ).all(leagueId) as Array<{
    id: number;
    event_type: string;
    badge: string;
    team_id: number | null;
    secondary_team_id: number | null;
    player_id: number | null;
    game_number: number;
    details_json: string | null;
  }>;

  if (pending.length === 0) return;

  // Prefetch team and player names for structured prompt building (CB-02: use structured columns only)
  const teamIds = [...new Set(
    pending.flatMap(r => [r.team_id, r.secondary_team_id]).filter((id): id is number => id !== null)
  )];
  const playerIds = [...new Set(pending.map(r => r.player_id).filter((id): id is number => id !== null))];

  const teamNameMap = new Map<number, string>();
  if (teamIds.length > 0) {
    const rows = prepared(
      `SELECT id, city, name FROM teams WHERE id IN (${teamIds.map(() => '?').join(',')})`
    ).all(...teamIds) as Array<{ id: number; city: string; name: string }>;
    for (const r of rows) teamNameMap.set(r.id, `${r.city} ${r.name}`);
  }

  const playerNameMap = new Map<number, string>();
  if (playerIds.length > 0) {
    const rows = prepared(
      `SELECT id, first_name, last_name FROM players WHERE id IN (${playerIds.map(() => '?').join(',')})`
    ).all(...playerIds) as Array<{ id: number; first_name: string; last_name: string }>;
    for (const r of rows) playerNameMap.set(r.id, `${r.first_name} ${r.last_name}`);
  }

  // Determine if we should use LLM or go straight to procedural fallback
  const useLlm = !breakerOpen() && getNewsCallsRemaining() > 0;

  if (useLlm) {
    const events: NewsBatchInput[] = pending.map(r => ({
      eventId: r.id,
      eventType: r.event_type,
      badge: r.badge,
      teamName: r.team_id ? (teamNameMap.get(r.team_id) ?? null) : null,
      secondaryTeamName: r.secondary_team_id ? (teamNameMap.get(r.secondary_team_id) ?? null) : null,
      playerName: r.player_id ? (playerNameMap.get(r.player_id) ?? null) : null,
      gameNumber: r.game_number,
      extra: null,
    }));

    const result = await callNewsHeadlinesBatch(events);
    const db = getDb();
    const updateStmt = db.prepare(
      'UPDATE news_items SET headline_text = ?, is_headline_pending = 0 WHERE id = ?'
    );

    for (const row of pending) {
      let headline: string;
      if (result.ok && result.headlines.has(row.id)) {
        headline = result.headlines.get(row.id)!;
      } else {
        headline = sanitizeNarrative(proceduralHeadline(row.event_type, row.badge));
      }
      updateStmt.run(headline, row.id);
    }
  } else {
    // Breaker open or cap hit — write procedural fallbacks immediately
    const db = getDb();
    const updateStmt = db.prepare(
      'UPDATE news_items SET headline_text = ?, is_headline_pending = 0 WHERE id = ?'
    );
    for (const row of pending) {
      updateStmt.run(sanitizeNarrative(proceduralHeadline(row.event_type, row.badge)), row.id);
    }
  }
}

// §1.1(h): Fill pending transaction narratives via LLM batch (up to 10 at a time).
// Types that get flavor: trade, free_agent_signing, release, waiver_claim, non_tender.
export async function fillPendingTransactionFlavors(leagueId: number): Promise<void> {
  const pending = prepared(
    `SELECT t.id, t.transaction_type, t.team_id, t.player_id
     FROM transactions t
     WHERE t.league_id = ? AND t.narrative IS NULL
       AND t.transaction_type IN ('trade','free_agent_signing','release','waiver_claim','non_tender')
     ORDER BY t.id LIMIT 10`
  ).all(leagueId) as Array<{
    id: number;
    transaction_type: string;
    team_id: number | null;
    player_id: number | null;
  }>;

  if (pending.length === 0) return;

  // Prefetch names
  const teamIds = [...new Set(pending.map(r => r.team_id).filter((id): id is number => id !== null))];
  const playerIds = [...new Set(pending.map(r => r.player_id).filter((id): id is number => id !== null))];

  const teamNameMap = new Map<number, string>();
  if (teamIds.length > 0) {
    const rows = prepared(
      `SELECT id, city, name FROM teams WHERE id IN (${teamIds.map(() => '?').join(',')})`
    ).all(...teamIds) as Array<{ id: number; city: string; name: string }>;
    for (const r of rows) teamNameMap.set(r.id, `${r.city} ${r.name}`);
  }

  const playerNameMap = new Map<number, string>();
  if (playerIds.length > 0) {
    const rows = prepared(
      `SELECT id, first_name, last_name FROM players WHERE id IN (${playerIds.map(() => '?').join(',')})`
    ).all(...playerIds) as Array<{ id: number; first_name: string; last_name: string }>;
    for (const r of rows) playerNameMap.set(r.id, `${r.first_name} ${r.last_name}`);
  }

  const useLlm = !breakerOpen();

  if (useLlm) {
    const txns: TxFlavorInput[] = pending.map(r => ({
      txId: r.id,
      transactionType: r.transaction_type,
      teamName: r.team_id ? (teamNameMap.get(r.team_id) ?? null) : null,
      playerName: r.player_id ? (playerNameMap.get(r.player_id) ?? null) : null,
      extra: null,
    }));

    const result = await callTransactionFlavorsBatch(txns);
    const db = getDb();
    const updateStmt = db.prepare('UPDATE transactions SET narrative = ? WHERE id = ?');

    for (const row of pending) {
      let flavor: string;
      if (result.ok && result.flavors.has(row.id)) {
        flavor = result.flavors.get(row.id)!;
      } else {
        flavor = sanitizeNarrative(proceduralTransactionNarrative(row.transaction_type, row.team_id, teamNameMap));
      }
      updateStmt.run(flavor, row.id);
    }
  } else {
    const db = getDb();
    const updateStmt = db.prepare('UPDATE transactions SET narrative = ? WHERE id = ?');
    for (const row of pending) {
      updateStmt.run(
        sanitizeNarrative(proceduralTransactionNarrative(row.transaction_type, row.team_id, teamNameMap)),
        row.id
      );
    }
  }
}

function proceduralTransactionNarrative(
  txType: string,
  teamId: number | null,
  teamNameMap: Map<number, string>
): string {
  const team = teamId ? (teamNameMap.get(teamId) ?? 'A team') : 'A team';
  switch (txType) {
    case 'trade': return `${team} completes a trade.`;
    case 'free_agent_signing': return `${team} signs a free agent.`;
    case 'release': return `Player released.`;
    case 'waiver_claim': return `${team} claims a player off waivers.`;
    case 'non_tender': return `${team} non-tenders a player.`;
    default: return `Transaction completed.`;
  }
}

// Get news feed with optional filter and limit.
// NF-1: tragedy items with pinned_until_game >= currentGame sort to top.
export function getNewsFeed(params: {
  leagueId: number;
  filter?: NewsFilter;
  teamId?: number;
  limit?: number;
}): Array<{
  id: number;
  season_number: number;
  game_number: number;
  event_type: string;
  badge: string;
  team_id: number | null;
  secondary_team_id: number | null;
  player_id: number | null;
  headline_text: string | null;
  is_headline_pending: number;
  details_json: string | null;
  created_at: number;
}> {
  const { leagueId, filter = 'all', teamId, limit = 50 } = params;

  // Get the league's current game number for pinning comparison
  const leagueRow = prepared(
    'SELECT current_game_number FROM leagues WHERE id = ?'
  ).get(leagueId) as { current_game_number: number } | undefined;
  const currentGame = leagueRow?.current_game_number ?? 0;

  let sql = `SELECT id, season_number, game_number, event_type, badge, team_id, secondary_team_id,
               player_id, headline_text, is_headline_pending, details_json, created_at
             FROM news_items
             WHERE league_id = ?`;

  const args: Array<string | number> = [leagueId];

  if (filter !== 'all') {
    const badges = FILTER_BADGE_MAP[filter];
    sql += ` AND badge IN (${badges.map(() => '?').join(',')})`;
    args.push(...badges);
  }

  if (teamId !== undefined) {
    sql += ` AND (team_id = ? OR secondary_team_id = ?)`;
    args.push(teamId, teamId);
  }

  // Pinned tragedy items (pinned_until_game >= currentGame) sort before all others
  sql += ` ORDER BY CASE WHEN pinned_until_game IS NOT NULL AND pinned_until_game >= ? THEN 0 ELSE 1 END ASC, id DESC LIMIT ?`;
  args.push(currentGame, limit);

  return prepared(sql).all(...args) as any[];
}
