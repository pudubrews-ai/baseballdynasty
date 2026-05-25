// City Skyline SVG — Zone 3 of Watch tab (Aquarium Mode)
// Market size determines building count and profile.
// All strings rendered as React text nodes — never dangerouslySetInnerHTML.

import { motion } from 'framer-motion';

interface CitySkylineProps {
  marketSize: 'small' | 'medium' | 'large' | 'mega';
  winningRecord: boolean;
  playoffClinch: boolean;
  isOffseason: boolean;
}

// Building definitions per market size
const BUILDING_SETS: Record<string, Array<{ x: number; w: number; h: number; windows: number }>> = {
  small: [
    { x: 10, w: 30, h: 80, windows: 2 },
    { x: 50, w: 40, h: 110, windows: 3 },
    { x: 100, w: 28, h: 65, windows: 2 },
    { x: 138, w: 36, h: 95, windows: 3 },
    { x: 185, w: 24, h: 55, windows: 1 },
  ],
  medium: [
    { x: 5, w: 28, h: 90, windows: 2 },
    { x: 40, w: 36, h: 130, windows: 4 },
    { x: 85, w: 42, h: 155, windows: 5 },
    { x: 135, w: 34, h: 120, windows: 4 },
    { x: 178, w: 30, h: 100, windows: 3 },
    { x: 215, w: 26, h: 85, windows: 2 },
    { x: 250, w: 38, h: 140, windows: 4 },
  ],
  large: [
    { x: 0, w: 26, h: 100, windows: 3 },
    { x: 32, w: 34, h: 145, windows: 5 },
    { x: 72, w: 40, h: 180, windows: 6 },
    { x: 118, w: 46, h: 210, windows: 7 },
    { x: 170, w: 38, h: 175, windows: 6 },
    { x: 214, w: 32, h: 150, windows: 5 },
    { x: 252, w: 28, h: 120, windows: 4 },
    { x: 286, w: 36, h: 160, windows: 5 },
    { x: 328, w: 30, h: 130, windows: 4 },
  ],
  mega: [
    { x: 0, w: 28, h: 120, windows: 4 },
    { x: 34, w: 36, h: 170, windows: 6 },
    { x: 76, w: 44, h: 220, windows: 8 },
    { x: 126, w: 52, h: 270, windows: 10 },
    { x: 184, w: 48, h: 300, windows: 11 },
    { x: 238, w: 40, h: 240, windows: 9 },
    { x: 284, w: 36, h: 200, windows: 7 },
    { x: 326, w: 32, h: 170, windows: 6 },
    { x: 364, w: 28, h: 140, windows: 5 },
    { x: 398, w: 24, h: 110, windows: 4 },
    { x: 428, w: 34, h: 190, windows: 7 },
  ],
};

// Fireworks burst component
function Fireworks() {
  const bursts = [
    { cx: 80, cy: 60, color: '#f59e0b' },
    { cx: 180, cy: 40, color: '#3b82f6' },
    { cx: 280, cy: 55, color: '#ef4444' },
  ];

  return (
    <g>
      {bursts.map((b, i) => (
        <motion.g key={i}
          animate={{ opacity: [0, 1, 0], scale: [0.5, 1.2, 0.8] }}
          transition={{ duration: 0.8, delay: i * 0.3, repeat: Infinity, repeatDelay: 2 }}
          style={{ transformOrigin: `${b.cx}px ${b.cy}px` }}
        >
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, j) => {
            const rad = (angle * Math.PI) / 180;
            const x2 = b.cx + Math.cos(rad) * 22;
            const y2 = b.cy + Math.sin(rad) * 22;
            return <line key={j} x1={b.cx} y1={b.cy} x2={x2} y2={y2} stroke={b.color} strokeWidth={2} />;
          })}
          <circle cx={b.cx} cy={b.cy} r={4} fill={b.color} />
        </motion.g>
      ))}
    </g>
  );
}

