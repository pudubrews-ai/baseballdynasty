import { prepared, getActiveLeague, type TeamRow } from '../db.js';
import { computeTeamStreak } from '../sim/streak.js';

export async function getStandings(): Promise<object> {
  const league = getActiveLeague();
  if (!league) return { conferences: [] };

  const teamsRaw = prepared(
    'SELECT * FROM teams WHERE league_id = ?'
  ).all(league.id) as TeamRow[];

  // §3.2 Iter-5: Sort by PCT desc (with run-diff and wins as tiebreakers)
  const teams = teamsRaw.sort((a, b) => {
    const pctA = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
    const pctB = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
    if (pctB !== pctA) return pctB - pctA;
    const rdA = a.runs_scored - a.runs_allowed;
    const rdB = b.runs_scored - b.runs_allowed;
    if (rdB !== rdA) return rdB - rdA;
    return b.wins - a.wins;
  });

  const conferences = ['American', 'National'];
  const result = {
    conferences: conferences.map(conf => {
      const confTeams = teams.filter(t => t.conference === conf);
      const divisions = ['East', 'West'];

      return {
        name: conf,
        divisions: divisions.map(div => {
          const divName = `${conf} ${div}`;
          const divTeams = confTeams.filter(t => t.division === divName);
          const leader = divTeams[0];

          return {
            name: divName,
            teams: divTeams.map(t => {
              const gb = leader && t.id !== leader.id
                ? ((leader.wins - t.wins) + (t.losses - leader.losses)) / 2
                : 0;
              const pct = (t.wins + t.losses) > 0 ? t.wins / (t.wins + t.losses) : 0;
              const { streak, last10 } = computeTeamStreak(league.id, t.id, league.season_number);
              return {
                teamId: t.id,
                teamName: `${t.city} ${t.name}`,
                wins: t.wins,
                losses: t.losses,
                pct: Math.round(pct * 1000) / 1000,
                gb: Math.max(0, gb),
                runsScored: t.runs_scored,
                runsAllowed: t.runs_allowed,
                runDifferential: t.runs_scored - t.runs_allowed,
                streak,
                last10,
              };
            }),
          };
        }),
      };
    }),
  };

  return result;
}
