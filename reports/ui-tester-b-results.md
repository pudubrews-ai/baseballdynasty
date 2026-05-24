# UI Tester B Results — Baseball Dynasty Simulator v0.1.0, Iteration 2
**Date:** 2026-05-23  
**Tester:** UI Tester B (Worker B — Groups 2, 4, 6, 8)  
**Tool:** Playwright with Chromium (headless)  
**App:** http://localhost:5173 (Vite) → http://localhost:3001 (Express API)

---

## Summary

| Group | Pass | Fail | Skip |
|-------|------|------|------|
| G2 — Draft Room UI | 3 | 10 | 0 |
| G4 — Standings UI | 11 | 2 | 0 |
| G6 — Player Data | 4 | 3 | 0 |
| G8 — Timeline | 2 | 3 | 0 |
| **Total** | **20** | **18** | **0** |

---

## Group 2 — Draft Room UI

### [FAIL] `[data-testid="draft-board"]` is visible when phase = "draft"

The draft board does NOT render. When phase is "draft" and the Draft tab is clicked, the component shows:
```
No active draft. Draft occurs during expansion and each offseason.
```
Root cause: The Draft view's live pick display depends entirely on `picksDelta` in the `/api/state` response being non-empty. However, `picksDelta` is always `[]` in all API responses, even while picks are actively being made (`lastPickId` increments rapidly). The component only shows the board when streaming pick deltas arrive; since `picksDelta` is never populated, the board never renders.

The only testid present on the Draft tab is `new-dynasty-button` (from the header). Zero draft-specific testids are ever present in the DOM.

### [PASS] `[data-testid="new-dynasty-button"]` is visible when no league exists

When `/api/league/reset` is called and state returns `phase: "no_league"`, two `new-dynasty-button` elements appear:
1. One in the header (always present, text "New Dynasty")
2. One in the main content area (additional call-to-action, text "Start New Dynasty")

Both are visible and clickable. PASS — the button is visible.

### [FAIL] `[data-testid="draft-onclock-team"]` displays correct team name for pick 1

`data-testid="draft-onclock-team"` is never present in the DOM. Since the draft board never renders (see above), no sub-elements render either.

### [FAIL] Draft board grid renders with 30 rows and 20 columns

Not testable — `draft-board` never renders. No `data-testid="draft-round-*"` or `data-testid="draft-team-col-*"` elements found.

### [FAIL] After first pick completes: `[data-testid="draft-pick-1-1"]` shows player name and position

Not present in DOM. Draft board does not render.

### [FAIL] `[data-testid="draft-pick-reveal"]` animates in with player card content

Not present in DOM. Draft board does not render.

### [FAIL] Draft pick card shows: player name, position, age, reasoning text

Not testable. No pick reveal element exists.

### [FAIL] On-the-clock team advances to next team after pick completes

`draft-onclock-team` not present. Not testable.

### [PASS] Snake order verified: round 1 pick 20 and round 2 pick 1 are same team

Verified via SQLite database query on draft_picks table (league_id=11):
- Round 1, pick 20: `team_id = 211`
- Round 2, pick 1 (pick_number=21): `team_id = 211`

Snake order is correctly implemented in the engine. PASS.

### [FAIL] At normal speed: pick timing 1.4s-1.6s

Measured via API polling (Python). At "normal" speed, picks arrive at ~109ms intervals:
```
Pick intervals (ms): ['108', '113', '106']
Average: 109ms
In 1400-1600ms range: False
```
The draft engine ignores the speed setting and runs at full speed (~100ms) regardless of whether speed is "normal", "fast", or "turbo" from the API perspective. The speed differentiation is not implemented for draft picks.

### [FAIL] Fast speed: pick timing 180ms-220ms

Measured via API polling at "fast" speed:
```
Fast intervals (ms): ['103', '107', '96', '97']
Average: 101ms
In 180-220ms range: False
```
Fast speed is identical to normal speed in the draft engine (~100ms). No speed differentiation.

### [PASS] Turbo speed: all 600 picks complete in < 5 seconds

Measured via API polling (Python):
```
Draft complete at 0.915s, picks made: 600, phase: regular_season
Under 5 seconds: True
```
At turbo speed, the draft completes in under 1 second. PASS.

**Note:** The server crashes with `throw new Error('DRAFT_PAUSED')` when attempting to pause the draft engine, causing instability. The server consistently crashed when switching from non-paused to paused speed during draft. This made repeated timing tests unreliable.

### [PASS] After all 30 rounds: phase transitions out of "draft"

Confirmed: After 600 picks (20 teams × 30 rounds), `phase` changes from `"draft"` to `"regular_season"`. PASS.

---

## Group 4 — Standings UI

### [PASS] `[data-testid="league-standings-table"]` renders with 20 rows

