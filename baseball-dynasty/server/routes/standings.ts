import { prepared, getActiveLeague, type TeamRow } from '../db.js';

export async function getStandings(): Promise<object> {
  const league = getActiveLeague();
  if (!league) return { conferences: [] };

  const teams = prepared(
    'SELECT * FROM teams WHERE league_id = ? ORDER BY wins DESC, (wins - losses) DESC'
  ).all(league.id) as TeamRow[];

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
              };
            }),
          };
        }),
      };
    }),
  };

  return result;
}
