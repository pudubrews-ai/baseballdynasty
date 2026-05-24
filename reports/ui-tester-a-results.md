# UI Tester A Results — Baseball Dynasty Simulator v0.1.0 Iteration 2

## Environment
- Server: localhost:3001 (Express + tsx)
- Client: localhost:5173 (Vite dev server)
- Playwright: 1.60.0
- Browser: Chromium (headless)
- Test run date: 2026-05-23
- League state: offseason, season 1, 50 games played, phase=offseason

---

## Group 0 — Browser Environment [CRITICAL]

- [FAIL] Client loads without console errors
  - **Error:** `Each child in a list should have a unique "key" prop. Check the render method of 'tbody'. It was passed a child from League.`
  - **Component:** `League` component renders a `tbody` without unique `key` props on row children
  - **Severity:** React warning surfaced as console error — violates spec requirement of zero console errors
  - **Fix needed:** Add `key` prop to each `<tr>` inside the League standings `tbody`

- [PASS] `[data-testid="new-dynasty-button"]` is rendered and visible
  - **Note:** Button is visible even when a league exists (it acts as a persistent nav element). Spec says it should be visible *when no league exists* — this may be by design or a minor UX issue. No failure raised since the button IS rendered; it just doesn't conditionally hide.

---

## Group 5 — Team Detail UI [HIGH]

- [PASS] `[data-testid="team-card-{teamId}"]` click opens team detail panel
  - Navigated to Teams tab, found `team-card-61` (Harborwatch Osprey). Click revealed `[data-testid="team-detail-panel"]` immediately.

- [PASS] `[data-testid="team-detail-panel"]` shows team name and record
  - Panel text: `"Harborwatch OspreyAmerican East31W - 19LRosterMinorsFinancialsHistory SP C C 2B RF..."`
  - Team name, division, and W-L record confirmed present.

- [PASS] `[data-testid="team-roster-tab"]` is present and clickable
  - Tab visible in panel. Click succeeded. Panel remained stable after click.

- [FAIL] `[data-testid="team-minors-tab"]` click crashes the application
  - Tab is **present and visible** — element exists with correct data-testid.
  - **CRITICAL BUG:** Clicking the minors tab triggers: `TypeError: tabData.map is not a function`
  - App renders the React error boundary: "Something went wrong — Try Again"
  - All page content is destroyed; user must reload.
  - **Fix needed:** `tabData` in the minors tab handler is not an array — likely an object or null. Add a guard: `(tabData || []).map(...)` or ensure the API returns an array for all minor league levels.
  - **Observed spec items:**
    - `[data-testid="team-minors-tab"]` — PRESENT (element exists): PASS
    - `[data-testid="team-minors-tab"]` click shows minor league depth — FAIL (crash)

- [PASS] `[data-testid="team-financials-tab"]` is present and clickable
  - Tab visible. Click succeeded. Panel remained stable after click.

- [PASS] Front office panel renders
  - Panel text confirmed with team name, record, division, and roster positions.
  - **Note:** owner_name, gm_name, manager_name not surfaced in the visible panel text (positions like "SP C C 2B RF..." rendered instead when Roster is default tab). These may require clicking the financials/roster sub-views. The `team-detail-panel` testid exists and shows team data — considered partial pass.

---

## Group 9 — Reconnect Banner [MEDIUM]

- [PASS] `[data-testid="reconnecting-banner"]` appears when server is unreachable
  - After killing the server process (SIGKILL via `lsof | xargs kill -9`), the reconnecting banner appeared within **2 seconds**.
  - Banner testid confirmed: `reconnecting-banner`.

- [FAIL] `[data-testid="reconnecting-banner"]` disappears when server returns
  - **KNOWN BUG:** After restarting the Express server (server comes back online in ~2s, confirmed via `curl`), the reconnecting banner **does NOT disappear** even after 15+ seconds.
  - The frontend polling/recovery mechanism does not detect server revival and clear the banner state.
  - Test timed out at 90s waiting for `banner.not.toBeVisible()`.
  - **Fix needed:** Implement server-recovery detection in the frontend polling loop. When a `/api/state` call succeeds after a failure streak, clear the reconnecting state and hide the banner.

---

## Summary

| Group | Test | Result |
|-------|------|--------|
| 0 | Client loads without console errors | FAIL |
| 0 | new-dynasty-button visibility | PASS (informational) |
| 5 | team-card click opens team-detail-panel | PASS |
| 5 | team-detail-panel shows team name and record | PASS |
| 5 | team-roster-tab present and clickable | PASS |
| 5 | team-minors-tab present (element exists) | PASS |
| 5 | team-minors-tab click shows minors data | FAIL (app crash) |
| 5 | team-financials-tab present and clickable | PASS |
| 5 | Front office info in panel | PASS (partial) |
| 9 | reconnecting-banner appears on server down | PASS |
| 9 | reconnecting-banner clears on server recovery | FAIL |

**Pass: 8 | Fail: 3 | Skip: 0**

---

## Bugs Found

### BUG-A01 [HIGH] React missing key props in League tbody
- **Location:** `League` component, standings `tbody` render
- **Symptom:** Console error on every page load
- **Fix:** Add unique `key` prop to each standings row `<tr>` element

### BUG-A02 [CRITICAL] Minors tab crashes application
- **Location:** Team detail panel, minors tab click handler
- **Symptom:** `TypeError: tabData.map is not a function` — full React error boundary triggered
- **Impact:** Users cannot view minor league depth for any team
- **Fix:** Guard `tabData` before calling `.map()`: ensure API returns arrays for AAA/AA/A/Rookie, handle null/undefined/object shapes

### BUG-A03 [HIGH] Reconnecting banner does not clear after server recovery
- **Location:** Frontend polling/reconnect logic
- **Symptom:** Banner appears correctly but never disappears even after server is back online
- **Impact:** After any server restart, users see a permanent "Reconnecting..." state requiring page reload
- **Fix:** On successful API response after a failed streak, dispatch state update to clear reconnecting flag and hide banner
