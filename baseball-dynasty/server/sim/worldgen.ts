// World generation — creates a full league from scratch
// Uses direct tier sampling per §5.2 (NOT normal distribution)

import { getDb, prepared, type TeamRow } from '../db.js';
import { CITIES, type CityData } from '../data/cities.js';
import { NICKNAMES } from '../data/nicknames.js';
import { NAME_POOLS, ORIGIN_DISTRIBUTION, type OriginKey } from '../data/names.js';
import { mulberry32, seedFor, resolveSeed, randInt, randNormal, shuffle } from './prng.js';

// §5.2: Direct tier sampling — exact counts, NOT normal distribution
const TIERS = [
  { name: 'elite',       count: 16,  min: 85, max: 99 },
  { name: 'star',        count: 64,  min: 75, max: 84 },
  { name: 'regular',     count: 200, min: 60, max: 74 },
  { name: 'fringe',      count: 320, min: 45, max: 59 },
  { name: 'replacement', count: 200, min: 30, max: 44 },
];
// Total: 800 players

// §8: Position allocations
const POSITION_ALLOCATIONS = [
  { position: 'SP', count: 60 },
  { position: 'RP', count: 40 },
  { position: 'CL', count: 20 },
  { position: 'C',  count: 80 },
  { position: '1B', count: 80 },
  { position: '2B', count: 80 },
  { position: '3B', count: 80 },
  { position: 'SS', count: 80 },
  { position: 'LF', count: 90 },
  { position: 'CF', count: 90 },
  { position: 'RF', count: 90 },
  { position: 'DH', count: 10 },
];
// Total: 800

const TEAM_COLORS = [
  '#1e3a5f', '#8b1a1a', '#1a4a1a', '#4a1a4a', '#4a3a1a',
  '#1a4a4a', '#3a1a1a', '#1a1a4a', '#4a4a1a', '#1a3a4a',
  '#5a1a2a', '#2a1a5a', '#1a5a2a', '#5a2a1a', '#2a5a1a',
  '#1a2a5a', '#5a4a1a', '#4a1a5a', '#1a5a4a', '#5a1a4a',
];

const GM_PHILOSOPHIES: Array<'win-now' | 'rebuild' | 'balanced'> = ['win-now', 'rebuild', 'balanced'];
const GM_RISK_TOLERANCES: Array<'conservative' | 'moderate' | 'aggressive'> = ['conservative', 'moderate', 'aggressive'];
const GM_FOCUSES: Array<'hitting' | 'pitching' | 'defense'> = ['hitting', 'pitching', 'defense'];
const MANAGER_STYLES: Array<'aggressive' | 'balanced' | 'conservative'> = ['aggressive', 'balanced', 'conservative'];
// v0.2.0: expanded owner personality includes win-now and patient (AB-17)
const OWNER_PERSONALITIES: Array<'meddling' | 'hands-off' | 'moderate' | 'win-now' | 'patient'> = ['meddling', 'hands-off', 'moderate', 'win-now', 'patient'];
// GM archetypes per AB-06 market-correlated derivation
type GmArchetype = 'analytics' | 'old-school' | 'balanced';
const POTENTIAL_DIST: Array<{ grade: string; pct: number }> = [
  { grade: 'A', pct: 0.10 },
  { grade: 'B', pct: 0.25 },
  { grade: 'C', pct: 0.40 },
  { grade: 'D', pct: 0.25 },
];

export interface WorldgenOptions {
  seed?: number;
  leagueName?: string;
}

