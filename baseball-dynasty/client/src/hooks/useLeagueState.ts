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
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const poll = async () => {
    try {
      const response = await getState({
        sincePickId: lastPickIdRef.current,
        sinceGameId: lastGameIdRef.current,
      }) as Record<string, unknown>;

      if (response['noLeague']) {
        setState(null);
        setNoLeague(true);
        setReconnecting(false);
        return;
      }

      setNoLeague(false);
      setReconnecting(false);

      const snapshot = response as unknown as LeagueStateSnapshot & {
        picksDelta?: unknown[];
        gamesDelta?: unknown[];
      };

      setState(snapshot);

      const picks = snapshot.picksDelta ?? [];
      const games = snapshot.gamesDelta ?? [];

      if (picks.length > 0) {
        const lastPick = picks[picks.length - 1] as { id: number };
        lastPickIdRef.current = lastPick.id;
        // D11: batch-render if >20 items
        setPicksDelta(picks);
      }

      if (games.length > 0) {
        const lastGame = games[games.length - 1] as { id: number };
        lastGameIdRef.current = lastGame.id;
        setGamesDelta(games);
      }
    } catch {
      setReconnecting(true);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      // D11: 500ms during draft phases, 2000ms otherwise
      const isDraft = state?.phase === 'expansion_draft' || state?.phase === 'annual_draft';
      const interval = reconnecting ? 3000 : isDraft ? 500 : 2000;
      timeoutRef.current = setTimeout(async () => {
        await poll();
        schedule();
      }, interval);
    };

    poll().then(() => schedule());

    return () => {
      cancelled = true;
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
