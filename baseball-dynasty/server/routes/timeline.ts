import { Router, Request, Response, NextFunction } from 'express';
import { prepared, getActiveLeague } from '../db.js';

export const timelineRouter = Router();

// Procedural headline builder (no LLM per AB-07 pattern).
function buildSeasonHeadline(
  seasonNumber: number,
  championName: string | null,
  topFoEvent: { reason: string | null; person: string | null; event_type: string | null } | null
): string {
  if (championName) {
    return `${championName} Win Season ${seasonNumber} Championship`;
  }
  if (topFoEvent?.person && topFoEvent?.event_type) {
    const verb = topFoEvent.event_type.includes('fired') ? 'Fired' : 'Departs';
    return `${topFoEvent.person} ${verb} — ${topFoEvent.reason ?? 'Front Office Change'}`;
  }
  return `Season ${seasonNumber} Concludes`;
}

function buildSeasonLede(
  championName: string | null,
  mvpName: string | null,
  narrative: string | null
): string {
  if (narrative && narrative.length > 10) {
    return narrative.substring(0, 200) + (narrative.length > 200 ? '...' : '');
  }
  if (championName) {
    return `The ${championName} claimed the championship in a memorable season${mvpName ? `, led by MVP ${mvpName}` : ''}.`;
  }
  return 'A season of change and competition across the league.';
}

// §3.4: snake_case fields + notable_events per season
// v0.3.0: adds newspaper object per season (spec §8)
timelineRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const seasons = prepared(
      `SELECT sn.season_number, sn.narrative,
       t.id as champion_team_id, t.city || ' ' || t.name as champion_team_name,
       p.id as mvp_player_id, p.first_name || ' ' || p.last_name as mvp_player_name
       FROM season_narratives sn
       LEFT JOIN teams t ON t.id = sn.champion_team_id
       LEFT JOIN players p ON p.id = sn.mvp_player_id
       WHERE sn.league_id = ?
       ORDER BY sn.season_number DESC`
    ).all(league.id) as Array<{
      season_number: number;
      narrative: string | null;
      champion_team_id: number | null;
      champion_team_name: string | null;
      mvp_player_id: number | null;
      mvp_player_name: string | null;
    }>;

    // Get owned team id for isChampionEdition
    let ownedTeamId: number | null = null;
    const fsRow = prepared('SELECT owned_team_id FROM franchise_state WHERE league_id = ?').get(league.id) as { owned_team_id: number | null } | undefined;
    if (fsRow) ownedTeamId = fsRow.owned_team_id;

    const result = seasons.map(s => {
      // Pull notable events from game_log for this season
      const eventsRaw = prepared(
        `SELECT notable_events_json FROM game_log
         WHERE league_id = ? AND season_number = ? AND notable_events_json != '[]'
         LIMIT 100`
      ).all(league.id, s.season_number) as Array<{ notable_events_json: string }>;

      const allEvents: unknown[] = [];
      for (const row of eventsRaw) {
        try {
          const arr = JSON.parse(row.notable_events_json);
          if (Array.isArray(arr)) allEvents.push(...arr);
        } catch { /* ignore malformed JSON */ }
      }
      const notable_events = allEvents.slice(0, 10);

      // --- Newspaper object (v0.3.0 spec §8) ---
      const masthead = s.champion_team_name
        ? `The ${s.champion_team_name} Gazette`
        : `${league.name} Gazette`;

      // Front office events for below-fold and headline
      const foEvents = prepared(
        `SELECT foe.id, foe.event_type, foe.reason, foe.person_name, foe.new_person_name
         FROM front_office_events foe
         WHERE foe.league_id = ? AND foe.season_number = ?
         ORDER BY foe.id ASC
         LIMIT 20`
      ).all(league.id, s.season_number) as Array<{
        id: number;
        event_type: string;
        reason: string | null;
        person_name: string | null;
        new_person_name: string | null;
      }>;

      const below_fold = foEvents.slice(0, 4).map(ev => {
        const personLabel = ev.person_name ?? ev.new_person_name ?? 'Front Office';
        const verbMap: Record<string, string> = {
          manager_fired: 'fired',
          gm_fired: 'fired',
          manager_resigned: 'resigned',
          gm_resigned: 'resigned',
          owner_death: 'passed away',
          owner_sale: 'sold franchise',
          interim_gm_permanent: 'named permanent GM',
          interim_manager_permanent: 'named permanent manager',
        };
        const verb = verbMap[ev.event_type] ?? ev.event_type.replace(/_/g, ' ');
        return {
          id: ev.id,
          headline: `${personLabel} ${verb}`,
          reason: ev.reason ?? null,
          event_type: ev.event_type,
        };
      });

      const topFoEvent = foEvents.length > 0
        ? { reason: foEvents[0]!.reason, person: foEvents[0]!.person_name, event_type: foEvents[0]!.event_type }
        : null;

      const headline = buildSeasonHeadline(s.season_number, s.champion_team_name, topFoEvent);
      const lede = buildSeasonLede(s.champion_team_name, s.mvp_player_name, s.narrative);

      // Awards: cy_young / top_prospect from season_narratives if columns exist
      let cyYoungName: string | null = null;
      let topProspectName: string | null = null;
      try {
        const snRow = prepared(
          `SELECT cy_young_player_id, rookie_player_id FROM season_narratives WHERE league_id = ? AND season_number = ?`
        ).get(league.id, s.season_number) as { cy_young_player_id: number | null; rookie_player_id: number | null } | undefined;
        if (snRow?.cy_young_player_id) {
          const cyRow = prepared('SELECT first_name, last_name FROM players WHERE id = ?').get(snRow.cy_young_player_id) as { first_name: string; last_name: string } | undefined;
          if (cyRow) cyYoungName = `${cyRow.first_name} ${cyRow.last_name}`;
        }
        if (snRow?.rookie_player_id) {
          const rookieRow = prepared('SELECT first_name, last_name FROM players WHERE id = ?').get(snRow.rookie_player_id) as { first_name: string; last_name: string } | undefined;
          if (rookieRow) topProspectName = `${rookieRow.first_name} ${rookieRow.last_name}`;
        }
      } catch { /* columns may not exist in older schemas */ }

      const isChampionEdition = ownedTeamId !== null && s.champion_team_id === ownedTeamId;

      const newspaper = {
        masthead,
        headline,
        lede,
        is_champion_edition: isChampionEdition,
        awards: {
          mvp: s.mvp_player_name ?? null,
          cy_young: cyYoungName,
          top_prospect: topProspectName,
        },
        below_fold,
      };

      return {
        season_number: s.season_number,
        champion_team_id: s.champion_team_id,
        champion_team_name: s.champion_team_name,
        mvp_player_id: s.mvp_player_id,
        mvp_player_name: s.mvp_player_name,
        narrative: s.narrative,
        year: 2025 + s.season_number,
        notable_events,
        newspaper,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});
