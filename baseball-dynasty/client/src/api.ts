// API fetch wrappers for all /api endpoints
// Throws on non-2xx with status code

export interface ApiError {
  status: number;
  message: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'unknown' })) as { error: string };
    const err: ApiError = { status: res.status, message: body.error ?? 'unknown_error' };
    throw err;
  }

  return res.json() as Promise<T>;
}

export function getState(params?: { sincePickId?: number; sinceGameId?: number }): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params?.sincePickId) qs.set('sincePickId', String(params.sincePickId));
  if (params?.sinceGameId) qs.set('sinceGameId', String(params.sinceGameId));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch(`/api/state${query}`);
}

export function createLeague(options?: { seed?: number; leagueName?: string }): Promise<{ leagueId: number; worldgenSeed: number }> {
  return apiFetch('/api/league/new', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

export function deleteLeague(): Promise<{ ok: boolean }> {
  return apiFetch('/api/league/current', { method: 'DELETE' });
}

export function setSimSpeed(speed: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/sim/speed', {
    method: 'POST',
    body: JSON.stringify({ speed }),
  });
}

export function advanceSim(): Promise<{ ok: boolean }> {
  return apiFetch('/api/sim/advance', { method: 'POST', body: '{}' });
}

export function getStandings(): Promise<unknown> {
  return apiFetch('/api/standings');
}

export function getTeams(): Promise<unknown[]> {
  return apiFetch('/api/teams');
}

export function getTeam(id: number): Promise<unknown> {
  return apiFetch(`/api/teams/${id}`);
}

export function getTeamRoster(id: number): Promise<unknown[]> {
  return apiFetch(`/api/teams/${id}/roster`);
}

export function getTeamMinors(id: number): Promise<unknown[]> {
  return apiFetch(`/api/teams/${id}/minors`);
}

export function getTeamHistory(id: number): Promise<unknown> {
  return apiFetch(`/api/teams/${id}/history`);
}

export function getTeamFinancials(id: number): Promise<unknown> {
  return apiFetch(`/api/teams/${id}/financials`);
}

export function getPlayer(id: number): Promise<unknown> {
  return apiFetch(`/api/players/${id}`);
}

export function getPlayerLeaders(): Promise<unknown> {
  return apiFetch('/api/players/leaders');
}

export function searchPlayers(q: string): Promise<unknown[]> {
  return apiFetch(`/api/players/search?q=${encodeURIComponent(q)}`);
}

export function getRecentGames(): Promise<unknown[]> {
  return apiFetch('/api/games/recent');
}

export function getGame(id: number): Promise<unknown> {
  return apiFetch(`/api/games/${id}`);
}

export function getTimeline(): Promise<unknown[]> {
  return apiFetch('/api/timeline');
}

export function getTransactions(): Promise<unknown[]> {
  return apiFetch('/api/transactions');
}
