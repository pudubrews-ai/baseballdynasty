// Hall of Fame view — v0.4.0
// data-testids: halloffame-browser, halloffame-inductee-{playerId}, halloffame-filter-position,
//               halloffame-filter-era, halloffame-manager-wing

import { useState, useEffect } from 'react';

interface HofInductee {
  id: number;
  player_id: number;
  player_name: string;
  induction_season: number;
  vote_share: number;
  veterans_committee: number;
  ped_flag: number;
  wing: string;
  memorial: number;
  career_stats_at_induction: string | null;
}

export default function HallOfFame() {
  const [inductees, setInductees] = useState<HofInductee[]>([]);
  const [filterPosition, setFilterPosition] = useState('');
  const [filterEra, setFilterEra] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/halloffame')
      .then(r => r.ok ? r.json() : [])
      .then((data: HofInductee[]) => {
        setInductees(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const playerInductees = inductees.filter(i => i.wing === 'player');
  const managerGmInductees = inductees.filter(i => i.wing !== 'player');

  const filteredPlayers = playerInductees.filter(i => {
    if (filterEra && i.induction_season) {
      const era = Math.ceil(i.induction_season / 5) * 5;
      if (String(era) !== filterEra) return false;
    }
    // Position filter — we'd need position from career_stats JSON
    if (filterPosition) {
      try {
        const stats = i.career_stats_at_induction ? JSON.parse(i.career_stats_at_induction) as Record<string, unknown> : null;
        if (stats && stats['position'] !== filterPosition) return false;
      } catch { /* no stats */ }
    }
    return true;
  });

  const eras = [...new Set(playerInductees.map(i => String(Math.ceil(i.induction_season / 5) * 5)))].sort();
  const positions = ['SP', 'RP', 'CL', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

  return (
    <div style={{ fontFamily: 'system-ui', color: '#e2e8f0' }}>
      <h2 style={{ marginTop: 0, color: '#f59e0b' }}>Hall of Fame</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
        <label style={{ color: '#94a3b8', fontSize: '13px' }}>
          Position:
          <select
            data-testid="halloffame-filter-position"
            value={filterPosition}
            onChange={e => setFilterPosition(e.target.value)}
            style={{ marginLeft: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '4px', padding: '4px' }}
          >
            <option value="">All</option>
            {positions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label style={{ color: '#94a3b8', fontSize: '13px' }}>
          Era:
          <select
            data-testid="halloffame-filter-era"
            value={filterEra}
            onChange={e => setFilterEra(e.target.value)}
            style={{ marginLeft: '6px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '4px', padding: '4px' }}
          >
            <option value="">All</option>
            {eras.map(era => <option key={era} value={era}>Season {parseInt(era) - 4}–{era}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading...</p>
      ) : (
        <>
          {/* Player wing */}
          <div
            data-testid="halloffame-browser"
            style={{ background: '#1e293b', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}
          >
            <h3 style={{ marginTop: 0, color: '#f59e0b' }}>Players ({filteredPlayers.length})</h3>
            {filteredPlayers.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '13px' }}>No inductees yet</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {filteredPlayers.map(inductee => {
                  let statsObj: Record<string, unknown> | null = null;
                  try {
                    statsObj = inductee.career_stats_at_induction ? JSON.parse(inductee.career_stats_at_induction) as Record<string, unknown> : null;
                  } catch { /* ignore */ }
                  return (
                    <div
                      key={inductee.player_id}
                      data-testid={`halloffame-inductee-${inductee.player_id}`}
                      style={{
                        background: '#0f172a',
                        border: inductee.memorial === 1 ? '2px solid #6b7280' : '1px solid #334155',
                        borderRadius: '6px',
                        padding: '12px',
                      }}
                    >
                      <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
                        {inductee.player_name}
                        {inductee.ped_flag === 1 && (
                          <span style={{ color: '#f87171', fontSize: '11px', marginLeft: '6px' }}>[PED]</span>
                        )}
                        {inductee.memorial === 1 && (
                          <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '6px' }}>[Memorial]</span>
                        )}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                        Inducted Season {inductee.induction_season}
                        {inductee.veterans_committee === 1 && (
                          <span style={{ color: '#a78bfa', marginLeft: '6px' }}>— Veterans Committee</span>
                        )}
                      </div>
                      {inductee.vote_share > 0 && (
                        <div style={{ color: '#60a5fa', fontSize: '12px' }}>
                          Vote Share: {inductee.vote_share.toFixed(1)}%
                        </div>
                      )}
                      {statsObj && (
                        <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>
                          {Object.entries(statsObj).map(([k, v]) => (
                            <span key={k} style={{ marginRight: '8px' }}>{k}: {String(v)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Manager/GM wing — always rendered (testid must be present in DOM per spec §3 / P2.3) */}
          <div
            data-testid="halloffame-manager-wing"
            style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}
          >
            <h3 style={{ marginTop: 0, color: '#a78bfa' }}>Managers &amp; GMs</h3>
            {managerGmInductees.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '13px' }}>No manager inductees yet</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
                {managerGmInductees.map(inductee => (
                  <div
                    key={inductee.player_id}
                    data-testid={`halloffame-inductee-${inductee.player_id}`}
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', padding: '10px' }}
                  >
                    <div style={{ fontWeight: 'bold' }}>{inductee.player_name}</div>
                    <div style={{ color: '#a78bfa', fontSize: '12px' }}>{inductee.wing}</div>
                    <div style={{ color: '#94a3b8', fontSize: '12px' }}>Inducted Season {inductee.induction_season}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
