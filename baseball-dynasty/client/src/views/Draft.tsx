import { useState, useEffect, useRef } from 'react';
import { useLeagueState } from '../hooks/useLeagueState.js';

interface DraftPick {
  id: number;
  round: number;
  pick_number: number;
  team_id: number;
  player_id: number | null;
  reasoning: string | null;
  first_name?: string;
  last_name?: string;
  position?: string;
  overall_rating?: number;
  age?: number;
}

interface TeamInfo {
  id: number;
  name: string;
  city: string;
}

export default function Draft() {
  const { state, picksDelta } = useLeagueState();
  const [allPicks, setAllPicks] = useState<DraftPick[]>([]);
  const [latestPick, setLatestPick] = useState<DraftPick | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [teamOrder, setTeamOrder] = useState<number[]>([]);
  const isBatchMode = useRef(false);

  // Load teams on mount
  useEffect(() => {
    fetch('/api/teams')
      .then(r => r.json())
      .then((data: TeamInfo[]) => setTeams(data))
      .catch(console.error);
  }, []);

  // Fetch draft order when phase is 'draft' — re-fetch if subPhase changes (§1.2.1)
  useEffect(() => {
    if (state?.phase === 'draft') {
      fetch('/api/draft/order')
        .then(r => r.json())
        .then((data: { teamOrder: number[] }) => setTeamOrder(data.teamOrder || []))
        .catch(console.error);
    }
  }, [state?.phase, state?.subPhase]);

  // Teams in correct draft order — fallback to /api/teams order until draft order loads (§1.2.1)
  const teamsInDraftOrder: TeamInfo[] = teamOrder.length > 0
    ? teamOrder.map(id => teams.find(t => t.id === id)).filter((t): t is TeamInfo => t !== undefined)
    : teams;

  // Load all existing picks on mount
  useEffect(() => {
    if (state?.leagueId) {
      fetch(`/api/state?sincePickId=0`)
        .then(r => r.json())
        .then((data: { picksDelta?: DraftPick[] }) => {
          if (data.picksDelta && data.picksDelta.length > 0) {
            setAllPicks(data.picksDelta);
          }
        })
        .catch(console.error);
    }
  }, [state?.leagueId]);

  // Process delta picks
  useEffect(() => {
    if (picksDelta.length === 0) return;

    const newPicks = picksDelta as DraftPick[];

    // D11: batch-render without animation if delta > 20
    if (newPicks.length > 20) {
      isBatchMode.current = true;
      setAllPicks(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        return [...prev, ...newPicks.filter(p => !existingIds.has(p.id))];
      });
      isBatchMode.current = false;
    } else {
      setAllPicks(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        return [...prev, ...newPicks.filter(p => !existingIds.has(p.id))];
      });
      if (newPicks.length > 0) {
        setLatestPick(newPicks[newPicks.length - 1] ?? null);
      }
    }
  }, [picksDelta]);

  const totalRounds = 30;
  const totalTeams = teamsInDraftOrder.length || 20;

  // Determine on-clock team using teamsInDraftOrder (§1.2.2)
  const totalPicksMade = allPicks.length;
  const currentRound = Math.floor(totalPicksMade / totalTeams) + 1;
  const currentPickInRound = totalPicksMade % totalTeams;

  // Snake order: odd rounds go 0→N-1, even rounds go N-1→0
  let onClockTeamId: number | null = null;
  if (teamsInDraftOrder.length > 0 && state?.phase === 'draft') {
    const roundOrder = currentRound % 2 === 1 ? teamsInDraftOrder : [...teamsInDraftOrder].reverse();
    onClockTeamId = roundOrder[currentPickInRound]?.id ?? null;
  }

  // Helper to compute actual pick number for a cell (§1.2.3)
  const getPickNumberForCell = (round: number, teamIdx: number, totalTeamsCount: number): number => {
    // Snake order: odd rounds forward, even rounds reversed
    const pickInRound = round % 2 === 1 ? teamIdx + 1 : (totalTeamsCount - teamIdx);
    return (round - 1) * totalTeamsCount + pickInRound;
  };

  const getPickForCell = (round: number, teamIndex: number): DraftPick | undefined => {
    const pickNumber = getPickNumberForCell(round, teamIndex, teamsInDraftOrder.length || totalTeams);
    return allPicks.find(p => p.pick_number === pickNumber);
  };

  const starsForRating = (rating: number): string => {
    const stars = Math.round((rating - 30) / 14); // 30=1star, 44=2, 58=3, 72=4, 86=5
    return '★'.repeat(Math.max(1, Math.min(5, stars))) + '☆'.repeat(Math.max(0, 5 - Math.max(1, Math.min(5, stars))));
  };

  // §1.1.3: Check for 'draft' not 'expansion_draft'/'annual_draft'
  if (state?.phase !== 'draft') {
    return (
      <div style={{ padding: '20px', color: '#64748b' }}>
        <h2>Draft</h2>
        <p>No active draft. Draft occurs during expansion and each offseason.</p>
        {allPicks.length > 0 && (
          <p style={{ color: '#94a3b8' }}>{allPicks.length} picks made in the last draft.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>
          {/* §1.1.3: Use subPhase for title */}
          {state.subPhase === 'expansion' ? 'Expansion Draft' : 'Annual Draft'}
        </h2>
        {onClockTeamId && (
          <div data-testid="draft-onclock-team" style={{ background: '#f59e0b', color: '#000', padding: '4px 12px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold' }}>
            On the Clock: {teamsInDraftOrder.find(t => t.id === onClockTeamId)?.city} {teamsInDraftOrder.find(t => t.id === onClockTeamId)?.name}
          </div>
        )}
        <div style={{ color: '#64748b', fontSize: '13px' }}>
          {allPicks.length} / {totalRounds * totalTeams} picks
        </div>
      </div>

      {/* Latest pick reveal */}
      {latestPick && latestPick.first_name && (
        <div data-testid="draft-pick-reveal" style={{ background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
              Round {latestPick.round}, Pick {latestPick.pick_number}
            </div>
            <div style={{ fontWeight: 'bold', fontSize: '16px' }}>
              {latestPick.first_name} {latestPick.last_name}
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px' }}>
              {latestPick.position} · Age {latestPick.age}
            </div>
            <div style={{ color: '#f59e0b', fontSize: '14px', marginTop: '4px' }}>
              {starsForRating(latestPick.overall_rating ?? 50)}
            </div>
            {/* §4.4: LLM reasoning rendered as text node only */}
            {latestPick.reasoning && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#cbd5e1', fontStyle: 'italic' }}>
                {latestPick.reasoning}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Draft board */}
      <div data-testid="draft-board" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '11px', minWidth: '100%' }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              <th style={{ padding: '6px', textAlign: 'left', minWidth: '50px', color: '#94a3b8' }}>Round</th>
              {/* §1.2.2: Use teamsInDraftOrder */}
              {teamsInDraftOrder.map(team => (
                <th
                  key={team.id}
                  style={{
                    padding: '4px 6px',
                    textAlign: 'center',
                    minWidth: '80px',
                    color: team.id === onClockTeamId ? '#f59e0b' : '#94a3b8',
                    background: team.id === onClockTeamId ? 'rgba(245,158,11,0.1)' : 'transparent',
                  }}
                >
                  {team.city.slice(0, 6)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: totalRounds }, (_, roundIdx) => {
              const round = roundIdx + 1;
              return (
                <tr key={round} style={{ background: round % 2 === 0 ? '#0f172a' : 'transparent' }}>
                  <td style={{ padding: '4px 6px', color: '#64748b', fontWeight: 'bold' }}>{round}</td>
                  {/* §1.2.2: Use teamsInDraftOrder */}
                  {teamsInDraftOrder.map((team, teamIdx) => {
                    const pick = getPickForCell(round, teamIdx);
                    return (
                      <td
                        key={team.id}
                        data-testid={`draft-pick-${round}-${getPickNumberForCell(round, teamIdx, teamsInDraftOrder.length || totalTeams)}`}
                        style={{
                          padding: '3px 5px',
                          textAlign: 'center',
                          borderLeft: '1px solid #1e293b',
                          background: team.id === onClockTeamId && !pick ? 'rgba(245,158,11,0.05)' : 'transparent',
                        }}
                      >
                        {pick && pick.first_name ? (
                          <div style={{ color: '#e2e8f0' }}>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '78px' }}>
                              {pick.first_name[0]}. {pick.last_name}
                            </div>
                            <div style={{ color: '#64748b' }}>{pick.position}</div>
                          </div>
                        ) : (
                          <div style={{ color: '#334155' }}>—</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
