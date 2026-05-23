# Adversary Pre-Build Review — Baseball Dynasty Simulator v0.1.0

**Reviewer:** Adversary
**Inputs:** `app-spec.md`, `v0.1.0-app-spec-section.md`, `v0.1.0-test-spec.md`, `reports/architect-eval-0.md`, `reports/ciso-pre-build.md`
**Posture:** Hostile. The Architect did a competent job, but several decisions are wrong, several formulas don't survive contact with reality, and the test spec validates the wrong things. Below are the holes.

---

## TL;DR

The architect resolved the obvious contradictions but missed a cluster of correctness defects that will produce visibly broken output: the **schedule generator cannot produce 50 games per team with the parity claimed** (D4 is arithmetically broken), the **score generator cannot satisfy the test spec's blowout-rate assertion deterministically per-100-game sample**, the **box-score "consistency rules" are weak enough to permit impossible games** (winning pitcher with 0 IP loophole, RBI margin asymmetry, save logic undefined), and the **rating distribution percentages sum to 100% but the test spec tolerances sum to more than 100%** and don't survive the mean=55 / σ=12 normal distribution they're supposed to be sampled from. The **state machine has no defined transitions** and several POSTs will corrupt phase if called at the wrong moment. The **LLM `pickIndex` contract has at least three failure modes the spec doesn't cover** (pickIndex==0 with the top-1 already drafted being the worst). And the **CISO/Architect both missed that `transactions.narrative` is an LLM string written to SQLite and rendered to the UI un-escaped — that's a stored XSS vector even on localhost** if the rendering uses `dangerouslySetInnerHTML` or any markdown-with-HTML pipeline.

---

## 1. Spec holes the Architect missed

### 1.1 Schedule generator D4 is arithmetically broken
The Architect's D4 says "9 intra-conference opponents × 4 games (36) + 10 inter-conference opponents × 1.4 games" then re-derives as "14 cross-opponents × 1 game + 4 random extras." **There are only 10 inter-conference opponents, not 14.** A team has 9 same-conference rivals and 10 cross-conference rivals — total 19 opponents. The arithmetic of "36 + 14 = 50" is fine, but the only way to spend 14 inter-conference games over 10 opponents is 4 of them getting played twice and 6 once. The Architect didn't say *which* 4. The Developer will pick arbitrarily, and the schedule will be **non-deterministic across seeds** unless an exact pairing algorithm is specified.

Also: schedule **symmetry** is not addressed. If Team A plays Team B 4 times intra-conference, those need to split home/away (2-2). With 4 games that works. With 14 inter-conference games where some opponents are played twice and some once, the league-wide home/away balance does *not* trivially work out. **Each team must play exactly 25 home and 25 away** or attendance/revenue is biased. The spec doesn't require this; it should.

### 1.2 `current_game_date` advances 1/day but schedule says ~50 games/league/day
D5 says `current_game_date` advances 1 day per game (tick). But 20 teams × 1 game each per "day" = 10 games per day. If the tick advances the date by 1 per tick, then on day 1 only one of the 10 games gets that date. The game_log will show a single game per date for 500 days — which is a year and a half. **Either the date advances per game-day batch (10 games), or game_date stops being a real calendar.** Spec is silent.

### 1.3 Snake order definition is wrong
v0.1.0 §Expansion Draft Logic: "snake order (round 1: picks 1-20, round 2: picks 20-1, etc.)." Test spec G2: "round 1 pick 20 and round 2 pick 1 are same team." That checks out. **But the spec also says first 15 rounds = overall 50+, rounds 16-30 = overall 30-49.** With 20 teams × 15 rounds = 300 picks against the spec's distribution: elite (~16) + star (~64) + regular (~200) = 280 players overall 60+. Add fringe (45-59, ~320) to get the 50+ pool. Roughly 280 + (some fringe) = the first-15-rounds pool. **Math is tight but works.** However, with snake order, *late picks in early rounds* and *early picks in late rounds* get materially worse players. There's no spec for what "best available" means when the top-10 list is forced to span a quality cliff (rounds 15→16). The Developer may rank players across the gating boundary, which contradicts the gating.

### 1.4 Draft pool "exhausted" edge case is contradicted
v0.1.0 edge case: "should not happen with 800 players and 20 teams × 30 picks = 600 picks total." Then D21 says "If after expansion draft (20×30=600 picks) <800 players are exhausted, remaining 200 become free agent pool." Fine. But: **what about the 50+ vs 30-49 split?** If there are fewer than 300 players rated 50+, the first 15 rounds *will* run out. The rating distribution targets ~280 players overall 60+ and ~320 fringe (45-59). Only ~half of fringe is in the 50-59 bucket, so the 50+ pool is roughly 280 + 160 = 440 — comfortable. But if a seeded run drifts low and produces only 290 players ≥50, **round 15 has no candidates left.** Spec has no fallback.

