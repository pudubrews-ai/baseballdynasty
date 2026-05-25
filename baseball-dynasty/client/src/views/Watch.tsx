// Watch Tab — Aquarium Mode (v0.3.0)
// Three-zone immersive layout: Ballpark (60%) | Front Office (20%) | City Skyline (20%)
// Bottom bar: news ticker. Owner directives panel bottom-left.
// All text content is React text nodes — never dangerouslySetInnerHTML.

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLeagueState } from '../hooks/useLeagueState.js';
import Ballpark from '../components/watch/Ballpark.js';
import CitySkyline from '../components/watch/CitySkyline.js';
import FrontOfficeSprite from '../components/watch/FrontOfficeSprite.js';
import OwnerDirectivesPanel from '../components/watch/OwnerDirectivesPanel.js';

// ---- Types ----
interface NewspaperLike {
  masthead: string;
  headline: string;
  lede: string;
}

interface WatchOwnedTeam {
  id: number;
  name: string;
  city: string;
  color: string;
  market_size: 'small' | 'medium' | 'large' | 'mega';
  owner_name: string;
  owner_personality: string;
  owner_patience: number;
  owner_net_worth_tier: string;
  gm_name: string;
  gm_archetype: string;
  manager_name: string;
  interim_gm: number;
  interim_manager: number;
  wins: number;
  losses: number;
  winPct: number;
  streak: string;
  last10: string;
  attendancePct: number;
  stadiumCapacity: number;
  weather: 'clear' | 'cloudy' | 'overcast';
  daypart: 'day' | 'twilight' | 'night';
}

interface WatchLatestGame {
  gameId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  gameNumber: number;
  gameDate: number;
}

interface WatchState {
  ownedTeamId: number | null;
  phase: 'draft' | 'regular_season' | 'playoffs' | 'offseason';
  latestGame: WatchLatestGame | null;
  ownedTeam: WatchOwnedTeam | null;
  gmConfidence: number | null;
  fireworks: boolean;
}

interface DirectiveAvailability { available: boolean; reason: string | null; }
interface DirectiveStatus {
  goForIt: DirectiveAvailability;
  rebuild: DirectiveAvailability;
  targetPlayer: DirectiveAvailability;
  fireManager: DirectiveAvailability;
  trustProcess: DirectiveAvailability;
}

interface TickerItem {
  id: number;
  badge: string;
  headline_text: string | null;
  event_type: string;
  game_number: number;
}

// ---- Helpers ----
async function fetchWatchState(): Promise<WatchState | null> {
  try {
    const res = await fetch('/api/watch');
    if (!res.ok) return null;
    return res.json() as Promise<WatchState>;
  } catch {
    return null;
  }
}

async function fetchDirectiveStatus(): Promise<DirectiveStatus | null> {
  try {
    const res = await fetch('/api/directive/status');
    if (!res.ok) return null;
    return res.json() as Promise<DirectiveStatus>;
  } catch {
    return null;
  }
}

async function fetchTicker(): Promise<TickerItem[]> {
  try {
    const res = await fetch('/api/news?limit=8');
    if (!res.ok) return [];
    return res.json() as Promise<TickerItem[]>;
  } catch {
    return [];
  }
}

// ---- News ticker (bottom bar) ----
function WatchNewsTicker({ items, paused }: { items: TickerItem[]; paused: boolean }) {
  const text = items
    .map(i => `[${i.badge}] ${i.headline_text ?? i.event_type}`)
    .join('   ·   ');

  return (
    <div
      data-testid="watch-news-ticker"
      style={{
        background: '#0d1117',
        borderTop: '1px solid #1e3a5f',
        padding: '6px 0',
        overflow: 'hidden',
        height: '30px',
        position: 'relative',
      }}
    >
      {items.length === 0 ? (
        <span style={{ color: '#334155', fontSize: '12px', paddingLeft: '16px' }}>No live updates</span>
      ) : (
        <motion.div
          animate={paused ? {} : { x: [0, -(text.length * 7)] }}
          transition={{ duration: Math.max(20, text.length * 0.15), repeat: Infinity, ease: 'linear' }}
          style={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
            fontSize: '12px',
            color: '#94a3b8',
            fontFamily: 'Inter, sans-serif',
            paddingLeft: '16px',
          }}
        >
          {text}
        </motion.div>
      )}
    </div>
  );
}

