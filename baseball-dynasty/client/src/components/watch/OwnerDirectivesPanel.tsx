// Owner Directives Panel — persistent panel in Watch tab, bottom-left
// Five directive buttons with cooldown state, confirmation modal.
// All text rendered as React text nodes — never dangerouslySetInnerHTML.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface DirectiveStatus {
  go_for_it: { available: boolean; last_used_season: number | null };
  rebuild: { available: boolean; last_used_season: number | null };
  target_player: { available: boolean; uses_this_season: number };
  fire_manager: { available: boolean; last_used_season: number | null };
  trust_process: { available: boolean; last_used_season: number | null };
  gm_confidence: number;
}

interface OwnerDirectivesPanelProps {
  directiveStatus: DirectiveStatus | null;
  onDirectiveIssued: () => void;
}

const DIRECTIVE_INFO = [
  {
    id: 'go_for_it' as const,
    label: 'Go For It',
    desc: 'Shift to aggressive buyer at trade deadline; open checkbook for one FA above budget',
    testId: 'directive-go-for-it',
    confirmText: 'Issue "Go For It" directive? GM will pursue aggressive strategy this season.',
    accentColor: '#10b981',
  },
  {
    id: 'rebuild' as const,
    label: 'Start Rebuilding',
    desc: 'Shift to seller mode; prospects untouchable; veterans available',
    testId: 'directive-rebuild',
    confirmText: 'Issue "Start Rebuilding" directive? Veterans will be made available.',
    accentColor: '#6366f1',
  },
  {
    id: 'target_player' as const,
    label: 'I Want That Player',
    desc: 'Flag a player as priority acquisition target (2× per season)',
    testId: 'directive-target-player',
    confirmText: 'Make this player a priority acquisition target?',
    accentColor: '#f59e0b',
  },
  {
    id: 'fire_manager' as const,
    label: 'This Manager Has Lost Me',
    desc: 'Fire manager immediately regardless of record (−10 GM confidence)',
    testId: 'directive-fire-manager',
    confirmText: 'Fire the manager immediately? This costs −10 GM confidence.',
    accentColor: '#ef4444',
  },
  {
    id: 'trust_process' as const,
    label: 'Trust The Process',
    desc: 'Lock out in-season firings; signal patience (+5 GM confidence)',
    testId: 'directive-trust-process',
    confirmText: 'Issue "Trust The Process"? Locks out firings and signals patience to the org.',
    accentColor: '#3b82f6',
  },
] as const;

type DirectiveId = typeof DIRECTIVE_INFO[number]['id'];