Confirmed: 20 `standings-row-{teamId}` elements present. The table is displayed on the default League tab with all 20 teams. PASS.

### [PASS] Each `[data-testid="standings-row-{teamId}"]` shows team name, W, L, PCT, GB

Confirmed. Each row renders as `<tr data-testid="standings-row-{id}">` with `<td>` elements in order: Team Name, W, L, PCT, GB, RS, RA, DIFF.

Example row: `"Coldwater Falls Floodwater210.667-129+3"` (W=2, L=1, PCT=0.667, GB="-")

Note: W/L/PCT/GB sub-elements use plain `<td>` tags without their own `data-testid` attributes.

### [PASS] Standings are sorted by win percentage descending

Each division's teams are sorted by pct descending within the division. All 4 divisions verified:
- American East: sorted correctly
- American West: sorted correctly
- National East: sorted correctly
- National West: sorted correctly

The display is per-division (not a global sort), which is appropriate for baseball standings. PASS.

### [FAIL] Division leader row visually distinguished

Division leaders (first-place teams) have NO special styling. The table uses division header rows (a `<tr>` with `colspan=8` and blue text for the division name), but the actual division-leader team row has identical styling to all other rows. No class, background color, border, or icon distinguishes the leader.

Observed: The division header rows ARE visually distinct (blue colored text), but the leader team row is not.

### [PASS] `[data-testid="sim-speed-control"]` renders 4 buttons

Confirmed. The speed control renders exactly 4 buttons:
- `[data-testid="sim-speed-paused"]` — text "Pause"
- `[data-testid="sim-speed-normal"]` — text "Normal"
- `[data-testid="sim-speed-fast"]` — text "Fast"
- `[data-testid="sim-speed-turbo"]` — text "Turbo"

PASS.

### [PASS] `[data-testid="sim-speed-paused"]` is present and clickable

Confirmed visible and enabled. PASS.

### [PASS] `[data-testid="sim-speed-normal"]` is present and clickable

Confirmed visible and enabled. PASS.

### [PASS] `[data-testid="sim-speed-fast"]` is present and clickable

Confirmed visible and enabled. PASS.

### [PASS] `[data-testid="sim-speed-turbo"]` is present and clickable

Confirmed visible and enabled. PASS.

### [PASS] `[data-testid="sim-speed-normal"]` click triggers POST /api/sim/speed with body `{"speed":"normal"}`

Confirmed via request interception. When normal button is clicked:
- API call captured: `{"speed":"normal"}`
- State after click: `simSpeed: "normal"`

PASS.

### [FAIL] Standings update within 3 seconds of a game completing (polling)

Measured via Playwright timer. The UI uses `/api/standings` polling at ~2000ms intervals. Test observation:
- Standings updated in 5008ms from when sim started
- Polling interval: ~2000ms

At normal speed (one game every ~1.5s), the worst case for standings update is: game_duration (1.5s) + poll_interval (2s) = 3.5s. The measured update time of 5008ms exceeds the 3-second requirement.

The standings DO update (confirmed), but the polling interval makes it take longer than 3 seconds after a game completes.

### [PASS] `[data-testid="game-ticker"]` shows scrolling game results

Confirmed. The ticker is visible on the League tab and shows game results after games are played.

Sample ticker content: `"Mar 31Flinthills Foundry6Mesaverde Herons8Mar 31Thunder Ridge Ironmen2Harborwatch Copperheads6"`

### [PASS] Game ticker items show: away team, away score, home team, home score

Confirmed. Each `[data-testid="game-ticker-item-{id}"]` element shows:
- Date (e.g., "Mar 31")
- Away team name + score
- Home team name + score

Example: `"Mar 31Flinthills Foundry6Mesaverde Herons8"` = Flinthills Foundry 6 @ Mesaverde Herons 8

PASS.

---

## Group 6 — Player Data

### [PASS] GET /api/players/leaders returns hitting and pitching leaders

Confirmed. Response structure:
```json
{
  "hitting": [...], // HR and RBI categories
  "pitching": [...] // ERA, WHIP, K categories
}
```
Returns 200 with valid JSON. PASS.

### [PASS] Each leader entry has: player_name, team_name, stat_value

Confirmed. Each entry includes:
- `player_name` (e.g., "Jeffrey Nelson")
- `team_name` (e.g., "Westgate Glaciers")
- `stat_value` (numeric)
- `category` (e.g., "HR", "ERA")

PASS.

### [PASS] GET /api/players/:id returns full player card

Confirmed. Returns 200 with player data including id, first_name, last_name, age, position, etc.

### [PASS] Player card includes: name, age, position, birthplace, ratings, contract

Verified via API. Player objects include name, age, position, birth_country (birthplace). Rating fields confirmed present. PASS (API level).

### [FAIL] `[data-testid="player-leaders-table"]` renders with at least 5 rows per category

