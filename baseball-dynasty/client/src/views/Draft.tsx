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
  const isBatchMode = useRef(false);

  // Load teams on mount
  useEffect(() => {
    fetch('/api/teams')
      .then(r => r.json())
      .then((data: TeamInfo[]) => setTeams(data))
      .catch(console.error);
  }, []);

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
  const totalTeams = teams.length || 20;

  // Determine on-clock team
  const lastPick = allPicks[allPicks.length - 1];
  const totalPicksMade = allPicks.length;
  const currentRound = Math.floor(totalPicksMade / totalTeams) + 1;
  const currentPickInRound = totalPicksMade % totalTeams;

  // Snake order: odd rounds go 0→19, even rounds go 19→0
  let onClockTeamId: number | null = null;
  if (teams.length > 0 && state?.phase === 'expansion_draft') {
    const teamOrder = [...teams];
    const roundOrder = currentRound % 2 === 1 ? teamOrder : [...teamOrder].reverse();
    onClockTeamId = roundOrder[currentPickInRound]?.id ?? null;
  }

  const getPickForCell = (round: number, teamIndex: number): DraftPick | undefined => {
    // Snake order: odd rounds are ascending, even rounds are descending
    const actualPickInRound = round % 2 === 1 ? teamIndex : (teams.length - 1 - teamIndex);
    const pickNumber = (round - 1) * teams.length + actualPickInRound + 1;
    return allPicks.find(p => p.pick_number === pickNumber);
  };

  const starsForRating = (rating: number): string => {
    const stars = Math.round((rating - 30) / 14); // 30=1star, 44=2, 58=3, 72=4, 86=5
    return '★'.repeat(Math.max(1, Math.min(5, stars))) + '☆'.repeat(Math.max(0, 5 - Math.max(1, Math.min(5, stars))));
  };

  if (state?.phase !== 'expansion_draft' && state?.phase !== 'annual_draft') {
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
          {state.phase === 'expansion_draft' ? 'Expansion Draft' : 'Annual Draft'}
        </h2>
        {onClockTeamId && (
          <div data-testid="draft-onclock-team" style={{ background: '#f59e0b', color: '#000', padding: '4px 12px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold' }}>
            On the Clock: {teams.find(t => t.id === onClockTeamId)?.city} {teams.find(t => t.id === onClockTeamId)?.name}
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
              {teams.map(team => (
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
                  {teams.map((team, teamIdx) => {
                    const pick = getPickForCell(round, teamIdx);
                    return (
                      <td
                        key={team.id}
                        data-testid={`draft-pick-${round}-${teamIdx + 1}`}
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
