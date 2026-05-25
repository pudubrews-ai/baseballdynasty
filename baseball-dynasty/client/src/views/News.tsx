import { useState, useEffect } from 'react';
import { useLeagueState } from '../hooks/useLeagueState.js';

type NewsBadge = 'ROSTER' | 'TRANSACTION' | 'FRONT OFFICE' | 'INJURY' | 'MILESTONE' | 'GAME' | 'RIVALRY';
type NewsFilter = 'all' | 'roster' | 'transactions' | 'frontoffice' | 'injuries' | 'milestones';

interface NewsItem {
  id: number;
  season_number: number;
  game_number: number;
  event_type: string;
  badge: NewsBadge;
  team_id: number | null;
  secondary_team_id: number | null;
  player_id: number | null;
  source_id: number | null;
  headline_text: string | null;
  is_headline_pending: number;
  details_json: string | null;
  created_at: number;
}

const BADGE_COLORS: Record<NewsBadge, { bg: string; text: string }> = {
  'ROSTER': { bg: '#0ea5e9', text: '#fff' },
  'TRANSACTION': { bg: '#8b5cf6', text: '#fff' },
  'FRONT OFFICE': { bg: '#f59e0b', text: '#000' },
  'INJURY': { bg: '#ef4444', text: '#fff' },
  'MILESTONE': { bg: '#10b981', text: '#fff' },
  'GAME': { bg: '#475569', text: '#fff' },
  'RIVALRY': { bg: '#dc2626', text: '#fff' }, // v0.5.0: rivalry badge
};

const FILTER_LABELS: Record<NewsFilter, string> = {
  all: 'All',
  roster: 'Roster',
  transactions: 'Transactions',
  frontoffice: 'Front Office',
  injuries: 'Injuries',
  milestones: 'Milestones',
};

async function fetchNews(filter: NewsFilter, limit = 50): Promise<NewsItem[]> {
  const params = new URLSearchParams({ type: filter, limit: String(limit) });
  const res = await fetch(`/api/news?${params.toString()}`);
  if (!res.ok) return [];
  return res.json() as Promise<NewsItem[]>;
}

function BadgePill({ badge }: { badge: NewsBadge }) {
  const { bg, text } = BADGE_COLORS[badge] ?? { bg: '#475569', text: '#fff' };
  return (
    <span style={{
      background: bg, color: text,
      padding: '2px 8px', borderRadius: '4px',
      fontSize: '11px', fontWeight: 'bold',
      letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>
      {badge}
    </span>
  );
}

export default function News() {
  const [filter, setFilter] = useState<NewsFilter>('all');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { state } = useLeagueState();

  useEffect(() => {
    fetchNews(filter).then(setItems).catch(console.error);
  }, [filter, state?.lastNewsId]);

  return (
    <div data-testid="news-view" style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h2 style={{ marginTop: 0, marginBottom: '16px' }}>News Feed</h2>

      {/* Filter buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(Object.keys(FILTER_LABELS) as NewsFilter[]).map(f => (
          <button
            key={f}
            data-testid={`news-filter-${f}`}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? '#3b82f6' : '#1e293b',
              color: filter === f ? '#fff' : '#94a3b8',
              border: `1px solid ${filter === f ? '#3b82f6' : '#334155'}`,
              padding: '6px 14px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* News feed */}
      <div data-testid="news-feed" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.length === 0 ? (
          <div style={{ color: '#64748b', padding: '32px', textAlign: 'center' }}>
            No news items yet.
          </div>
        ) : (
          items.map(item => (
            <div
              key={item.id}
              data-testid={`news-item-${item.id}`}
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '12px 16px',
                cursor: 'pointer',
              }}
            >
              {/* Compact row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span data-testid="news-badge"><BadgePill badge={item.badge} /></span>
                {/* v0.5.0: Rivalry badge — exactly once per rivalry_game item (wrap in div per Universal Lesson 1) */}
                {item.event_type === 'rivalry_game' && (
                  <div data-testid={`rivalry-badge-${item.source_id ?? item.id}`}>
                    <BadgePill badge="RIVALRY" />
                  </div>
                )}
                <span data-testid="news-game-number" style={{ color: '#64748b', fontSize: '12px', whiteSpace: 'nowrap' }}>
                  G{item.game_number}
                </span>
                <span data-testid="news-headline" style={{ flex: 1, fontSize: '14px', color: item.headline_text ? '#e2e8f0' : '#64748b' }}>
                  {item.headline_text ?? (item.is_headline_pending ? '(generating…)' : item.event_type)}
                </span>
              </div>

              {/* Expanded detail */}
              {expandedId === item.id && (
                <div data-testid="news-item-detail" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #334155', fontSize: '13px', color: '#94a3b8' }}>
                  <div>Season {item.season_number} · Game {item.game_number}</div>
                  {item.event_type && <div style={{ marginTop: '4px' }}>Event: {item.event_type}</div>}
                  {item.team_id && <div>Team ID: {item.team_id}</div>}
                  {item.player_id && <div>Player ID: {item.player_id}</div>}
                  {item.details_json && (() => {
                    try {
                      return (
                        <pre style={{ marginTop: '8px', background: '#0f172a', padding: '8px', borderRadius: '4px', fontSize: '12px', overflow: 'auto' }}>
                          {JSON.stringify(JSON.parse(item.details_json), null, 2)}
                        </pre>
                      );
                    } catch {
                      return null;
                    }
                  })()}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