// §2.11: Market-size quota selection — exactly 2 mega + 4 large + 8 medium + 6 small
function selectCitiesWithMarketQuota(rng: () => number, allCities: CityData[]): CityData[] {
  const quotas: Record<string, number> = { mega: 2, large: 4, medium: 8, small: 6 };
  const remaining: Record<string, number> = { ...quotas };

  const shuffled = [...allCities];
  shuffle(rng, shuffled);

  const usedRegions = new Set<string>();
  const selected: CityData[] = [];

  // First pass: greedy by market size, honoring region uniqueness
  for (const city of shuffled) {
    if (selected.length >= 20) break;
    if ((remaining[city.market_size] ?? 0) <= 0) continue;
    if (usedRegions.has(city.region)) continue;
    selected.push(city);
    usedRegions.add(city.region);
    remaining[city.market_size]!--;
  }

  // Second pass: if any quota unmet (region exhaustion), relax region uniqueness
  if (selected.length < 20) {
    for (const city of shuffled) {
      if (selected.length >= 20) break;
      if (selected.includes(city)) continue;
      if ((remaining[city.market_size] ?? 0) <= 0) continue;
      console.warn(`[worldgen] Relaxing region uniqueness to satisfy market-size quota for ${city.name}`);
      selected.push(city);
      remaining[city.market_size]!--;
    }
  }

  // §3.3: Throw clear error if any quota is unsatisfied
  if (selected.length < 20) {
    const unmet: string[] = [];
    for (const [size, count] of Object.entries(remaining)) {
      if (count > 0) unmet.push(`${size}=${count}`);
    }
    throw new Error(`[worldgen] Insufficient cities to satisfy market quotas: ${unmet.join(', ')}`);
  }

  return selected;
}

// §3.1: Generate unique team abbreviation from nickname + city
function generateAbbreviation(nickname: string, city: string, takenAbbrevs: Set<string>): string {
  let abbrev = nickname.slice(0, 3).toUpperCase();
  if (!takenAbbrevs.has(abbrev)) {
    takenAbbrevs.add(abbrev);
    return abbrev;
  }
  abbrev = (city.slice(0, 2) + nickname.slice(0, 1)).toUpperCase();
  let suffix = 0;
  while (takenAbbrevs.has(abbrev)) {
    suffix++;
    abbrev = (city.slice(0, 2) + suffix).toUpperCase();
    if (suffix > 99) break;
  }
  takenAbbrevs.add(abbrev);
  return abbrev;
}

