import { useState, useEffect } from 'react';
import { getTeams, getTeam, getTeamRoster, getTeamMinors, getTeamHistory } from '../api.js';

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
  payroll_budget: number;
  current_payroll: number;
  revenue: number;
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
        case 'financials': setTabData([]); break;
      }
    } catch (err) {
      console.error(err);
    }
  };

  const formatMoney = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
      {/* Team grid */}
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
                const minors = (tabData ?? {}) as Record<string, Array<{ id: number; first_name: string; last_name: string; position: string; overall_rating: number }>>;
                const levels: Array<'AAA' | 'AA' | 'A' | 'Rookie'> = ['AAA', 'AA', 'A', 'Rookie'];
                const hasAny = levels.some(lvl => Array.isArray(minors[lvl]) && minors[lvl]!.length > 0);
                if (!hasAny) return <p style={{ color: '#64748b', fontSize: '12px' }}>No minor league depth yet</p>;
                return levels.map(level => {
                  const players = Array.isArray(minors[level]) ? minors[level]! : [];
                  if (players.length === 0) return null;
                  return (
                    <div key={level} style={{ marginBottom: '8px' }}>
                      <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>{level}</div>
                      {players.map(p => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155', fontSize: '12px' }}>
                          <span>{p.first_name} {p.last_name}</span>
                          <span style={{ color: '#94a3b8' }}>{p.position}</span>
                          <span style={{ color: '#60a5fa' }}>{p.overall_rating}</span>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* §1.4.4: snake_case field names for financials */}
          {activeTab === 'financials' && (
            <div style={{ fontSize: '13px' }}>
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
              <div style={{ marginTop: '12px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
                <div style={{ marginBottom: '6px' }}>GM: {teamDetail.gm_name}</div>
                <div style={{ marginBottom: '6px', color: '#94a3b8', fontSize: '12px' }}>
                  {teamDetail.gm_personality?.philosophy} / {teamDetail.gm_personality?.risk_tolerance} / {teamDetail.gm_personality?.focus}
                </div>
                <div style={{ marginBottom: '6px' }}>Manager: {teamDetail.manager_name}</div>
                <div>Owner: {teamDetail.owner_name}</div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div style={{ maxHeight: '400px', overflowY: 'auto', fontSize: '12px' }}>
              {Array.isArray(tabData) && (tabData as unknown[]).length === 0 ? (
                <p style={{ color: '#64748b' }}>No history yet</p>
              ) : (
                Array.isArray(tabData) && (tabData as Array<{ id: number; event_type: string; departing_person: string; incoming_person: string; narrative: string }>).map(event => (
                  <div key={event.id} style={{ padding: '6px 0', borderBottom: '1px solid #334155' }}>
                    <div style={{ color: '#f59e0b', fontSize: '11px' }}>{event.event_type}</div>
                    {/* §4.4: Render as text node, never dangerouslySetInnerHTML */}
                    <div>{event.narrative}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
