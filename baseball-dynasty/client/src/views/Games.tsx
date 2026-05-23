import { useState, useEffect } from 'react';
import { getRecentGames, getGame } from '../api.js';
import { useLeagueState } from '../hooks/useLeagueState.js';

interface GameSummary {
  id: number;
  gameNumber: number;
  gameDate: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
}

interface GameDetail extends GameSummary {
  homeHits: number;
  awayHits: number;
  homeErrors: number;
  awayErrors: number;
  homeWalks: number;
  awayWalks: number;
  notableEvents: Array<{ type: string; playerName?: string; description: string }>;
}

export default function Games() {
  const { state } = useLeagueState();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameDetail | null>(null);

  useEffect(() => {
    getRecentGames().then(data => setGames(data as GameSummary[])).catch(console.error);
  }, [state?.currentGameNumber]);

  const handleGameClick = async (gameId: number) => {
    try {
      const detail = await getGame(gameId);
      setSelectedGame(detail as GameDetail);
    } catch (err) {
      console.error(err);
    }
  };

  const formatDate = (ms: number): string => {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Recent Games</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Games list */}
        <div>
          {games.length === 0 ? (
            <p style={{ color: '#64748b' }}>No games yet</p>
          ) : (
            games.map(game => (
              <button
                key={game.id}
                onClick={() => handleGameClick(game.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  background: selectedGame?.id === game.id ? '#1e3a5f' : '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  marginBottom: '6px',
                  cursor: 'pointer',
                  color: 'white',
                  textAlign: 'left',
                  fontSize: '13px',
                }}
              >
                <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '4px' }}>
                  {formatDate(game.gameDate)} · Game {game.gameNumber}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div>{game.awayTeamName} <strong>{game.awayScore}</strong></div>
                    <div>{game.homeTeamName} <strong>{game.homeScore}</strong></div>
                  </div>
                  <div style={{ color: game.homeScore > game.awayScore ? '#4ade80' : '#94a3b8', fontSize: '12px' }}>
                    F
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Box score modal */}
        {selectedGame && (
          <div
            data-testid={`box-score-modal-${selectedGame.id}`}
            style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}
          >
            <h3 style={{ marginTop: 0, fontSize: '14px' }}>
              {selectedGame.awayTeamName} @ {selectedGame.homeTeamName}
            </h3>
            <div style={{ fontSize: '13px', marginBottom: '12px' }}>
              <div style={{ color: '#64748b', marginBottom: '4px' }}>{formatDate(selectedGame.gameDate)}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#94a3b8', fontSize: '12px' }}>
                    <th style={{ padding: '4px', textAlign: 'left' }}>Team</th>
                    <th style={{ padding: '4px', textAlign: 'center' }}>R</th>
                    <th style={{ padding: '4px', textAlign: 'center' }}>H</th>
                    <th style={{ padding: '4px', textAlign: 'center' }}>E</th>
                    <th style={{ padding: '4px', textAlign: 'center' }}>BB</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px' }}>{selectedGame.awayTeamName}</td>
                    <td style={{ padding: '4px', textAlign: 'center', fontWeight: 'bold' }}>{selectedGame.awayScore}</td>
                    <td style={{ padding: '4px', textAlign: 'center' }}>{selectedGame.awayHits}</td>
                    <td style={{ padding: '4px', textAlign: 'center' }}>{selectedGame.awayErrors}</td>
                    <td style={{ padding: '4px', textAlign: 'center' }}>{selectedGame.awayWalks}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px' }}>{selectedGame.homeTeamName}</td>
                    <td style={{ padding: '4px', textAlign: 'center', fontWeight: 'bold' }}>{selectedGame.homeScore}</td>
                    <td style={{ padding: '4px', textAlign: 'center' }}>{selectedGame.homeHits}</td>
                    <td style={{ padding: '4px', textAlign: 'center' }}>{selectedGame.homeErrors}</td>
                    <td style={{ padding: '4px', textAlign: 'center' }}>{selectedGame.homeWalks}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Notable events */}
            {selectedGame.notableEvents.length > 0 && (
              <div>
                <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '6px' }}>Notable Events</div>
                {selectedGame.notableEvents.map((evt, i) => (
                  <div key={i} style={{ fontSize: '12px', padding: '4px 0', borderBottom: '1px solid #334155', color: '#e2e8f0' }}>
                    {/* §4.4: Text node only, never dangerouslySetInnerHTML */}
                    {evt.description}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