export async function generateWorld(options: WorldgenOptions): Promise<{ leagueId: number; worldgenSeed: number }> {
  const db = getDb();
  const seed = resolveSeed(options.seed);
  const rng = seedFor('worldgen', seed);
  const leagueName = options.leagueName ?? 'Baseball Dynasty';

  // Pre-build position array (800 entries)
  const positionArray: string[] = [];
  for (const { position, count } of POSITION_ALLOCATIONS) {
    for (let i = 0; i < count; i++) positionArray.push(position);
  }
  shuffle(rng, positionArray);

  // Pre-build tier assignment array (800 entries)
  const tierArray: typeof TIERS[0][] = [];
  for (const tier of TIERS) {
    for (let i = 0; i < tier.count; i++) tierArray.push(tier);
  }
  shuffle(rng, tierArray);

  // Pre-build origin assignment array (800 entries)
  const originArray: OriginKey[] = [];
  for (const { key, pct } of ORIGIN_DISTRIBUTION) {
    const count = Math.round(800 * pct);
    for (let i = 0; i < count; i++) originArray.push(key);
  }
  // Fill any shortfall due to rounding
  while (originArray.length < 800) originArray.push('us');
  originArray.length = 800;
  shuffle(rng, originArray);

  // Potential distribution array
  const potentialArray: string[] = [];
  for (const { grade, pct } of POTENTIAL_DIST) {
    const count = Math.round(800 * pct);
    for (let i = 0; i < count; i++) potentialArray.push(grade);
  }
  while (potentialArray.length < 800) potentialArray.push('C');
  potentialArray.length = 800;
  shuffle(rng, potentialArray);

  // Pick 20 cities with market-size quota: exactly 2 mega + 4 large + 8 medium + 6 small (§2.11)
  const selectedCities = selectCitiesWithMarketQuota(rng, [...CITIES]);

  // Pick 20 nicknames (no duplicates)
  const shuffledNicknames = [...NICKNAMES];
  shuffle(rng, shuffledNicknames);
  const selectedNicknames = shuffledNicknames.slice(0, 20);

  const insertLeague = db.prepare(
    'INSERT INTO leagues (name, season_number, phase, sim_speed, current_game_date, current_game_number, last_pick_id, last_game_id, worldgen_seed, archived, created_at) VALUES (?, 1, ?, ?, 0, 0, 0, 0, ?, 0, ?)'
  );
  const insertTeam = db.prepare(
    `INSERT INTO teams (league_id, name, city, state_province, region, market_size, conference, division, color, wins, losses, runs_scored, runs_allowed, games_played, payroll_budget, current_payroll, revenue, gm_name, gm_philosophy, gm_risk_tolerance, gm_focus, gm_archetype, manager_name, manager_style, manager_tactics, manager_motivation, manager_communication, owner_name, owner_personality, owner_age, job_security, abbreviation, franchise_value, stadium_capacity, founded_season) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, ?, ?, ?, 1)`
  );
  const insertPlayer = db.prepare(
    `INSERT INTO players (league_id, team_id, first_name, last_name, age, position, overall_rating, potential, potential_revealed, contact, power, speed, fielding, arm, pitching_velocity, pitching_control, pitching_stamina, is_on_mlb_roster, is_on_25man, annual_salary, contract_years_remaining, service_time, service_time_days, injury_prone, coachability, work_ethic, leadership, origin, birthplace_city, birthplace_country, is_drafted, career_hits, career_hr, career_rbi, career_ip, career_k, options_remaining) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
  );

  const doWorldgen = db.transaction(() => {
    // Insert league
    const leagueResult = insertLeague.run(
      leagueName,
      'expansion_draft',
      'paused',
      seed,
      Date.now()
    );
    const leagueId = leagueResult.lastInsertRowid as number;

    // Assign conferences and divisions
    const conferences = ['American', 'National'];
    const teamIds: number[] = [];
    const takenAbbrevs = new Set<string>();

    for (let i = 0; i < 20; i++) {
      const city = selectedCities[i]!;
      const nickname = selectedNicknames[i]!;
      const conference = conferences[i < 10 ? 0 : 1]!;
      const divIndex = Math.floor((i % 10) / 5); // 2 divisions per conference
      const division = `${conference} ${divIndex === 0 ? 'East' : 'West'}`;
      const color = TEAM_COLORS[i] ?? '#1e3a5f';

      // Financial generation by market size
      let payrollBudget: number;
      let revenue: number;
      switch (city.market_size) {
        case 'mega':
          revenue = randInt(rng, 180_000_000, 220_000_000);
          payrollBudget = randInt(rng, 140_000_000, 170_000_000);
          break;
        case 'large':
          revenue = randInt(rng, 120_000_000, 160_000_000);
          payrollBudget = randInt(rng, 90_000_000, 120_000_000);
          break;
        case 'medium':
          revenue = randInt(rng, 70_000_000, 110_000_000);
          payrollBudget = randInt(rng, 55_000_000, 80_000_000);
          break;
        case 'small':
        default:
          revenue = randInt(rng, 40_000_000, 65_000_000);
          payrollBudget = randInt(rng, 30_000_000, 50_000_000);
          break;
      }

      const philosophy = GM_PHILOSOPHIES[randInt(rng, 0, 2)] ?? 'balanced';
      const riskTolerance = GM_RISK_TOLERANCES[randInt(rng, 0, 2)] ?? 'moderate';
      const focus = GM_FOCUSES[randInt(rng, 0, 2)] ?? 'hitting';
      const managerStyle = MANAGER_STYLES[randInt(rng, 0, 2)] ?? 'balanced';
      const ownerPersonality = OWNER_PERSONALITIES[randInt(rng, 0, 4)] ?? 'moderate';
      const ownerAge = randInt(rng, 45, 75);

      // AB-06: GM archetype correlated with market size (seeded)
      const archetypeRng = seedFor(`archetype_${i}_${leagueId}`, seed);
      const archetypeRoll = archetypeRng();
      let gmArchetype: GmArchetype;
      const marketSize = city.market_size;
      if (marketSize === 'small' || marketSize === 'medium') {
        // 60% analytics, 25% balanced, 15% old-school
        if (archetypeRoll < 0.60) gmArchetype = 'analytics';
        else if (archetypeRoll < 0.85) gmArchetype = 'balanced';
        else gmArchetype = 'old-school';
      } else {
        // large/mega: 50% old-school, 30% balanced, 20% analytics
        if (archetypeRoll < 0.50) gmArchetype = 'old-school';
        else if (archetypeRoll < 0.80) gmArchetype = 'balanced';
        else gmArchetype = 'analytics';
      }

      // Manager numeric ratings (random 40-70 range)
      const managerTactics = randInt(rng, 40, 70);
      const managerMotivation = randInt(rng, 40, 70);
      const managerCommunication = randInt(rng, 40, 70);

      const gmFirst = pickRandomName(rng, 'us', 'first');
      const gmLast = pickRandomName(rng, 'us', 'last');
      const managerFirst = pickRandomName(rng, 'us', 'first');
      const managerLast = pickRandomName(rng, 'us', 'last');
      const ownerFirst = pickRandomName(rng, 'us', 'first');
      const ownerLast = pickRandomName(rng, 'us', 'last');

      const abbreviation = generateAbbreviation(nickname, city.name, takenAbbrevs);

      // v0.4.0: franchise_value and stadium_capacity by market size
      const startingFranchiseValue =
        city.market_size === 'mega' ? 400
        : city.market_size === 'large' ? 250
        : city.market_size === 'medium' ? 150 : 100;
      const stadiumCapacity =
        city.market_size === 'mega' ? 48000
        : city.market_size === 'large' ? 42000
        : city.market_size === 'medium' ? 36000 : 30000;

      const teamResult = insertTeam.run(
        leagueId,
        nickname,
        city.name,
        city.state,
        city.region,
        city.market_size,
        conference,
        division,
        color,
        payrollBudget,
        revenue,
        `${gmFirst} ${gmLast}`,
        philosophy,
        riskTolerance,
        focus,
        gmArchetype,
        `${managerFirst} ${managerLast}`,
        managerStyle,
        managerTactics,
        managerMotivation,
        managerCommunication,
        `${ownerFirst} ${ownerLast}`,
        ownerPersonality,
        ownerAge,
        abbreviation,
        startingFranchiseValue,
        stadiumCapacity
        // founded_season = 1 is hardcoded in the INSERT statement (last literal)
      );
      teamIds.push(teamResult.lastInsertRowid as number);
    }

    // Generate 800 players
    for (let i = 0; i < 800; i++) {
      const tier = tierArray[i]!;
      const position = positionArray[i]!;
      const origin = originArray[i]!;
      const potential = potentialArray[i]!;

      // Overall rating: uniform within tier
      const overall = randInt(rng, tier.min, tier.max);

      // Sub-ratings: uniform(overall - 10, overall + 10), clamped [1, 99]
      const sub = (base: number) => Math.max(1, Math.min(99, randInt(rng, base - 10, base + 10)));

      // Age: truncated normal centered at 25, σ=4, clamped [18, 35]
      let age = Math.round(randNormal(rng, 25, 4));
      age = Math.max(18, Math.min(35, age));

      // Service time: for players 23+, uniform [0, age - 22]
      const serviceTime = age >= 23 ? randInt(rng, 0, age - 22) : 0;

      // Salary: (overall^2) / 100 * 50_000, rounded to $100K, capped at $35M
      const rawSalary = (overall * overall) / 100 * 50_000;
      const annualSalary = Math.min(35_000_000, Math.round(rawSalary / 100_000) * 100_000);

      // Contract years: 1-4
      const contractYears = randInt(rng, 1, 4);

      // injury_prone: most players 3-6, a tail of injury-prone players 7-9
      // AB-11 FIX: widened range to include ≥7 so the game.ts trigger (injury_prone >= 7) is reachable.
      // randInt(3,9) puts ~43% of players at ≥7; the 0.05 per-game gate keeps actual injuries sparse.
      const injuryProne = randInt(rng, 3, 9);

      // Name generation
      const firstName = pickRandomName(rng, origin, 'first');
      const lastName = pickRandomName(rng, origin, 'last');
      const country = getCountryForOrigin(rng, origin);

      // Pitching vs hitting sub-ratings
      const isPitcher = ['SP', 'RP', 'CL'].includes(position);
      const contact = isPitcher ? sub(40) : sub(overall);
      const power = isPitcher ? sub(35) : sub(overall);
      const speed = sub(overall);
      const fielding = sub(overall);
      const arm = sub(overall);
      const pitchingVelocity = isPitcher ? sub(overall) : sub(40);
      const pitchingControl = isPitcher ? sub(overall) : sub(40);
      const pitchingStamina = isPitcher ? sub(overall) : sub(40);

      const coachability = randInt(rng, 1, 10);
      const workEthic = randInt(rng, 1, 10);
      const leadership = randInt(rng, 1, 10);

      // v0.2.0: service_time_days = serviceTime * 30 (AB-05 rescaling)
      const serviceTimeDays = serviceTime * 30;

      // AB-10 Part B: options_remaining based on service time — veterans exhaust their options.
      // MLB rules: players get 3 options; each send-down uses one. After 3 years of service,
      // most players have used all options. service_time >= 3 → 0 options, >= 2 → max 1, else 3.
      const optionsRemaining = serviceTime >= 3 ? 0 : serviceTime >= 2 ? 1 : 3;

      // AB-11 FIX §1.2b: Seed age-scaled career stats so veterans sit near milestone thresholds.
      // Milestones fire on crossing 100/200 HR, 2000 hits, 1000 K — all starting at 0 makes them
      // unreachable in a fresh play horizon. Scale by (age - 22) × rate, clamped 0..threshold-1
      // so a player never *starts* past a threshold (they must cross it in play).
      const yearsPlayed = Math.max(0, age - 22);
      let careerHits = 0;
      let careerHr = 0;
      let careerRbi = 0;
      let careerIp = 0;
      let careerK = 0;
      if (!isPitcher && yearsPlayed > 0) {
        // Approximate per-year rates from ratings (contact drives hits, power drives HR)
        const hitsPerYear = Math.round((contact ?? 50) * 4);
        const hrPerYear = Math.round((power ?? 50) / 12);
        const rbiPerYear = Math.round(hrPerYear * 3.5);
        careerHits = Math.min(1999, yearsPlayed * hitsPerYear);
        careerHr = Math.min(199, yearsPlayed * hrPerYear);
        careerRbi = yearsPlayed * rbiPerYear;
      } else if (isPitcher && yearsPlayed > 0) {
        const ipPerYear = Math.round((pitchingStamina ?? 50) * 2.5);
        const kPerYear = Math.round((pitchingVelocity ?? 50) * 0.06 * ipPerYear);
        careerIp = yearsPlayed * ipPerYear;
        careerK = Math.min(999, yearsPlayed * kPerYear);
      }

      insertPlayer.run(
        leagueId,
        firstName,
        lastName,
        age,
        position,
        overall,
        potential,
        contact,
        power,
        speed,
        fielding,
        arm,
        pitchingVelocity,
        pitchingControl,
        pitchingStamina,
        annualSalary,
        contractYears,
        serviceTime,
        serviceTimeDays,
        injuryProne,
        coachability,
        workEthic,
        leadership,
        origin,
        '', // birthplace_city
        country,
        careerHits,
        careerHr,
        careerRbi,
        careerIp,
        careerK,
        optionsRemaining,
      );
    }

    return { leagueId, worldgenSeed: seed };
  });

  return doWorldgen() as { leagueId: number; worldgenSeed: number };
}

function pickRandomName(rng: () => number, origin: OriginKey, type: 'first' | 'last'): string {
  const pool = NAME_POOLS[origin];
  if (!pool) return 'Unknown';
  const names = type === 'first' ? pool.first : pool.last;
  return names[Math.floor(rng() * names.length)] ?? 'Unknown';
}

function getCountryForOrigin(rng: () => number, origin: OriginKey): string {
  const dist = ORIGIN_DISTRIBUTION.find(d => d.key === origin);
  if (!dist || dist.countries.length === 0) return 'USA';
  return dist.countries[Math.floor(rng() * dist.countries.length)] ?? 'USA';
}

// Validate post-draft rosters for positional coverage
export function validatePostDraftRosters(leagueId: number): void {
  const db = getDb();
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];

  for (const team of teams) {
    // Check required positions: C, SS, CF, SP (>=2), CL (>=1)
    const rosterPositions = prepared(
      'SELECT position, COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 GROUP BY position'
    ).all(team.id) as Array<{ position: string; cnt: number }>;

    const posMap = new Map<string, number>();
    for (const row of rosterPositions) posMap.set(row.position, row.cnt);

    const checks = [
      { pos: 'C', min: 1 },
      { pos: 'SS', min: 1 },
      { pos: 'CF', min: 1 },
      { pos: 'SP', min: 2 },
      { pos: 'CL', min: 1 },
    ];

    for (const check of checks) {
      const have = posMap.get(check.pos) ?? 0;
      if (have < check.min) {
        console.warn(`[worldgen] Team ${team.id} (${team.name}) needs more ${check.pos}: has ${have}, needs ${check.min}. Running auto-balance.`);
        autoBalance(db, leagueId, team, check.pos, check.min - have);
      }
    }
  }
}

function autoBalance(
  db: ReturnType<typeof import('../db.js').getDb>,
  leagueId: number,
  needyTeam: TeamRow,
  position: string,
  deficit: number
): void {
  // Find the team with the most surplus at this position
  const surplusTeams = db.prepare(
    `SELECT t.id, t.name, COUNT(p.id) as cnt
     FROM teams t
     JOIN players p ON p.team_id = t.id AND p.is_on_mlb_roster = 1 AND p.position = ?
     WHERE t.league_id = ? AND t.id != ?
     GROUP BY t.id
     HAVING cnt > 1
     ORDER BY cnt DESC
     LIMIT 1`
  ).get(position, leagueId, needyTeam.id) as { id: number; name: string; cnt: number } | undefined;

  if (!surplusTeams) {
    // Try minors pool (fixed parameter order: leagueId, position — §2.8)
    const minorPlayer = db.prepare(
      'SELECT id FROM players WHERE league_id = ? AND position = ? AND is_on_mlb_roster = 0 AND is_drafted = 1 ORDER BY overall_rating DESC LIMIT 1'
    ).get(leagueId, position) as { id: number } | undefined;

    if (minorPlayer) {
      db.prepare('UPDATE players SET team_id = ?, is_on_mlb_roster = 1 WHERE id = ?').run(needyTeam.id, minorPlayer.id);
    }
    return;
  }

  for (let i = 0; i < deficit; i++) {
    // Transfer the lowest-rated surplus player from surplusTeams to needyTeam
    const player = db.prepare(
      'SELECT id FROM players WHERE team_id = ? AND position = ? AND is_on_mlb_roster = 1 ORDER BY overall_rating ASC LIMIT 1'
    ).get(surplusTeams.id, position) as { id: number } | undefined;

    if (!player) break;

    db.prepare('UPDATE players SET team_id = ? WHERE id = ?').run(needyTeam.id, player.id);

    // Write an auto-balance transaction record
    db.prepare(
      'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)'
    ).run(leagueId, 'auto_balance', needyTeam.id, player.id, `Auto-balance trade: positional coverage for ${position}`, Date.now());
  }
}
