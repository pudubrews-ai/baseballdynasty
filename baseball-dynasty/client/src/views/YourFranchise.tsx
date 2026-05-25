// v0.5.0: Your Franchise Tab (Section 8/10)
// All 10 data-testid attributes required — each appears EXACTLY ONCE in the DOM.
// Browse Any Org: pure client-side view toggle — never POST to change owned team (CISO V5-3).

import React, { useState, useEffect } from 'react';
import { ordinal } from '../utils';

interface TeamOption {
  id: number;
  name: string;
  city: string;
}

interface RosterPlayer {
  id: number;
  name: string;
  position: string;
  overall_rating: number;
  age: number;
  annual_salary: number;
  contract_years_remaining: number;
  is_injured: boolean;
  suspended: boolean;
  streak_type: string | null;
  streak_games_remaining: number;
}

interface Prospect {
  id: number;
  name: string;
  position: string;
  overall_rating: number;
  age: number;
  level: string;
  potential: string | null;
  is_international: boolean;
}

interface NewsItem {
  id: number;
  event_type: string;
  badge: string | null;
  headline_text: string | null;
  game_number: number;
  created_at: number;
}

interface FranchiseDashboard {
  team_id: number;
  current_game_number: number;
  record: { wins: number; losses: number; win_pct: number };
  standings_position: number;
  division: string;
  conference: string;
  market_size: string;
  streaks: { winning_streak: number; losing_streak: number };
  at_a_glance: {
    wins: number;
    losses: number;
    win_pct: number;
    standings_position: number;
    payroll_vs_budget: {
      current_payroll: number;
      budget: number;
      over_budget: boolean;
      luxury_tax_owed: number;
      over_luxury_threshold: boolean;
    };
    gm_confidence: number | null;
    chemistry_score: number | null;
  };
  front_office: {
    owner_name: string;
    owner_personality: string;
    owner_age: number;
    gm_name: string;
    gm_archetype: string;
    interim_gm: boolean;
    manager_name: string;
    interim_manager: boolean;
  };
  roster_25man: RosterPlayer[];
  prospects_top10: Prospect[];
  recent_news_10: NewsItem[];
  financials_snapshot: {
    revenue: number;
    current_payroll: number;
    payroll_budget: number;
    franchise_value: number;
    luxury_tax_threshold: number;
    luxury_tax_owed: number;
    over_luxury_threshold: boolean;
  };
  history_snapshot: {
    seasons_played: number;
    championships: number;
    playoff_appearances: number;
    career_wins: number;
  };
}

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function RatingBar({ value, max = 99 }: { value: number; max?: number }) {
  const pct = Math.round((value / max) * 100);
  const color = value >= 80 ? '#22c55e' : value >= 65 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ flex: 1, background: '#1e293b', borderRadius: '3px', height: '6px' }}>
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: '3px' }} />
      </div>
      <span style={{ fontSize: '12px', color: '#94a3b8', minWidth: '24px' }}>{value}</span>
    </div>
  );
}

interface Props {
  ownedTeamId: number | null;
}

