import React, { useState, useEffect } from 'react';
import { useLeagueState } from '../hooks/useLeagueState.js';
import { getStandings, getRecentGames, setSimSpeed } from '../api.js';

// v0.5.0 Award race types
interface AwardRaceEntry {
  award_type: string;
  league: string; // "AL" or "NL"
  last_updated_game: number;
  leader: { player_id: number; name: string; team_id: number | null; value: number | null } | null;
  second: { player_id: number; name: string; team_id: number | null; value: number | null } | null;
}

// v0.5.0 Record watch types
interface RecordWatchNews {
  id: number;
  event_type: string;
  headline_text: string | null;
  game_number: number;
  player_id: number | null;
}

// v0.5.0 Team streak (from standings, via teams endpoint)
interface TeamStreak {
  teamId: number;
  winning_streak: number;
  losing_streak: number;
}

interface TeamStandingsRow {
  teamId: number;
  teamName: string;
  wins: number;
  losses: number;
  pct: number;
  gb: number;
  runsScored: number;
  runsAllowed: number;
  runDifferential: number;
}

interface DivisionStandings {
  name: string;
  teams: TeamStandingsRow[];
}

interface ConferenceStandings {
  name: string;
  divisions: DivisionStandings[];
}

interface StandingsData {
  conferences: ConferenceStandings[];
}

interface GameResult {
  id: number;
  gameNumber: number;
  gameDate: number;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
}

