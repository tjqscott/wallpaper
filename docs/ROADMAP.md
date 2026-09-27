# Island Colony — Development Roadmap

Last updated: 2026-07-11. Living document — update the phase status lines as work lands.

Companion doc: [SYSTEMS.md](SYSTEMS.md) explains how the existing code works. Read README.md first for the hard rules (no UI, no player input, no failure, no persistence) — every phase below must respect them.

---

## Phase 0 — Connectivity, cottages, and boats (CURRENT — being implemented in a parallel session)

This is not future work. It is landing now; treat it as the baseline when reading the rest of this roadmap.

### 0.1 Connectivity-driven bridge planning

Replaces the "straight perpendicular river crossing" heuristic in `js/jobs.js` `planBridges()`.

- Land components are labelled by BFS flood fill over walkable tiles.
- Bridge candidates are straight 3–8 tile runs of water with land at both ends (same scan shape as before).
- A candidate is **accepted** if either:
  - it joins two *different* land components, or
  - it shortcuts a large detour within one component (walking detour ≥ ~6× the bridge span).
- The span axis (`h`/`v`) is stored on the tiles so `drawBridge()` in `js/render.js` orients planks correctly *mid-construction*, not just once both banks connect.

### 0.2 Composite cottage sprites

Replaces per-tile roof/wall painting in `js/render.js` `drawHouseTile()` and the fake `z=4` house extrusion.

- Each house is drawn as one composite cottage sprite: gabled roof, door, windows, chimney.
- Anchored at the house origin, drawn at the **south row** of the footprint so Y-sorting puts dupes correctly in front of / behind it.
- House tiles stay unwalkable; the tile type remains the footprint marker.

### 0.3 Boat lifecycle rework

Replaces `spawnInitialBoats()` (no more magic boats at world init) in `js/jobs.js`.

- Dupes build docks first; a `build_boat` job then spawns **at the dock** and consumes stocked logs.
- Boats follow **water A\*** waypoint paths (passable: sea-connected water + dock tiles) instead of bouncy steering with velocity reflection.
- Stranded dupes now deliberately spawn on secondary islands. Rescue mission, run by an idle boat:
  1. sailor boards at dock →
  2. boat sails to the stranded island's coast →
  3. castaway boards →
  4. boat returns to dock →
  5. castaway disembarks and joins the colony workforce.
- Stranded dupes show an occasional "!" bubble — glanceable story, not UI.

**Files touched:** `js/jobs.js` (planning, boat states, rescue missions), `js/dupes.js` (stranded spawn, boarding), `js/render.js` (bridge axis, cottage sprite, "!" bubble), `js/config.js` (new tunables).

**Definition of done (glance test):** a two-island world shows a bridge growing plank-by-plank in the right orientation; houses read as little cottages with smoke; no boats exist at dawn but by mid-day a dock exists and a boat is being built at it; at some point a boat visibly sails out, collects a lone dupe from the far island, and brings them home.

---

## Phase 1 — Story & personality

**Goal:** make dupes read as characters, not pathfinding particles. Zero new mechanics — all presentation.

| Task | Files | Notes |
|---|---|---|
| Speech bubbles with short personality lines | `js/dupes.js` (trigger logic), `js/render.js` or new `js/bubbles.js` (draw), `js/config.js` (line lists) | Rare, brief, one dupe at a time. Reuses the "!" bubble plumbing from Phase 0. |
| Mood faces (smile/frown) | `js/dupes.js` `drawDupe()` | Mood from simple signals: working = content, idling long = bored, night at fire = happy. Keep the chunky sprite — 2–3 px mouth only. |
| Work sparks/particles at job sites | `js/render.js`, small particle list in `js/jobs.js` or new `js/particles.js` | Chips at chop, dust at mine, splash at dock builds. Short-lived, few. |
| Dupes idle at campfires at night | `js/dupes.js` (night behaviour: walk to nearest campfire, sit), `js/render.js` (seated pose) | Use `getDayPhase()`; darkness > threshold sends idle dupes to fires. Warm glow already exists. |
| Rescued castaways keep a distinct clothing colour until nightfall | `js/dupes.js`, `js/config.js` (castaway colour) | Marks the story beat; resets at dusk so no persistence. |

**Definition of done:** a 10-second glance at night shows dupes sitting around a fire; during the day you catch someone say something short; a freshly rescued dupe is visibly "the new one" until dark.

---

## Phase 2 — Tech progression

**Goal:** the colony visibly advances during the day; stockpiles drive it and are drained by it.

