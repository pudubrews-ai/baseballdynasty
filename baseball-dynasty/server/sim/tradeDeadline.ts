// Trade Deadline System — Phase 8 (v0.2.0)
// Per §6, [AB-01], [AB-12 RULING].
// Trade posture set at per-team games_played >= 30.
// Trade execution window: [30, 37] per-team games_played.
// Interim GM teams skip trades.
// Per-team cap: 2 trades/season. League cap: 12 trades/season.
// Forced minimum: 3 trades after deadline marker fires.

import { getDb, prepared, type TeamRow, type PlayerRow } from '../db.js';
import { getArchetype } from './archetypes.js';
import { insertTransactionNewsItem } from './news.js';

const TRADE_WINDOW_START = 30;
const TRADE_WINDOW_END = 37;
const PER_TEAM_CAP = 2;
const LEAGUE_CAP = 12;

// Compute games back from division/league leader
function computeGamesBack(team: TeamRow, allTeams: TeamRow[]): number {
  const maxWins = Math.max(...allTeams.map(t => t.wins));
  return maxWins - team.wins;
}

// Set trade posture for a team (called when team reaches games_played >= 30)
export function setTradePosture(team: TeamRow, allTeams: TeamRow[]): void {
  const gamesBack = computeGamesBack(team, allTeams);
  let posture: 'BUYER' | 'SELLER' | 'NEUTRAL';

  if (gamesBack <= 5) posture = 'BUYER';
  else if (gamesBack >= 10) posture = 'SELLER';
  else posture = 'NEUTRAL';

  prepared('UPDATE teams SET trade_posture = ? WHERE id = ?').run(posture, team.id);
}

// Count trades executed this season league-wide (raw row count, used for LEAGUE_CAP check)
function countLeagueTrades(leagueId: number, seasonNumber: number): number {
  return (prepared(
    "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND season_number = ? AND transaction_type = 'trade'"
  ).get(leagueId, seasonNumber) as { cnt: number }).cnt;
}

// Count DISTINCT trades this season (one trade = one executeTrade call = one buyer-side row).
// Uses buyer team perspective: each distinct trade inserts exactly one row with the veteran's player_id.
// We count buyer-side rows (team that received the veteran) as proxies for distinct trade executions.
// This avoids counting the 1-3 prospect rows of the same trade as separate trades.
function countDistinctLeagueTrades(leagueId: number, seasonNumber: number): number {
  // Each executeTrade logs one buyer-side row (buyer.id, veteran.id) and N prospect rows (seller, prospect).
  // The buyer row is the "trade event" row — it's guaranteed unique per trade since we insert one per executeTrade.
  // We can't perfectly distinguish buyer vs seller rows without an extra column, so we use the simpler heuristic:
  // count transactions where the player_id is from an MLB-roster player (the veteran being traded).
  // For simplicity and correctness: count total 'trade' rows and divide by the typical ratio is fragile.
  // Cleanest approach: count by NEWS_ITEMS with eventType='trade' (one per executeTrade — see insertTransactionNewsItem call).
  return (prepared(
    "SELECT COUNT(*) as cnt FROM news_items WHERE league_id = ? AND season_number = ? AND event_type = 'trade'"
  ).get(leagueId, seasonNumber) as { cnt: number }).cnt;
}

// Count trades executed this season for a specific team
function countTeamTrades(teamId: number, leagueId: number, seasonNumber: number): number {
  return (prepared(
    "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND season_number = ? AND transaction_type = 'trade' AND team_id = ?"
  ).get(leagueId, seasonNumber, teamId) as { cnt: number }).cnt;
}