// ---- Emotion helper ----
type EmotionState = 'neutral' | 'happy' | 'anxious' | 'angry' | 'celebrating';

function deriveEmotion(team: WatchOwnedTeam | null, fireworks: boolean): EmotionState {
  if (!team) return 'neutral';
  if (fireworks) return 'celebrating';
  const gp = team.wins + team.losses;
  if (gp === 0) return 'neutral';
  const streak = team.streak ?? '';
  const streakN = parseInt(streak.slice(1), 10) || 0;
  if (streak.startsWith('W') && streakN >= 5) return 'happy';   // 5+ win streak
  if (streak.startsWith('L') && streakN >= 5) return 'anxious'; // 5+ loss streak
  const winPct = team.wins / gp;
  if (winPct >= 0.6) return 'happy';
  if (winPct <= 0.35) return 'angry';
  return 'neutral';
}

// ---- Turbo headline flash ----
function TurboHeadlineFlash({ items }: { items: TickerItem[] }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (items.length === 0) return;
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), 200);
    return () => clearInterval(t);
  }, [items.length]);

  const item = items[idx];
  if (!item) return null;

  return (
    <motion.div
      data-testid="watch-turbo-headline-flash"
      key={idx}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.05 }}
      style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(13,17,23,0.75)',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: '28px',
        color: '#f59e0b',
        letterSpacing: '0.05em',
        textAlign: 'center',
        maxWidth: '70%',
      }}>
        {item.headline_text ?? item.event_type}
      </div>
    </motion.div>
  );
}

