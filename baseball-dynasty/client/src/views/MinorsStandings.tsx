// MinorsStandings view — Step 9 (v0.4.0)
// Shows league-wide minor league standings for all 4 levels.
// data-testids: minors-standings-AAA, minors-standings-AA, minors-standings-A, minors-standings-Rookie
// Also shows prospects leaderboard (top 50) with prospects-leaderboard, prospect-row-{playerId}

import { useEffect, useState } from 'react';
import { getMinorsStandings, getProspects } from '../api.js';

interface StandingsRow {
  team_id: number;
  team_name: string;
  wins: number;
  losses: number;
  pct: number;
  gb: number;
}

interface MinorsStandingsData {
  AAA: StandingsRow[];
  AA: StandingsRow[];
  A: StandingsRow[];
  Rookie: StandingsRow[];
}

interface ProspectRow {
  rank: number;
  player_id: number;
  name: string;
  position: string;
  age: number;
  level: string | null;
  team_name: string | null;
  overall: number;
  potential: string;
}

const LEVELS: Array<keyof MinorsStandingsData> = ['AAA', 'AA', 'A', 'Rookie'];

export default function MinorsStandings() {
  const [standings, setStandings] = useState<MinorsStandingsData | null>(null);
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [activeView, setActiveView] = useState<'standings' | 'prospects'>('standings');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getMinorsStandings(), getProspects()])
      .then(([s, p]) => {
        setStandings(s as MinorsStandingsData);
        setProspects(p as ProspectRow[]);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  if (loading) return <p style={{ color: '#94a3b8', padding: '12px' }}>Loading minors data...</p>;
  if (error) return <p style={{ color: '#ef4444', padding: '12px' }}>Error: {error}</p>;

  const containerStyle: React.CSSProperties = {
    padding: '12px',
    color: '#e2e8f0',
    maxWidth: '900px',
  };

  const levelBlockStyle: React.CSSProperties = {
    marginBottom: '20px',
    background: '#1e293b',
    borderRadius: '6px',
    padding: '10px',
  };

  const headerStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#60a5fa',
    marginBottom: '8px',
    borderBottom: '1px solid #334155',
    paddingBottom: '4px',
  };

  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 3rem 3rem 3.5rem 3rem',
    fontSize: '12px',
    padding: '3px 0',
    gap: '4px',
    borderBottom: '1px solid #1e293b',
  };

  const colHeaderStyle: React.CSSProperties = {
    ...rowStyle,
    color: '#64748b',
    fontWeight: 'bold',
    borderBottom: '1px solid #334155',
  };

  return (
    <div style={containerStyle}>
      <h2 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '12px', color: '#f1f5f9' }}>
        Minor Leagues
      </h2>

      {/* Toggle between standings and prospects */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        <button
          onClick={() => setActiveView('standings')}
          style={{
            background: activeView === 'standings' ? '#3b82f6' : '#334155',
            color: 'white', border: 'none', padding: '4px 10px',
            borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
          }}
        >
          Standings
        </button>
        <button
          onClick={() => setActiveView('prospects')}
          style={{
            background: activeView === 'prospects' ? '#3b82f6' : '#334155',
            color: 'white', border: 'none', padding: '4px 10px',
            borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
          }}
        >
          Top Prospects
        </button>
      </div>

      {activeView === 'standings' && (
        <>
          {LEVELS.map(level => {
            const rows = standings?.[level] ?? [];
            return (
              <div
                key={level}
                data-testid={`minors-standings-${level}`}
                style={levelBlockStyle}
              >
                <div style={headerStyle}>{level}</div>
                {rows.length === 0 ? (
                  <p style={{ color: '#64748b', fontSize: '12px' }}>No data yet</p>
                ) : (
                  <>
                    <div style={colHeaderStyle}>
                      <span>Team</span>
                      <span>W</span>
                      <span>L</span>
                      <span>PCT</span>
                      <span>GB</span>
                    </div>
                    {rows.map(row => (
                      <div key={row.team_id} style={rowStyle}>
                        <span>{row.team_name}</span>
                        <span>{row.wins}</span>
                        <span>{row.losses}</span>
                        <span>{row.pct.toFixed(3).replace('0.', '.')}</span>
                        <span>{row.gb === 0 ? '-' : row.gb.toFixed(1)}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </>
      )}

      {activeView === 'prospects' && (
        <div data-testid="prospects-leaderboard" style={levelBlockStyle}>
          <div style={headerStyle}>Top 50 Prospects</div>
          {prospects.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '12px' }}>No prospects ranked yet</p>
          ) : (
            <>
              <div style={{ ...colHeaderStyle, gridTemplateColumns: '2rem 1fr 3rem 2rem 3rem 3rem 3rem 3rem' }}>
                <span>#</span>
                <span>Name</span>
                <span>Pos</span>
                <span>Age</span>
                <span>Level</span>
                <span>OVR</span>
                <span>POT</span>
                <span>Team</span>
              </div>
              {prospects.map(p => (
                <div
                  key={p.player_id}
                  data-testid={`prospect-row-${p.player_id}`}
                  style={{
                    ...rowStyle,
                    gridTemplateColumns: '2rem 1fr 3rem 2rem 3rem 3rem 3rem 3rem',
                  }}
                >
                  <span style={{ color: '#64748b' }}>{p.rank}</span>
                  <span>{p.name}</span>
                  <span>{p.position}</span>
                  <span>{p.age}</span>
                  <span>{p.level ?? '—'}</span>
                  <span>{p.overall}</span>
                  <span
                    style={{
                      color: p.potential === 'A' ? '#10b981'
                        : p.potential === 'B' ? '#3b82f6'
                        : p.potential === 'C' ? '#f59e0b'
                        : '#94a3b8',
                    }}
                  >
                    {p.potential}
                  </span>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>
                    {p.team_name ?? 'FA'}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