// Find trade package: buyer gets veteran (age >= 28, contract_years <= 2),
// seller gets 1-2 prospects (AAA/AA).
export function findTradePackage(
  buyer: TeamRow,
  seller: TeamRow,
  leagueId: number
): { veteran: PlayerRow; prospects: PlayerRow[] } | null {
  // Find veteran on seller's 25-man
  const veteran = prepared(
    `SELECT * FROM players
     WHERE team_id = ? AND is_on_25man = 1 AND age >= 28 AND contract_years_remaining <= 2
       AND position NOT IN ('DH')
     ORDER BY overall_rating DESC
     LIMIT 1`
  ).get(seller.id) as PlayerRow | undefined;

  if (!veteran) return null;

  // Check positional need for buyer
  const buyerNeed = (prepared(
    'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1 AND position = ?'
  ).get(buyer.id, veteran.position) as { cnt: number }).cnt;

  if (buyerNeed >= 3) return null; // Buyer already deep at this position

  // Find prospects from buyer's system (AAA/AA)
  const buyerArchetype = getArchetype(buyer.gm_archetype ?? 'balanced');
  const sellerArchetype = getArchetype(seller.gm_archetype ?? 'balanced');

  // §2.6: How many prospects seller demands — read from ARCHETYPES table (draft_potential_weight)
  // analytics has draft_potential_weight=1.5 (>= 1.3 threshold) → demands 2 prospects
  const prospectsRequired = sellerArchetype.draft_potential_weight >= 1.3 ? 2 : 1;

  // §2.6: old-school seller demands proven (older) players: sort buyer prospects by age DESC
  const prospectOrder = buyerArchetype.veteran_loyalty > 1.0
    ? 'age DESC, overall_rating DESC'   // old-school buyer: proven prospects back
    : 'overall_rating DESC';            // default: best upside

  const prospects = prepared(
    `SELECT * FROM players
     WHERE team_id = ? AND minor_level IN ('AAA','AA') AND waiver_state = 'none'
       AND age <= 26
     ORDER BY ${prospectOrder}
     LIMIT ?`
  ).all(buyer.id, prospectsRequired) as PlayerRow[];

  if (prospects.length < 1) return null; // Need at least 1 prospect

  // Buyer (analytics) demands fair return: veteran must be worth the prospects
  if (buyerArchetype.draft_potential_weight >= 1.3 && veteran.overall_rating < 65) return null;

  return { veteran, prospects };
}

// Execute a single trade between buyer and seller
function executeTrade(
  buyer: TeamRow,
  seller: TeamRow,
  veteran: PlayerRow,
  prospects: PlayerRow[],
  leagueId: number,
  seasonNumber: number,
  db: ReturnType<typeof import('../db.js').getDb>,
  currentGameNumber: number = 0
): void {
  // Transfer veteran from seller to buyer
  db.prepare(
    'UPDATE players SET team_id = ? WHERE id = ?'
  ).run(buyer.id, veteran.id);

  // Transfer prospects from buyer to seller
  for (const prospect of prospects) {
    db.prepare('UPDATE players SET team_id = ? WHERE id = ?').run(seller.id, prospect.id);
  }

  const narrative = `${buyer.city} ${buyer.name} acquire ${veteran.position} from ${seller.city} ${seller.name}`;

  // Log trade for buyer team
  const buyerTxResult = db.prepare(
    `INSERT INTO transactions
       (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
     VALUES (?, ?, 'trade', ?, ?, ?, ?)`
  ).run(leagueId, seasonNumber, buyer.id, veteran.id, narrative, Date.now());

  // §1.1(d): Insert one trade news item (for buyer — one per trade)
  insertTransactionNewsItem({
    leagueId,
    seasonNumber,
    gameNumber: currentGameNumber,
    eventType: 'trade',
    teamId: buyer.id,
    secondaryTeamId: seller.id,
    playerId: veteran.id,
    sourceTable: 'transactions',
    sourceId: buyerTxResult.lastInsertRowid as number,
  });

  // Log trade for seller team (with prospect info)
  for (const prospect of prospects) {
    db.prepare(
      `INSERT INTO transactions
         (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
       VALUES (?, ?, 'trade', ?, ?, ?, ?)`
    ).run(leagueId, seasonNumber, seller.id, prospect.id, narrative, Date.now());
  }

  // Increment deadline_trades_this_season for both teams
  db.prepare('UPDATE teams SET deadline_trades_this_season = deadline_trades_this_season + 1 WHERE id = ?').run(buyer.id);
  db.prepare('UPDATE teams SET deadline_trades_this_season = deadline_trades_this_season + 1 WHERE id = ?').run(seller.id);

  console.log(`[tradeDeadline] Trade: ${buyer.city} ${buyer.name} acquire ${veteran.first_name} ${veteran.last_name} from ${seller.city} ${seller.name}`);
}

