import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { getState } from '../api.js';
import type { LeagueStateSnapshot } from '../../../shared/types.js';

interface LeagueStateContextValue {
  state: LeagueStateSnapshot | null;
  noLeague: boolean;
  reconnecting: boolean;
  lastPickId: number;
  lastGameId: number;
  picksDelta: unknown[];
  gamesDelta: unknown[];
}

export const LeagueStateContext = createContext<LeagueStateContextValue>({
  state: null,
  noLeague: true,
  reconnecting: false,
  lastPickId: 0,
  lastGameId: 0,
  picksDelta: [],
  gamesDelta: [],
});

export function useLeagueState(): LeagueStateContextValue {
  return useContext(LeagueStateContext);
}

export function useLeagueStatePolling(): LeagueStateContextValue {
  const [state, setState] = useState<LeagueStateSnapshot | null>(null);
  const [noLeague, setNoLeague] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [picksDelta, setPicksDelta] = useState<unknown[]>([]);
  const [gamesDelta, setGamesDelta] = useState<unknown[]>([]);
  const lastPickIdRef = useRef(0);
  const lastGameIdRef = useRef(0);
  const phaseRef = useRef<string | null>(null);
  const failureCountRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const poll = async (): Promise<void> => {
      try {
        const response = await getState({
          sincePickId: lastPickIdRef.current,
          sinceGameId: lastGameIdRef.current,
        }) as Record<string, unknown>;

        // Any success clears reconnecting state immediately
        failureCountRef.current = 0;
        setReconnecting(false);

        if (response['noLeague']) {
          setState(null);
          setNoLeague(true);
          phaseRef.current = 'no_league';
          return;
        }

        setNoLeague(false);
        const snapshot = response as unknown as LeagueStateSnapshot & {
          picksDelta?: unknown[];
          gamesDelta?: unknown[];
          lastPickId?: number;
          lastGameId?: number;
        };

        // §1.3: Bootstrap refs on first successful poll so streaming picks up recent picks
        if (lastPickIdRef.current === 0 && (snapshot.lastPickId ?? 0) > 0) {
          lastPickIdRef.current = Math.max(0, (snapshot.lastPickId ?? 0) - 50);
        }
        if (lastGameIdRef.current === 0 && (snapshot.lastGameId ?? 0) > 0) {
          lastGameIdRef.current = Math.max(0, (snapshot.lastGameId ?? 0) - 50);
        }

        setState(snapshot);
        phaseRef.current = snapshot.phase;

        const picks = snapshot.picksDelta ?? [];
        const games = snapshot.gamesDelta ?? [];

        if (picks.length > 0) {
          const lastPick = picks[picks.length - 1] as { id: number };
          lastPickIdRef.current = lastPick.id;
          setPicksDelta(picks);
        }
        if (games.length > 0) {
          const lastGame = games[games.length - 1] as { id: number };
          lastGameIdRef.current = lastGame.id;
          setGamesDelta(games);
        }
      } catch {
        failureCountRef.current += 1;
        // §2.5: Show reconnecting banner only after 2 consecutive failures (avoids flicker)
        if (failureCountRef.current >= 2) {
          setReconnecting(true);
        }
      }
    };

    const schedule = (): void => {
      if (cancelledRef.current) return;
      const isReconnecting = failureCountRef.current >= 2;
      // §1.1.4: Check for 'draft' (not 'expansion_draft'/'annual_draft')
      const isDraft = phaseRef.current === 'draft';
      // §2.7: Reduced to 1500ms from 2000ms during regular season
      const interval = isReconnecting ? 3000 : isDraft ? 500 : 1500;
      timeoutRef.current = setTimeout(async () => {
        try {
          await poll();
        } finally {
          // §2.5: ALWAYS reschedule, even if poll throws
          schedule();
        }
      }, interval);
    };

    poll().finally(() => schedule());

    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []); // Only run once on mount

  return {
    state,
    noLeague,
    reconnecting,
    lastPickId: lastPickIdRef.current,
    lastGameId: lastGameIdRef.current,
    picksDelta,
    gamesDelta,
  };
}