export default function YourFranchise({ ownedTeamId }: Props) {
  // Browse Any Org: pure client state — NEVER POST to change owned team (CISO V5-3)
  const [browseTeamId, setBrowseTeamId] = useState<number | null>(null);
  const [allTeams, setAllTeams] = useState<TeamOption[]>([]);
  const [dashboard, setDashboard] = useState<FranchiseDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewingTeamId = browseTeamId ?? ownedTeamId;

  // Load all teams for browse selector
  useEffect(() => {
    fetch('/api/teams')
      .then(r => r.ok ? r.json() : [])
      .then((data: Array<{ id: number; name: string; city: string }>) => {
        setAllTeams(data.map(t => ({ id: t.id, name: t.name, city: t.city })));
      })
      .catch(() => {});
  }, []);

  // Load dashboard for currently viewed team
  useEffect(() => {
    if (!viewingTeamId) {
      setDashboard(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/franchise/dashboard/${viewingTeamId}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: FranchiseDashboard) => {
        setDashboard(data);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [viewingTeamId]);

  // Empty state: no owned franchise
  if (!ownedTeamId) {
    return (
      <div
        data-testid="your-franchise-tab"
        style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}
      >
        <h2 style={{ fontSize: '22px', marginBottom: '12px', color: '#e2e8f0' }}>Your Franchise</h2>
        <p>No franchise selected. Start a new dynasty and pick your team during the expansion draft.</p>
      </div>
    );
  }

  const isBrowsing = browseTeamId !== null && browseTeamId !== ownedTeamId;

  return (
    <div data-testid="your-franchise-tab" style={{ fontFamily: 'system-ui, sans-serif', padding: '0 4px' }}>
      {/* Browse Any Org controls */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div data-testid="franchise-browse-selector">
          <label style={{ fontSize: '13px', color: '#94a3b8', marginRight: '8px' }}>
            View Franchise:
          </label>
          <select
            value={browseTeamId ?? ownedTeamId}
            onChange={e => {
              const newId = Number(e.target.value);
              setBrowseTeamId(newId === ownedTeamId ? null : newId);
            }}
            style={{
              background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155',
              borderRadius: '4px', padding: '4px 8px', fontSize: '13px',
            }}
          >
            {allTeams.map(t => (
              <option key={t.id} value={t.id}>
                {t.city} {t.name}{t.id === ownedTeamId ? ' (Your Team)' : ''}
              </option>
            ))}
          </select>
        </div>
        {isBrowsing && (
          <button
            data-testid="franchise-browse-return"
            onClick={() => setBrowseTeamId(null)}
            style={{
              background: '#3b82f6', color: 'white', border: 'none',
              padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
            }}
          >
            Return to My Franchise
          </button>
        )}
        {!isBrowsing && (
          // Render hidden return button so data-testid always present in DOM (X-F1 empty state)
          <button
            data-testid="franchise-browse-return"
            style={{ display: 'none' }}
            onClick={() => setBrowseTeamId(null)}
          >
            Return to My Franchise
          </button>
        )}
      </div>

      {loading && (
        <div style={{ color: '#94a3b8', padding: '20px' }}>Loading franchise data...</div>
      )}
      {error && (
        <div style={{ color: '#ef4444', padding: '20px' }}>Error: {error}</div>
      )}

      {dashboard && !loading && (
        <div style={{ display: 'grid', gap: '16px' }}>
          {/* Header */}
          <div style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: '22px', color: '#e2e8f0' }}>
              {dashboard.conference} League — {dashboard.division}
            </h2>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', color: '#94a3b8', fontSize: '13px' }}>
              <span>{dashboard.record.wins}W - {dashboard.record.losses}L ({dashboard.record.win_pct.toFixed(3)})</span>
              <span>{ordinal(dashboard.standings_position)} in {dashboard.division}</span>
              <span style={{ textTransform: 'capitalize' }}>{dashboard.market_size} market</span>
              {dashboard.streaks.winning_streak >= 5 && (
                <span style={{ color: '#22c55e' }}>W{dashboard.streaks.winning_streak} streak</span>
              )}
              {dashboard.streaks.losing_streak >= 5 && (
                <span style={{ color: '#ef4444' }}>L{dashboard.streaks.losing_streak} streak</span>
              )}
            </div>
          </div>

          {/* At a Glance */}
          <div data-testid="franchise-at-a-glance" style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>At a Glance</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Record</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{dashboard.at_a_glance.wins}-{dashboard.at_a_glance.losses}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Win %</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{dashboard.at_a_glance.win_pct.toFixed(3)}</div>
              </div>
              {dashboard.at_a_glance.gm_confidence !== null && (
                <div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>GM Confidence</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', color: dashboard.at_a_glance.gm_confidence >= 70 ? '#22c55e' : dashboard.at_a_glance.gm_confidence >= 40 ? '#f59e0b' : '#ef4444' }}>
                    {dashboard.at_a_glance.gm_confidence}
                  </div>
                </div>
              )}
              {dashboard.at_a_glance.chemistry_score !== null && (
                <div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Chemistry</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{dashboard.at_a_glance.chemistry_score}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Payroll vs Budget</div>
                <div style={{ fontSize: '14px', color: dashboard.at_a_glance.payroll_vs_budget.over_budget ? '#ef4444' : '#22c55e' }}>
                  {fmt$(dashboard.at_a_glance.payroll_vs_budget.current_payroll)} / {fmt$(dashboard.at_a_glance.payroll_vs_budget.budget)}
                </div>
                {dashboard.at_a_glance.payroll_vs_budget.over_luxury_threshold && (
                  <div style={{ fontSize: '12px', color: '#f59e0b' }}>
                    Luxury tax: {fmt$(dashboard.at_a_glance.payroll_vs_budget.luxury_tax_owed)}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Division Rank</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{dashboard.at_a_glance.standings_position}</div>
              </div>
            </div>
          </div>

          {/* Roster Panel */}
          <div data-testid="franchise-roster-panel" style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              25-Man Roster ({dashboard.roster_25man.length})
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155', color: '#64748b' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Player</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Pos</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', minWidth: '120px' }}>Rating</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Age</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Salary</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Yrs</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.roster_25man.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #1e3a5f' }}>
                      <td style={{ padding: '4px 8px' }}>
                        {p.name}
                        {/* Player streak badge — exactly ONE per player (player card only) */}
                        {p.streak_type && p.streak_games_remaining > 0 && (
                          <span
                            data-testid={`player-streak-badge-${p.id}`}
                            style={{ marginLeft: '4px', fontSize: '14px' }}
                            title={`${p.streak_type} streak (${p.streak_games_remaining} games remaining)`}
                          >
                            {p.streak_type === 'hot' ? '🔥' : '🧊'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{p.position}</td>
                      <td style={{ padding: '4px 8px' }}>
                        <RatingBar value={p.overall_rating} />
                      </td>
                      <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{p.age}</td>
                      <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{fmt$(p.annual_salary)}</td>
                      <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{p.contract_years_remaining}</td>
                      <td style={{ padding: '4px 8px' }}>
                        {p.is_injured && <span style={{ color: '#ef4444', fontSize: '12px' }}>IL</span>}
                        {p.suspended && <span style={{ color: '#f59e0b', fontSize: '12px' }}>SUSP</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pipeline Panel */}
          <div data-testid="franchise-pipeline-panel" style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Top Prospects
            </h3>
            {dashboard.prospects_top10.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '13px' }}>No prospects in the system.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                {dashboard.prospects_top10.map(p => (
                  <div
                    key={p.id}
                    style={{ background: '#0f172a', borderRadius: '6px', padding: '10px', fontSize: '13px' }}
                  >
                    <div style={{ fontWeight: 'bold' }}>{p.name}</div>
                    <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '2px' }}>
                      {p.position} — {p.level} — Age {p.age}
                      {p.is_international && ' 🌐'}
                    </div>
                    <RatingBar value={p.overall_rating} />
                    {p.potential && (
                      <div style={{ color: '#f59e0b', fontSize: '12px', marginTop: '2px' }}>
                        Potential: {p.potential}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Front Office Panel */}
          <div data-testid="franchise-frontoffice-panel" style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Front Office</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', fontSize: '14px' }}>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Owner</div>
                <div>{dashboard.front_office.owner_name}</div>
                <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'capitalize' }}>
                  {dashboard.front_office.owner_personality}, age {dashboard.front_office.owner_age}
                </div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>General Manager</div>
                <div>
                  {dashboard.front_office.gm_name}
                  {dashboard.front_office.interim_gm && <span style={{ color: '#f59e0b', fontSize: '11px', marginLeft: '4px' }}>(Interim)</span>}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'capitalize' }}>
                  {dashboard.front_office.gm_archetype}
                </div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Manager</div>
                <div>
                  {dashboard.front_office.manager_name}
                  {dashboard.front_office.interim_manager && <span style={{ color: '#f59e0b', fontSize: '11px', marginLeft: '4px' }}>(Interim)</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Recent News Panel */}
          <div data-testid="franchise-news-panel" style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent News</h3>
            {dashboard.recent_news_10.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '13px' }}>No news items yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {dashboard.recent_news_10.map(n => (
                  <div
                    key={n.id}
                    style={{ fontSize: '13px', borderLeft: '2px solid #3b82f6', paddingLeft: '8px' }}
                  >
                    {n.badge && <span style={{ color: '#64748b', marginRight: '6px' }}>[{n.badge}]</span>}
                    {n.headline_text ?? n.event_type}
                    <span style={{ color: '#475569', fontSize: '11px', marginLeft: '8px' }}>Game {n.game_number}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Financials Snapshot */}
          <div data-testid="franchise-financials-snapshot" style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Financials</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', fontSize: '14px' }}>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Revenue</div>
                <div>{fmt$(dashboard.financials_snapshot.revenue)}</div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Payroll</div>
                <div style={{ color: dashboard.financials_snapshot.current_payroll > dashboard.financials_snapshot.payroll_budget ? '#ef4444' : '#e2e8f0' }}>
                  {fmt$(dashboard.financials_snapshot.current_payroll)}
                </div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Budget</div>
                <div>{fmt$(dashboard.financials_snapshot.payroll_budget)}</div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Franchise Value</div>
                <div>{dashboard.financials_snapshot.franchise_value}M</div>
              </div>
              {dashboard.financials_snapshot.over_luxury_threshold && (
                <div>
                  <div style={{ color: '#64748b', fontSize: '12px' }}>Luxury Tax</div>
                  <div style={{ color: '#f59e0b' }}>{fmt$(dashboard.financials_snapshot.luxury_tax_owed)}</div>
                </div>
              )}
            </div>
          </div>

          {/* History Snapshot */}
          <div data-testid="franchise-history-snapshot" style={{ background: '#1e293b', borderRadius: '8px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Franchise History</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', fontSize: '14px' }}>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Seasons</div>
                <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{dashboard.history_snapshot.seasons_played}</div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Championships</div>
                <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#f59e0b' }}>
                  {dashboard.history_snapshot.championships}
                </div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Playoff Apps</div>
                <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{dashboard.history_snapshot.playoff_appearances}</div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px' }}>Career Wins</div>
                <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{dashboard.history_snapshot.career_wins}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
