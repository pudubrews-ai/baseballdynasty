// Ballpark SVG — Zone 1 of Watch tab (Aquarium Mode)
// Perspective view from behind home plate looking out.
// Daypart: 'day' | 'twilight' | 'night'
// Weather: 'clear' | 'cloudy' | 'overcast'
// All text rendered as React text nodes — never dangerouslySetInnerHTML.

import { motion } from 'framer-motion';

interface ScoreboardData {
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  inning: number;
}

interface BallparkProps {
  daypart: 'day' | 'twilight' | 'night';
  weather: 'clear' | 'cloudy' | 'overcast';
  attendancePct: number;  // 0–1
  scoreboard: ScoreboardData | null;
  baseRunners: { first: boolean; second: boolean; third: boolean };
  isOwnedPark: boolean;
  isGameActive: boolean;
  isTurboMode: boolean;
}

const SKY_COLORS: Record<string, { top: string; bottom: string }> = {
  day: { top: '#1e90ff', bottom: '#87ceeb' },
  twilight: { top: '#3b1d6e', bottom: '#f97316' },
  night: { top: '#0d1117', bottom: '#1a2744' },
};

const CLOUD_OPACITY: Record<string, number> = {
  clear: 0,
  cloudy: 0.4,
  overcast: 0.75,
};

// Split-flap score digit — simple CSS keyframe via framer-motion
function ScoreDigit({ value, turbo }: { value: number; turbo: boolean }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: turbo ? 0.05 : 0.25 }}
      style={{ display: 'inline-block', minWidth: '20px', textAlign: 'center' }}
    >
      {value}
    </motion.span>
  );
}

