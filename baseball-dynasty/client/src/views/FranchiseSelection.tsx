// Franchise Selection Screen (v0.3.0)
// Shown once after world gen completes, before expansion draft begins.
// Full screen dark overlay with 4×5 team card grid.
// All text rendered as React text nodes — never dangerouslySetInnerHTML.

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TeamCard {
  id: number;
  city: string;
  name: string;
  color: string;
  market_size: string;
  owner_name: string;
  owner_personality: string;
  gm_name: string;
  gm_archetype: string;
  abbreviation: string | null;
  payroll_budget: number;
  wins: number;
  losses: number;
  // stadium capacity derived from market size
}

function marketSizeBadge(size: string): string {
  const labels: Record<string, string> = {
    mega: 'MEGA', large: 'LARGE', medium: 'MEDIUM', small: 'SMALL',
  };
  return labels[size] ?? size.toUpperCase();
}

function marketSizeBadgeColor(size: string): string {
  const colors: Record<string, string> = {
    mega: '#f59e0b', large: '#3b82f6', medium: '#10b981', small: '#6b7280',
  };
  return colors[size] ?? '#6b7280';
}

function gmArchetypeLabel(archetype: string): string {
  const labels: Record<string, string> = {
    analytics: 'Analytics GM',
    'old-school': 'Old-School GM',
    balanced: 'Balanced GM',
  };
  return labels[archetype] ?? archetype;
}

function ownerPersonalityLabel(personality: string): string {
  const labels: Record<string, string> = {
    meddling: 'Meddling Win-Now Owner',
    'win-now': 'Aggressive Win-Now Owner',
    moderate: 'Moderate Owner',
    patient: 'Patient Owner',
    'hands-off': 'Hands-Off Owner',
  };
  return labels[personality] ?? personality;
}

function flavorLine(team: TeamCard): string {
  const sizeAdj: Record<string, string> = {
    small: 'scrappy small-market', large: 'big-market powerhouse',
    mega: 'dynasty-caliber mega-market', medium: 'solid mid-market',
  };
  const gmDesc: Record<string, string> = {
    analytics: 'analytics GM who loves a bargain',
    'old-school': 'old-school GM with an eye for proven veterans',
    balanced: 'balanced GM who adapts to the roster',
  };
  const ownerDesc: Record<string, string> = {
    meddling: 'demanding meddling owner',
    'win-now': 'impatient win-now owner',
    patient: 'patient owner',
    'hands-off': 'hands-off owner',
    moderate: 'moderate owner',
  };
  const adj = sizeAdj[team.market_size] ?? 'competitive';
  const gm = gmDesc[team.gm_archetype] ?? 'GM';
  const owner = ownerDesc[team.owner_personality] ?? 'owner';
  return `A ${adj} org with a ${owner} and an ${gm}.`;
}

function stadiumCapacity(marketSize: string): string {
  const caps: Record<string, string> = {
    mega: '50,000', large: '42,000', medium: '35,000', small: '28,000',
  };
  return caps[marketSize] ?? '35,000';
}

async function fetchTeams(): Promise<TeamCard[]> {
  const res = await fetch('/api/teams');
  if (!res.ok) return [];
  return res.json() as Promise<TeamCard[]>;
}

async function selectFranchise(teamId: number): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/franchise/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

