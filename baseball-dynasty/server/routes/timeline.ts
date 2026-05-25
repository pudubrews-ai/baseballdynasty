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

    // M4: Fetch owned team name once for masthead (spec §8: "{City} {Nickname} Gazette")
    let ownedTeamName: string | null = null;
    if (ownedTeamId !== null) {
      const otRow = prepared("SELECT city || ' ' || name AS full_name FROM teams WHERE id = ?")
        .get(ownedTeamId) as { full_name: string } | undefined;
      ownedTeamName = otRow?.full_name ?? null;
    }

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
      // M4: Use owned team name for masthead, not champion
      const masthead = ownedTeamName
        ? `The ${ownedTeamName} Gazette`
        : `${league.name} Gazette`;

      // Front office events for below-fold and headline
      // C2 fix: use correct column names (departing_person, incoming_person)
      let below_fold: Array<{ id: number; headline: string; reason: string | null; event_type: string }> = [];
      let topFoEvent: { reason: string | null; person: string | null; event_type: string } | null = null;
      try {
        const foEvents = prepared(
          `SELECT foe.id, foe.event_type, foe.reason, foe.departing_person, foe.incoming_person
           FROM front_office_events foe
           WHERE foe.league_id = ? AND foe.season_number = ?
           ORDER BY foe.id ASC
           LIMIT 20`
        ).all(league.id, s.season_number) as Array<{
          id: number;
          event_type: string;
          reason: string | null;
          departing_person: string | null;
          incoming_person: string | null;
        }>;

        below_fold = foEvents.slice(0, 4).map(ev => {
          const personLabel = ev.departing_person ?? ev.incoming_person ?? 'Front Office';
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

        topFoEvent = foEvents.length > 0
          ? { reason: foEvents[0]!.reason, person: foEvents[0]!.departing_person, event_type: foEvents[0]!.event_type }
          : null;
      } catch {
        // Defense-in-depth: degrade to empty below_fold if column drift occurs
        below_fold = [];
        topFoEvent = null;
      }

      const headline = buildSeasonHeadline(s.season_number, s.champion_team_name, topFoEvent);
      const lede = buildSeasonLede(s.champion_team_name, s.mvp_player_name, s.narrative);

      // Awards: M5 — derive at read time from season_stats (no persisted award columns needed)
      let mvpName: string | null = s.mvp_player_name ?? null;
      let cyYoungName: string | null = null;
      let topProspectName: string | null = null;
      try {
        if (mvpName === null) {
          const mvp = prepared(
            `SELECT p.first_name, p.last_name
             FROM season_stats ss JOIN players p ON p.id = ss.player_id
             WHERE ss.league_id = ? AND ss.season_number = ? AND ss.at_bats >= 40
               AND (p.position IS NULL OR p.position NOT IN ('SP','RP'))
             ORDER BY (ss.hits + 2*ss.home_runs) DESC LIMIT 1`
          ).get(league.id, s.season_number) as { first_name: string; last_name: string } | undefined;
          if (mvp) mvpName = `${mvp.first_name} ${mvp.last_name}`;
        }
        const cy = prepared(
          `SELECT p.first_name, p.last_name
           FROM season_stats ss JOIN players p ON p.id = ss.player_id
           WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched >= 25
           ORDER BY (ss.earned_runs * 9.0 / ss.innings_pitched) ASC LIMIT 1`
        ).get(league.id, s.season_number) as { first_name: string; last_name: string } | undefined;
        if (cy) cyYoungName = `${cy.first_name} ${cy.last_name}`;
        const tp = prepared(
          `SELECT p.first_name, p.last_name
           FROM players p
           LEFT JOIN season_stats ss ON ss.player_id = p.id AND ss.league_id = ? AND ss.season_number = ?
           WHERE p.league_id = ? AND p.minor_level IS NOT NULL
           ORDER BY COALESCE(ss.games_played,0) DESC, p.overall_rating DESC LIMIT 1`
        ).get(league.id, s.season_number, league.id) as { first_name: string; last_name: string } | undefined;
        if (tp) topProspectName = `${tp.first_name} ${tp.last_name}`;
      } catch { /* leave awards null */ }

      const isChampionEdition = ownedTeamId !== null && s.champion_team_id === ownedTeamId;

      const newspaper = {
        masthead,
        headline,
        lede,
        is_champion_edition: isChampionEdition,
        awards: {
          mvp: mvpName,
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
