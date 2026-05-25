import { useState, useEffect } from 'react';
import { getTeams, getTeam, getTeamRoster, getTeamMinors, getTeamHistory, getTeamFinancials } from '../api.js';
import { useLeagueState } from '../hooks/useLeagueState.js';

interface WaiverEntry {
  player_id: number;
  player_name: string;
  position: string;
  overall_rating: number;
  claim_window_games_remaining: number;
  dfa_team_name: string;
}

function WaiversPanel() {
  const [waivers, setWaivers] = useState<WaiverEntry[]>([]);
  const { state } = useLeagueState();

  // §3.2: Re-fetch waivers whenever lastNewsId advances (sim state changes)
  useEffect(() => {
    fetch('/api/waivers')
      .then(r => r.ok ? r.json() : [])
      .then((data: WaiverEntry[]) => setWaivers(data))
      .catch(() => {});
  }, [state?.lastNewsId]);

  return (
    <div style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0, marginBottom: '8px', fontSize: '14px', color: '#f59e0b' }}>Waiver Wire</h3>
      <div data-testid="waivers-list" style={{ background: '#0f172a', borderRadius: '6px', padding: '8px' }}>
        {waivers.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: '12px', padding: '8px' }}>No players on waivers</div>
        ) : (
          waivers.map(w => (
            <div
              key={w.player_id}
              data-testid={`waiver-player-${w.player_id}`}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1e293b', fontSize: '12px' }}
            >
              <span>{w.player_name}</span>
              <span style={{ color: '#94a3b8' }}>{w.position}</span>
              <span style={{ color: '#60a5fa' }}>{w.overall_rating}</span>
              <span style={{ color: '#64748b' }}>DFA'd by {w.dfa_team_name} ({w.claim_window_games_remaining}g left)</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface TeamSummary {
  id: number;
  name: string;
  city: string;
  region: string;
  conference: string;
  division: string;
  wins: number;
  losses: number;
  market_size: string;
  color: string;
}

// §1.4.4: snake_case to match API response
interface TeamDetail extends TeamSummary {
  gm_name: string;
  gm_personality: {
    philosophy: string;
    risk_tolerance: string;
    focus: string;
  };
  manager_name: string;
  owner_name: string;
  owner_personality: string;
  owner_patience: number;
  owner_net_worth_tier: string;
  payroll_budget: number;
  current_payroll: number;
  revenue: number;
  gm_hired_context: string | null;
  manager_hired_context: string | null;
  front_office_history: Array<{
    id: number;
    event_type: string;
    departing_person: string | null;
    incoming_person: string | null;
    reason: string | null;
    hired_person_context: string | null;
    season_number: number;
  }>;
  // Step 13: chemistry (server-only)
  chemistry_score?: number;
}

type TeamTab = 'roster' | 'minors' | 'financials' | 'history';

export default function Teams() {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teamDetail, setTeamDetail] = useState<TeamDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TeamTab>('roster');
  // §1.4.1: tabData accepts either array or object
  const [tabData, setTabData] = useState<unknown>([]);

  useEffect(() => {
    getTeams().then(data => setTeams(data as TeamSummary[])).catch(console.error);
  }, []);

  const handleTeamClick = async (teamId: number) => {
    setSelectedTeamId(teamId);
    setActiveTab('roster');
    try {
      const detail = await getTeam(teamId);
      setTeamDetail(detail as TeamDetail);
      const roster = await getTeamRoster(teamId);
      setTabData(roster);
    } catch (err) {
      console.error(err);
    }
  };

  const handleTabChange = async (tab: TeamTab) => {
    setActiveTab(tab);
    if (!selectedTeamId) return;
    try {
      switch (tab) {
        case 'roster': setTabData(await getTeamRoster(selectedTeamId)); break;
        case 'minors': setTabData(await getTeamMinors(selectedTeamId)); break;
        case 'history': setTabData(await getTeamHistory(selectedTeamId)); break;
        case 'financials': setTabData(await getTeamFinancials(selectedTeamId)); break;
      }
    } catch (err) {
      console.error(err);
    }
  };

  const formatMoney = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
      {/* Team grid + Waivers */}
      <div>
        <h2 style={{ marginTop: 0 }}>Teams</h2>
        <div data-testid="team-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {teams.map(team => (
            <button
              key={team.id}
              data-testid={`team-card-${team.id}`}
              onClick={() => handleTeamClick(team.id)}
              style={{
                background: selectedTeamId === team.id ? team.color || '#1e3a5f' : '#1e293b',
                border: `2px solid ${team.color || '#334155'}`,
                borderRadius: '8px',
                padding: '10px',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'white',
              }}
            >
              <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{team.city}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>{team.name}</div>
              <div style={{ fontSize: '11px', marginTop: '4px' }}>{team.wins}W-{team.losses}L</div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>{team.division}</div>
            </button>
          ))}
        </div>
        <WaiversPanel />
      </div>

      {/* Team detail panel */}
      {teamDetail && (
        <div data-testid="team-detail-panel" style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
          <h3 style={{ marginTop: 0, color: teamDetail.color }}>
            {teamDetail.city} {teamDetail.name}
          </h3>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>
            <div>{teamDetail.division}</div>
            <div style={{ color: '#60a5fa' }}>{teamDetail.wins}W - {teamDetail.losses}L</div>
          </div>

          {/* M8: Owner info block */}
          <div style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '12px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
            <div data-testid="owner-name">Owner: {teamDetail.owner_name}</div>
            <div data-testid="owner-personality">Personality: {teamDetail.owner_personality}</div>
            <div data-testid="owner-patience">Patience: {teamDetail.owner_patience}/10</div>
            <div data-testid="owner-net-worth-tier">Net Worth: {teamDetail.owner_net_worth_tier}</div>
            {/* P5: team-chemistry-score testid (spec §9 / dev-instructions-2 P5) */}
            <div
              data-testid="team-chemistry-score"
              style={{ color: (teamDetail.chemistry_score ?? 50) < 25 ? '#ef4444' : (teamDetail.chemistry_score ?? 50) >= 75 ? '#10b981' : '#94a3b8' }}
            >
              Chemistry: {teamDetail.chemistry_score ?? 50}/100
            </div>
            {teamDetail.gm_hired_context && (
              <div data-testid="gm-hire-context" style={{ color: '#94a3b8' }}>GM: {teamDetail.gm_name} — {teamDetail.gm_hired_context}</div>
            )}
            {teamDetail.manager_hired_context && (
              <div data-testid="manager-hire-context" style={{ color: '#94a3b8' }}>Manager: {teamDetail.manager_name} — {teamDetail.manager_hired_context}</div>
            )}
          </div>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
            <button
              data-testid="team-roster-tab"
              onClick={() => handleTabChange('roster')}
              style={{ background: activeTab === 'roster' ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
            >Roster</button>
            <button
              data-testid="team-minors-tab"
              onClick={() => handleTabChange('minors')}
              style={{ background: activeTab === 'minors' ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
            >Minors</button>
            <button
              data-testid="team-financials-tab"
              onClick={() => handleTabChange('financials')}
              style={{ background: activeTab === 'financials' ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
            >Financials</button>
            <button
              data-testid="team-history-tab"
              onClick={() => handleTabChange('history')}
              style={{ background: activeTab === 'history' ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
            >History</button>
          </div>

          {/* Tab content */}
          {/* §1.4.3: snake_case field names to match API */}
          {activeTab === 'roster' && (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {Array.isArray(tabData) && (tabData as Array<{ id: number; first_name: string; last_name: string; position: string; overall_rating: number; annual_salary: number }>).map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155', fontSize: '12px' }}>
                  <span>{p.first_name} {p.last_name}</span>
                  <span style={{ color: '#94a3b8' }}>{p.position}</span>
                  <span style={{ color: '#60a5fa' }}>{p.overall_rating}</span>
                </div>
              ))}
            </div>
          )}

          {/* §1.4.2: Rewrite minors tab to consume {AAA, AA, A, Rookie} grouped object */}
          {activeTab === 'minors' && (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {(() => {
                interface MinorPlayer {
                  id: number;
                  first_name: string;
                  last_name: string;
                  position: string;
                  overall_rating: number;
                  season_stats?: {
                    games_played?: number;
                    at_bats?: number;
                    hits?: number;
                    home_runs?: number;
                    era?: number;
                    k?: number;
                    ip?: number;
                    battingAvg?: number;
                  };
                }
                const minors = (tabData ?? {}) as Record<string, MinorPlayer[]>;
                const levels: Array<'AAA' | 'AA' | 'A' | 'Rookie'> = ['AAA', 'AA', 'A', 'Rookie'];
                const hasAny = levels.some(lvl => Array.isArray(minors[lvl]) && minors[lvl]!.length > 0);
                if (!hasAny) return <p style={{ color: '#64748b', fontSize: '12px' }}>No minor league depth yet</p>;
                const isPitcher = (pos: string) => pos === 'SP' || pos === 'CL' || pos === 'RP';
                return levels.map(level => {
                  const players = Array.isArray(minors[level]) ? minors[level]! : [];
                  if (players.length === 0) return null;
                  return (
                    <div key={level} style={{ marginBottom: '8px' }}>
                      <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>{level}</div>
                      {players.map(p => {
                        const ss = p.season_stats;
                        const pit = isPitcher(p.position);
                        return (
                          <div key={p.id} data-testid={`minors-stats-${p.id}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155', fontSize: '12px', gap: '4px' }}>
                            <span style={{ flex: 2 }}>{p.first_name} {p.last_name}</span>
                            <span style={{ color: '#94a3b8', flex: 1 }}>{p.position}</span>
                            <span style={{ color: '#60a5fa', flex: 1 }}>{p.overall_rating}</span>
                            {pit ? (
                              <>
                                <span style={{ color: '#94a3b8', flex: 1 }} title="ERA">{ss?.era !== undefined ? Number(ss.era).toFixed(2) : '—'}</span>
                                <span style={{ color: '#94a3b8', flex: 1 }} title="K">{ss?.k ?? '—'}K</span>
                                <span style={{ color: '#94a3b8', flex: 1 }} title="IP">{ss?.ip !== undefined ? Number(ss.ip).toFixed(1) : '—'}IP</span>
                              </>
                            ) : (
                              <>
                                <span style={{ color: '#94a3b8', flex: 1 }} title="AVG">{ss?.battingAvg !== undefined ? Number(ss.battingAvg).toFixed(3).replace('0.', '.') : (ss?.at_bats && ss.at_bats > 0 ? (((ss.hits ?? 0) / ss.at_bats)).toFixed(3).replace('0.', '.') : '—')}</span>
                                <span style={{ color: '#94a3b8', flex: 1 }} title="HR">{ss?.home_runs ?? '—'}HR</span>
                                <span style={{ color: '#94a3b8', flex: 1 }} title="G">{ss?.games_played ?? '—'}G</span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* §1.4.4: snake_case field names for financials */}
          {/* P2.5/P2.6: All testid containers always rendered when financials tab active */}
          {activeTab === 'financials' && (() => {
            interface FinancialsData {
              revenue_history: Array<{ season_number: number; revenue: number; attendance_avg: number; payroll_actual: number; payroll_budget: number; luxury_tax_paid: number }>;
              franchise_value: number;
              relocation_threat_active: boolean;
            }
            const fin = (tabData && typeof tabData === 'object' && !Array.isArray(tabData) && 'revenue_history' in (tabData as object))
              ? (tabData as FinancialsData)
              : null;
            const BAR_MAX_W = 120;
            const revMax = fin && fin.revenue_history.length > 0 ? Math.max(...fin.revenue_history.map(r => r.revenue), 1) : 1;
            return (
              <div style={{ fontSize: '13px', maxHeight: '400px', overflowY: 'auto' }}>
                {/* Current financials from teamDetail */}
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>Revenue: </span>
                  <span style={{ color: '#4ade80' }}>{formatMoney(teamDetail.revenue)}</span>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>Payroll Budget: </span>
                  <span>{formatMoney(teamDetail.payroll_budget)}</span>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>Current Payroll: </span>
                  <span style={{ color: teamDetail.current_payroll > teamDetail.payroll_budget ? '#f87171' : '#4ade80' }}>
                    {formatMoney(teamDetail.current_payroll)}
                  </span>
                </div>
                {/* P2.6: franchise-value-display always rendered when financials tab active */}
                <div data-testid="franchise-value-display" style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#94a3b8' }}>Franchise Value: </span>
                  {fin ? (
                    <span style={{ color: '#f59e0b' }}>${fin.franchise_value}M</span>
                  ) : (
                    <span style={{ color: '#64748b' }}>—</span>
                  )}
                  {fin?.relocation_threat_active && (
                    <span data-testid="relocation-threat-banner" style={{ marginLeft: '8px', color: '#f87171', fontSize: '11px', fontWeight: 'bold' }}>
                      RELOCATION THREAT
                    </span>
                  )}
                </div>
                {/* Revenue history chart — containers always rendered per spec P2.5 */}
                <div style={{ marginTop: '12px', borderTop: '1px solid #334155', paddingTop: '8px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '6px' }}>Revenue History</div>
                  <div data-testid="financials-revenue-chart" style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', minHeight: '20px' }}>
                    {fin && fin.revenue_history.length > 0 ? fin.revenue_history.map(r => (
                      <div key={r.season_number} title={`S${r.season_number}: ${formatMoney(r.revenue)}`}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ width: '12px', background: '#3b82f6', height: `${Math.round((r.revenue / revMax) * BAR_MAX_W)}px` }} />
                        <div style={{ fontSize: '9px', color: '#64748b' }}>{r.season_number}</div>
                      </div>
                    )) : <span style={{ color: '#64748b', fontSize: '11px' }}>No data yet</span>}
                  </div>
                  <div data-testid="financials-attendance-chart" style={{ marginTop: '8px', color: '#94a3b8', fontSize: '11px' }}>
                    Attendance History
                  </div>
                  {fin && fin.revenue_history.map(r => (
                    <div key={r.season_number}
                      style={{ fontSize: '11px', color: '#64748b' }}>
                      S{r.season_number}: {r.attendance_avg.toLocaleString()} avg
                    </div>
                  ))}
                  {(!fin || fin.revenue_history.length === 0) && (
                    <div style={{ fontSize: '11px', color: '#64748b' }}>No data yet</div>
                  )}
                  <div data-testid="financials-payroll-chart" style={{ marginTop: '8px', color: '#94a3b8', fontSize: '11px' }}>
                    Payroll vs Budget History
                  </div>
                  {fin && fin.revenue_history.map(r => (
                    <div key={r.season_number}
                      style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                      <span>S{r.season_number}</span>
                      <span>{formatMoney(r.payroll_actual)} / {formatMoney(r.payroll_budget)}</span>
                    </div>
                  ))}
                  {(!fin || fin.revenue_history.length === 0) && (
                    <div style={{ fontSize: '11px', color: '#64748b' }}>No data yet</div>
                  )}
                  <div data-testid="financials-luxury-tax" style={{ marginTop: '8px', color: '#94a3b8', fontSize: '11px' }}>
                    Luxury Tax
                  </div>
                  {fin && fin.revenue_history.filter(r => r.luxury_tax_paid > 0).map(r => (
                    <div key={r.season_number} style={{ fontSize: '11px', color: '#f87171' }}>
                      S{r.season_number}: {formatMoney(r.luxury_tax_paid)}
                    </div>
                  ))}
                  {(!fin || fin.revenue_history.every(r => !r.luxury_tax_paid)) && (
                    <div style={{ fontSize: '11px', color: '#64748b' }}>None</div>
                  )}
                </div>
                <div style={{ marginTop: '12px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
                  <div style={{ marginBottom: '6px' }}>GM: {teamDetail.gm_name}</div>
                  <div style={{ marginBottom: '6px', color: '#94a3b8', fontSize: '12px' }}>
                    {teamDetail.gm_personality?.philosophy} / {teamDetail.gm_personality?.risk_tolerance} / {teamDetail.gm_personality?.focus}
                  </div>
                  <div style={{ marginBottom: '6px' }}>Manager: {teamDetail.manager_name}</div>
                  <div>Owner: {teamDetail.owner_name}</div>
                </div>
              </div>
            );
          })()}

          {/* P2.4: History tab — franchise-championships and franchise-stat-leaders always rendered */}
          {activeTab === 'history' && (() => {
            interface HistoryData {
              season_records: Array<{ season_number: number; wins: number; losses: number; division_finish: number | null; playoff_round: string; won_championship: boolean; city_label: string | null }>;
              manager_history: Array<{ name: string; tenure_seasons: number; record: { wins: number; losses: number }; reason: string | null; interim: boolean }>;
              gm_history: Array<{ name: string; tenure_seasons: number; record: { wins: number; losses: number }; reason: string | null; interim: boolean }>;
              owner_history: Array<{ name: string; era_start: number; era_end: number | string; exit_reason: string }>;
              championships: Array<{ season: number; manager_name: string | null; gm_name: string | null }>;
              stat_leaders: { most_hr: { name: string; value: number } | null; most_hits: { name: string; value: number } | null; most_wins: { name: string; value: number } | null; lowest_era: { name: string; value: number } | null };
            }
            const hist = (tabData && typeof tabData === 'object' && !Array.isArray(tabData) && 'season_records' in (tabData as object))
              ? (tabData as HistoryData)
              : null;
            return (
              <div style={{ maxHeight: '450px', overflowY: 'auto', fontSize: '12px' }}>
                {/* Season records */}
                {hist && hist.season_records.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>Season Records</div>
                    {hist.season_records.map(r => (
                      <div key={r.season_number}
                        data-testid={`franchise-season-row-${r.season_number}`}
                        style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #334155' }}>
                        <span>{r.city_label ? `[${r.city_label}] ` : ''}S{r.season_number}</span>
                        <span>{r.wins}W-{r.losses}L</span>
                        <span style={{ color: r.won_championship ? '#f59e0b' : '#64748b' }}>
                          {r.won_championship ? 'Champion' : r.playoff_round !== 'missed' ? `${r.playoff_round}` : 'Missed playoffs'}
                        </span>
                        {r.division_finish && <span style={{ color: '#94a3b8' }}>Div {r.division_finish}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Championships — always rendered per spec P2.4 */}
                <div data-testid="franchise-championships" style={{ marginBottom: '12px' }}>
                  <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>Championships</div>
                  {hist && hist.championships.length > 0 ? hist.championships.map(c => (
                    <div key={c.season} style={{ padding: '3px 0', borderBottom: '1px solid #334155' }}>
                      <span>Season {c.season}</span>
                      {c.manager_name && <span style={{ color: '#94a3b8', marginLeft: '8px' }}>Mgr: {c.manager_name}</span>}
                      {c.gm_name && <span style={{ color: '#94a3b8', marginLeft: '8px' }}>GM: {c.gm_name}</span>}
                    </div>
                  )) : (
                    <div style={{ color: '#64748b' }}>No championships yet</div>
                  )}
                </div>
                {/* Manager history */}
                {hist && hist.manager_history.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: '#60a5fa', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>Manager History</div>
                    {hist.manager_history.map((m, i) => (
                      <div key={i} data-testid={`franchise-manager-row-${m.name}`} style={{ padding: '3px 0', borderBottom: '1px solid #334155' }}>
                        <span>{m.name}</span>
                        <span style={{ color: '#94a3b8', marginLeft: '8px' }}>{m.record.wins}W-{m.record.losses}L</span>
                        {m.reason && <span style={{ color: '#64748b', fontSize: '11px', marginLeft: '8px' }}>{m.reason}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {/* GM history */}
                {hist && hist.gm_history.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: '#a78bfa', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>GM History</div>
                    {hist.gm_history.map((g, i) => (
                      <div key={i} data-testid={`franchise-gm-row-${g.name}`} style={{ padding: '3px 0', borderBottom: '1px solid #334155' }}>
                        <span>{g.name}</span>
                        <span style={{ color: '#94a3b8', marginLeft: '8px' }}>{g.record.wins}W-{g.record.losses}L</span>
                        {g.reason && <span style={{ color: '#64748b', fontSize: '11px', marginLeft: '8px' }}>{g.reason}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Owner history */}
                {hist && hist.owner_history.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ color: '#34d399', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>Owner History</div>
                    {hist.owner_history.map((o, i) => (
                      <div key={i} data-testid={`franchise-owner-row-${o.name}`} style={{ padding: '3px 0', borderBottom: '1px solid #334155' }}>
                        <span>{o.name}</span>
                        <span style={{ color: '#94a3b8', marginLeft: '8px' }}>S{o.era_start}–{o.era_end}</span>
                        <span style={{ color: '#64748b', marginLeft: '8px' }}>{o.exit_reason}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Stat leaders — always rendered per spec P2.4 */}
                <div data-testid="franchise-stat-leaders" style={{ marginBottom: '8px' }}>
                  <div style={{ color: '#fb923c', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>All-Time Stat Leaders</div>
                  {hist ? (
                    <>
                      {hist.stat_leaders.most_hr && <div style={{ color: '#94a3b8' }}>HR: {hist.stat_leaders.most_hr.name} ({hist.stat_leaders.most_hr.value})</div>}
                      {hist.stat_leaders.most_hits && <div style={{ color: '#94a3b8' }}>H: {hist.stat_leaders.most_hits.name} ({hist.stat_leaders.most_hits.value})</div>}
                      {hist.stat_leaders.most_wins && <div style={{ color: '#94a3b8' }}>W: {hist.stat_leaders.most_wins.name} ({hist.stat_leaders.most_wins.value})</div>}
                      {hist.stat_leaders.lowest_era && <div style={{ color: '#94a3b8' }}>ERA: {hist.stat_leaders.lowest_era.name} ({hist.stat_leaders.lowest_era.value})</div>}
                      {!hist.stat_leaders.most_hr && !hist.stat_leaders.most_hits && !hist.stat_leaders.most_wins && !hist.stat_leaders.lowest_era && (
                        <div style={{ color: '#64748b' }}>No stats recorded yet</div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: '#64748b' }}>No history yet</div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