async function skipFranchise(): Promise<{ ok: boolean }> {
  const res = await fetch('/api/franchise/skip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return res.json() as Promise<{ ok: boolean }>;
}

interface FranchiseSelectionProps {
  onComplete: () => void;
  onNewDynasty?: () => void;
}

export default function FranchiseSelection({ onComplete, onNewDynasty }: FranchiseSelectionProps) {
  const [teams, setTeams] = useState<TeamCard[]>([]);
  const [hoveredTeam, setHoveredTeam] = useState<number | null>(null);
  const [pendingTeam, setPendingTeam] = useState<TeamCard | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTeams().then(setTeams).catch(console.error);
  }, []);

  const handleTeamClick = (team: TeamCard) => {
    setPendingTeam(team);
    setError(null);
  };

  const handleConfirm = async () => {
    if (!pendingTeam) return;
    setSubmitting(true);
    try {
      const result = await selectFranchise(pendingTeam.id);
      if (result.ok) {
        onComplete();
      } else {
        setError(result.error ?? 'Selection failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setSubmitting(true);
    try {
      await skipFranchise();
      onComplete();
    } catch {
      // skip silently — draft will proceed
      onComplete();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      data-testid="franchise-selection-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(13,17,23,0.97)',
        zIndex: 500,
        overflowY: 'auto',
        padding: '32px 24px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '32px', position: 'relative' }}>
        {onNewDynasty && (
          <button
            data-testid="franchise-selection-new-dynasty"
            onClick={onNewDynasty}
            style={{
              position: 'absolute', top: 0, right: 0,
              background: '#1e293b', border: '1px solid #334155',
              color: '#94a3b8', padding: '6px 14px', borderRadius: '6px',
              cursor: 'pointer', fontSize: '13px',
            }}
          >
            New Dynasty
          </button>
        )}
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: '52px',
          letterSpacing: '0.08em',
          color: '#f9fafb',
          margin: 0,
        }}>
          Choose Your Franchise
        </h1>
        <p style={{ color: '#6b7280', fontSize: '16px', margin: '8px 0 0' }}>
          You won't control them. You'll watch them. Pick wisely.
        </p>
      </div>

      {/* Team grid — 4 columns × 5 rows */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        maxWidth: '1100px',
        margin: '0 auto',
      }}>
        {teams.slice(0, 20).map(team => {
          const isHovered = hoveredTeam === team.id;
          return (
            <motion.div
              key={team.id}
              data-testid={`franchise-card-${team.id}`}
              whileHover={{ y: -4 }}
              transition={{ duration: 0.15 }}
              onMouseEnter={() => setHoveredTeam(team.id)}
              onMouseLeave={() => setHoveredTeam(null)}
              onClick={() => handleTeamClick(team)}
              style={{
                background: '#161b22',
                border: `2px solid ${isHovered ? team.color : '#2a3a50'}`,
                borderRadius: '8px',
                padding: '14px',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
                position: 'relative',
              }}
            >
              {/* Color accent bar */}
              <div style={{ height: '4px', background: team.color, borderRadius: '2px', marginBottom: '10px' }} />

              {/* Team name */}
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '20px', color: '#f9fafb', letterSpacing: '0.04em', lineHeight: 1.1 }}>
                {team.city}
              </div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '24px', color: team.color, letterSpacing: '0.04em', lineHeight: 1.1, marginBottom: '8px' }}>
                {team.name}
              </div>

              {/* Market size badge */}
              <div style={{ marginBottom: '8px' }}>
                <span style={{
                  background: marketSizeBadgeColor(team.market_size),
                  color: '#000',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                }}>
                  {marketSizeBadge(team.market_size)}
                </span>
              </div>

              {/* FO names */}
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>
                {ownerPersonalityLabel(team.owner_personality)}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
                {gmArchetypeLabel(team.gm_archetype)}
              </div>

              {/* Flavor text */}
              <div style={{ fontSize: '11px', color: '#4b5563', lineHeight: 1.4 }}>
                {flavorLine(team)}
              </div>

              {/* Hover: stadium + payroll */}
              {isHovered && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{
                    position: 'absolute',
                    bottom: 0, left: 0, right: 0,
                    background: `${team.color}22`,
                    borderTop: `1px solid ${team.color}44`,
                    borderRadius: '0 0 6px 6px',
                    padding: '6px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: '#e2e8f0',
                  }}
                >
                  <span>Cap: {stadiumCapacity(team.market_size)}</span>
                  <span>Budget: ${Math.round(team.payroll_budget / 1_000_000)}M</span>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Skip button */}
      <div style={{ textAlign: 'center', marginTop: '24px' }}>
        <button
          onClick={handleSkip}
          disabled={submitting}
          style={{
            background: 'transparent',
            border: '1px solid #334155',
            color: '#6b7280',
            padding: '8px 20px',
            borderRadius: '6px',
            cursor: submitting ? 'wait' : 'pointer',
            fontSize: '13px',
          }}
        >
          Skip — watch as neutral observer
        </button>
      </div>

      {/* Confirmation modal */}
      <AnimatePresence>
        {pendingTeam && (
          <motion.div
            data-testid="franchise-confirm-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 600,
            }}
            onClick={e => { if (e.target === e.currentTarget) setPendingTeam(null); }}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              style={{
                background: '#161b22',
                border: `2px solid ${pendingTeam.color}`,
                borderRadius: '10px',
                padding: '28px',
                maxWidth: '400px',
                width: '90%',
              }}
            >
              <div style={{ height: '4px', background: pendingTeam.color, borderRadius: '2px', marginBottom: '16px' }} />
              <h2 style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '28px',
                color: '#f9fafb',
                margin: '0 0 4px',
                letterSpacing: '0.04em',
              }}>
                {pendingTeam.city} {pendingTeam.name}
              </h2>
              <p style={{ color: '#6b7280', fontSize: '14px', margin: '0 0 20px', lineHeight: 1.5 }}>
                Own the {pendingTeam.city} {pendingTeam.name}? You'll be along for the ride.
              </p>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px' }}>
                <div style={{ marginBottom: '4px' }}>{ownerPersonalityLabel(pendingTeam.owner_personality)}</div>
                <div>{gmArchetypeLabel(pendingTeam.gm_archetype)}</div>
              </div>
              {error && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{error}</div>
              )}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setPendingTeam(null)}
                  disabled={submitting}
                  style={{
                    background: '#1e293b', color: '#94a3b8',
                    border: '1px solid #334155', padding: '8px 16px',
                    borderRadius: '5px', cursor: 'pointer', fontSize: '13px',
                  }}
                >
                  Back
                </button>
                <button
                  data-testid="franchise-confirm-button"
                  onClick={handleConfirm}
                  disabled={submitting}
                  style={{
                    background: pendingTeam.color, color: '#000',
                    border: 'none', padding: '8px 20px',
                    borderRadius: '5px', cursor: submitting ? 'wait' : 'pointer',
                    fontSize: '13px', fontWeight: 700,
                  }}
                >
                  {submitting ? 'Selecting...' : `Own the ${pendingTeam.name}`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
