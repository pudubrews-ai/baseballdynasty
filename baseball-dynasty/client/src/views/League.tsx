import { useState, useEffect } from 'react';
import { useLeagueState } from '../hooks/useLeagueState.js';
import { getStandings, getRecentGames, setSimSpeed } from '../api.js';

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

  useEffect(() => {
    getStandings().then(data => setStandings(data as StandingsData)).catch(console.error);
    getRecentGames().then(data => setRecentGames(data as GameResult[])).catch(console.error);
  }, [state?.currentGameNumber]);

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
                <>
                  <tr key={div.name} style={{ background: '#0f172a' }}>
                    <td colSpan={8} style={{ padding: '6px 8px', color: '#60a5fa', fontWeight: 'bold', fontSize: '12px' }}>
                      {div.name}
                    </td>
                  </tr>
                  {div.teams.map(team => (
                    <tr
                      key={team.teamId}
                      data-testid={`standings-row-${team.teamId}`}
                      style={{ borderBottom: '1px solid #1e293b' }}
                    >
                      <td style={{ padding: '8px' }}>{team.teamName}</td>
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
                </>
              ))
            ))}
          </tbody>
        </table>
      </div>

      {/* Game ticker */}
      <div>
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
