import { useState, useEffect } from 'react';
import { getPlayerLeaders, getPlayer, searchPlayers } from '../api.js';
import { useLeagueState } from '../hooks/useLeagueState.js';

// §2.6: Updated StatLeader interface to match new API shape {hitting, pitching}
interface StatLeader {
  player_name: string;
  team_name: string;
  stat_value: number;
  category: string;
}

interface PlayerCard {
  id: number;
  first_name: string;
  last_name: string;
  age: number;
  position: string;
  overall_rating: number;
  potential: string;
  potential_revealed: boolean;
  team_name: string | null;
  contact: number;
  power: number;
  speed: number;
  fielding: number;
  arm: number;
  pitching_velocity: number;
  pitching_control: number;
  pitching_stamina: number;
  annual_salary: number;
  contract_years_remaining: number;
  career_hits: number;
  career_hr: number;
  career_rbi: number;
  career_ip: number;
  career_k: number;
  career_wins: number;
}

// §2.6: Updated Leaders interface to match {hitting: [...], pitching: [...]}
interface Leaders {
  hitting: StatLeader[];
  pitching: StatLeader[];
}

export default function Players() {
  const { state } = useLeagueState();
  const [leaders, setLeaders] = useState<Leaders>({ hitting: [], pitching: [] });
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCard | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<unknown[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('AVG');

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

  // §2.6: CATEGORIES array with group and key fields
  const CATEGORIES: Array<{ key: string; label: string; format: (v: number) => string; group: 'hitting' | 'pitching' }> = [
    { key: 'AVG',  label: 'AVG',  format: v => (v ?? 0).toFixed(3), group: 'hitting' },
    { key: 'HR',   label: 'HR',   format: v => String(v),           group: 'hitting' },
    { key: 'RBI',  label: 'RBI',  format: v => String(v),           group: 'hitting' },
    { key: 'ERA',  label: 'ERA',  format: v => (v ?? 0).toFixed(2), group: 'pitching' },
    { key: 'K',    label: 'SO',   format: v => String(v),           group: 'pitching' },
    { key: 'WHIP', label: 'WHIP', format: v => (v ?? 0).toFixed(3), group: 'pitching' },
  ];

  // §2.6: Filter leaders by category key from hitting/pitching arrays
  const activeCat = CATEGORIES.find(c => c.key === activeCategory) ?? CATEGORIES[0]!;
  const activeLeaders: StatLeader[] = activeCat.group === 'hitting'
    ? leaders.hitting.filter(l => l.category === activeCat.key)
    : leaders.pitching.filter(l => l.category === activeCat.key);

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
            {(searchResults as Array<{ id: number; first_name: string; last_name: string; position: string; overall_rating: number; team_name: string | null }>).map(p => (
              <button
                key={p.id}
                onClick={() => { handlePlayerClick(p.id); setSearchResults([]); }}
                style={{ display: 'block', width: '100%', background: 'transparent', border: 'none', color: 'white', padding: '6px 12px', textAlign: 'left', cursor: 'pointer', fontSize: '13px' }}
              >
                {p.first_name} {p.last_name} · {p.position} · {p.overall_rating} OVR
                {p.team_name && <span style={{ color: '#64748b' }}> ({p.team_name})</span>}
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
              {/* §2.6: Render using new data shape */}
              {activeLeaders.map((leader, idx) => (
                <tr
                  key={`${leader.player_name}-${idx}`}
                  style={{ borderBottom: '1px solid #1e293b' }}
                >
                  <td style={{ padding: '6px', color: '#64748b' }}>{idx + 1}</td>
                  <td style={{ padding: '6px' }}>{leader.player_name}</td>
                  <td style={{ padding: '6px', color: '#94a3b8', fontSize: '12px' }}>{leader.team_name}</td>
                  <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>
                    {activeCat.format(leader.stat_value)}
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
              {selectedPlayer.first_name} {selectedPlayer.last_name}
            </h3>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '12px' }}>
              {selectedPlayer.position} · Age {selectedPlayer.age}
              {selectedPlayer.team_name && <span> · {selectedPlayer.team_name}</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', marginBottom: '12px' }}>
              <div style={{ background: '#0f172a', borderRadius: '6px', padding: '8px' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>OVR</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#60a5fa' }}>{selectedPlayer.overall_rating}</div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: '6px', padding: '8px' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Potential</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f59e0b' }}>
                  {selectedPlayer.potential_revealed ? selectedPlayer.potential : '?'}
                </div>
              </div>
            </div>

            {/* Ratings */}
            {['SP', 'RP', 'CL'].includes(selectedPlayer.position) ? (
              <div style={{ fontSize: '12px' }}>
                {[
                  ['Velocity', selectedPlayer.pitching_velocity],
                  ['Control', selectedPlayer.pitching_control],
                  ['Stamina', selectedPlayer.pitching_stamina],
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
                <div>H: {selectedPlayer.career_hits}</div>
                <div>HR: {selectedPlayer.career_hr}</div>
                <div>RBI: {selectedPlayer.career_rbi}</div>
              </div>
            </div>

            {/* Contract */}
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>
              {formatSalary(selectedPlayer.annual_salary)} / yr · {selectedPlayer.contract_years_remaining} yr remaining
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