### 1.5 Position scarcity formula has an exploitable degeneracy
`SP (overall 70+): +6` is the only conditional bonus. SP rated 69 gets +0; SP rated 70 gets +6. **A 1-point rating delta inverts the entire pick ordering** at the LLM context boundary. A 70-rated SP appears in the top-10 ahead of a 75-rated SS who only gets +4. Worse, this creates a hard discontinuity that a deterministic test (`sample 100 picks where teams need SS more than SP`) will detect as a bug. Real fix: use `max(0, (overall - 60) / 5) × scarcity_weight` or similar smooth function.

### 1.6 No position eligibility for "lineup of 9"
D6 says `selectLineup(team)` = "top 9 position players by overall excluding pitchers, one per position (C, 1B, 2B, 3B, SS, LF, CF, RF + DH = best remaining)." That's 9 slots including DH. **Catcher is a hard requirement** — what if the team's only C is injured or wasn't drafted? With expansion draft of 25 MLB slots and no positional minimums in draft logic, a team can end up with zero catchers. The spec has no waiver/promotion mechanism, no position-conversion fallback. `selectLineup` will throw or silently skip a position. The test spec doesn't check for "every team has all 9 positions filled."

### 1.7 Pitcher rotation breaks at game 1 with `gameNumber % 5`
D6: "SP1-SP5 rotated by `gameNumber % 5`." If `gameNumber` is 1-indexed, game 1 → SP2 (index 1), game 5 → SP1 (index 0). If 0-indexed, game 0 → SP1. **Off-by-one is unspecified.** Also: `gameNumber` is the league-wide game count, not the team's game count. Team A plays games 1, 3, 5... so its rotation cycles SP2, SP4, SP1, SP3, SP5 instead of SP1-5 in order. Should be `team.games_played % 5`, not league `gameNumber`.

### 1.8 "is_on_25man" vs roster size mismatch
D3 says "25 active (MLB) + 15 minors per team. Drop `is_on_40man`, keep `is_on_25man`. Add `is_on_mlb_roster` boolean for clarity." Two booleans for the same concept (`is_on_25man` and `is_on_mlb_roster`) is asking for them to drift apart. Pick one. Also, the table still has both columns per the original `players` schema — the Developer will not know which to migrate.

### 1.9 Free agency formula's `needs_multiplier` is undefined
D20: "bid = `overall × 0.15M × needs_multiplier`." `needs_multiplier` is never defined. Range? Source? Caps? With no upper bound, a desperate team bids $infinity. With no floor at 1.0, every team underbids. The Developer will make this up.

### 1.10 Owner death "heir takes over with randomized personality" — no schema
App-spec §Front Office Instability: "Owner death → heir takes over with randomized personality." The `teams` table has `owner_name` and `owner_personality` columns. Heir succession just overwrites them. **All history is lost** — there's no `owner_history` or `front_office_events` write specified for this. The Timeline tab will show "Bill Smith owns the team" forever even after he's died three times.

### 1.11 Trade deadline at game 35 — what counts as game 35?
Per-team game 35 or league-wide game 35? If league-wide, that's game ~3.5 per team (50 games / 20 teams × 35 / 50 ≈ team game 1-2 with current pacing — too early). If per-team, then 20 teams hit "game 35" at different real times, and the LLM trade context will see wildly different standings. Architect's D19 says "logs a transactions row at game 35" without disambiguating. **Most likely Developer reading: per-team, fires 20 separate times** — and now you have 20 trades on different "days."

### 1.12 Playoff bracket size doesn't match conference layout
"Top 4 teams per conference make playoffs" → 8 teams total. "Division Series (3-game), Conference Series (5-game), Championship (7-game)." Division Series = 4 teams per conference → 2 series per conference = 4 series league-wide. Conference Series = 2 winners per conference → 1 series per conference. Championship = 1 series. Total: 7 series. **Where do the wildcards/seeds map?** 2 divisions × 5 teams = 10 teams per conference; top 4 of 10 = 2 div winners + 2 wildcards. **Are wildcards by conference record or by division finish?** Undefined. Bracket pairing (1v4, 2v3) not specified either.

### 1.13 No deterministic seed flow for game outcomes
D7: "Seed = `league.id`. All worldgen and game outcome rolls draw from it (separate streams per concern)." But `league.id` is auto-increment integer, defaulting to 1 in a fresh DB. **Every new dynasty has seed=1**, producing identical leagues. The `POST /api/league/new` body is `{ seed?, leagueName? }` per gap #9 — but it's optional. Default behavior is "all leagues are clones of each other." Test G7 (persistence) will pass; user perception will be "this game has no variety."

### 1.14 No "in-game injury" mechanics defined for box-score level
Notable event: "Player injury during game (if injury_prone roll fires)." But the box score is generated in one pass, not pitch-by-pitch. **When in the game does the injury happen?** Does the injured player's box-score line get truncated (only the AB they had before the injury)? The spec just says "log to notable_events." The player still gets a full game's stats, which contradicts an injury actually happening.

---

## 2. Math and logic errors in the spec

