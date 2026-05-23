import React, { useState } from 'react';
import { LeagueStateContext, useLeagueStatePolling } from './hooks/useLeagueState.js';
import League from './views/League.js';
import Teams from './views/Teams.js';
import Games from './views/Games.js';
import Draft from './views/Draft.js';
import Players from './views/Players.js';
import Timeline from './views/Timeline.js';
import { createLeague, deleteLeague } from './api.js';

type TabName = 'league' | 'teams' | 'games' | 'draft' | 'players' | 'timeline';

// React error boundary
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: unknown): { hasError: boolean; error: string } {
    return { hasError: true, error: String(error) };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red' }}>
          <h2>Something went wrong</h2>
          <pre>{this.state.error}</pre>
          <button onClick={() => this.setState({ hasError: false, error: '' })}>Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabName>('league');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const leagueStateValue = useLeagueStatePolling();
  const { state, noLeague, reconnecting } = leagueStateValue;

  const handleNewDynasty = () => {
    if (!noLeague) {
      setShowConfirmModal(true);
    } else {
      createLeague().then(() => {
        setActiveTab('draft');
      }).catch(console.error);
    }
  };

  const handleConfirmNewDynasty = async () => {
    try {
      await deleteLeague();
      await createLeague();
      setShowConfirmModal(false);
      setActiveTab('draft');
    } catch (err) {
      console.error(err);
    }
  };

  const tabs: Array<{ id: TabName; label: string }> = [
    { id: 'league', label: 'League' },
    { id: 'teams', label: 'Teams' },
    { id: 'games', label: 'Games' },
    { id: 'draft', label: 'Draft' },
    { id: 'players', label: 'Players' },
    { id: 'timeline', label: 'Timeline' },
  ];

  return (
    <LeagueStateContext.Provider value={leagueStateValue}>
      <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
        {/* Reconnecting banner */}
        {reconnecting && (
          <div data-testid="reconnecting-banner" style={{ background: '#dc2626', color: 'white', padding: '8px', textAlign: 'center' }}>
            Reconnecting...
          </div>
        )}

        {/* Header */}
        <header style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>
            Baseball Dynasty Simulator
            {state && <span style={{ fontSize: '14px', color: '#94a3b8', marginLeft: '12px' }}>
              Season {state.seasonNumber}
            </span>}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {state?.simSpeed === 'turbo' && (
              <div data-testid="turbo-mode-badge" style={{ background: '#f59e0b', color: '#000', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                Turbo — picks made procedurally
              </div>
            )}
            <button
              data-testid="new-dynasty-button"
              onClick={handleNewDynasty}
              style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
            >
              {noLeague ? 'Start New Dynasty' : 'New Dynasty'}
            </button>
          </div>
        </header>

        {/* Tab navigation */}
        <nav style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '0 16px', display: 'flex', gap: '4px' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: activeTab === tab.id ? '#3b82f6' : 'transparent',
                color: activeTab === tab.id ? 'white' : '#94a3b8',
                border: 'none',
                padding: '10px 16px',
                cursor: 'pointer',
                borderRadius: '4px 4px 0 0',
                fontSize: '14px',
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main style={{ padding: '16px' }}>
          <ErrorBoundary>
            {noLeague ? (
              <div style={{ textAlign: 'center', padding: '80px 20px' }}>
                <h2 style={{ fontSize: '28px', marginBottom: '16px' }}>Welcome to Baseball Dynasty</h2>
                <p style={{ color: '#94a3b8', marginBottom: '24px' }}>
                  Start a new dynasty to begin your journey as a baseball franchise manager.
                </p>
                <button
                  data-testid="new-dynasty-button"
                  onClick={handleNewDynasty}
                  style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}
                >
                  Start New Dynasty
                </button>
              </div>
            ) : (
              <>
                {activeTab === 'league' && <League />}
                {activeTab === 'teams' && <Teams />}
                {activeTab === 'games' && <Games />}
                {activeTab === 'draft' && <Draft />}
                {activeTab === 'players' && <Players />}
                {activeTab === 'timeline' && <Timeline />}
              </>
            )}
          </ErrorBoundary>
        </main>

        {/* Confirm new dynasty modal */}
        {showConfirmModal && (
          <div
            data-testid="confirm-new-dynasty-modal"
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
            }}
          >
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '24px', maxWidth: '400px', width: '100%' }}>
              <h3 style={{ marginTop: 0 }}>Start New Dynasty?</h3>
              <p style={{ color: '#94a3b8' }}>
                This will archive your current league. Continue?
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  style={{ background: '#334155', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  data-testid="delete-league-button"
                  onClick={handleConfirmNewDynasty}
                  style={{ background: '#dc2626', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Archive &amp; Start New
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LeagueStateContext.Provider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