// ---- Main Watch component ----
export default function Watch() {
  const { state } = useLeagueState();
  const [watchState, setWatchState] = useState<WatchState | null>(null);
  const [directiveStatus, setDirectiveStatus] = useState<DirectiveStatus | null>(null);
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const [tickerPaused, setTickerPaused] = useState(false);
  const lastNewsIdRef = useRef<number>(0);
  const prevPhaseRef = useRef<string | null>(null);
  const [seasonEndPaper, setSeasonEndPaper] = useState<NewspaperLike | null>(null);

  const isTurbo = state?.simSpeed === 'turbo';

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const ws = await fetchWatchState();
      if (!cancelled) setWatchState(ws);
      const ds = await fetchDirectiveStatus();
      if (!cancelled) setDirectiveStatus(ds);
    };

    void refresh();
    const interval = setInterval(() => void refresh(), isTurbo ? 1000 : 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isTurbo, state?.lastNewsId]);

  // Refresh ticker when news changes
  useEffect(() => {
    if ((state?.lastNewsId ?? 0) === lastNewsIdRef.current) return;
    lastNewsIdRef.current = state?.lastNewsId ?? 0;
    fetchTicker().then(setTickerItems).catch(() => {});
  }, [state?.lastNewsId]);

  // Initial ticker load
  useEffect(() => {
    fetchTicker().then(setTickerItems).catch(() => {});
  }, []);

  // M6: Season-end newspaper drop — hold ≥1.5s on phase transition into playoffs/offseason
  useEffect(() => {
    const p = watchState?.phase ?? state?.phase ?? null;
    const prev = prevPhaseRef.current;
    if (prev && prev !== p && (p === 'playoffs' || p === 'offseason')) {
      fetch('/api/timeline').then(r => r.ok ? r.json() : []).then((arr: unknown[]) => {
        const firstEntry = arr?.[0] as { newspaper?: NewspaperLike } | undefined;
        const latest = firstEntry?.newspaper ?? null;
        if (latest) {
          setSeasonEndPaper(latest);
          setTimeout(() => setSeasonEndPaper(null), 1500); // non-skippable, even in turbo
        }
      }).catch(() => {});
    }
    prevPhaseRef.current = p ?? null;
  }, [watchState?.phase, state?.phase]);

  const team = watchState?.ownedTeam ?? null;
  const latestGame = watchState?.latestGame ?? null;
  const phase = watchState?.phase ?? 'offseason';
  const fireworks = watchState?.fireworks ?? false;
  const ownedTeamId = watchState?.ownedTeamId ?? null;
  const emotion = deriveEmotion(team, fireworks);

  const isGameActive = phase === 'regular_season' || phase === 'playoffs';
  const isOffseason = phase === 'offseason';

  const ownerPersonalityNormalized = (team?.owner_personality ?? 'moderate')
    .toLowerCase()
    .replace(/[^a-z-]/g, '') as 'meddling' | 'hands-off' | 'win-now' | 'patient';

  // D1: cosmetic, deterministic base state — NOT real sim state.
  const BASE_PATTERNS: Array<{ first: boolean; second: boolean; third: boolean }> = [
    { first: false, second: false, third: false }, // 0 — empty
    { first: true,  second: false, third: false }, // 1
    { first: false, second: true,  third: false }, // 2
    { first: true,  second: true,  third: false }, // 3
    { first: false, second: false, third: true  }, // 4
    { first: true,  second: false, third: true  }, // 5
    { first: false, second: true,  third: true  }, // 6
    { first: true,  second: true,  third: true  }, // 7 — bases loaded
  ];
  const baseRunners = (isGameActive && latestGame)
    ? (BASE_PATTERNS[latestGame.gameId % 8] ?? BASE_PATTERNS[0]!)
    : { first: false, second: false, third: false };

  const scoreboard = latestGame ? {
    homeTeamName: latestGame.homeTeamName,
    awayTeamName: latestGame.awayTeamName,
    homeScore: latestGame.homeScore,
    awayScore: latestGame.awayScore,
    inning: Math.min(50, Math.max(1, Math.floor((latestGame.gameNumber - 1) % 9) + 1)),
  } : null;

  const handleDirectiveIssued = () => {
    fetchDirectiveStatus().then(setDirectiveStatus).catch(() => {});
    fetchWatchState().then(setWatchState).catch(() => {});
  };

  return (
    <div
      data-testid="watch-content"
      style={{
        background: '#0d1117',
        minHeight: 'calc(100vh - 130px)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Main 3-zone layout */}
      <div style={{ display: 'flex', flex: 1, gap: 0, overflow: 'hidden', height: 'calc(100vh - 200px)', minHeight: '400px' }}>

        {/* Zone 2 — Front Office panel (20%) */}
        <div
          data-testid="watch-frontoffice-panel"
          style={{
            width: '20%',
            minWidth: '130px',
            background: '#0d1117',
            borderRight: '1px solid #1e3a5f',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
            padding: '16px 8px',
            position: 'relative',
          }}
        >
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '13px', letterSpacing: '0.08em', color: '#334155', marginBottom: '-10px' }}>
            FRONT OFFICE
          </div>
          {team ? (
            <>
              <FrontOfficeSprite
                role="owner"
                name={team.owner_name}
                badge={team.owner_personality}
                emotion={emotion}
                isInterim={false}
                isFired={false}
                ownerPersonality={ownerPersonalityNormalized}
                isGameActive={isGameActive}
              />
              <FrontOfficeSprite
                role="gm"
                name={team.gm_name}
                badge={`${team.gm_archetype} GM`}
                emotion={emotion}
                isInterim={team.interim_gm === 1}
                isFired={false}
                gmArchetype={team.gm_archetype}
                isGameActive={isGameActive}
              />
              <FrontOfficeSprite
                role="manager"
                name={team.manager_name}
                badge="Manager"
                emotion={emotion}
                isInterim={team.interim_manager === 1}
                isFired={false}
                isGameActive={isGameActive}
              />
            </>
          ) : (
            <div style={{ color: '#334155', fontSize: '12px', textAlign: 'center' }}>
              {ownedTeamId === null ? 'No franchise selected' : 'Loading...'}
            </div>
          )}
        </div>

        {/* Zone 1 — Ballpark (60%) */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {isTurbo && (
            <TurboHeadlineFlash items={tickerItems} />
          )}
          <Ballpark
            daypart={team?.daypart ?? (isOffseason ? 'night' : 'night')}
            weather={team?.weather ?? 'clear'}
            attendancePct={team?.attendancePct ?? 0}
            scoreboard={isGameActive ? scoreboard : null}
            baseRunners={baseRunners}
            isOwnedPark={ownedTeamId !== null && latestGame?.homeTeamId === ownedTeamId}
            isGameActive={isGameActive}
            isTurboMode={isTurbo}
          />

          {/* Team record overlay */}
          {team && (
            <div style={{
              position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(13,17,23,0.8)',
              border: '1px solid #1e3a5f',
              borderRadius: '6px',
              padding: '4px 12px',
              fontSize: '13px',
              color: '#e2e8f0',
              fontFamily: "'Bebas Neue', sans-serif",
              letterSpacing: '0.06em',
              pointerEvents: 'none',
            }}>
              {team.city} {team.name} · {team.wins}–{team.losses} · {team.streak}
            </div>
          )}

          {/* Owner directives panel — bottom-left of ballpark zone */}
          {ownedTeamId !== null && (
            <div style={{
              position: 'absolute',
              bottom: '44px',
              left: '8px',
            }}>
              <OwnerDirectivesPanel
                directiveStatus={directiveStatus}
                gmConfidence={watchState?.gmConfidence ?? null}
                onDirectiveIssued={handleDirectiveIssued}
              />
            </div>
          )}
        </div>

        {/* Zone 3 — City skyline (20%) */}
        <div style={{
          width: '20%',
          minWidth: '130px',
          background: '#0d1117',
          borderLeft: '1px solid #1e3a5f',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          overflow: 'hidden',
        }}>
          <CitySkyline
            marketSize={(team?.market_size as 'small' | 'medium' | 'large' | 'mega') ?? 'medium'}
            winningRecord={team ? team.wins > team.losses : false}
            playoffClinch={fireworks}
            isOffseason={isOffseason}
          />
        </div>
      </div>

      {/* Bottom bar — news ticker */}
      <div
        onMouseEnter={() => setTickerPaused(true)}
        onMouseLeave={() => setTickerPaused(false)}
      >
        <WatchNewsTicker items={tickerItems} paused={tickerPaused} />
      </div>

      {/* M6: Season-end newspaper drop overlay (held ≥1.5s, non-skippable even in turbo) */}
      {seasonEndPaper && (
        <div
          data-testid="watch-season-end-newspaper"
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(13,17,23,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div style={{
            background: '#fef9f0',
            border: '4px double #c8a86a',
            borderRadius: '4px',
            padding: '32px 40px',
            maxWidth: '500px',
            width: '90%',
            textAlign: 'center',
            fontFamily: "'Bebas Neue', sans-serif",
          }}>
            <div style={{ fontSize: '14px', color: '#8b7355', letterSpacing: '0.1em', marginBottom: '8px' }}>
              {seasonEndPaper.masthead}
            </div>
            <div style={{ fontSize: '32px', color: '#1a1a1a', letterSpacing: '0.05em', lineHeight: 1.1 }}>
              {seasonEndPaper.headline}
            </div>
            <div style={{ marginTop: '12px', fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#4a3f30', lineHeight: 1.5 }}>
              {seasonEndPaper.lede}
            </div>
          </div>
        </div>
      )}

      {/* Phase badge */}
      <AnimatePresence>
        {phase !== 'offseason' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              background: phase === 'playoffs' ? '#f59e0b' : phase === 'regular_season' ? '#10b981' : '#6366f1',
              color: '#000',
              padding: '3px 10px',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: "'Bebas Neue', sans-serif",
              letterSpacing: '0.08em',
              fontWeight: 'bold',
            }}
          >
            {phase === 'regular_season' ? 'REGULAR SEASON' : phase === 'playoffs' ? 'PLAYOFFS' : 'DRAFT'}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