### 2.1 Rating distribution doesn't sum to a normal distribution
Spec: mean 55, σ 12.
- Elite 85+: `1 - Φ((85-55)/12) = 1 - Φ(2.5) = 0.62%`. Spec says ~2%. **Off by 3×.**
- Star 75-84: `Φ(2.5) - Φ(1.67) = 0.99 - 0.95 = 4.0%`. Spec says ~8%. **Off by 2×.**
- Regular 60-74: `Φ(1.67) - Φ(0.42) = 0.953 - 0.66 = 29%`. Spec says ~25%. Close.
- Fringe 45-59: `Φ(0.42) - Φ(-0.83) = 0.66 - 0.20 = 46%`. Spec says ~40%. Close.
- Replacement <45: `Φ(-0.83) = 20%`. Spec says ~25%. Close.

Test G1 enforces the spec's targets with tight tolerances (Elite: 14-18 of 800). **A true mean-55/σ-12 normal sample will produce ~5 elites, not 14-18.** The Developer will either fudge the sampler with rejection sampling (slow and biased) or post-process by promoting top-N players (defeats the "natural distribution" claim). Either way, test G1 and the sampler are in conflict.

### 2.2 Win probability formula extremes
```
+ (starting_pitcher_rating - opp_starter_rating) * 0.003   // SP range: 1-99, delta range: ±98 → ±0.294
+ (batting_lineup_avg - opp_lineup_avg) * 0.004            // lineup avg range: ~30-90, delta: ±60 → ±0.24
+ (bullpen_avg - opp_bullpen_avg) * 0.002                  // similar: ±0.12
+ (home_field ? 0.04 : 0)                                  // +0.04
```
Worst-case lopsided matchup: `0.5 + 0.294 + 0.24 + 0.12 + 0.04 = 1.194`, clamped to 0.85. Equal teams: 0.5. **Even a 95 vs 50 SP differential only shifts win prob by 13.5%** — the formula is dominated by the clamp, not the inputs. A juggernaut team plays a doormat and wins 85% of games. **In MLB the best team beats the worst about 70%.** This is too high and inconsistent with the score-generation algorithm (which is independent of win-prob — see 2.4).

Also: the formula uses `batting_lineup_avg` and `bullpen_avg`. **Average of what?** Overall rating? Hitting subratings? Pitcher subratings averaged together? Undefined.

### 2.3 Win probability subratings aren't position-weighted
`batting_lineup_avg` treats a 90-contact/40-power slap hitter the same as a 70/70 balanced bat. Spec lists 6 hitter subratings (contact, power, speed, fielding, arm, eye) and 5 pitcher subratings. There's no overall computation specified. Test G6 requires "AVG leaders show realistic 0.200-0.400 range" after 10 games — but with no defined overall, the Developer's `lineup_avg` could be anything from `mean(contact)` to `mean(all 6)`, producing wildly different results.

### 2.4 Score generation is decoupled from win probability
The spec computes win probability, then "winner score: random integer 3-12 weighted to 3-6, loser score: 0 to winner-1." **The score has no causal relationship to the team strengths.** A 0.85-probability favorite that wins gets the same score distribution as a 0.51-probability favorite that wins. Stats accumulated this way produce uniformly distributed run totals across teams — **the run differential column in standings will not correlate with win percentage** beyond luck. Test G3 doesn't check this; the user will see it immediately.

### 2.5 Blowout enforcement is per-season, not per-sample
"Blowouts (winner_score >= 8) occur in approximately 15% of games (enforce this percentage over a season)." 15% of 500 league-games (20 teams × 50 / 2) = 75 blowouts per season. Test G3: "Sample 100 completed games: count games with winner_score >= 8, verify 12-18 blowouts." **A binomial(100, 0.15) has σ ≈ 3.6, so 12-18 is roughly mean ± 0.83σ ≈ ±1σ. That fails ~32% of the time even with a correctly calibrated generator.** The test is statistically guaranteed to flake.

If the implementation tries to "enforce" 15% exactly by tracking running count and forcing blowouts when behind / capping when ahead, then **early games in the season have different score distributions than late games** — also visibly wrong.