export default function League() {
  const { state } = useLeagueState();
  const [standings, setStandings] = useState<StandingsData | null>(null);
  const [recentGames, setRecentGames] = useState<GameResult[]>([]);
  // v0.5.0 additions
  const [awardRaces, setAwardRaces] = useState<AwardRaceEntry[]>([]);
  const [recordWatchers, setRecordWatchers] = useState<RecordWatchNews[]>([]);
  const [teamStreaks, setTeamStreaks] = useState<Map<number, TeamStreak>>(new Map());

  useEffect(() => {
    getStandings().then(data => setStandings(data as StandingsData)).catch(console.error);
    getRecentGames().then(data => setRecentGames(data as GameResult[])).catch(console.error);

    // v0.5.0: load award races
    fetch('/api/awards/current')
      .then(r => r.ok ? r.json() : [])
      .then((data: AwardRaceEntry[]) => setAwardRaces(data))
      .catch(() => {});

    // v0.5.0: load record watch news (filter client-side since /api/news ignores event_type param)
    fetch('/api/news?limit=50')
      .then(r => r.ok ? r.json() : [])
      .then((data: RecordWatchNews[]) =>
        setRecordWatchers(data.filter(n => n.event_type === 'record_watch')))
      .catch(() => {});

    // v0.5.0: load team streaks
    fetch('/api/teams')
      .then(r => r.ok ? r.json() : [])
      .then((data: Array<{ id: number; winning_streak?: number; losing_streak?: number }>) => {
        const m = new Map<number, TeamStreak>();
        for (const t of data) {
          m.set(t.id, { teamId: t.id, winning_streak: t.winning_streak ?? 0, losing_streak: t.losing_streak ?? 0 });
        }
        setTeamStreaks(m);
      })
      .catch(() => {});
  }, [state?.currentGameNumber]);

  // §3.7: Add dedicated standings polling during regular_season at 1500ms
  useEffect(() => {
    if (state?.phase !== 'regular_season') return;
    const intervalId = setInterval(() => {
      getStandings().then(data => setStandings(data as StandingsData)).catch(console.error);
    }, 1500);
    return () => clearInterval(intervalId);
  }, [state?.phase]);

  const handleSpeedChange = async (speed: string) => {
    try {
      await setSimSpeed(speed);
    } catch (err) {
      console.error(err);
    }
  };

  const formatDate = (ms: number): string => {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '16px' }}>
      {/* Standings */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ margin: 0 }}>League Standings</h2>
          {/* Speed control */}
          <div data-testid="sim-speed-control" style={{ display: 'flex', gap: '8px' }}>
            {['paused', 'normal', 'fast', 'turbo'].map(speed => (
              <button
                key={speed}
                data-testid={`sim-speed-${speed}`}
                onClick={() => handleSpeedChange(speed)}
                style={{
                  background: state?.simSpeed === speed ? '#3b82f6' : '#334155',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  textTransform: 'capitalize',
                }}
              >
                {speed === 'paused' ? 'Pause' : speed.charAt(0).toUpperCase() + speed.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <table
          data-testid="league-standings-table"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}
        >
          <thead>
            <tr style={{ background: '#1e293b', color: '#94a3b8' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>Team</th>
              <th style={{ padding: '8px', textAlign: 'center' }}>W</th>
              <th style={{ padding: '8px', textAlign: 'center' }}>L</th>
              <th style={{ padding: '8px', textAlign: 'center' }}>PCT</th>
              <th style={{ padding: '8px', textAlign: 'center' }}>GB</th>
              <th style={{ padding: '8px', textAlign: 'center' }}>RS</th>
              <th style={{ padding: '8px', textAlign: 'center' }}>RA</th>
              <th style={{ padding: '8px', textAlign: 'center' }}>DIFF</th>
            </tr>
          </thead>
          <tbody>
            {standings?.conferences.map(conf => (
              conf.divisions.map(div => (
                // §2.4: React.Fragment with key to fix missing key warning
                <React.Fragment key={`${conf.name}-${div.name}`}>
                  <tr style={{ background: '#0f172a' }}>
                    <td colSpan={8} style={{ padding: '6px 8px', color: '#60a5fa', fontWeight: 'bold', fontSize: '12px' }}>
                      {div.name}
                    </td>
                  </tr>
                  {div.teams.map((team, teamIdx) => (
                    <tr
                      key={team.teamId}
                      data-testid={`standings-row-${team.teamId}`}
                      {...(teamIdx === 0 ? { 'data-division-leader': 'true', className: 'division-leader' } : {})}
                      style={{
                        borderBottom: '1px solid #1e293b',
                        // §3.2 Iter4: Division leader styling with data attribute and class
                        background: teamIdx === 0 ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                        fontWeight: teamIdx === 0 ? 'bold' : 'normal',
                      }}
                    >
                      <td style={{ padding: '8px' }}>
                        {team.teamName}
                        {/* Team streak indicator — shown only during 5+ game streak (Section 10) */}
                        {(() => {
                          const streak = teamStreaks.get(team.teamId);
                          if (streak && streak.winning_streak >= 5) return (
                            <span
                              data-testid={`team-streak-indicator-${team.teamId}`}
                              style={{ marginLeft: '4px', color: '#22c55e', fontSize: '11px' }}
                              title={`W${streak.winning_streak} streak`}
                            >W{streak.winning_streak}</span>
                          );
                          if (streak && streak.losing_streak >= 5) return (
                            <span
                              data-testid={`team-streak-indicator-${team.teamId}`}
                              style={{ marginLeft: '4px', color: '#ef4444', fontSize: '11px' }}
                              title={`L${streak.losing_streak} streak`}
                            >L{streak.losing_streak}</span>
                          );
                          return null;
                        })()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{team.wins}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{team.losses}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{team.pct.toFixed(3)}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{team.gb === 0 ? '-' : team.gb.toFixed(1)}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{team.runsScored}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{team.runsAllowed}</td>
                      <td style={{ padding: '8px', textAlign: 'center', color: team.runDifferential >= 0 ? '#4ade80' : '#f87171' }}>
                        {team.runDifferential >= 0 ? '+' : ''}{team.runDifferential}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))
            ))}
          </tbody>
        </table>
      </div>

      {/* v0.5.0: Award races panel + Record watch banner — in right column */}
      <div>
        {/* Record Watch Banner — visible when any non-retired player is in chase window */}
        {recordWatchers.length > 0 && (
          <div data-testid="record-watch-banner" style={{ background: '#1e293b', borderRadius: '8px', padding: '12px', marginBottom: '16px', borderLeft: '3px solid #f59e0b' }}>
            <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 'bold', marginBottom: '6px' }}>RECORD WATCH</div>
            {recordWatchers.slice(0, 3).map(n => (
              <div
                key={n.id}
                data-testid={`record-watch-${n.player_id ?? n.id}`}
                style={{ fontSize: '12px', color: '#e2e8f0', marginBottom: '4px' }}
              >
                {n.headline_text ?? n.event_type}
              </div>
            ))}
          </div>
        )}

        {/* Award Races Panel */}
        {awardRaces.length > 0 && (
          <div data-testid="award-races-panel" style={{ background: '#1e293b', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Award Races</div>
            {['AL', 'NL'].map(conf => {
              const confRaces = awardRaces.filter(r => r.league === conf);
              if (confRaces.length === 0) return null;
              return (
                <div key={conf} style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '12px', color: '#60a5fa', marginBottom: '4px' }}>{conf} League</div>
                  {confRaces.map(race => (
                    <div
                      key={`${race.award_type}-${race.league}`}
                      data-testid={
                        race.award_type === 'mvp' ? `mvp-race-${race.league}`
                        : race.award_type === 'cy_young' ? `cy-young-race-${race.league}`
                        : `roy-race-${race.league}`
                      }
                      style={{ fontSize: '12px', marginBottom: '6px' }}
                    >
                      <span style={{ color: '#64748b' }}>
                        {race.award_type === 'mvp' ? 'MVP' : race.award_type === 'cy_young' ? 'Cy Young' : 'ROY'}:{' '}
                      </span>
                      {race.leader
                        ? <><span style={{ color: '#e2e8f0' }}>{race.leader.name}</span> <span style={{ color: '#64748b' }}>({race.leader.value})</span></>
                        : <span style={{ color: '#475569' }}>No data yet</span>
                      }
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <h3 style={{ marginTop: 0 }}>Recent Games</h3>
        <div data-testid="game-ticker" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {recentGames.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '14px' }}>No games yet</p>
          ) : (
            recentGames.map(game => (
              <div
                key={game.id}
                data-testid={`game-ticker-item-${game.id}`}
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  fontSize: '13px',
                }}
              >
                <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '4px' }}>
                  {formatDate(game.gameDate)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ flex: 1 }}>{game.awayTeamName}</span>
                  <span style={{ fontWeight: 'bold', margin: '0 8px' }}>{game.awayScore}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ flex: 1 }}>{game.homeTeamName}</span>
                  <span style={{ fontWeight: 'bold', margin: '0 8px' }}>{game.homeScore}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sim status */}
        {state && (
          <div style={{ marginTop: '16px', background: '#1e293b', borderRadius: '6px', padding: '12px', fontSize: '13px' }}>
            <div style={{ color: '#64748b', marginBottom: '4px' }}>Sim Status</div>
            <div>Phase: <span style={{ color: '#60a5fa' }}>{state.phase}</span></div>
            <div>Games: <span style={{ color: '#60a5fa' }}>{state.currentGameNumber}</span></div>
            <div>LLM Budget: <span style={{ color: state.llmStatus.circuitBreakerOpen ? '#f87171' : '#4ade80' }}>
              {state.llmStatus.dailyBudgetRemaining} remaining
            </span></div>
          </div>
        )}
      </div>
    </div>
  );
}