// Main trade deadline evaluation — called per team when in window [30, 37].
export function evaluateTradeDeadline(
  team: TeamRow,
  allTeams: TeamRow[],
  leagueId: number,
  seasonNumber: number
): void {
  const db = getDb();

  // Interim GM teams skip trades entirely (AB-12)
  if (team.interim_gm === 1) return;

  // Set posture if not set yet (first time reaching game 30)
  if (!team.trade_posture && team.games_played >= TRADE_WINDOW_START) {
    setTradePosture(team, allTeams);
    // Re-read
    const updated = prepared('SELECT * FROM teams WHERE id = ?').get(team.id) as TeamRow;
    team = { ...team, trade_posture: updated.trade_posture };
  }

  // Only execute trades within the window
  if (team.games_played < TRADE_WINDOW_START || team.games_played > TRADE_WINDOW_END) return;

  // Check caps
  const leagueTrades = countLeagueTrades(leagueId, seasonNumber);
  if (leagueTrades >= LEAGUE_CAP) return;

  const teamTrades = countTeamTrades(team.id, leagueId, seasonNumber);
  if (teamTrades >= PER_TEAM_CAP) return;

  // Apply analytics' early trade offset (trades earlier in the window)
  const archetype = getArchetype(team.gm_archetype ?? 'balanced');
  const effectiveWindowStart = TRADE_WINDOW_START - archetype.veteran_trade_offset_games_before_deadline;

  if (team.games_played < effectiveWindowStart) return;

  if (team.trade_posture === 'BUYER') {
    // Find seller teams
    const sellers = allTeams.filter(t =>
      t.id !== team.id &&
      t.trade_posture === 'SELLER' &&
      t.interim_gm === 0
    );

    const leagueRow = prepared('SELECT current_game_number FROM leagues WHERE id = ?').get(leagueId) as { current_game_number: number } | undefined;
    const currentGameNumber = leagueRow?.current_game_number ?? 0;

    for (const seller of sellers) {
      const sellerTeamTrades = countTeamTrades(seller.id, leagueId, seasonNumber);
      if (sellerTeamTrades >= PER_TEAM_CAP) continue;

      const pkg = findTradePackage(team, seller, leagueId);
      if (!pkg) continue;

      const tradeTx = db.transaction(() => {
        executeTrade(team, seller, pkg.veteran, pkg.prospects, leagueId, seasonNumber, db, currentGameNumber);
      });
      tradeTx();
      break; // One trade attempt per evaluation pass
    }
  }
}

