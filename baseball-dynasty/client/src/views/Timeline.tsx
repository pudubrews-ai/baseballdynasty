import { useState, useEffect } from 'react';
import { getTimeline, getTransactions } from '../api.js';

// §2.7: snake_case to match API response
interface NewspaperBelowFoldItem {
  id: number;
  headline: string;
  reason: string | null;
  event_type: string;
}

interface NewspaperAwards {
  mvp: string | null;
  cy_young: string | null;
  top_prospect: string | null;
}

interface NewspaperObject {
  masthead: string;
  headline: string;
  lede: string;
  is_champion_edition: boolean;
  awards: NewspaperAwards;
  below_fold: NewspaperBelowFoldItem[];
}

interface TimelineSeason {
  season_number: number;
  champion_team_id: number | null;
  champion_team_name: string | null;
  mvp_player_id: number | null;
  mvp_player_name: string | null;
  narrative: string | null;
  year: number;
  notable_events?: unknown[];
  newspaper?: NewspaperObject;
}

interface Transaction {
  id: number;
  season_number: number;
  transaction_type: string;
  player_name: string | null;
  team_name: string | null;
  narrative: string | null;
  reason: string | null;
  game_number: number;
  created_at: number;
}

// Newspaper front page for a single season
function NewspaperPage({ season, expanded, onToggle }: { season: TimelineSeason; expanded: boolean; onToggle: () => void }) {
  const np = season.newspaper;
  const isChamp = np?.is_champion_edition ?? false;

  const pageStyle: React.CSSProperties = {
    background: '#fef9ec',
    border: isChamp ? '3px solid #f59e0b' : '1px solid #c4a96a',
    borderRadius: '4px',
    marginBottom: '24px',
    fontFamily: "'Inter', system-ui, sans-serif",
    overflow: 'hidden',
    boxShadow: isChamp ? '0 0 24px rgba(245,158,11,0.3)' : '0 2px 8px rgba(0,0,0,0.3)',
  };

  const mastheadStyle: React.CSSProperties = {
    background: '#1a1208',
    padding: '10px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const headlineStyle: React.CSSProperties = {
    fontFamily: "'Bebas Neue', 'Impact', sans-serif",
    fontSize: isChamp ? '36px' : '28px',
    letterSpacing: '0.04em',
    color: isChamp ? '#f59e0b' : '#1a1208',
    lineHeight: 1.1,
    margin: '0 0 8px',
  };

  return (
    <div
      data-testid={`timeline-newspaper-${season.season_number}`}
      style={pageStyle}
    >
      {/* Masthead */}
      <div style={mastheadStyle}>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', letterSpacing: '0.08em', color: '#f59e0b' }}>
          {np?.masthead ?? `Season ${season.season_number} Gazette`}
        </span>
        <span style={{ color: '#6b7280', fontSize: '12px' }}>End of Season {season.season_number} · {season.year}</span>
      </div>

      {/* Front page body */}
      <div style={{ padding: '16px 20px' }}>
        {isChamp && (
          <div style={{ background: '#f59e0b', color: '#1a1208', textAlign: 'center', padding: '6px', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em', fontSize: '18px', marginBottom: '10px', borderRadius: '2px' }}>
            CHAMPIONS
          </div>
        )}

        {/* Headline */}
        <h2
          data-testid={`timeline-headline-${season.season_number}`}
          style={headlineStyle}
        >
          {np?.headline ?? `Season ${season.season_number} Concludes`}
        </h2>

        {/* Main content area */}
        <div style={{ display: 'flex', gap: '16px' }}>
          {/* Lead column */}
          <div style={{ flex: 2 }}>
            <p style={{ color: '#374151', fontSize: '14px', lineHeight: '1.6', margin: '0 0 12px' }}>
              {np?.lede ?? season.narrative?.substring(0, 200) ?? 'Season concluded.'}
            </p>
            {season.champion_team_name && (
              <div style={{ fontSize: '13px', color: '#1a1208', fontWeight: 600 }}>
                Champion: {season.champion_team_name}
              </div>
            )}
          </div>

          {/* Awards sidebar */}
          {np?.awards && (
            <div style={{ flex: 1, borderLeft: '1px solid #c4a96a', paddingLeft: '16px', minWidth: '120px' }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.06em', fontSize: '13px', color: '#6b4c0a', marginBottom: '8px' }}>AWARDS</div>
              {np.awards.mvp && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '10px', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MVP</div>
                  <div style={{ fontSize: '13px', color: '#1a1208', fontWeight: 500 }}>{np.awards.mvp}</div>
                </div>
              )}
              {np.awards.cy_young && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '10px', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cy Young</div>
                  <div style={{ fontSize: '13px', color: '#1a1208', fontWeight: 500 }}>{np.awards.cy_young}</div>
                </div>
              )}
              {np.awards.top_prospect && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '10px', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top Prospect</div>
                  <div style={{ fontSize: '13px', color: '#1a1208', fontWeight: 500 }}>{np.awards.top_prospect}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Below the fold divider */}
        {np?.below_fold && np.below_fold.length > 0 && (
          <>
            <div style={{ borderTop: '2px solid #1a1208', marginTop: '12px', marginBottom: '10px' }} />
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.08em', fontSize: '12px', color: '#6b4c0a', marginBottom: '8px' }}>BELOW THE FOLD</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {np.below_fold.map(item => (
                <div
                  key={item.id}
                  data-testid={`timeline-frontoffice-reason-${item.id}`}
                  style={{ fontSize: '13px', color: '#374151', display: 'flex', gap: '8px', alignItems: 'flex-start' }}
                >
                  <span style={{ color: '#c4a96a', flexShrink: 0 }}>›</span>
                  <span>
                    {item.headline}
                    {item.reason && (
                      <span style={{ color: '#6b7280', marginLeft: '4px' }}>— {item.reason}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Expand/collapse toggle */}
        <button
          data-testid={`timeline-expand-${season.season_number}`}
          onClick={onToggle}
          style={{
            marginTop: '12px',
            background: 'transparent',
            border: '1px solid #c4a96a',
            color: '#6b4c0a',
            padding: '4px 12px',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {expanded ? 'Close Edition' : 'Read Full Edition →'}
        </button>

        {/* Expanded full broadsheet */}
        {expanded && (
          <div style={{ marginTop: '16px', borderTop: '1px solid #c4a96a', paddingTop: '16px' }}>
            {season.narrative && (
              <p style={{ color: '#374151', fontSize: '14px', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                {season.narrative}
              </p>
            )}
            {season.mvp_player_name && (
              <div style={{ fontSize: '13px', color: '#1a1208', marginTop: '8px' }}>
                League MVP: {season.mvp_player_name}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Timeline() {
  const [seasons, setSeasons] = useState<TimelineSeason[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activeView, setActiveView] = useState<'seasons' | 'transactions'>('seasons');
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);

  useEffect(() => {
    getTimeline().then(data => setSeasons(data as TimelineSeason[])).catch(console.error);
    getTransactions().then(data => setTransactions(data as Transaction[])).catch(console.error);
  }, []);

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: '#e2e8f0' }}>Dynasty Timeline</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveView('seasons')}
            style={{ background: activeView === 'seasons' ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >Newspaper</button>
          <button
            onClick={() => setActiveView('transactions')}
            style={{ background: activeView === 'transactions' ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >Transactions</button>
        </div>
      </div>

      {activeView === 'seasons' && (
        <div>
          {seasons.length === 0 ? (
            <p style={{ color: '#64748b', textAlign: 'center', padding: '48px' }}>No seasons completed yet. The presses are quiet.</p>
          ) : (
            seasons.map(season => (
              <NewspaperPage
                key={season.season_number}
                season={season}
                expanded={expandedSeason === season.season_number}
                onToggle={() => setExpandedSeason(expandedSeason === season.season_number ? null : season.season_number)}
              />
            ))
          )}
        </div>
      )}

      {activeView === 'transactions' && (
        <div>
          {transactions.length === 0 ? (
            <p style={{ color: '#64748b' }}>No transactions yet</p>
          ) : (
            transactions.map(txn => (
              <div key={txn.id} style={{ borderBottom: '1px solid #1e293b', padding: '8px 0', fontSize: '13px' }}>
                <span style={{ color: '#f59e0b', fontSize: '11px', marginRight: '8px', textTransform: 'uppercase' }}>{txn.transaction_type}</span>
                <span style={{ color: '#64748b', fontSize: '11px', marginRight: '8px' }}>G{txn.game_number}</span>
                {/* §4.4: Text node only, never dangerouslySetInnerHTML */}
                {txn.narrative && <span style={{ color: '#e2e8f0' }}>{txn.narrative}</span>}
                {!txn.narrative && txn.player_name && (
                  <span style={{ color: '#94a3b8' }}>{txn.player_name}{txn.team_name ? ` — ${txn.team_name}` : ''}</span>
                )}
                {txn.reason && (
                  <span style={{ color: '#6b7280', marginLeft: '8px', fontSize: '12px' }}>({txn.reason})</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
