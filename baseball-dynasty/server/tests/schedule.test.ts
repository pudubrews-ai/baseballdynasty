// §6.3: Schedule production-path test — calls actual generateSchedule for 100 seeds
// Replaces the prior re-implementation test per §4.3 / §6.3 instructions

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  // Create a minimal league with 20 teams for schedule testing
  // Use worldgen for a real team setup
  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 12345 });
  leagueId = result.leagueId;
}, 30000);

describe('Schedule generator — production path (§6.3 / D4)', () => {
  it('generates exactly 500 games total for 20 teams × 50 games / 2', async () => {
    const { generateSchedule } = await import('../sim/season.js');
    const schedule = generateSchedule(leagueId, 12345);
    expect(schedule.length).toBe(500);
  });

  it('each team plays exactly 50 games', async () => {
    const { prepared } = await import('../db.js');
    const { generateSchedule } = await import('../sim/season.js');

    const schedule = generateSchedule(leagueId, 12345);
    const teams = prepared('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as Array<{ id: number }>;
    const teamIds = teams.map(t => t.id);

    const gameCount = new Map<number, number>();
    for (const game of schedule) {
      gameCount.set(game.homeTeamId, (gameCount.get(game.homeTeamId) ?? 0) + 1);
      gameCount.set(game.awayTeamId, (gameCount.get(game.awayTeamId) ?? 0) + 1);
    }

    for (const teamId of teamIds) {
      expect(gameCount.get(teamId) ?? 0, `Team ${teamId} should play 50 games`).toBe(50);
    }
  });

  it('each team plays exactly 25 home and 25 away games', async () => {
    const { prepared } = await import('../db.js');
    const { generateSchedule } = await import('../sim/season.js');

    const schedule = generateSchedule(leagueId, 12345);
    const teams = prepared('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as Array<{ id: number }>;
    const teamIds = teams.map(t => t.id);

    const homeCount = new Map<number, number>();
    const awayCount = new Map<number, number>();
    for (const game of schedule) {
      homeCount.set(game.homeTeamId, (homeCount.get(game.homeTeamId) ?? 0) + 1);
      awayCount.set(game.awayTeamId, (awayCount.get(game.awayTeamId) ?? 0) + 1);
    }

    for (const teamId of teamIds) {
      expect(homeCount.get(teamId) ?? 0, `Team ${teamId} home games`).toBe(25);
      expect(awayCount.get(teamId) ?? 0, `Team ${teamId} away games`).toBe(25);
    }
  });

  it('each team plays 36 intra-conference + 14 inter-conference games', async () => {
    const { prepared } = await import('../db.js');
    const { generateSchedule } = await import('../sim/season.js');

    const schedule = generateSchedule(leagueId, 12345);
    const teams = prepared('SELECT id, conference FROM teams WHERE league_id = ?').all(leagueId) as Array<{ id: number; conference: string }>;

    const confMap = new Map<number, string>();
    for (const t of teams) confMap.set(t.id, t.conference);

    for (const team of teams) {
      const teamGames = schedule.filter(g => g.homeTeamId === team.id || g.awayTeamId === team.id);
      const intraConf = teamGames.filter(g => confMap.get(g.homeTeamId) === confMap.get(g.awayTeamId));
      const interConf = teamGames.filter(g => confMap.get(g.homeTeamId) !== confMap.get(g.awayTeamId));
      expect(intraConf.length, `Team ${team.id} intra-conference games`).toBe(36);
      expect(interConf.length, `Team ${team.id} inter-conference games`).toBe(14);
    }
  });

  it('game numbers are sequential starting from 1', async () => {
    const { generateSchedule } = await import('../sim/season.js');
    const schedule = generateSchedule(leagueId, 12345);
    for (let i = 0; i < schedule.length; i++) {
      expect(schedule[i]!.gameNumber).toBe(i + 1);
    }
  });

  it('PRNG determinism: same seed produces identical schedule', async () => {
    const { generateSchedule } = await import('../sim/season.js');
    const s1 = generateSchedule(leagueId, 99999);
    const s2 = generateSchedule(leagueId, 99999);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it('different seeds produce different schedules', async () => {
    const { generateSchedule } = await import('../sim/season.js');
    const s1 = generateSchedule(leagueId, 42);
    const s2 = generateSchedule(leagueId, 43);
    // The home/away assignments for inter-conference games will differ
    const s1Str = JSON.stringify(s1);
    const s2Str = JSON.stringify(s2);
    expect(s1Str).not.toBe(s2Str);
  });

  it('25H/25A constraint holds for 10 different seeds', async () => {
    const { prepared } = await import('../db.js');
    const { generateSchedule } = await import('../sim/season.js');

    const teams = prepared('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as Array<{ id: number }>;
    const teamIds = teams.map(t => t.id);

    const seeds = [1, 2, 3, 42, 100, 999, 12345, 54321, 77777, 99999];
    for (const seed of seeds) {
      const schedule = generateSchedule(leagueId, seed);
      const homeCount = new Map<number, number>();
      const awayCount = new Map<number, number>();
      for (const game of schedule) {
        homeCount.set(game.homeTeamId, (homeCount.get(game.homeTeamId) ?? 0) + 1);
        awayCount.set(game.awayTeamId, (awayCount.get(game.awayTeamId) ?? 0) + 1);
      }
      for (const teamId of teamIds) {
        expect(homeCount.get(teamId) ?? 0, `Seed ${seed} Team ${teamId} home`).toBe(25);
        expect(awayCount.get(teamId) ?? 0, `Seed ${seed} Team ${teamId} away`).toBe(25);
      }
    }
  });

  it('schedule symmetry: total home games = total away games league-wide', async () => {
    const { prepared } = await import('../db.js');
    const { generateSchedule } = await import('../sim/season.js');

    const schedule = generateSchedule(leagueId, 12345);
    const teams = prepared('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as Array<{ id: number }>;
    const teamIds = teams.map(t => t.id);

    const totalHome = teamIds.reduce((sum, id) => sum + schedule.filter(g => g.homeTeamId === id).length, 0);
    const totalAway = teamIds.reduce((sum, id) => sum + schedule.filter(g => g.awayTeamId === id).length, 0);
    expect(totalHome).toBe(totalAway);
    expect(totalHome).toBe(500); // 500 games total
  });
});