async function issueDirective(directiveId: DirectiveId, body?: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  const endpointMap: Record<DirectiveId, string> = {
    go_for_it: '/api/directive/go-for-it',
    rebuild: '/api/directive/rebuild',
    target_player: '/api/directive/target-player',
    fire_manager: '/api/directive/fire-manager',
    trust_process: '/api/directive/trust-process',
  };
  const res = await fetch(endpointMap[directiveId], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json() as { ok: boolean; message?: string };
  return data;
}

function isDirectiveAvailable(status: DirectiveStatus | null, id: DirectiveId): boolean {
  if (!status) return false;
  if (id === 'go_for_it') return status.go_for_it.available;
  if (id === 'rebuild') return status.rebuild.available;
  if (id === 'target_player') return status.target_player.available;
  if (id === 'fire_manager') return status.fire_manager.available;
  if (id === 'trust_process') return status.trust_process.available;
  return false;
}

function DirectiveCooldownText({ status, id }: { status: DirectiveStatus | null; id: DirectiveId }) {
  if (!status) return null;
  if (id === 'target_player') {
    const uses = status.target_player.uses_this_season;
    if (uses >= 2) return <span style={{ color: '#ef4444', fontSize: '10px' }}>Cooldown: 2/2 used</span>;
    return <span style={{ color: '#10b981', fontSize: '10px' }}>{2 - uses} use{2 - uses === 1 ? '' : 's'} remaining</span>;
  }
  const s = status[id as Exclude<DirectiveId, 'target_player'>];
  if ('last_used_season' in s && s.last_used_season !== null) {
    return <span style={{ color: '#6b7280', fontSize: '10px' }}>Used S{s.last_used_season}</span>;
  }
  return <span style={{ color: '#10b981', fontSize: '10px' }}>Available</span>;
}

export default function OwnerDirectivesPanel({ directiveStatus, onDirectiveIssued }: OwnerDirectivesPanelProps) {
  const [pendingDirective, setPendingDirective] = useState<DirectiveId | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const pendingInfo = DIRECTIVE_INFO.find(d => d.id === pendingDirective);

  const handleConfirm = async () => {
    if (!pendingDirective) return;
    setIssuing(true);
    try {
      const result = await issueDirective(pendingDirective);
      setLastMessage(result.message ?? (result.ok ? 'Directive issued.' : 'Could not issue directive.'));
      if (result.ok) onDirectiveIssued();
    } catch {
      setLastMessage('Network error issuing directive.');
    } finally {
      setIssuing(false);
      setPendingDirective(null);
    }
  };

  const confidence = directiveStatus?.gm_confidence ?? 100;
  const confidenceColor = confidence >= 70 ? '#10b981' : confidence >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div
      data-testid="owner-directives-panel"
      style={{
        background: 'rgba(13,17,23,0.95)',
        border: '1px solid #2a3a50',
        borderRadius: '8px',
        padding: '12px',
        width: '200px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* GM Confidence indicator */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>GM Confidence</span>
          <span
            data-testid="gm-confidence-indicator"
            style={{ fontSize: '13px', fontWeight: 700, color: confidenceColor }}
          >
            {confidence}
          </span>
        </div>
        <div style={{ background: '#1e293b', borderRadius: '3px', height: '4px', overflow: 'hidden' }}>
          <motion.div
            style={{ height: '100%', background: confidenceColor, borderRadius: '3px' }}
            animate={{ width: `${confidence}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      {/* Directive buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {DIRECTIVE_INFO.map(d => {
          const available = isDirectiveAvailable(directiveStatus, d.id);
          return (
            <div key={d.id}>
              <button
                data-testid={d.testId}
                disabled={!available}
                onClick={() => {
                  setLastMessage(null);
                  setPendingDirective(d.id);
                }}
                title={d.desc}
                style={{
                  width: '100%',
                  background: available ? `${d.accentColor}22` : '#1e293b',
                  border: `1px solid ${available ? d.accentColor : '#334155'}`,
                  color: available ? d.accentColor : '#4b5563',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  cursor: available ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                  fontWeight: 600,
                  textAlign: 'left',
                  display: 'block',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {d.label}
              </button>
              <div style={{ paddingLeft: '4px', marginTop: '1px' }}>
                <DirectiveCooldownText status={directiveStatus} id={d.id} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Last result message */}
      {lastMessage && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #1e293b', paddingTop: '6px' }}>
          {lastMessage}
        </div>
      )}

      {/* Confirmation modal */}
      <AnimatePresence>
        {pendingDirective && pendingInfo && (
          <motion.div
            data-testid="directive-confirm-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.75)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 2000,
            }}
            onClick={e => { if (e.target === e.currentTarget) setPendingDirective(null); }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              style={{
                background: '#161b22',
                border: `1px solid ${pendingInfo.accentColor}`,
                borderRadius: '8px',
                padding: '20px',
                maxWidth: '360px',
                width: '90%',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '22px', color: pendingInfo.accentColor, letterSpacing: '0.04em', marginBottom: '10px' }}>
                {pendingInfo.label}
              </div>
              <p style={{ color: '#e2e8f0', fontSize: '14px', lineHeight: 1.5, margin: '0 0 16px' }}>
                {pendingInfo.confirmText}
              </p>
              <p style={{ color: '#6b7280', fontSize: '12px', margin: '0 0 16px' }}>
                {pendingInfo.desc}
              </p>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setPendingDirective(null)}
                  disabled={issuing}
                  style={{
                    background: '#1e293b', color: '#94a3b8',
                    border: '1px solid #334155', padding: '8px 16px',
                    borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  Cancel
                </button>
                <button
                  data-testid="directive-confirm-button"
                  onClick={handleConfirm}
                  disabled={issuing}
                  style={{
                    background: pendingInfo.accentColor, color: '#000',
                    border: 'none', padding: '8px 16px',
                    borderRadius: '5px', cursor: issuing ? 'wait' : 'pointer',
                    fontSize: '13px', fontWeight: 700, fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {issuing ? 'Issuing...' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
