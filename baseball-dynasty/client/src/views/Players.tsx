import { useState, useEffect } from 'react';
import { getPlayerLeaders, getPlayer, searchPlayers, getProspects } from '../api.js';
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
  // P5: personality / v0.4.0 fields
  trade_demand_active?: boolean;
  memorial?: boolean;
  gambling_ban?: boolean;
  ped_offenses?: number;
  retired_number?: number | null;
}

// §2.6: Updated Leaders interface to match {hitting: [...], pitching: [...]}
interface Leaders {
  hitting: StatLeader[];
  pitching: StatLeader[];
}

// P2.2: Top Prospects interface for Players tab
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

export default function Players() {
  const { state } = useLeagueState();
  const [leaders, setLeaders] = useState<Leaders>({ hitting: [], pitching: [] });
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCard | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<unknown[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('AVG');
  const [showProspects, setShowProspects] = useState(false);

  useEffect(() => {
    getPlayerLeaders().then(data => setLeaders(data as Leaders)).catch(console.error);
    getProspects().then(data => setProspects(data as ProspectRow[])).catch(console.error);
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
      {/* P2.2: Top Prospects toggle — additive to stat leaders */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          onClick={() => setShowProspects(false)}
          style={{ background: !showProspects ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
        >
          Stat Leaders
        </button>
        <button
          onClick={() => setShowProspects(true)}
          style={{ background: showProspects ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
        >
          Top Prospects
        </button>
      </div>

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
        {/* Stat leaders / Top Prospects */}
        <div>
          {!showProspects ? (
            <>
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
            </>
          ) : (
            /* P2.2: Top Prospects leaderboard in Players tab */
            <div data-testid="prospects-leaderboard">
              <h3 style={{ marginTop: 0, marginBottom: '8px', fontSize: '14px', color: '#f1f5f9' }}>
                Top 50 Prospects
              </h3>
              {prospects.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '13px' }}>No prospects ranked yet</p>
              ) : (
                <div style={{ fontSize: '12px' }}>
                  {prospects.map(p => (
                    <div
                      key={p.player_id}
                      data-testid={`prospect-row-${p.player_id}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2rem 1fr 3rem 2rem 3rem 3rem 3rem 3rem',
                        padding: '3px 0',
                        borderBottom: '1px solid #1e293b',
                        gap: '4px',
                      }}
                    >
                      <span style={{ color: '#64748b' }}>{p.rank}</span>
                      <span>{p.name}</span>
                      <span style={{ color: '#94a3b8' }}>{p.position}</span>
                      <span>{p.age}</span>
                      <span style={{ color: '#60a5fa' }}>{p.level ?? '—'}</span>
                      <span>{p.overall}</span>
                      <span style={{
                        color: p.potential === 'A' ? '#10b981'
                          : p.potential === 'B' ? '#3b82f6'
                          : p.potential === 'C' ? '#f59e0b'
                          : '#94a3b8',
                      }}>
                        {p.potential}
                      </span>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>{p.team_name ?? 'FA'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Player card */}
        {selectedPlayer && (
          <div
            data-testid={`player-card-${selectedPlayer.id}`}
            style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '4px' }}>
              {selectedPlayer.memorial && <span style={{ color: '#9ca3af', fontSize: '14px', marginRight: '6px' }}>✝</span>}
              {selectedPlayer.first_name} {selectedPlayer.last_name}
              {selectedPlayer.retired_number != null && (
                <span style={{ color: '#f59e0b', fontSize: '12px', marginLeft: '6px' }}>#{selectedPlayer.retired_number} (Retired)</span>
              )}
            </h3>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '12px' }}>
              {selectedPlayer.position} · Age {selectedPlayer.age}
              {selectedPlayer.team_name && <span> · {selectedPlayer.team_name}</span>}
            </div>
            {/* P5: trade demand badge (spec §9) */}
            {selectedPlayer.trade_demand_active && (
              <div
                data-testid="player-trade-demand-badge"
                style={{
                  display: 'inline-block',
                  background: '#7c3aed22', border: '1px solid #7c3aed',
                  color: '#a78bfa', fontSize: '11px', fontWeight: 700,
                  padding: '2px 8px', borderRadius: '4px', marginBottom: '8px',
                }}
              >
                TRADE DEMAND
              </div>
            )}
            {/* NF-5: gambling ban overlay marker */}
            {selectedPlayer.gambling_ban && (
              <div style={{
                display: 'inline-block', background: '#dc262622', border: '1px solid #dc2626',
                color: '#f87171', fontSize: '11px', fontWeight: 700,
                padding: '2px 8px', borderRadius: '4px', marginBottom: '8px', marginLeft: '4px',
              }}>
                [GAMBLING BAN]
              </div>
            )}
            {/* NF-5: PED flag */}
            {(selectedPlayer.ped_offenses ?? 0) > 0 && (
              <div style={{
                display: 'inline-block', background: '#d9770622', border: '1px solid #d97706',
                color: '#fbbf24', fontSize: '11px', fontWeight: 700,
                padding: '2px 8px', borderRadius: '4px', marginBottom: '8px', marginLeft: '4px',
              }}>
                [PED ×{selectedPlayer.ped_offenses}]
              </div>
            )}

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
