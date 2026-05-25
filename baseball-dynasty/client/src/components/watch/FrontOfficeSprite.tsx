// Front Office Sprite SVG — Zone 2 of Watch tab (Aquarium Mode)
// Clean flat-illustration character (owner / gm / manager).
// Emotion states: neutral | happy | anxious | angry | celebrating
// All strings are React text nodes — never dangerouslySetInnerHTML.

import { motion } from 'framer-motion';

type SpriteRole = 'owner' | 'gm' | 'manager';
type EmotionState = 'neutral' | 'happy' | 'anxious' | 'angry' | 'celebrating';
type OwnerPersonality = 'meddling' | 'hands-off' | 'win-now' | 'patient';

interface FrontOfficeSpriteProps {
  role: SpriteRole;
  name: string;
  badge: string;
  emotion: EmotionState;
  isInterim: boolean;
  isFired: boolean;         // triggers walk-off animation
  ownerPersonality?: OwnerPersonality;
  gmArchetype?: string;
  isGameActive: boolean;
}

// Body colors by role
const ROLE_COLORS: Record<SpriteRole, { suit: string; skin: string; accent: string }> = {
  owner: { suit: '#1e3a5f', skin: '#fdbcb4', accent: '#f59e0b' },
  gm:    { suit: '#2d4a2d', skin: '#fdbcb4', accent: '#10b981' },
  manager: { suit: '#7f1d1d', skin: '#fdbcb4', accent: '#3b82f6' },
};

// Emotion → mouth curve dy, eyebrow rotation
const EMOTION_CONFIG: Record<EmotionState, { mouthScale: number; eyebrowY: number; bodyTilt: number }> = {
  neutral:     { mouthScale: 1,    eyebrowY: 0,    bodyTilt: 0   },
  happy:       { mouthScale: 1.4,  eyebrowY: -2,   bodyTilt: 0   },
  anxious:     { mouthScale: 0.6,  eyebrowY: 2,    bodyTilt: 3   },
  angry:       { mouthScale: 0.5,  eyebrowY: 4,    bodyTilt: -2  },
  celebrating: { mouthScale: 1.8,  eyebrowY: -4,   bodyTilt: 0   },
};