export default function CitySkyline({ marketSize, winningRecord, playoffClinch, isOffseason }: CitySkylineProps) {
  const buildings = BUILDING_SETS[marketSize] ?? BUILDING_SETS['small'] ?? [];
  const viewBoxW = marketSize === 'mega' ? 460 : marketSize === 'large' ? 360 : marketSize === 'medium' ? 280 : 210;
  const H = 320;
  const groundY = H - 20;

  const buildingColor = winningRecord ? '#1e2d40' : '#141c26';
  const litWindowColor = winningRecord ? '#fef3c7' : '#2a3a50';
  const windowOpacity = winningRecord ? 0.9 : 0.3;

  // Snow dots for offseason
  const snowflakes = isOffseason ? Array.from({ length: 20 }, (_, i) => ({
    x: (i * 37) % viewBoxW,
    y: (i * 53) % (H - 40),
    delay: i * 0.15,
  })) : [];

  return (
    <svg
      data-testid="watch-city-skyline"
      viewBox={`0 0 ${viewBoxW} ${H}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-label="City skyline"
    >
      {/* Night sky background */}
      <rect x={0} y={0} width={viewBoxW} height={H} fill={isOffseason ? '#0a1220' : '#0d1117'} />

      {/* Moon */}
      {isOffseason && (
        <circle cx={viewBoxW - 30} cy={35} r={18} fill="#fef3c7" opacity={0.7} />
      )}

      {/* Stars */}
      {[...Array(15)].map((_, i) => (
        <motion.circle
          key={i}
          cx={(i * 71 + 20) % viewBoxW}
          cy={(i * 43 + 10) % (H * 0.4)}
          r={1}
          fill="#fff"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2 + (i % 3), repeat: Infinity, delay: i * 0.2 }}
        />
      ))}

      {/* Buildings */}
      {buildings.map((b, i) => {
        const topY = groundY - b.h;
        const litCount = Math.floor(b.windows * (winningRecord ? 0.75 : 0.25));
        return (
          <g key={i}>
            <rect x={b.x} y={topY} width={b.w} height={b.h} fill={buildingColor} />
            {/* Windows */}
            {Array.from({ length: b.windows }, (_, wi) => {
              const isLit = wi < litCount;
              const winX = b.x + 4 + (wi % 2) * (b.w / 2 - 4);
              const winY = topY + 10 + Math.floor(wi / 2) * 18;
              return (
                <motion.rect
                  key={wi}
                  x={winX} y={winY} width={8} height={10}
                  fill={isLit ? litWindowColor : '#111827'}
                  opacity={isLit ? windowOpacity : 0.5}
                  animate={isLit && winningRecord ? { opacity: [windowOpacity, windowOpacity * 0.7, windowOpacity] } : {}}
                  transition={{ duration: 3 + wi * 0.5, repeat: Infinity, delay: wi * 0.1 }}
                />
              );
            })}
            {/* Small market water tower on first building */}
            {marketSize === 'small' && i === 1 && (
              <g>
                <rect x={b.x + b.w / 2 - 4} y={topY - 20} width={8} height={20} fill="#2a3040" />
                <ellipse cx={b.x + b.w / 2} cy={topY - 20} rx={12} ry={8} fill="#334155" />
              </g>
            )}
            {/* Mega market landmark spire on tallest building */}
            {marketSize === 'mega' && i === 4 && (
              <line x1={b.x + b.w / 2} y1={topY} x2={b.x + b.w / 2} y2={topY - 40} stroke="#f59e0b" strokeWidth={2} />
            )}
          </g>
        );
      })}

      {/* Ground */}
      <rect x={0} y={groundY} width={viewBoxW} height={20} fill="#0f1a20" />

      {/* Playoff fireworks */}
      {playoffClinch && <Fireworks />}

      {/* Offseason snow */}
      {snowflakes.map((sf, i) => (
        <motion.circle
          key={i} cx={sf.x} cy={sf.y} r={1.5}
          fill="#e2e8f0" opacity={0.6}
          animate={{ y: [0, H * 0.3, 0], opacity: [0, 0.6, 0] }}
          transition={{ duration: 4 + sf.delay, repeat: Infinity, delay: sf.delay }}
        />
      ))}
    </svg>
  );
}
