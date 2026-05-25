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
  day:      { top: '#1e90ff', bottom: '#87ceeb' },
  twilight: { top: '#3b1d6e', bottom: '#f97316' },
  night:    { top: '#0d1117', bottom: '#1a2744' },
};

const CLOUD_OPACITY: Record<string, number> = {
  clear:    0,
  cloudy:   0.4,
  overcast: 0.75,
};

const NIGHT_SKY = { top: '#0d1117', bottom: '#1a2744' };

export default function Ballpark({
  daypart, weather, attendancePct, scoreboard,
  baseRunners, isOwnedPark, isGameActive, isTurboMode,
}: BallparkProps) {
  const sky = SKY_COLORS[daypart] ?? NIGHT_SKY;
  const cloudOpacity = CLOUD_OPACITY[weather] ?? 0;
  // Owned park = slightly blue tint in the crowd; neutral = slate
  const crowdColor = isOwnedPark ? '#4a6fa5' : '#3d4f6b';
  const fillPct = isGameActive ? Math.min(1, Math.max(0, attendancePct)) : 0;

  const W = 600;
  const H = 380;

  // Outfield fence line (perspective arc)
  // Left foul pole, center field apex, right foul pole
  const FL_X = 20,       FL_Y = H * 0.62;   // left
  const FC_Y = H * 0.50;                     // center field (furthest/highest in perspective)
  const FR_X = W - 20,   FR_Y = H * 0.62;   // right

  // Stadium bowl: polygon covering the entire upper region above the outfield fence.
  // The outfield wall + grass will paint on top of the lower edge, creating
  // the natural look of bleachers receding behind the fence.
  const bowlPath = `M 0 0 L ${W} 0 L ${FR_X} ${FR_Y} Q ${W / 2} ${FC_Y} ${FL_X} ${FL_Y} L 0 ${FL_Y} Z`;

  // Max bowl height (y at foul poles) — used for crowd fill animation
  const BOWL_H = FL_Y; // H * 0.62

  return (
    <svg
      data-testid="watch-ballpark"
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-label="Ballpark view"
    >
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sky.top} />
          <stop offset="100%" stopColor={sky.bottom} />
        </linearGradient>
        <radialGradient id="fieldGrad" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#2d5a1e" />
          <stop offset="100%" stopColor="#1a3a12" />
        </radialGradient>
        {/* Bowl clip — crowd fill rect is clipped to bowl shape */}
        <clipPath id="bowlClip">
          <path d={bowlPath} />
        </clipPath>
      </defs>

      {/* Sky */}
      <rect x={0} y={0} width={W} height={H} fill="url(#skyGrad)" />

      {/* Clouds */}
      {cloudOpacity > 0 && (
        <g opacity={cloudOpacity}>
          <ellipse cx={120} cy={50} rx={80} ry={22} fill="#c8d8e8" />
          <ellipse cx={320} cy={34} rx={110} ry={26} fill="#d0dde8" />
          <ellipse cx={500} cy={58} rx={70} ry={20} fill="#c8d8e8" />
        </g>
      )}

      {/* ===== STADIUM BOWL (bleachers + crowd) ===== */}
      <g data-testid="watch-crowd">
        {/* Empty seat base — dark stadium interior */}
        <path d={bowlPath} fill="#111827" />

        {/* Seat-row texture — thin horizontal lines across the bowl */}
        <g opacity={0.12}>
          {Array.from({ length: 20 }, (_, i) => {
            const t = (i + 0.5) / 20;
            const y = BOWL_H * t;
            // Rows narrow slightly toward the bottom (perspective foreshortening)
            const margin = t * 35;
            return (
              <line
                key={i}
                x1={margin} y1={y}
                x2={W - margin} y2={y}
                stroke="#7090b0"
                strokeWidth={0.8}
              />
            );
          })}
        </g>

        {/* Section dividers — faint vertical lines splitting LF / CF / RF */}
        <g opacity={0.06} stroke="#7090b0" strokeWidth={1.5}>
          <line x1={W * 0.32} y1={0} x2={W * 0.26} y2={BOWL_H} />
          <line x1={W * 0.68} y1={0} x2={W * 0.74} y2={BOWL_H} />
        </g>

        {/* Crowd fill — animated rect clipped to bowl shape, rises from bottom */}
        <motion.rect
          x={0}
          width={W}
          fill={crowdColor}
          opacity={0.6}
          clipPath="url(#bowlClip)"
          initial={false}
          animate={{
            y: BOWL_H * (1 - fillPct),
            height: BOWL_H * fillPct,
          }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </g>

      {/* Night light standards — four poles on the bowl rim */}
      {daypart === 'night' && (
        <g>
          {[50, 170, 430, 550].map(x => (
            <g key={x}>
              <rect x={x - 3} y={H * 0.04} width={6} height={H * 0.19} fill="#1e2535" />
              <ellipse cx={x} cy={H * 0.04} rx={12} ry={5} fill="#fffbe0" opacity={0.9} />
              <ellipse cx={x} cy={H * 0.04} rx={22} ry={9} fill="#fffbe0" opacity={0.07} />
            </g>
          ))}
        </g>
      )}

      {/* ===== OUTFIELD FENCE ===== */}
      {/* Wall face — painted over lower bowl edge */}
      <path
        d={`M ${FL_X} ${FL_Y} Q ${W / 2} ${FC_Y} ${FR_X} ${FR_Y}
            L ${FR_X} ${FR_Y + 20} Q ${W / 2} ${FC_Y + 20} ${FL_X} ${FL_Y + 20} Z`}
        fill="#1c4d2e"
      />
      {/* Fence cap stripe */}
      <path
        d={`M ${FL_X} ${FL_Y} Q ${W / 2} ${FC_Y} ${FR_X} ${FR_Y}`}
        fill="none"
        stroke="#2d7a42"
        strokeWidth={3}
      />

      {/* Foul lines (perspective) */}
      <line x1={W / 2} y1={H * 0.89} x2={FL_X + 8} y2={FL_Y + 16} stroke="white" strokeWidth={1.5} opacity={0.35} />
      <line x1={W / 2} y1={H * 0.89} x2={FR_X - 8} y2={FR_Y + 16} stroke="white" strokeWidth={1.5} opacity={0.35} />

      {/* ===== FIELD ===== */}
      {/* Outfield grass */}
      <ellipse cx={W / 2} cy={H * 0.76} rx={W * 0.48} ry={H * 0.25} fill="url(#fieldGrad)" />

      {/* Warning track */}
      <path
        d={`M ${FL_X + 22} ${FL_Y + 18} Q ${W / 2} ${FC_Y + 18} ${FR_X - 22} ${FR_Y + 18}`}
        fill="none"
        stroke="#7a5c30"
        strokeWidth={28}
        opacity={0.5}
      />

      {/* Infield dirt */}
      <ellipse cx={W / 2} cy={H * 0.80} rx={W * 0.18} ry={H * 0.11} fill="#8a6030" />

      {/* Base paths */}
      {/* Home plate */}
      <polygon
        points={`${W / 2},${H * 0.88} ${W / 2 - 8},${H * 0.86} ${W / 2 - 8},${H * 0.83} ${W / 2 + 8},${H * 0.83} ${W / 2 + 8},${H * 0.86}`}
        fill="#fff"
      />
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

      {/* Scoreboard — mounted on the left-field fence face */}
      <g data-testid="watch-scoreboard">
        <rect x={34} y={H * 0.36} width={164} height={90} fill="#0d1117" rx={4} stroke="#f59e0b" strokeWidth={2} />
        <rect x={40} y={H * 0.36 + 6} width={152} height={18} fill="#1a2744" rx={2} />
        <text x={116} y={H * 0.36 + 19} textAnchor="middle" fill="#f59e0b" fontSize={12} fontFamily="'Bebas Neue', sans-serif" letterSpacing={1}>
          {isGameActive && scoreboard ? scoreboard.awayTeamName : 'STADIUM'}
        </text>

        {isGameActive && scoreboard ? (
          <>
            <text x={76} y={H * 0.36 + 44} fill="#94a3b8" fontSize={10} fontFamily="Inter, sans-serif">
              {scoreboard.awayTeamName.substring(0, 8)}
            </text>
            <text x={76} y={H * 0.36 + 58} fill="#94a3b8" fontSize={10} fontFamily="Inter, sans-serif">
              {scoreboard.homeTeamName.substring(0, 8)}
            </text>
            {/* Split-flap score — spins in turbo mode */}
            <motion.text
              data-testid="watch-scoreboard-spin"
              x={162} y={H * 0.36 + 44}
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
              x={162} y={H * 0.36 + 58}
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
            <text x={116} y={H * 0.36 + 76} textAnchor="middle" fill="#6b7280" fontSize={10} fontFamily="Inter, sans-serif">
              {`INN ${scoreboard.inning}`}
            </text>
          </>
        ) : (
          <text x={116} y={H * 0.36 + 58} textAnchor="middle" fill="#334155" fontSize={11} fontFamily="Inter, sans-serif">
            {isGameActive ? 'LOADING' : 'OFFSEASON'}
          </text>
        )}
      </g>

      {/* Diamond base runner overlay */}
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

      {/* Turbo: dark overlay + flashing TURBO text */}
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
