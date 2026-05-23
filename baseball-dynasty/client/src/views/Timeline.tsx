import { useState, useEffect } from 'react';
import { getTimeline, getTransactions } from '../api.js';

interface TimelineSeason {
  seasonNumber: number;
  championTeamId: number | null;
  championTeamName: string | null;
  mvpPlayerId: number | null;
  mvpPlayerName: string | null;
  narrative: string | null;
  year: number;
}

interface Transaction {
  id: number;
  seasonNumber: number;
  transactionType: string;
  playerName: string | null;
  teamName: string | null;
  narrative: string | null;
  createdAt: number;
}

export default function Timeline() {
  const [seasons, setSeasons] = useState<TimelineSeason[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activeView, setActiveView] = useState<'seasons' | 'transactions'>('seasons');

  useEffect(() => {
    getTimeline().then(data => setSeasons(data as TimelineSeason[])).catch(console.error);
    getTransactions().then(data => setTransactions(data as Transaction[])).catch(console.error);
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Timeline</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveView('seasons')}
            style={{ background: activeView === 'seasons' ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >Seasons</button>
          <button
            onClick={() => setActiveView('transactions')}
            style={{ background: activeView === 'transactions' ? '#3b82f6' : '#334155', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >Transactions</button>
        </div>
      </div>

      {activeView === 'seasons' && (
        <div>
          {seasons.length === 0 ? (
            <p style={{ color: '#64748b' }}>No seasons completed yet</p>
          ) : (
            seasons.map(season => (
              <div
                key={season.seasonNumber}
                data-testid={`timeline-season-${season.seasonNumber}`}
                style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <span style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '16px' }}>Season {season.seasonNumber}</span>
                    <span style={{ color: '#64748b', marginLeft: '8px', fontSize: '13px' }}>{season.year}</span>
                  </div>
                  {season.championTeamName && (
                    <div style={{ background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 12px', fontSize: '13px', color: '#60a5fa' }}>
                      Champion: {season.championTeamName}
                    </div>
                  )}
                </div>
                {season.mvpPlayerName && (
                  <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '6px' }}>
                    MVP: {season.mvpPlayerName}
                  </div>
                )}
                {/* §4.4: Text node only, never dangerouslySetInnerHTML */}
                {season.narrative && (
                  <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: '1.5' }}>
                    {season.narrative}
                  </div>
                )}
              </div>
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
                <span style={{ color: '#f59e0b', fontSize: '11px', marginRight: '8px', textTransform: 'uppercase' }}>{txn.transactionType}</span>
                {/* §4.4: Text node only */}
                {txn.narrative && <span style={{ color: '#e2e8f0' }}>{txn.narrative}</span>}
                {!txn.narrative && txn.playerName && (
                  <span style={{ color: '#94a3b8' }}>{txn.playerName}{txn.teamName ? ` - ${txn.teamName}` : ''}</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