### 2.6 Box-score consistency rules permit impossibility
> Total team hits >= total team runs (you can't score more runs than hits, except via walks/errors)

But the rule **does not enforce walks/errors to actually be in the box score** when runs > hits is permitted. Walks aren't in the consistency rule at all. If team scores 5 runs on 4 hits and 0 walks, the rule is violated — but the score generator doesn't ensure walks fill the gap.

> Total team RBI <= total team runs + 2 (allow small margin for scoring anomalies)

This is **wrong**. RBI ≤ runs is the hard rule (RBI can only be credited when a run scores; the +2 margin allows for which?). The "anomalies" the +2 is supposedly forgiving don't exist in real baseball. This rule should be `RBI ≤ runs` and `RBI ≥ runs - (error_runs + sb_runs)` (closer to runs minus unearned). The Developer will implement `RBI ≤ runs + 2` and produce boxes where 5 RBI back 3 runs — readable, obvious bug.

> Winning pitcher must have pitched in the game (IP > 0)

**Wrong rule.** The winning pitcher must (a) be on the winning team, (b) have pitched and either started or been the pitcher of record when the lead was taken. With "IP > 0" alone, a 0.1-IP reliever for the winning team qualifies — but actual MLB rules require the SP to pitch 5+ IP to be eligible. **The save/win/loss assignment algorithm is entirely undefined.**

> Total IP for both teams = 9.0 innings each

OK for a normal game. But: what about a walk-off win where the home team doesn't bat in the bottom of the 9th? **Home team IP = 9.0; away team IP = 8.0 if losing on the road... or 9.0 if winning on the road.** The spec ignores this asymmetry. Strict 9.0/9.0 will produce too-many ABs for walked-off home teams.

### 2.7 Financial tiers don't scale with payroll
- Mega: payroll budget $140-170M, luxury threshold $180M → tax is rare.
- Large: $90-120M → never hits luxury tax. Fine.
- Small: $30-50M → never relevant.

Only mega-markets ever pay luxury tax, and even then only when bidding aggressively. **The luxury tax is functionally inert at v0.1.0** unless free agency lets teams overshoot budgets. Spec doesn't say whether bids can exceed budget. If they can't (D20: "capped at budget remaining"), luxury tax can never trigger. Delete the concept from v0.1.0 or make budgets soft.

### 2.8 Position-adjusted value formula caps below reality
Max bonus: SP70+ (+6) + age 24- (+3) = +9. A 99-rated SP age 24 has PAV = 108. A 99-rated SS age 24 has PAV = 99 + 4 + 3 = 106. **Pitchers always rank higher than position players at equal overall.** This biases the LLM context toward pitcher-heavy top-10 lists. With ~15% of pool being pitchers, the top-10 in most picks may be 4-6 pitchers — overstating their value to the LLM.

---

## 3. State machine attacks

The spec defines **no state machine.** Phases are listed (draft / regular / playoffs / offseason) but transitions are implicit and the POST endpoints have no preconditions. Concrete attacks:

### 3.1 `POST /api/sim/speed` with `speed=turbo` during draft
Draft is LLM-driven with 100ms rate-limiting → max 12 picks/sec. Architect D12 says "Turbo bypasses LLM" — but Test G2 says: "POST /api/sim/speed with `{speed:"turbo"}`, verify all 600 picks complete in < 5 seconds total." That requires the LLM bypass, but then test G10 expects "at least one draft pick has non-empty reasoning string in draft_picks table." **If the developer follows the test sequence (G2 before G10), all 600 picks are procedural and the reasoning column is empty for every row.** G10 then fails because there's no LLM-reasoning row to validate against. Tests are mutually inconsistent.

### 3.2 `POST /api/league/new` while sim running
No precondition. Test G9 says it should return 409 if league exists. But what about: league exists, sim is running, user POSTs. Does it (a) return 409 immediately, (b) stop the sim then 409, (c) archive and replace (D16)? **D16 says archive on `POST /api/league/new`. G9 says 409.** Conflict. The test will fail if D16 is implemented.

### 3.3 `POST /api/sim/advance` during playoffs / draft / offseason
"Manually advance one game (when paused)." What's "one game" during draft (one pick)? During offseason (one transaction)? Undefined. The Developer will probably no-op during non-regular phases, and the user will think the button is broken.

### 3.4 Phase transition atomicity
After game 50 of a season, the phase transitions to playoffs. **What if the sim tick is in the middle of writing game 50's results when a request comes in?** With per-tick transactions (D9), this is safe at the DB level. But the `league_state_cache` row is updated last (D9). Between "game 50 written" and "cache updated to playoffs," a polling request sees regular season with 0 games remaining. Frontend renders an empty schedule.

### 3.5 Restart during offseason
D17: "On boot, restore last archived=0 league at paused." Fine for regular season. **What if the server died mid-offseason** — halfway through free agency, or after some FAs signed but not others? The `players.team_id` and `players.contract_years_remaining` columns are mid-mutation. There's no offseason checkpoint state in the schema. On restart, the engine has no way to know "we already processed 30 of 50 free agents." It will either restart offseason from scratch (duplicate signings) or skip it entirely (silently corrupt).

### 3.6 Invalid speed during draft phase
`POST /api/sim/speed {speed:"paused"}` while a draft pick LLM call is in flight: does the pick complete and then pause, or abort? If abort, **the LLM response is paid for but discarded** (silent cost leak). If complete-then-pause, "paused" doesn't really mean paused.

### 3.7 Two simultaneous `POST /api/league/new`
Race condition: two clicks within the same tick. Both pass the "league exists" check (no league yet), both create new leagues, both run worldgen. Now there are two `archived=0` leagues. Every "current league" query is ambiguous. The schema has no unique constraint preventing this.

### 3.8 Polling cursor regression
D10/D11: "Cursor for picks." If the client crashes and reloads with `lastSeenPickId = 0`, the server replays all 600 picks back through the animation queue. UX freezes for 5+ minutes as the board re-animates. Spec doesn't say whether catch-up should batch-render or animate.

---

## 4. Sim engine correctness gap — box scores

Walking through the algorithm as specified:

1. Compute win probability (clamped 0.15-0.85).
2. Roll PRNG vs win prob → determine winner.
3. Roll winner score from triangular(3, 4, 12).
4. Roll loser score from uniform(0, winner_score-1).
5. Enforce blowout rate over season (some retroactive adjustment).
6. Distribute hits/HR/RBI/BB/K to batters weighted by ratings.
7. Distribute IP/H/ER/BB/K to pitchers weighted by ratings.
8. Apply consistency rules.

**Where this produces impossible box scores:**

### 4.1 Walks/errors don't exist in the score gen
Step 4 produces a total runs. Step 6 distributes "hits" — but the spec doesn't allocate walks at the team level first. Per consistency rule, `hits >= runs` (without walk fallback). To meet this with a 4-run/3-hit game, the developer has two options: (a) regenerate scores (slow, biased), (b) bump hits up to match runs (inflates AVG league-wide). **Option (b) is the path of least resistance and breaks the realism check in G6** (AVG leaders 0.200-0.400 range).

### 4.2 ER vs R asymmetry not modeled
The spec stores `er` (earned runs) per pitcher in season_stats, but the score gen only produces `r` (runs). Unearned runs require errors. **No errors are generated.** So all runs become earned, and ERA is overstated. ERA leader range 1.50-5.00 (test G6) is plausible but skewed high.

### 4.3 Distribution weights can produce zero-hit, zero-AB players
"Weighted by their ratings" — a low-rated bench player has positive weight, but if all hits land on the top of the order, the bench gets 0 AB. **Real lineups have 4-5 AB for every starter.** If a starter gets 0 AB, the lineup is effectively shorter than 9. Stats aggregation will say "player X had 0 ABs in 30 games" — visibly wrong on the leaderboard.

### 4.4 Bullpen workload is unbounded
Step 7 says "distribute IP/K/BB to pitchers weighted by their ratings." Best reliever gets used most. Over a 50-game season this reliever gets impossible workload (40+ IP in 50 games at 1-2 IP each) unless usage caps exist. **The spec mentions "fatigue (pitcher usage)" in win prob, but nowhere defines how usage accumulates or decays.** The Developer will leave it as a stub. Top relievers will end the season with 80 IP and 4-WHIP.

### 4.5 Save attribution is undefined
`game_log.save_pitcher_id` is a column. The spec never defines when a save is awarded. MLB rules: lead of 3 or fewer when entering, pitches at least 1 inning. Developer will guess: "last pitcher of the winning team if they pitched 1 IP." That's wrong (no lead-size check) but defensible. Test spec doesn't check save logic at all. **Stats for closers will be meaningless.**

### 4.6 Winning pitcher = "IP > 0" loophole
Per consistency rule, the winning pitcher must have IP > 0. **A losing-team pitcher could be assigned as winning pitcher** if the rule isn't conjoined with "on the winning team." The spec doesn't enforce team membership. Easy bug to introduce.

### 4.7 9.0/9.0 IP rule fails on walk-offs
As noted in §2.6: home team walk-off means away team only got 8 innings of "at bat opportunities," but they still pitched 9 (because home batters had ABs in 9 innings). Wait — actually it's reversed: in a walk-off, **the home team's pitchers throw 8 IP (because away team got 9 ABs), and the away team's pitchers throw 8.x IP (because home team batted bottom of 9 and ended on a hit).** Total: 9.0 IP for *batters*' AB, but pitcher IP totals are asymmetric. The rule "total IP both teams = 9.0 innings each" is naive about which sides pitch.

### 4.8 Notable-events idempotency
"Player hitting milestone: 100 career HR." How is this detected? Each game increments career_hr; if pre-game it was 99 and post-game is 100, log the milestone. **What if a player hits 2 HRs in a game starting at 99? Career goes 99 → 101. The milestone-100 check `career_hr == 100` misses.** Use `>= 100 && previous < 100` instead. Spec doesn't say.

### 4.9 Catcher catches every inning
With one C on the team and 50 games, the C must catch every game = 450 IP defensively. No backup C usage logic. If the C gets injured (in-game injury), the team has no catcher for the rest of the game. **Box-score generation will assign defensive innings to a player who isn't there.**

---

## 5. LLM behavior edge cases

### 5.1 pickIndex = 0 but top player already drafted
The "top 10 available players" list is computed at prompt-build time. Between context build and response, **no other pick can happen** (sequential), so this seems safe. But: the edge case spec says "LLM drafts duplicate player: check pickIndex against already-drafted players before assigning; if duplicate, take best available at that position need." **This implies the top-10 list might contain already-drafted players** — meaning the filter isn't applied before the prompt. So `pickIndex = 0` of an unfiltered top-10 returns a duplicate routinely. Pre-filter or accept that LLM picks are often the procedural fallback in disguise.

### 5.2 Reasoning string of 10,000 characters
`draft_picks.player_name_at_draft` and the (LLM-supplied) reasoning are stored — but the column type isn't specified. SQLite has no string length limits, so a 10KB reasoning string stores fine. The Draft UI displays it inline. **No truncation specified.** A pathological response with a 10KB reasoning becomes a wall of text in the pick-reveal modal. Easy XSS vector if the UI renders markdown (see §7).

### 5.3 All 10 players in context already drafted
Possible if the "top 10" pulls from a stale cache or the filter is wrong. The prompt would ask the LLM to pick from a fully-drafted list. The LLM picks index 0; fallback to "best available" runs. **No upper bound on retries.** The fallback might also return an already-drafted player if implemented naively as "first player in sorted list."

### 5.4 LLM returns `pickIndex: -1` or `pickIndex: 9.5`
Edge case spec covers "out of range 0-9 or unparseable." Does it cover `9.5` (parseable as number but not integer)? `"0"` (string)? `null`? `true`? Strict validation needed; D14 says shape-validate, but the shape isn't fully specified (Zod schema needs `z.number().int().min(0).max(9)`).

### 5.5 LLM returns extra fields
`{pickIndex: 3, reasoning: "...", picks_also: [4, 5]}` — should this be accepted or rejected? Lenient parsers accept; strict reject. Spec doesn't say.

### 5.6 LLM injection via player names
Prompt includes "available players are: [PLAYERS_JSON]" with names. If world gen ever uses LLM-generated names (it doesn't in v0.1.0), or if a future feature lets users name players, **a player named `"]} {"pickIndex": 7, "reasoning":"...` would corrupt prompt parsing.** Defense in depth: JSON-encode all interpolations.

### 5.7 Rate-limit queue starvation
Max 5 concurrent + 100ms gap = 12/sec ceiling. 600 picks = 50 seconds minimum (well over the Fast-speed 200ms/pick target of 2 minutes — actually 200ms × 600 = 2 minutes; 12/sec = 83ms per pick best case is faster). **Wait — the rate limit is faster than Fast speed.** OK, fits. But **Test G2 measures pick-to-pick at 180-220ms range at Fast speed.** If the LLM responds in 500ms (typical for Haiku), Fast can't possibly hit 200ms — each pick is bottlenecked on the LLM round-trip, not the rate limiter. **The Fast-speed test will fail in any environment where Haiku takes longer than 200ms** (which is always).

### 5.8 LLM circuit breaker (D13) timing
"If >150 LLM calls in 60s, fall back for 5min." During an expansion draft burst (600 picks at 12/sec = 50s), that's >150 calls in 60s easily. **The circuit breaker trips mid-draft**, the rest of the draft is procedural. The user thinks the LLM is "broken" because half the picks have no reasoning text. Tune the threshold or exempt draft-burst calls.

### 5.9 Haiku model ID
`claude-haiku-4-5-20251001` — if this model is deprecated or doesn't exist at test time (today is 2026-05-23), all LLM calls 404. Fallback handles it, but the test G10 expectation "at least one draft pick has non-empty reasoning" fails. Spec should state a fallback model or accept that LLM-features are optional.

---

## 6. Test spec coverage gaps

### 6.1 Tests skip box-score field correctness
G3 checks `total_hits >= runs_scored` and `total_rbi <= runs_scored + 2`. **Does not check:** individual pitcher line consistency (sum of IP = 9), individual batter line consistency (sum of ABs in lineup ~= 35-40), no negative stats, no AB without a hit causing impossible AVG, no >9 R/inning, decisions (W/L/S) are mutually consistent.

### 6.2 No test that all 9 positions filled per team
After expansion draft, a team can lack a C or SS. No test checks `team.roster has at least one player at each of {C, 1B, 2B, 3B, SS, LF, CF, RF}`. **First game sim will throw "no catcher available."**

### 6.3 No test for schedule symmetry
G3 checks "wins + losses = total games played (within ±1 for scheduling)." Does not check:
- Each team plays exactly 50 games.
- Each team plays 25 home / 25 away.
- Each opponent played the correct number of times.
- No team plays itself.
- All games scheduled for unique team-pair-date combinations.

### 6.4 No test for rating distribution after multiple seasons
Player development (offseason) modifies ratings. After 3 seasons, what should the distribution look like? Untested. Easy for development to drift the league into all-stars or all-replacement-level.

### 6.5 No test for tiebreaker logic
D18 defines tiebreakers (H2H, run diff, coin flip). Test spec doesn't construct a tie scenario.

### 6.6 No test for FK integrity after a season cycle
After offseason: players move teams, contracts end, players retire. Are there orphan FKs (player.team_id pointing to a team that doesn't exist)? Player retirement should set team_id to null or remove from rosters — undefined.

### 6.7 No test for restart during sim
G7 tests SIGTERM and restart, but doesn't test **mid-tick** kill. The "write before advance" rule is fragile.

### 6.8 No test for concurrent league creation
§3.7 race condition is unguarded by tests.

### 6.9 No test for LLM cost / circuit breaker
D13 defines a circuit breaker. No test triggers it.

### 6.10 No test for XSS in narrative fields
LLM-supplied strings (reasoning, narrative) flow to the UI. No test for HTML/script injection. Even on localhost, this is a footgun if the same renderer ships to v1.0 hosted.

### 6.11 G2 timing assertions are environment-dependent
"At normal speed: measure time between pick N completing and pick N+1 completing, verify 1.4s - 1.6s." On a slow laptop, GC pause, or under test runner overhead, ±100ms tolerance is too tight. Tests will flake.

### 6.12 G3 blowout rate test will statistically flake
See §2.5: binomial(100, 0.15) has σ≈3.6, the 12-18 window is ±1σ, so ~32% false-fail rate.

### 6.13 G1 rating distribution tests will fail with a true normal sampler
See §2.1: a real normal(55, 12) sample produces ~5 elites of 800. Tolerance 14-18 will fail. Tests are inconsistent with the sampler spec.

### 6.14 G1 player origin distribution
"US-born players are 32-38% of total." For a multinomial with p=0.35, n=800: σ ≈ 13.5. ±3% = ±24 players ≈ ±1.8σ. Margin is OK but only just; will flake under unlucky seeds.

### 6.15 G7 persistence doesn't check sim state
After restart, checks phase/season/standings persist. Does not check that the **sim is paused after restart** (D17). A bug that auto-resumes Turbo on restart would pass G7.

---

## 7. Architect decision challenges

### D1 (flat columns) — AGREE
Correct call. Flat columns serialize better and indexes work.

### D2 (enum values) — AGREE with caveat
Lowercase storage / title-case render is fine. **Add:** enum validation at the DB layer (CHECK constraint) so corrupt enum values can't be written.

### D3 (roster size) — DISAGREE
"25 active + 15 minors" = 40 per team × 20 = 800 — matches pool perfectly. But the player pool spec says 800 with various age/position distributions; some will retire/be cut and the spec has **no roster size enforcement.** A team could end up with 30 active + 10 minors after a season. D3 should specify hard caps and a cut algorithm. Also: dropping `is_on_40man` loses the concept of "protected from rule 5 draft" forever (rule 5 is roadmap v0.4 — fine to drop, but document the rationale).

### D4 (schedule generator) — DISAGREE (arithmetic broken)
See §1.1. "10 inter-conference opponents × 1.4 games" doesn't round to "14 cross-opponents × 1 game + 4 random extras" — only 10 cross opponents exist. The actual answer is "4 of 10 inter-conf opponents played twice, 6 played once." Algorithm to select the 4 is missing. **And home/away balance is unspecified.**

### D5 (game date) — DISAGREE (see §1.2)
Advancing 1 day per *game* means 500 days per season. With 50 games/team and ~10 league games per day, dates should advance per game-day, not per game.

### D6 (lineup/rotation/bullpen) — PARTIAL DISAGREE
See §1.7 (rotation off-by-one and uses league gameNumber instead of team game count). See §1.6 (no fallback when a position is unfilled).

### D7 (seeded PRNG) — DISAGREE
See §1.13. League id = 1 by default → every new league is identical. **Seed should default to `Date.now()` if not provided in request body.**

### D8 (DB pragmas) — AGREE
Correct.

### D9 (per-tick transaction) — AGREE with caveat
Good. But the `league_state_cache` row written "last" creates a window where DB committed game results don't match cache. A second polling request between game-commit and cache-update sees stale data. **Either write cache inside the same transaction, or accept eventual consistency.** Spec is silent.

### D10 (state endpoint contract) — AGREE
Define the interface. Add `simRunningSinceMs` so the client can detect stalls.

### D11 (polling 500ms during draft) — PARTIAL DISAGREE
500ms still misses picks at Fast (200ms/pick) when the network lags. **Use SSE or WebSocket for draft phase.** Or accept that the cursor delta will return 2-3 picks per poll and animate them serially.

### D12 (Turbo bypass LLM) — DISAGREE
Breaks Test G10 (see §3.1). Either change the test to allow `if speed != "turbo"` or accept slower Turbo. **The Architect's call conflicts with the test spec — Architect did not catch this.**

### D13 (circuit breaker thresholds) — DISAGREE
See §5.8. 150 calls/60s trips mid-expansion-draft. Either raise the threshold or exempt draft-burst.

### D14 (LLM parsing) — AGREE
Robust. Implement with Zod for D2/D14 unification.

### D15 (migrations) — AGREE
Required.

### D16 (singleton league) — DISAGREE (conflicts with G9 test)
Test G9: `POST /api/league/new` when league exists → 409. D16: archive and replace. **Conflict.** Architect should have spotted this when reviewing the test spec. Pick one.

### D17 (restart at paused) — AGREE
Critical. But add: offseason mid-state recovery (§3.5).

### D18 (tiebreakers) — AGREE
H2H → run diff → seeded coin flip. Specify that H2H is only meaningful within division (intra-division play is more frequent).

### D19 (trade deadline at game 35) — DISAGREE (ambiguity)
See §1.11. "Game 35" is per-team or league-wide? Must specify.

### D20 (free agency formula) — DISAGREE
`needs_multiplier` undefined. See §1.9.

### D21 (worldgen draft pool sizing) — AGREE
Fine.

### D22 (Express 5) — AGREE
Fine.

### D23 (test coverage gate) — PARTIAL DISAGREE
"Unit tests for PRNG, schedule, win-prob, box-score, LLM parser, fallback." Missing: schedule symmetry, position completeness per team, FK integrity after offseason, restart-resume invariants. Coverage gate should require these.

### D24 (data-testid enforcement) — AGREE
But the test spec list has gaps (no `data-testid="player-card"`, no `data-testid="box-score-modal-{gameId}"`, no `data-testid="reconnecting-banner"`). Architect should have audited.

### D25 (naming) — AGREE
Fine.

---

## 8. Top 5 findings (severity-ordered)

### F1 — CRITICAL — Test spec contradicts Architect decisions, build cannot pass tests as written
Three direct conflicts:
- **G2 turbo timing (5s for 600 picks) requires LLM bypass, but G10 requires LLM reasoning rows.** Tests cannot both pass.
- **G9 expects 409 on duplicate `POST /api/league/new`, but D16 archives and creates new.** One passes, the other fails.
- **G1 rating distribution buckets (Elite: 14-18 of 800) are not achievable from the specified normal(55, 12) sampler.** True σ-correct sampler produces ~5 elites.

**Impact:** Developer ships, QA fails, rebuild loop. Resolve before Phase 0 closes.

### F2 — CRITICAL — Box-score generator cannot guarantee MLB-plausible output
The consistency rules are wrong (`RBI ≤ runs + 2` should be `≤ runs`; "winning pitcher IP > 0" misses team-membership; 9.0/9.0 IP fails on walk-offs; no walk/error generation to back hits-vs-runs gap). The user will look at the first box score and see RBI > runs or a winning pitcher from the losing team. Visible-on-first-screen bug.

**Impact:** The flagship feature (watching the league unfold) ships broken.

### F3 — HIGH — Schedule generator is arithmetically undefined (D4)
"50 games per team" with 9 intra + 10 inter conference opponents has no clean decomposition. D4's "14 cross-opponents × 1 + 4 extras" is wrong (only 10 cross-opponents exist). Home/away balance unspecified. Without a deterministic algorithm, the schedule may not produce exactly 50 games per team, will fail Test G3, and home revenue will be asymmetric.

**Impact:** Season cannot complete cleanly; tests fail; standings are broken.

### F4 — HIGH — Stored XSS / un-escaped LLM strings rendered in UI
`transactions.narrative`, `front_office_events.narrative`, and `draft_picks` reasoning are LLM-supplied strings rendered inline. Spec doesn't say whether the React render escapes them or uses `dangerouslySetInnerHTML` / markdown-with-HTML. Even on localhost, a model-injected `<script>` (or a future user-supplied team name) is a real attack vector. **Neither Architect nor CISO flagged this.**

**Impact:** Cross-site scripting in v0.1.0 that survives to a hosted v1.0 deployment.

### F5 — HIGH — Default seed = 1 makes every new dynasty identical (D7)
D7 says seed = league.id, default first league is id=1. Every fresh DB produces the same league with the same teams, players, names, cities. The "dynasty" pitch is broken: replay value = zero. Easy fix (default to `Date.now()`), but the spec specifies the broken behavior.

**Impact:** Every new dynasty looks identical until the user discovers and uses the optional seed parameter.

---

## Honorable mentions (not top 5 but worth flagging)

- **H1 — Owner death erases history (§1.10):** no `front_office_events` write, no owner_history table; Timeline tab can't show "owner died and heir took over."
- **H2 — In-game injury doesn't truncate box score (§1.14):** injured player still gets a full game's stats.
- **H3 — Rate limit (12/sec) faster than Fast-speed test target (200ms/pick) but slower than LLM round-trip (§5.7):** Fast-speed timing test (G2) will fail in any real LLM environment.
- **H4 — Polling-based draft UI cannot animate every pick at Fast speed (§3.8):** even with 500ms polling and cursor deltas, pick-reveal animation needs SSE or WS.
- **H5 — `data-testid` list is incomplete:** no `box-score-modal-{id}`, `reconnecting-banner`, `player-card-{id}` (test G6 needs it), `team-history-tab`.
- **H6 — Save pitcher attribution undefined (§4.5):** column exists, no algorithm. Closers stats will be meaningless.
- **H7 — Pitcher usage fatigue mentioned but undefined (§4.4):** top reliever will rack up 80+ IP in a 50-game season.
- **H8 — Position scarcity bonus discontinuity at SP overall 70 (§1.5):** 1-point rating delta inverts rankings.
- **H9 — Concurrent `POST /api/league/new` race condition (§3.7):** no DB uniqueness constraint on `archived=0`.
- **H10 — Game date model produces 500-day "seasons" (§1.2 / D5):** users see April 2026 → August 2027 for a single season.

---

**End of adversary-pre-build.md.**
