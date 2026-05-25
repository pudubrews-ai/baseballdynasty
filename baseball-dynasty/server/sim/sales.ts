// Team Sales + Relocation — Step 14
// Extends runFrontOfficeStep's existing sale/death rolls with:
// - Sale type classification (distressed, succession, investment, hostile)
// - Relocation threat detection
// - Relocation resolution at season end
//
// Ordering vs owner death (B-5): sale type classification runs BEFORE relocation check.
// Relocation fires at season end ONLY (H-1: do NOT write new city/name mid-season).

import { prepared, getDb, type TeamRow } from '../db.js';
import { seedFor, randInt } from './prng.js';
import { CITIES } from '../data/cities.js';
import { NICKNAMES } from '../data/nicknames.js';

// ─────────────────────────────────────────────────────────────────────────────
// Sale type classification
// ─────────────────────────────────────────────────────────────────────────────

export type SaleType = 'distressed' | 'succession' | 'investment' | 'hostile';

interface SaleClassificationResult {
  saleType: SaleType;
  modifier: number;
  salePrice: number;
}

export function classifySale(
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  isOwnerDeath: boolean,
  worldgenSeed: number
): SaleClassificationResult {
  const franchiseValue = team.franchise_value ?? 100;

  let saleType: SaleType = 'hostile';
  let modifier = 1.5;

  if (isOwnerDeath) {
    // Succession: owner death + heir
    saleType = 'succession';
    modifier = 1.0;
  } else {
    // Check distressed: revenue < budget × 0.7 for 2 consecutive seasons
    const recentHistory = prepared(
      `SELECT revenue, payroll_budget FROM franchise_season_history
       WHERE league_id = ? AND team_id = ?
       ORDER BY season_number DESC LIMIT 2`
    ).all(leagueId, team.id) as Array<{ revenue: number; payroll_budget: number }>;

    const bothDistressed = recentHistory.length >= 2 &&
      recentHistory.every(h => h.revenue < h.payroll_budget * 0.7);

    if (bothDistressed) {
      saleType = 'distressed';
      modifier = 0.7;
    } else {
      // Check investment: recent championship
      const champRecent = prepared(
        `SELECT COUNT(*) as cnt FROM franchise_season_history
         WHERE league_id = ? AND team_id = ? AND won_championship = 1
           AND season_number >= ? - 1`
      ).get(leagueId, team.id, seasonNumber) as { cnt: number } | undefined;

      if ((champRecent?.cnt ?? 0) > 0) {
        saleType = 'investment';
        modifier = 1.3;
      } else {
        // Default: hostile outside investor
        saleType = 'hostile';
        modifier = 1.5;
      }
    }
  }

  const salePrice = Math.round(franchiseValue * modifier);
  return { saleType, modifier, salePrice };
}

// ─────────────────────────────────────────────────────────────────────────────
// Relocation threat detection
// Fires when ALL: new owner (sale this or last season), franchise_value < league median,
// stadium_capacity < 30000, attendance < 60% capacity for 2 consecutive seasons
// ─────────────────────────────────────────────────────────────────────────────

export function checkRelocationThreat(
  team: TeamRow,
  leagueId: number,
  seasonNumber: number
): boolean {
  if (team.relocation_threat_active === 1) return true; // already flagged

  // Check if new owner (sale this or last season)
  const recentSale = prepared(
    `SELECT COUNT(*) as cnt FROM front_office_events
     WHERE team_id = ? AND event_type = 'owner_sold_team'
       AND season_number >= ? - 1`
  ).get(team.id, seasonNumber) as { cnt: number } | undefined;

  if ((recentSale?.cnt ?? 0) === 0) return false;

  // League median franchise_value
  const allValues = prepared(
    'SELECT franchise_value FROM teams WHERE league_id = ? AND franchise_value > 0'
  ).all(leagueId) as Array<{ franchise_value: number }>;

  if (allValues.length === 0) return false;
  const sorted = allValues.map(r => r.franchise_value).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 100;

  const franchiseValue = team.franchise_value ?? 100;
  const stadiumCapacity = team.stadium_capacity ?? 35000;

  if (franchiseValue >= median) return false;
  if (stadiumCapacity >= 30000) return false;

  // Check attendance < 60% capacity for 2 consecutive seasons
  const history = prepared(
    `SELECT attendance_avg FROM franchise_season_history
     WHERE league_id = ? AND team_id = ?
     ORDER BY season_number DESC LIMIT 2`
  ).all(leagueId, team.id) as Array<{ attendance_avg: number }>;

  if (history.length < 2) return false;
  const threshold = stadiumCapacity * 0.6;
  const bothLow = history.every(h => h.attendance_avg < threshold);

  return bothLow;
}

