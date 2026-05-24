// News Feed System — Phase 10 (v0.2.0)
// Creates news_items rows for all non-GAME events.
// LLM headlines are generated asynchronously (is_headline_pending=1 until filled).
// GAME events are inserted synchronously with no LLM (headline_text = score string).

import { getDb, prepared } from '../db.js';

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
}): void {
  insertNewsItem({
    leagueId: params.leagueId,
    seasonNumber: params.seasonNumber,
    gameNumber: params.gameNumber,
    eventType: params.eventType,
    teamId: params.teamId,
    sourceTable: params.sourceTable ?? 'front_office_events',
    sourceId: params.sourceId ?? null,
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

// Get news feed with optional filter and limit.
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

  sql += ` ORDER BY id DESC LIMIT ?`;
  args.push(limit);

  return prepared(sql).all(...args) as any[];
}