// Crowd section — SVG path that fills upward based on attendance
function CrowdSection({ cx, cy, width, height, fillPct, color }: {
  cx: number; cy: number; width: number; height: number;
  fillPct: number; color: string;
}) {
  const filledHeight = height * Math.min(1, Math.max(0, fillPct));
  const emptyHeight = height - filledHeight;

  return (
    <g>
      {/* Empty seats */}
      <rect x={cx - width / 2} y={cy - height} width={width} height={height} fill="#2a3040" rx={4} />
      {/* Filled seats (motion) */}
      <motion.rect
        x={cx - width / 2}
        y={cy - filledHeight}
        width={width}
        height={filledHeight}
        fill={color}
        rx={4}
        initial={false}
        animate={{ height: filledHeight, y: cy - filledHeight }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </g>
  );
}

const NIGHT_SKY = { top: '#0d1117', bottom: '#1a2744' };

export default function Ballpark({
  daypart, weather, attendancePct, scoreboard,
  baseRunners, isOwnedPark, isGameActive, isTurboMode,
}: BallparkProps) {
  const sky = SKY_COLORS[daypart] ?? NIGHT_SKY;
  const cloudOpacity = CLOUD_OPACITY[weather] ?? 0;
  const crowdColor = isOwnedPark ? '#4b5563' : '#374151';

  // Field dimensions (viewBox 600×380)
  const W = 600;
  const H = 380;

  return (
    <svg
      data-testid="watch-ballpark"
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-label="Ballpark view"
    >
      {/* Sky gradient */}
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sky.top} />
          <stop offset="100%" stopColor={sky.bottom} />
        </linearGradient>
        <radialGradient id="fieldGrad" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#2d5a1e" />
          <stop offset="100%" stopColor="#1a3a12" />
        </radialGradient>
      </defs>

      {/* Sky */}
      <rect x={0} y={0} width={W} height={H * 0.55} fill="url(#skyGrad)" />

      {/* Clouds */}
      {cloudOpacity > 0 && (
        <g opacity={cloudOpacity}>
          <ellipse cx={120} cy={60} rx={80} ry={28} fill="#c8d8e8" />
          <ellipse cx={320} cy={40} rx={110} ry={32} fill="#d0dde8" />
          <ellipse cx={500} cy={70} rx={70} ry={24} fill="#c8d8e8" />
        </g>
      )}

      {/* Night lights */}
      {daypart === 'night' && (
        <g>
          {[80, 200, 400, 520].map(x => (
            <g key={x}>
              <rect x={x - 4} y={20} width={8} height={H * 0.35} fill="#3a3a2a" />
              <ellipse cx={x} cy={20} rx={18} ry={8} fill="#fffbe0" opacity={0.9} />
            </g>
          ))}
        </g>
      )}

      {/* Outfield wall */}
      <path d={`M 30 ${H * 0.6} Q ${W / 2} ${H * 0.35} ${W - 30} ${H * 0.6}`} fill="#264d1a" stroke="#1a3410" strokeWidth={3} />

      {/* Field surface */}
      <ellipse cx={W / 2} cy={H * 0.78} rx={W * 0.48} ry={H * 0.28} fill="url(#fieldGrad)" />

      {/* Infield dirt */}
      <ellipse cx={W / 2} cy={H * 0.8} rx={W * 0.18} ry={H * 0.12} fill="#8a6030" />

      {/* Base paths */}
      {/* Home plate */}
      <polygon points={`${W / 2},${H * 0.88} ${W / 2 - 8},${H * 0.86} ${W / 2 - 8},${H * 0.83} ${W / 2 + 8},${H * 0.83} ${W / 2 + 8},${H * 0.86}`} fill="#fff" />
      {/* 1st base */}
      <rect x={W * 0.62} y={H * 0.76} width={10} height={10} fill={baseRunners.first ? '#f59e0b' : '#fff'} rx={1} />
      {/* 2nd base */}
      <rect x={W / 2 - 5} y={H * 0.66} width={10} height={10} fill={baseRunners.second ? '#f59e0b' : '#fff'} rx={1} />
      {/* 3rd base */}
      <rect x={W * 0.37} y={H * 0.76} width={10} height={10} fill={baseRunners.third ? '#f59e0b' : '#fff'} rx={1} />

      {/* Basepath lines */}
      <line x1={W / 2} y1={H * 0.875} x2={W * 0.625} y2={H * 0.765} stroke="#c8a878" strokeWidth={1} strokeDasharray="4,4" />
      <line x1={W * 0.625} y1={H * 0.765} x2={W / 2} y2={H * 0.665} stroke="#c8a878" strokeWidth={1} strokeDasharray="4,4" />
      <line x1={W / 2} y1={H * 0.665} x2={W * 0.375} y2={H * 0.765} stroke="#c8a878" strokeWidth={1} strokeDasharray="4,4" />
      <line x1={W * 0.375} y1={H * 0.765} x2={W / 2} y2={H * 0.875} stroke="#c8a878" strokeWidth={1} strokeDasharray="4,4" />

      {/* Pitcher's mound */}
      <ellipse cx={W / 2} cy={H * 0.77} rx={14} ry={8} fill="#9a7040" />

      {/* Crowd sections (3 sections: left, center, right) */}
      {isGameActive && (
        <>
          <CrowdSection cx={W * 0.22} cy={H * 0.52} width={120} height={60} fillPct={attendancePct} color={crowdColor} />
          <CrowdSection cx={W * 0.5} cy={H * 0.44} width={160} height={55} fillPct={attendancePct} color={crowdColor} />
          <CrowdSection cx={W * 0.78} cy={H * 0.52} width={120} height={60} fillPct={attendancePct} color={crowdColor} />
        </>
      )}

      {/* watch-crowd testid: contains crowd fill proportional to attendancePct */}
      <g data-testid="watch-crowd">
        <CrowdSection
          cx={W * 0.5} cy={H * 0.5} width={W * 0.7} height={40}
          fillPct={attendancePct} color={crowdColor}
        />
      </g>

      {/* Owned park glow */}
      {isOwnedPark && (
        <motion.rect
          x={0} y={0} width={W} height={H}
          fill="#3b82f6"
          opacity={0}
          animate={{ opacity: [0, 0.04, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Scoreboard (left field area) */}
      <g data-testid="watch-scoreboard">
        <rect x={40} y={H * 0.38} width={160} height={90} fill="#0d1117" rx={4} stroke="#f59e0b" strokeWidth={2} />
        <rect x={46} y={H * 0.38 + 6} width={148} height={18} fill="#1a2744" rx={2} />
        {/* Scoreboard text rendered as SVG text nodes (never innerHTML) */}
        <text x={120} y={H * 0.38 + 19} textAnchor="middle" fill="#f59e0b" fontSize={12} fontFamily="'Bebas Neue', sans-serif" letterSpacing={1}>
          {isGameActive && scoreboard ? scoreboard.awayTeamName : 'STADIUM'}
        </text>

        {isGameActive && scoreboard ? (
          <>
            <text x={80} y={H * 0.38 + 44} fill="#94a3b8" fontSize={10} fontFamily="Inter, sans-serif">
              {scoreboard.awayTeamName.substring(0, 8)}
            </text>
            <text x={80} y={H * 0.38 + 58} fill="#94a3b8" fontSize={10} fontFamily="Inter, sans-serif">
              {scoreboard.homeTeamName.substring(0, 8)}
            </text>
            {/* Split-flap score spin in turbo mode — data-testid="watch-scoreboard-spin" */}
            <motion.text
              data-testid="watch-scoreboard-spin"
              x={160} y={H * 0.38 + 44}
              textAnchor="end"
              fill="#f9fafb"
              fontSize={16}
              fontFamily="'Bebas Neue', sans-serif"
              key={isTurboMode ? `turbo-away-${Date.now() % 1000}` : `away-${scoreboard.awayScore}`}
              animate={isTurboMode ? { opacity: [1, 0.2, 1], filter: ['blur(0px)', 'blur(3px)', 'blur(0px)'] } : { opacity: 1 }}
              transition={isTurboMode ? { duration: 0.1, repeat: Infinity } : { duration: 0.25 }}
            >
              {scoreboard.awayScore}
            </motion.text>
            <motion.text
              x={160} y={H * 0.38 + 58}
              textAnchor="end"
              fill="#f9fafb"
              fontSize={16}
              fontFamily="'Bebas Neue', sans-serif"
              key={isTurboMode ? `turbo-home-${Date.now() % 1000}` : `home-${scoreboard.homeScore}`}
              animate={isTurboMode ? { opacity: [1, 0.2, 1], filter: ['blur(0px)', 'blur(3px)', 'blur(0px)'] } : { opacity: 1 }}
              transition={isTurboMode ? { duration: 0.1, repeat: Infinity, delay: 0.05 } : { duration: 0.25 }}
            >
              {scoreboard.homeScore}
            </motion.text>
            <text x={120} y={H * 0.38 + 76} textAnchor="middle" fill="#6b7280" fontSize={10} fontFamily="Inter, sans-serif">
              {`INN ${scoreboard.inning}`}
            </text>
          </>
        ) : (
          <text x={120} y={H * 0.38 + 58} textAnchor="middle" fill="#334155" fontSize={11} fontFamily="Inter, sans-serif">
            {isGameActive ? 'LOADING' : 'OFFSEASON'}
          </text>
        )}
      </g>

      {/* Diamond base runner overlay — visual highlights */}
      <g data-testid="watch-diamond">
        {baseRunners.first && (
          <motion.circle cx={W * 0.625 + 5} cy={H * 0.765 + 5} r={6} fill="#f59e0b"
            animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
        )}
        {baseRunners.second && (
          <motion.circle cx={W / 2} cy={H * 0.665 + 5} r={6} fill="#f59e0b"
            animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
        )}
        {baseRunners.third && (
          <motion.circle cx={W * 0.375 + 5} cy={H * 0.765 + 5} r={6} fill="#f59e0b"
            animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
        )}
      </g>

      {/* Turbo: blur overlay + calendar flash */}
      {isTurboMode && (
        <g>
          <rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0.2)" />
          <motion.text
            x={W / 2} y={H / 2}
            textAnchor="middle"
            fill="#f59e0b"
            fontSize={28}
            fontFamily="'Bebas Neue', sans-serif"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.2, repeat: Infinity }}
          >
            TURBO
          </motion.text>
        </g>
      )}
    </svg>
  );
}