export function setRelocationThreat(teamId: number, leagueId: number, seasonNumber: number, gameNumber: number): void {
  const db = getDb();
  db.prepare('UPDATE teams SET relocation_threat_active = 1 WHERE id = ?').run(teamId);

  // News item
  const team = prepared('SELECT city, name FROM teams WHERE id = ?').get(teamId) as { city: string; name: string } | undefined;
  if (team) {
    db.prepare(
      `INSERT INTO news_items
         (league_id, season_number, game_number, created_at, event_type, badge,
          team_id, headline_text, is_headline_pending, details_json)
       VALUES (?, ?, ?, ?, 'owner_sold_team', 'FRONT OFFICE', ?, ?, 0, ?)`
    ).run(
      leagueId, seasonNumber, gameNumber, Date.now(),
      teamId,
      `Relocation threat: ${team.city} ${team.name} may leave their market`,
      JSON.stringify({ relocation_threat: true, teamId })
    );
  }
  console.log(`[sales] Relocation threat set for team ${teamId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Relocation resolution (season-end only, H-1)
// City council vote: small market 40% save, medium 65%
// ─────────────────────────────────────────────────────────────────────────────

export function resolveRelocation(
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  worldgenSeed: number
): void {
  if (team.relocation_threat_active !== 1) return;

  const db = getDb();
  const rng = seedFor(`relocation_resolve_${team.id}_${seasonNumber}`, worldgenSeed);

  // City council vote probability: small 40%, medium 65%, large/mega always saved
  const saveProb: Record<string, number> = {
    small: 0.40, medium: 0.65, large: 0.85, mega: 0.95,
  };
  const prob = saveProb[team.market_size] ?? 0.65;
  const saved = rng() < prob;

  if (saved) {
    // Stadium deal saves the team
    const capacityBoost = randInt(rng, 2000, 5000);
    db.prepare(
      `UPDATE teams
       SET relocation_threat_active = 0, stadium_deal_active = 1,
           stadium_capacity = stadium_capacity + ?
       WHERE id = ?`
    ).run(capacityBoost, team.id);

    db.prepare(
      `INSERT INTO news_items
         (league_id, season_number, game_number, created_at, event_type, badge,
          team_id, headline_text, is_headline_pending)
       VALUES (?, ?, 0, ?, 'owner_sold_team', 'FRONT OFFICE', ?, ?, 0)`
    ).run(
      leagueId, seasonNumber, Date.now(),
      team.id,
      `Stadium deal saves ${team.city} ${team.name} — relocation threat resolved`
    );
    console.log(`[sales] Relocation saved: team ${team.id} ${team.city} ${team.name}`);
  } else {
    // Relocation — pick a new city and nickname (H-1: only written at season end)
    const availableCities = CITIES.filter(c => c.market_size !== 'mega'); // avoid mega overlap
    const cityIdx = Math.floor(rng() * availableCities.length);
    const newCity = availableCities[cityIdx] ?? availableCities[0] ?? { name: 'Newville', state: 'TX', region: 'Southeast', market_size: 'small' as const, population_hint: 200 };

    const usedNicknames = (prepared('SELECT name FROM teams WHERE league_id = ?').all(leagueId) as Array<{ name: string }>)
      .map(t => t.name);
    const availableNicks = NICKNAMES.filter(n => !usedNicknames.includes(n));
    const nickIdx = Math.floor(rng() * availableNicks.length);
    const newNickname = availableNicks[nickIdx] ?? 'Wanderers';

    // Abbreviation: first 3 letters of new city
    const newAbbr = (newCity.name.replace(/\s+/g, '').toUpperCase().slice(0, 3));

    // Preserve original_city
    const originalCity = team.original_city ?? team.city;

    db.prepare(
      `UPDATE teams
       SET city = ?, name = ?, abbreviation = ?, state_province = ?, region = ?,
           market_size = ?, stadium_capacity = ?,
           relocation_threat_active = 0, original_city = ?
       WHERE id = ?`
    ).run(
      newCity.name, newNickname, newAbbr, newCity.state, newCity.region,
      newCity.market_size,
      newCity.market_size === 'mega' ? 48000 : newCity.market_size === 'large' ? 42000 : newCity.market_size === 'medium' ? 36000 : 30000,
      originalCity, team.id
    );

    db.prepare(
      `INSERT INTO news_items
         (league_id, season_number, game_number, created_at, event_type, badge,
          team_id, headline_text, is_headline_pending)
       VALUES (?, ?, 0, ?, 'owner_sold_team', 'FRONT OFFICE', ?, ?, 0)`
    ).run(
      leagueId, seasonNumber, Date.now(),
      team.id,
      `BREAKING: ${team.city} ${team.name} relocates to ${newCity.name} — renamed the ${newCity.name} ${newNickname}`
    );

    // Spec line 216/244: relocating cancels any in-progress stadium upgrade; forfeit costs.
    if (team.stadium_upgrade_in_progress === 1) {
      db.prepare(
        `UPDATE teams
           SET stadium_upgrade_in_progress = 0,
               stadium_upgrade_complete_season = NULL,
               stadium_upgrade_type = NULL
         WHERE id = ?`
      ).run(team.id);

      db.prepare(
        `INSERT INTO transactions
           (league_id, season_number, transaction_type, team_id, player_id, narrative, details_json, created_at)
         VALUES (?, ?, 'stadium_upgrade_forfeit', ?, NULL, ?, ?, ?)`
      ).run(
        leagueId, seasonNumber, team.id,
        `${team.city} ${team.name} forfeit in-progress stadium upgrade (${team.stadium_upgrade_type ?? 'unknown'}) on relocation`,
        JSON.stringify({ forfeited_upgrade_type: team.stadium_upgrade_type ?? null }),
        Date.now()
      );
    }

    console.log(`[sales] Relocation: team ${team.id} ${team.city} ${team.name} → ${newCity.name} ${newNickname}`);
  }
}
