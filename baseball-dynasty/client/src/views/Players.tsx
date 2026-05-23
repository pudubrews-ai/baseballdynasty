import { useState, useEffect } from 'react';
import { getPlayerLeaders, getPlayer, searchPlayers } from '../api.js';
import { useLeagueState } from '../hooks/useLeagueState.js';

interface StatLeader {
  id: number;
  first_name: string;
  last_name: string;
  team_name: string;
  value: number;
}

interface PlayerCard {
  id: number;
  firstName: string;
  lastName: string;
  age: number;
  position: string;
  overallRating: number;
  potential: string;
  potentialRevealed: boolean;
  teamName: string | null;
  contact: number;
  power: number;
  speed: number;
  fielding: number;
  arm: number;
  pitchingVelocity: number;
  pitchingControl: number;
  pitchingStamina: number;
  annualSalary: number;
  contractYearsRemaining: number;
  careerHits: number;
  careerHR: number;
  careerRBI: number;
  careerIP: number;
  careerK: number;
  careerWins: number;
}

interface Leaders {
  battingAvg?: StatLeader[];
  homeRuns?: StatLeader[];
  rbi?: StatLeader[];
  era?: StatLeader[];
  strikeouts?: StatLeader[];
  whip?: StatLeader[];
}

export default function Players() {
  const { state } = useLeagueState();
  const [leaders, setLeaders] = useState<Leaders>({});
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCard | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<unknown[]>([]);
  const [activeCategory, setActiveCategory] = useState<keyof Leaders>('battingAvg');

  useEffect(() => {
    getPlayerLeaders().then(data => setLeaders(data as Leaders)).catch(console.error);
  }, [state?.currentGameNumber]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    try {
      const results = await searchPlayers(q);
      setSearchResults(results);
    } catch { setSearchResults([]); }
  };

  const handlePlayerClick = async (playerId: number) => {
    try {
      const player = await getPlayer(playerId);
      setSelectedPlayer(player as PlayerCard);
    } catch (err) { console.error(err); }
  };

  const formatSalary = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

  const CATEGORIES: Array<{ key: keyof Leaders; label: string; format: (v: number) => string }> = [
    { key: 'battingAvg', label: 'AVG', format: v => (v ?? 0).toFixed(3) },
    { key: 'homeRuns', label: 'HR', format: v => String(v) },
    { key: 'rbi', label: 'RBI', format: v => String(v) },
    { key: 'era', label: 'ERA', format: v => (v ?? 0).toFixed(2) },
    { key: 'strikeouts', label: 'SO', format: v => String(v) },
    { key: 'whip', label: 'WHIP', format: v => (v ?? 0).toFixed(3) },
  ];

  const activeCat = CATEGORIES.find(c => c.key === activeCategory);
  const activeLeaders = leaders[activeCategory] ?? [];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Players</h2>

      {/* Search */}
      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search players..."
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          style={{
            background: '#1e293b', border: '1px solid #334155', color: 'white',
            padding: '8px 12px', borderRadius: '6px', width: '300px', fontSize: '14px'
          }}
        />
        {searchResults.length > 0 && (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', marginTop: '4px', maxWidth: '300px' }}>
            {(searchResults as Array<{ id: number; firstName: string; lastName: string; position: string; overallRating: number; teamName: string | null }>).map(p => (
              <button
                key={p.id}
                onClick={() => { handlePlayerClick(p.id); setSearchResults([]); }}
                style={{ display: 'block', width: '100%', background: 'transparent', border: 'none', color: 'white', padding: '6px 12px', textAlign: 'left', cursor: 'pointer', fontSize: '13px' }}
              >
                {p.firstName} {p.lastName} · {p.position} · {p.overallRating} OVR
                {p.teamName && <span style={{ color: '#64748b' }}> ({p.teamName})</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Stat leaders */}
        <div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                style={{
                  background: activeCategory === cat.key ? '#3b82f6' : '#334155',
                  color: 'white', border: 'none', padding: '4px 10px',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <table data-testid="player-leaders-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#94a3b8' }}>
                <th style={{ padding: '6px', textAlign: 'left' }}>#</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>Player</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>Team</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>{activeCat?.label}</th>
              </tr>
            </thead>
            <tbody>
              {activeLeaders.map((leader, idx) => (
                <tr
                  key={leader.id}
                  style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer' }}
                  onClick={() => handlePlayerClick(leader.id)}
                >
                  <td style={{ padding: '6px', color: '#64748b' }}>{idx + 1}</td>
                  <td style={{ padding: '6px' }}>{leader.first_name} {leader.last_name}</td>
                  <td style={{ padding: '6px', color: '#94a3b8', fontSize: '12px' }}>{leader.team_name}</td>
                  <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>
                    {activeCat?.format(leader.value)}
                  </td>
                </tr>
              ))}
              {activeLeaders.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '12px', color: '#64748b', textAlign: 'center' }}>No data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Player card */}
        {selectedPlayer && (
          <div
            data-testid={`player-card-${selectedPlayer.id}`}
            style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '4px' }}>
              {selectedPlayer.firstName} {selectedPlayer.lastName}
            </h3>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '12px' }}>
              {selectedPlayer.position} · Age {selectedPlayer.age}
              {selectedPlayer.teamName && <span> · {selectedPlayer.teamName}</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', marginBottom: '12px' }}>
              <div style={{ background: '#0f172a', borderRadius: '6px', padding: '8px' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>OVR</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#60a5fa' }}>{selectedPlayer.overallRating}</div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: '6px', padding: '8px' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Potential</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f59e0b' }}>
                  {selectedPlayer.potentialRevealed ? selectedPlayer.potential : '?'}
                </div>
              </div>
            </div>

            {/* Ratings */}
            {['SP', 'RP', 'CL'].includes(selectedPlayer.position) ? (
              <div style={{ fontSize: '12px' }}>
                {[
                  ['Velocity', selectedPlayer.pitchingVelocity],
                  ['Control', selectedPlayer.pitchingControl],
                  ['Stamina', selectedPlayer.pitchingStamina],
                ].map(([label, val]) => (
                  <div key={String(label)} style={{ marginBottom: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span style={{ color: '#94a3b8' }}>{label}</span><span>{val}</span>
                    </div>
                    <div style={{ background: '#334155', borderRadius: '2px', height: '4px' }}>
                      <div style={{ background: '#3b82f6', height: '100%', width: `${Number(val)}%`, borderRadius: '2px' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '12px' }}>
                {[
                  ['Contact', selectedPlayer.contact],
                  ['Power', selectedPlayer.power],
                  ['Speed', selectedPlayer.speed],
                  ['Fielding', selectedPlayer.fielding],
                  ['Arm', selectedPlayer.arm],
                ].map(([label, val]) => (
                  <div key={String(label)} style={{ marginBottom: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span style={{ color: '#94a3b8' }}>{label}</span><span>{val}</span>
                    </div>
                    <div style={{ background: '#334155', borderRadius: '2px', height: '4px' }}>
                      <div style={{ background: '#3b82f6', height: '100%', width: `${Number(val)}%`, borderRadius: '2px' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Career stats */}
            <div style={{ marginTop: '12px', fontSize: '12px', borderTop: '1px solid #334155', paddingTop: '8px' }}>
              <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Career</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
                <div>H: {selectedPlayer.careerHits}</div>
                <div>HR: {selectedPlayer.careerHR}</div>
                <div>RBI: {selectedPlayer.careerRBI}</div>
              </div>
            </div>

            {/* Contract */}
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>
              {formatSalary(selectedPlayer.annualSalary)} / yr · {selectedPlayer.contractYearsRemaining} yr remaining
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