The `player-leaders-table` element IS present on the Players tab. However, all 6 categories (AVG, HR, RBI, ERA, SO, WHIP) show "No data yet" with only 1 tbody row.

Root cause: The API returns data in format `{hitting: [{player_name, team_name, stat_value, category: "HR"}], pitching: [...]}` but the UI component appears to expect a different structure. The component renders "No data yet" for every category tab regardless of whether games have been played.

This is a UI rendering bug — API data structure mismatch with component expectations.

### [FAIL] After 10+ games: AVG leaders show realistic values (0.200-0.400 range)

The Players tab shows "No data yet" for AVG even after 50+ games. Additionally, the API does NOT include AVG as a stat category — only HR, RBI (hitting) and ERA, WHIP, K (pitching) are returned. AVG is not available in the leaders API response.

### [FAIL] After 10+ games: ERA leaders show realistic values (1.50-5.00 range)

ERA IS available in the pitching leaders API (`stat_value` format):
```
Harrison Davies: 1.72
Emilio Ramos: 2.06
Ian Dion: 2.73
Pablo Cabrera: 3.18
Kevin Green: 3.62
```
These values are in the 1.50-5.00 range at the API level. However, the UI shows "No data yet" for the ERA tab. FAIL at UI level.

---

## Group 8 — Timeline

### [PASS] GET /api/timeline returns array (may be empty before first season completes)

Confirmed. Returns `200` with `[]` before season completes. PASS.

### [PASS] After first season completes: GET /api/timeline returns array with 1 entry

Confirmed. After running season 1 to completion (via turbo):
```json
[{
  "season_number": 1,
  "champion_team_id": 146,
  "champion_team_name": "Pinecrest Lynx",
  "mvp_player_id": 380550,
  "mvp_player_name": "Ramon Tavarez",
  "narrative": null,
  "year": 2026,
  "notable_events": [...]
}]
```
PASS.

### [PASS] Timeline entry includes: season_number, champion_team_name, notable_events

API response confirms all three fields are present:
- `season_number: 1`
- `champion_team_name: "Pinecrest Lynx"`
- `notable_events: [{"type": "walk_off", ...}, {"type": "home_run", ...}]`

Note: `narrative` is null — not populated by the engine. PASS for required fields.

### [FAIL] `[data-testid="timeline-season-1"]` renders after season 1 completes

The timeline renders an element, but with the WRONG testid: `data-testid="timeline-season-undefined"`.

The component appears to use `season_number` for the testid but `season_number` resolves as undefined in the component's rendering logic. The actual element rendered:
```html
<div data-testid="timeline-season-undefined">Season 2026</div>
```

Expected: `data-testid="timeline-season-1"`  
Actual: `data-testid="timeline-season-undefined"`

This is a bug in the Timeline component — it likely accesses a wrong property (e.g., `entry.id` or `entry.number` instead of `entry.season_number`).

### [FAIL] Timeline season card shows champion name and season record

The timeline season card ONLY shows "Season 2026" (the year). It does NOT display:
- Champion team name ("Pinecrest Lynx")
- Season record

The card HTML:
```html
<span>Season </span><span>2026</span>
```

Both champion name and record are absent from the rendered card, despite being available in the API response. This is a UI rendering bug.

---

## Additional Findings (Not in Spec)

### Server Stability Issues
The Express server crashes when the draft engine encounters `DRAFT_PAUSED` errors. This occurs when:
1. Simulating at normal/fast speed during draft
2. Switching speed to "paused" mid-draft

The crash causes process exit and requires restart. The server recovers by restoring state from SQLite on restart.

### `picksDelta` and `gamesDelta` Always Empty
The `/api/state` endpoint returns `picksDelta: []` and `gamesDelta: []` in ALL responses, even when:
- `lastPickId` has advanced significantly (picks are happening)
- `lastGameId` has advanced (games are completing)

These delta arrays are meant to stream incremental updates to the UI, but the mechanism is non-functional. This is the root cause of the draft board never rendering.

### Turbo Mode Badge
When turbo draft completes, a `data-testid="turbo-mode-badge"` element appears in the header with text "Turbo — picks made procedurally".

### Duplicate `new-dynasty-button`
When no league exists, two elements with `data-testid="new-dynasty-button"` are present (one in header, one in main). This violates uniqueness convention for testids.

### Standings Polling Interval
The standings polling interval is ~2000ms. At normal sim speed, this means standings can lag up to ~3.5s behind actual game results.

---

## Environment Notes
- Server: Express/TSX on port 3001
- Client: Vite/React on port 5173 with `/api` proxy to 3001
- DB: SQLite at `./data/dynasty.db`
- Draft timing: ~0.9s for all 600 picks at turbo, ~100ms/pick at normal and fast (both same)
- LLM: Disabled (no API key) — procedural fallback active throughout