// Forced minimum 3 trades after the deadline marker fires (AB-12 RULING).
// Called when shouldFireTradeDeadline returns true and < 3 distinct trades exist.
// §1.2(b): Guarantees ≥3 distinct trades regardless of seed.
export function forceMinimumTrades(
  allTeams: TeamRow[],
  leagueId: number,
  seasonNumber: number
): void {
  const db = getDb();

  // Use distinct-trade count (one per executeTrade call) not raw row count
  const currentDistinctTrades = countDistinctLeagueTrades(leagueId, seasonNumber);
  if (currentDistinctTrades >= 3) return;

  const needed = 3 - currentDistinctTrades;
  let forced = 0;

  // Worst-record non-interim teams as sellers, best-record as buyers
  const eligible = allTeams.filter(t => t.interim_gm === 0);
  const sellers = [...eligible].sort((a, b) => a.wins - b.wins); // worst record first
  const buyers = [...eligible].sort((a, b) => b.wins - a.wins);  // best record first

  // Helper: find a movable prospect from buyer — progressively wider search
  function findBuyerProspect(buyerId: number): PlayerRow[] {
    // Tier 1: AAA/AA prospects (preferred)
    const tier1 = prepared(
      `SELECT * FROM players WHERE team_id = ? AND minor_level IN ('AAA','AA') AND waiver_state = 'none'
       ORDER BY overall_rating DESC LIMIT 1`
    ).all(buyerId) as PlayerRow[];
    if (tier1.length > 0) return tier1;

    // Tier 2: A/Rookie players
    const tier2 = prepared(
      `SELECT * FROM players WHERE team_id = ? AND minor_level IN ('A','Rookie') AND waiver_state = 'none'
       ORDER BY overall_rating DESC LIMIT 1`
    ).all(buyerId) as PlayerRow[];
    if (tier2.length > 0) return tier2;

    // Tier 3: 40-man reserves not on 25-man (bench depth)
    const tier3 = prepared(
      `SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND is_on_25man = 0 AND waiver_state = 'none'
       ORDER BY overall_rating ASC LIMIT 1`
    ).all(buyerId) as PlayerRow[];
    if (tier3.length > 0) return tier3;

    // Tier 4: lowest-rated 25-man bench player (last resort)
    const tier4 = prepared(
      `SELECT * FROM players WHERE team_id = ? AND is_on_25man = 1 AND waiver_state = 'none'
       AND position NOT IN ('SP', 'CL', 'SS', 'C', 'CF')
       ORDER BY overall_rating ASC LIMIT 1`
    ).all(buyerId) as PlayerRow[];
    return tier4;
  }

  for (let i = 0; i < sellers.length && forced < needed; i++) {
    const seller = sellers[i]!;

    const sellerTeamTrades = countTeamTrades(seller.id, leagueId, seasonNumber);
    if (sellerTeamTrades >= PER_TEAM_CAP) continue;

    const leagueTrades = countLeagueTrades(leagueId, seasonNumber);
    if (leagueTrades >= LEAGUE_CAP) break;

    // Find best veteran on seller
    const veteran = prepared(
      `SELECT * FROM players
       WHERE team_id = ? AND is_on_25man = 1 AND age >= 26
         AND contract_years_remaining <= 3
       ORDER BY overall_rating DESC
       LIMIT 1`
    ).get(seller.id) as PlayerRow | undefined;

    if (!veteran) continue;

    // Try each buyer (in order) until one has a movable asset
    let tradeMade = false;
    for (const buyer of buyers) {
      if (buyer.id === seller.id) continue;
      if (countTeamTrades(buyer.id, leagueId, seasonNumber) >= PER_TEAM_CAP) continue;

      const prospects = findBuyerProspect(buyer.id);
      if (prospects.length === 0) continue; // truly nothing to trade — skip this buyer

      const leagueRow = prepared('SELECT current_game_number FROM leagues WHERE id = ?').get(leagueId) as { current_game_number: number } | undefined;
      const currentGameNumber = leagueRow?.current_game_number ?? 0;

      const tradeTx = db.transaction(() => {
        executeTrade(buyer, seller, veteran, prospects, leagueId, seasonNumber, db, currentGameNumber);
      });

      try {
        tradeTx();
        forced++;
        tradeMade = true;
        console.log(`[tradeDeadline] Forced trade ${forced} of ${needed}`);
        break; // One trade per seller iteration
      } catch (err) {
        console.warn('[tradeDeadline] Forced trade failed:', err);
      }
    }

    if (!tradeMade) {
      // No buyer could trade with this seller — move to next seller
      continue;
    }
  }

  if (forced < needed) {
    console.warn(`[tradeDeadline] Only forced ${forced}/${needed} minimum trades`);
  }
}
