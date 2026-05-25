// Franchise selection and GM confidence helpers — v0.3.0
// CB-1: all mutating operations are server-authoritative.
// CB-2: single setGmConfidence writer, clamp [0,100].

import { getDb, prepared } from '../db.js';

export interface FranchiseStateRow {
  league_id: number;
  owned_team_id: number | null;
  selection_resolved: number;
  selected_at: number | null;
  gm_confidence: number;
  firings_locked_season: number | null;
  go_for_it_season: number | null;
  rebuild_season: number | null;
  fire_manager_season: number | null;
  trust_process_season: number | null;
  last_confidence_checkpoint_game: number;
  last_status_update_game: number;
  gm_resign_pending_season: number | null;
}

export function getFranchiseState(leagueId: number): FranchiseStateRow | undefined {
  return prepared(
    'SELECT * FROM franchise_state WHERE league_id = ?'
  ).get(leagueId) as FranchiseStateRow | undefined;
}

export function getOwnedTeamId(leagueId: number): number | null {
  const row = getFranchiseState(leagueId);
  return row?.owned_team_id ?? null;
}

export function isSelectionResolved(leagueId: number): boolean {
  const row = getFranchiseState(leagueId);
  return row?.selection_resolved === 1;
}

// selectFranchise: insert/update with owned_team_id set.
// Idempotency: callers must check selection_resolved=1 first and return 409 before calling this.
export function selectFranchise(leagueId: number, teamId: number): void {
  const db = getDb();
  const existing = getFranchiseState(leagueId);
  if (existing) {
    db.prepare(
      `UPDATE franchise_state
       SET owned_team_id = ?, selection_resolved = 1, selected_at = ?, gm_confidence = 100
       WHERE league_id = ?`
    ).run(teamId, Date.now(), leagueId);
  } else {
    db.prepare(
      `INSERT INTO franchise_state
         (league_id, owned_team_id, selection_resolved, selected_at, gm_confidence,
          last_confidence_checkpoint_game, last_status_update_game)
       VALUES (?, ?, 1, ?, 100, 0, 0)`
    ).run(leagueId, teamId, Date.now());
  }
}

// skipFranchise: upsert with owned_team_id = NULL, selection_resolved = 1.
export function skipFranchise(leagueId: number): void {
  const db = getDb();
  const existing = getFranchiseState(leagueId);
  if (existing) {
    db.prepare(
      `UPDATE franchise_state
       SET owned_team_id = NULL, selection_resolved = 1, selected_at = ?
       WHERE league_id = ?`
    ).run(Date.now(), leagueId);
  } else {
    db.prepare(
      `INSERT INTO franchise_state
         (league_id, owned_team_id, selection_resolved, selected_at, gm_confidence,
          last_confidence_checkpoint_game, last_status_update_game)
       VALUES (?, NULL, 1, ?, 100, 0, 0)`
    ).run(leagueId, Date.now());
  }
}

// Single GM confidence writer (CB-2 / D22).
// delta is integer, result clamped [0,100].
export function setGmConfidence(leagueId: number, delta: number): number {
  const fs = getFranchiseState(leagueId);
  if (!fs || fs.owned_team_id == null) return 0;
  const next = Math.max(0, Math.min(100, fs.gm_confidence + Math.trunc(delta)));
  prepared('UPDATE franchise_state SET gm_confidence = ? WHERE league_id = ?').run(next, leagueId);
  return next;
}

// Reset GM confidence to 100 (on GM change).
export function resetGmConfidence(leagueId: number): void {
  prepared('UPDATE franchise_state SET gm_confidence = 100 WHERE league_id = ?').run(leagueId);
}