export default function FrontOfficeSprite({
  role, name, badge, emotion, isInterim, isFired,
  ownerPersonality, gmArchetype, isGameActive,
}: FrontOfficeSpriteProps) {
  const colors = ROLE_COLORS[role];
  const emo = EMOTION_CONFIG[emotion];

  // Idle animation per personality/archetype
  const getMeddleAnim = () => {
    if (role === 'owner' && ownerPersonality === 'meddling' && isGameActive) {
      return { x: [-4, 4, -4], transition: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } };
    }
    if (role === 'gm' && gmArchetype === 'analytics' && isGameActive) {
      return { y: [-2, 0, -2], transition: { duration: 1.8, repeat: Infinity } };
    }
    if (emotion === 'celebrating') {
      return { y: [-5, 0, -5], transition: { duration: 0.5, repeat: Infinity } };
    }
    return {};
  };

  // Walk-off animation
  const walkOffAnim = isFired
    ? { x: 200, opacity: 0, transition: { duration: 0.6, ease: 'easeIn' } }
    : {};

  const testId = `watch-${role}-sprite`;

  return (
    <motion.div
      data-testid={testId}
      animate={{ ...getMeddleAnim(), ...walkOffAnim }}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', userSelect: 'none' }}
    >
      <svg viewBox="0 0 60 100" style={{ width: '56px', height: '90px' }} aria-label={`${role} sprite`}>
        {/* Body tilt group */}
        <g transform={`rotate(${emo.bodyTilt}, 30, 60)`}>
          {/* Head */}
          <circle cx={30} cy={22} r={14} fill={colors.skin} />
          {/* Eyes */}
          <circle cx={24} cy={20} r={2.5} fill="#1a1208" />
          <circle cx={36} cy={20} r={2.5} fill="#1a1208" />
          {/* Eyebrows */}
          <line x1={20} y1={14 + emo.eyebrowY} x2={28} y2={13 + emo.eyebrowY} stroke="#5a3e28" strokeWidth={1.5} strokeLinecap="round" />
          <line x1={32} y1={13 + emo.eyebrowY} x2={40} y2={14 + emo.eyebrowY} stroke="#5a3e28" strokeWidth={1.5} strokeLinecap="round" />
          {/* Mouth — scale vertically for emotion */}
          <path
            d={`M 24 28 Q 30 ${28 + 4 * emo.mouthScale} 36 28`}
            stroke="#5a3e28" strokeWidth={1.5} fill="none" strokeLinecap="round"
          />
          {/* Hair */}
          <path d="M 16 18 Q 30 8 44 18" fill="#4a3020" />

          {/* Suit/body */}
          {role === 'manager' ? (
            // Baseball jersey
            <g>
              <rect x={14} y={36} width={32} height={36} fill={colors.suit} rx={4} />
              {/* Jersey stripes */}
              <line x1={30} y1={38} x2={30} y2={70} stroke="#dc2626" strokeWidth={1.5} />
            </g>
          ) : (
            // Suit
            <g>
              <rect x={14} y={36} width={32} height={36} fill={colors.suit} rx={4} />
              {/* Lapels */}
              <path d="M 22 36 L 28 48 L 30 44 L 32 48 L 38 36" fill="#1a2a40" />
              {/* Tie */}
              <polygon points="29,44 31,44 30,56" fill={colors.accent} />
            </g>
          )}

          {/* Arms */}
          {gmArchetype === 'analytics' && role === 'gm' ? (
            // Leaning forward — arms forward
            <g>
              <line x1={14} y1={44} x2={6} y2={56} stroke={colors.suit} strokeWidth={7} strokeLinecap="round" />
              <line x1={46} y1={44} x2={54} y2={56} stroke={colors.suit} strokeWidth={7} strokeLinecap="round" />
            </g>
          ) : gmArchetype === 'old-school' && role === 'gm' ? (
            // Arms crossed
            <g>
              <line x1={14} y1={44} x2={28} y2={52} stroke={colors.suit} strokeWidth={7} strokeLinecap="round" />
              <line x1={46} y1={44} x2={32} y2={52} stroke={colors.suit} strokeWidth={7} strokeLinecap="round" />
            </g>
          ) : (
            // Default arms
            <g>
              <line x1={14} y1={44} x2={8} y2={58} stroke={colors.suit} strokeWidth={7} strokeLinecap="round" />
              <line x1={46} y1={44} x2={52} y2={58} stroke={colors.suit} strokeWidth={7} strokeLinecap="round" />
            </g>
          )}

          {/* Legs */}
          <rect x={18} y={72} width={10} height={22} fill="#263040" rx={3} />
          <rect x={32} y={72} width={10} height={22} fill="#263040" rx={3} />
          {/* Shoes */}
          <ellipse cx={23} cy={94} rx={8} ry={4} fill="#111827" />
          <ellipse cx={37} cy={94} rx={8} ry={4} fill="#111827" />

          {/* Manager's cap */}
          {role === 'manager' && (
            <g>
              <rect x={18} y={10} width={24} height={8} fill={colors.suit} rx={2} />
              <rect x={16} y={14} width={28} height={4} fill={colors.suit} rx={2} />
            </g>
          )}

          {/* Celebrating arms up */}
          {emotion === 'celebrating' && (
            <g>
              <line x1={14} y1={44} x2={4} y2={32} stroke={colors.suit} strokeWidth={7} strokeLinecap="round" />
              <line x1={46} y1={44} x2={56} y2={32} stroke={colors.suit} strokeWidth={7} strokeLinecap="round" />
            </g>
          )}
        </g>
      </svg>

      {/* Name label */}
      <div style={{ textAlign: 'center', fontSize: '11px', color: '#f9fafb', fontFamily: 'Inter, sans-serif', maxWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </div>
      {/* Role badge */}
      <div style={{
        background: isInterim ? '#6b7280' : colors.accent,
        color: isInterim ? '#fff' : '#000',
        padding: '1px 6px',
        borderRadius: '3px',
        fontSize: '9px',
        fontWeight: 'bold',
        fontFamily: 'Inter, sans-serif',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        {isInterim ? 'INTERIM' : badge}
      </div>
    </motion.div>
  );
}