| Task | Files | Notes |
|---|---|---|
| Machines: workbench → furnace → windmill | `js/jobs.js` (build jobs, machine list), `js/render.js` (sprites), `js/config.js` (costs, tick times) | Placed in village zone like houses. One machine of each tier max initially. |
| Stockpile-driven tier upgrades | `js/jobs.js` | E.g. workbench needs N logs, furnace needs N ore, windmill needs N grain + logs. Consuming stock spawns the build job. |
| Clothing progression with prosperity | `js/dupes.js`, `js/config.js` (tiered palettes) | Colony tier (highest machine built) shifts the clothes palette. World-readable prosperity, per the no-UI rule. |
| Resource sinks so stockpiles breathe | `js/jobs.js` | Machines and houses consume; caps in `STOCKPILE_CAP` stop being the steady state. Piles should visibly grow and shrink. |

**Definition of done:** morning glance shows raw piles accumulating; afternoon glance shows a furnace smoking and the log pile smaller; evening glance shows better-dressed dupes. No regressed colony ever looks "dead" — regression is fewer machines, not stopped dupes.

---

## Phase 3 — The daily differentiator

**Goal:** every day is recognisably *that* day.

| Task | Files | Notes |
|---|---|---|
| "One named feature per day" picker | `js/terrain.js` (new pass or pass-1 variants), `js/config.js` (feature table) | Volcano, swamp, twin island, hot springs, shipwreck, … Seed-picks one; it slots into the 8-pass pipeline where its terrain edits belong (most: after base terrain, before rivers). Remember the rejected lesson: present and visible, never map-dominating. |
| Vanilla days | picker logic | Some days deliberately pick "no feature" (see recommendations below). |
| Rare easter-egg events | `js/render.js` (overlay effects), `js/jobs.js` or `js/main.js` (scheduling) | Meteor showers, auroras, whale migration. Purely visual, seed-gated, rare enough to feel lucky. |

**Definition of done:** two consecutive days are never confusable at a glance; roughly one day a week has no big feature and that reads as calm, not broken; once in a while you catch a meteor shower and feel rewarded.

---

## Phase 4 — Wallpaper Engine hardening

**Goal:** runs for months unattended on a desktop.

| Task | Files | Notes |
|---|---|---|
| Daily seed rollover at local midnight | `js/main.js` | Derive the seed from the local date (`setSeed(dateHash)` instead of `newRandomSeed()`); check date each frame or minute and `regenerate()` on change. Also fixes terrain determinism (see SYSTEMS.md gotchas — several passes still call `Math.random()`). |
| Perf budget | all `js/*` | Target a fixed frame-time budget (e.g. ≤ 4 ms on a mid GPU). Biggest wins: stop full-grid scans per job-spawn tick (`countBuiltBridges`, `spawnChopJobs`, `spawnDocks` all scan 130×75), cache static terrain to an offscreen canvas and redraw only dirty tiles. |
| Pause when occluded | `js/main.js` | Wallpaper Engine `window.wallpaperPropertyListener` / visibility API: stop `requestAnimationFrame` when hidden, resume cleanly. Tick must not "catch up" in a burst. |
| Remove dev button in production | `index.html` | Regenerate button is dev-only per README; hide when running inside Wallpaper Engine. |

**Definition of done:** left running for a week, the wallpaper shows a fresh world each morning, never stutters under a fullscreen app, and CPU/GPU usage while occluded is ~0.

---

## Recommended answers to README's open questions

Opinionated recommendations; record the final decision back in README when each lands.

1. **Do dupes auto-build bridges?** Yes — this is now real (Phase 0). Connectivity-driven planning means bridges exist exactly where they tell a story: joining islands or shortcutting big detours. Rivers may fully segment land; the colony visibly solves it.
2. **Vanilla days?** Yes, roughly 1 in 5. A no-feature day makes feature days land harder, and a calm island is a fine wallpaper. The picker should treat "vanilla" as one of its named outcomes, not an error path.
3. **Machine upgrades?** Transform in place (wood → stone → iron on the same sprite/footprint). Replacement churn reads as noise at a glance; an evolving machine in a fixed spot reads as progress. Also cheaper: no re-placement logic.
4. **Do names persist across days?** Yes. It is the one worthwhile bend of "no persistence": the *name list* is fixed in `config.js` anyway, so recognising "Emmy" each day costs nothing and builds attachment. No stats, no memories — just the same 16 names.
5. **Easter eggs?** Yes, but rare — rare enough that seeing one feels like luck (order of once a week, seed-gated). Purely visual, never mechanical, so they can't violate the no-failure rule.
