# Island Colony — Systems Reference

Last updated: 2026-07-11. Living document. For phased plans see [ROADMAP.md](ROADMAP.md); for vision and hard rules see the root README.md.

Purpose: let a cold-start contributor (human or agent) navigate the codebase without re-reading every file.

---

## Boot & frame order

```
start()  (js/main.js)
 ├─ initRender(canvas)
 ├─ resize()                      ← provisional; landCX/CY still defaults
 ├─ regenerate()
 │   ├─ generateMap()             ← 8-pass terrain pipeline (js/terrain.js)
 │   ├─ spawnDupes()              (js/dupes.js)
 │   ├─ initJobs()                (js/jobs.js)
 │   │    buildSeaWaterSet → buildIslandCentroids (sets landCX/CY)
 │   │    → buildZoneMap → placeStockpiles → planBridges
 │   │    → placeCampfires → spawnInitialBoats → autoSpawnJobs
 │   └─ resize()                  ← re-centres now landCX/CY are real
 └─ animate()  — per frame:
     tick++  →  updateJobs()  →  updateDupes()  →  render()
```

`updateJobs()` per tick: job spawn timer (spawns every `JOB_SPAWN_INTERVAL`) → `updateGrowth()` → `updateBoats()` → `updateDayNight()`.

The Regenerate button (`index.html`) calls `regenerate()`; it is dev-only.

---

## Module convention (shared globals)

- Plain `<script>` tags, **not** modules — must work from `file://` and inside Wallpaper Engine.
- Load order in `index.html` matters: `config → noise → terrain → jobs → dupes → render → main`. Earlier files must not call later files at top level; runtime calls in any direction are fine (all names are global).
- All top-level `let`/`const`/`function` share one namespace. **Prefix new module-level names with the module name** (`dupeFoo`, not `foo`) to avoid collisions.
- No build step, no npm, no server.

Key globals by file:

| File | Owns |
|---|---|
| `config.js` | `CONFIG`, all `*_PALETTE`, `DUPE_NAMES`, `WALKABLE_TYPES` |
| `noise.js` | `seedOffset`, `hash`, `smoothNoise`, `fbm`, `setSeed`, `newRandomSeed` |
| `terrain.js` | `map`, `tileAt`, `generateMap` |
| `jobs.js` | `jobs`, `boats`, `stockpiles`, `houses`, `docks`, `campfires`, `zoneMap`, `landCX/landCY`, `dayPhase`, `plannedBridgeSpans` |
| `dupes.js` | `dupes`, `astar`, `isTileWalkable`, `nearestWalkable` |
| `render.js` | `canvas`, `ctx`, `tileSize`, `offsetX/Y`, **`tick`**, `resize`, `render` |
| `main.js` | `regenerate`, `animate`, `start` |

Tile object shape: `{type, z, seed, shadow:{n,s,e,w}, feature}` plus optional `growthTick` (farm), `saplingTick`, `dockDir`, `houseOriginX/Y`, `houseW/H`.

---

## Terrain: the 8 passes (`js/terrain.js`, `generateMap()`)

| # | Pass | Guarantees to later passes |
|---|---|---|
| 1 | `generateBaseTerrain()` | Full `map[y][x]` grid exists; every tile has type/z/seed. Types: water, sand, grass, grass_dark, stone, stone_high, plus inland ponds. Edge falloff keeps a 7-tile water margin. |
| 2 | `computeSeaDistanceMap()` | Returns BFS distance-from-open-sea grid (border water = 0). Used by rivers; not stored on tiles. |
| 3 | `carveRivers(seaDist)` | 1–3 rivers carved downhill from inland springs to the sea; river tiles become `water` (z 0), banks soften `grass_dark → grass`. |
| 4 | `carveRavines()` | 1–2 ravines: `ravine_edge` (z −1) / `ravine_stone` (z −2) / `ravine_void` (z −3), skirted by softened terrain. Never carve within 2 tiles of water. |
| 5 | `detectWaterfalls()` | Flags `feature='waterfall'` on water tiles whose south neighbour is lower. |
| 6 | `cleanupOrphanStone()` | No stone tile is 4-neighbour isolated (orphans → grass_dark). |
| 7 | `computeShadows()` | Every tile's `shadow.{n,s,e,w}` matches neighbour z. Anything changing z after this must call `recomputeShadowsAround()`. |
| 8 | `placeFlora()` | `feature='tree'` on grass, fbm-clustered, ≥ `TREE_ROCK_CLEARANCE` (2) tiles from stone/ravine. |

New passes: add a function, call it from `generateMap()` at the right slot, and document why it slots there.

Land-shape archetypes (`pickLandShape()`, chosen by `hash(3,0)`, 6 total):

| # | Shape |
|---|---|
| 0 | Round blob |
| 1 | Stretched/rotated ellipse |
| 2 | Two blobs (twin island tendency) |
| 3 | Core + 3–4 lobes |
| 4 | 4–5 scattered islands (archipelago) |
| 5 | Drowned ridge (long noisy spine) |

---

## Zones (`js/jobs.js`, `buildZoneMap()`)

Computed once at init from the main-island land centroid (`landCX/landCY`):

- **village** — circle radius 18 around the centroid. Wins over everything.
- **forest** — the quadrant (NE/NW/SW/SE relative to centroid) with the most pass-8 trees.
- **farm** — the non-forest quadrant with the most river-adjacent grass.
- Remaining quadrant(s): `null` (open/shared).

Zone respect by job type:

| Job | Zone constraint |
|---|---|
| chop | forest only |
| plant_tree | forest only (replant into canopy gaps) |
| farm | farm zone, river-bank seeded |
| build_house | village (or null) zone, ring-searched from stockpile |
| mine, build_bridge, build_dock, build_boat | no zone constraint |

Stockpiles and campfires are placed in the village zone.

---

## Jobs (`js/jobs.js`)

Lifecycle: **spawn** (`autoSpawnJobs`, every `JOB_SPAWN_INTERVAL`=360 ticks, hard cap `JOB_MAX`=28) → **assign** (idle dupe takes nearest unassigned job) → **travel** (A* to an adjacent stand tile) → **work** (`progress++` per tick to `JOB_TICKS[type]`) → **complete** (`completeJob` mutates the tile) → optionally **carry** (dupe walks the yielded resource to a stockpile and deposits).

| Type | Ticks | Spawn trigger | Completion effect |
|---|---|---|---|
| chop | 100 | < `CHOP_CONCURRENT` (5) active; nearest forest-zone trees | tree removed; carry log; queue replant |
| mine | 180 | < 2 active; random reachable stone | stone → grass_dark; carry ore; shadows recomputed |
| farm | 260 | cluster batch: ≤ `FARM_CLUSTER_MAX` (2) clusters of ~14 tiles | grass → farm, crops grow over `CROP_GROW_TICKS` |
| plant_tree | 150 | from `pendingPlants` queue ~400–600 ticks after a chop | grass → sapling → tree after `TREE_GROW_TICKS` |
| build_bridge | 240 | next incomplete planned span; ≤ `BRIDGE_MAX` (16) tiles total | water → bridge |
| build_dock | 180 | < `DOCK_MAX` (3) docks; coastal candidates near centroid | water → dock (stores `dockDir`) |
| build_boat | 360 | Phase 0: spawns at a dock, consumes stocked logs | boat spawned |
| build_house | 450 | log stock ≥ 3; < `HOUSE_MAX` (6); one at a time; 3×2 footprint = 6 jobs | tiles → house; entry in `houses` |

Unreachable jobs get `_skipUntil` backoff instead of deletion. `isJobValid()` (js/dupes.js) re-checks tile state before/during work so stale jobs self-release.

Stockpiles: up to two yards near the centroid — `organic` (3 tiles: log pile + grain sacks) and `stone` (2 tiles: ore heap). Visual caps in `STOCKPILE_CAP` = `{log:12, grain:9, ore:8}`; deposits beyond cap are dropped. Pile sprites scale with counts — the piles *are* the resource UI.

---

## Dupes (`js/dupes.js`)

State machine: `state` ∈ `idle | walk | work`, refined by `jobPhase` ∈ `travel | work | carry | null`.

- **idle** → countdown `wait`; then either take nearest valid job (→ walk/travel) or wander (`pickNewTarget`).
- **walk** → follow `path` waypoint by waypoint (`tx,ty` = current waypoint centre; arrive at < 0.12 tiles). On path end: travel → verify adjacency (≤1.5) to job tile → work; carry → `depositResource`; wander → idle.
- **work** → must stand on `workStandX/Y` (re-navigates if drifted); `workOnJob` ticks progress; on completion may enter carry with `carryTarget` stockpile.

Speeds: 0.050 tiles/tick walking, 0.038 carrying. Carried items draw above the head; `carryTimer` (800) is a safety fallback only.

A*: 4-directional, Manhattan heuristic, node key `x*200+y` (**key width 200** — safe for `GRID_COLS`=130; revisit if the grid ever exceeds 200 wide), linear-scan open list, **3000-iteration cap** (returns `null` = unreachable). Path excludes start, includes goal. `setPathedTarget` snaps unwalkable goals to `nearestWalkable(…, 4)` and never teleports.

Safety: each tick, a dupe standing on an unwalkable tile (water, new tree, house) is **snapped** to `nearestWalkable(…, 6)`. This is the anti-softlock of last resort — prefer fixing the cause if you see it fire often.

Walkability: `isTileWalkable` = `WALKABLE_TYPES.has(type)` AND no tree/sapling feature AND not house. `WALKABLE_TYPES` (config.js) is the single source of truth for type-level walkability — bridges and docks are walkable because they are in that set.

---

## Rendering (`js/render.js`)

- Canvas 2D, `tileSize` = floor(min(w/130, h/75)), offsets centre `landCX/landCY` on screen (clamped).
- **Y-sorted row painting:** for each row y (top→bottom): all tiles in the row → stockpile yard tiles → campfires → dupes standing in that row. Boats drawn after all rows; night overlay last.
- **Z-extrusion:** each tile draws its top face at `py - z*Z_MULT` and, where the south neighbour is lower, a cliff face of `drop` layers below it (`strataColour` above ground, `ravineLayerColour` gradient below; waterfalls animate down the face). This is what fakes 3D.
- Dupes interpolate z between their tile and the tile south of them, so they slide smoothly up/down cliffs.
- **Day/night:** `dayPhase` 0→1 over `DAY_TICKS` (3600 ≈ 60 s); darkness = 0 at noon-ish, peaks at midnight. A dark overlay rect is drawn over the whole canvas, then campfire/chimney warm point lights are added with `globalCompositeOperation='lighter'` (additive radial gradients). Night is darker, not bluer — keep the amber.
- Per-tile `shadow` flags paint edge shading against taller neighbours.

---

## Boats & rescue (Phase 0 design — landing now)

Pre-Phase-0 code (`updateBoats`) is heading/velocity steering with wall-bounce; the rework replaces it.

- **No boats at init.** Docks are built by dupes; a `build_boat` job at a dock consumes stocked logs and spawns the boat there.
- **Water A\*:** boats path over sea-connected water (`isSeaWater`) plus dock tiles, following waypoints like dupes do. No bounce, no random headings.
- Boat states: `idle_at_dock`, `cruise`, `to_pickup`, `waiting_pickup`, `return_home`.
- **Rescue mission** — trigger: a stranded dupe exists on a secondary island AND a boat is `idle_at_dock` AND a dock exists. Sequence: sailor boards at dock → boat cruises to the stranded island coast (`to_pickup`) → waits while the castaway walks aboard (`waiting_pickup`) → `return_home` → castaway disembarks and joins the workforce.
- Stranded dupes deliberately spawn on secondary islands (`islandCentroids[1..]`) and show an occasional "!" bubble. Story, not UI.

---

## Gotchas

- **`landCX`/`landCY` must be set before `resize()` does anything useful.** `regenerate()` calls `resize()` *after* `initJobs()` for this reason. Adding an early `resize()` call gives a mis-centred viewport.
- **Any z change at runtime must call `recomputeShadowsAround(x,y)`** (mine, bridge, dock, house completions all do). Forgetting it leaves stale edge shadows.
- **`WALKABLE_TYPES` is the single walkability source of truth.** New walkable tile types go in that set (config.js); do not add per-type checks in pathing code.
- **`JOB_TICKS` keys must match `makeJob` type strings exactly.** A typo gives `maxProgress: undefined` → the job never completes and the dupe works forever.
- **`hash()` is seed-dependent; `Math.random()` is not.** Terrain that must be reproducible for a given seed must use `hash`/`smoothNoise`/`fbm`. Note: `carveRivers`, `carveOneRiver`, `carveRavines` currently use `Math.random()` — daily-seed determinism (Roadmap Phase 4) requires converting these.
- **`tick` lives in render.js** but is incremented in main.js and read by jobs.js/dupes.js — a load-order artefact of the shared-globals convention. Don't shadow it.
- **A\* key width is 200.** Grid growth past 200 columns silently corrupts node keys.
- **Full-grid scans** (`countBuiltBridges`, `countBuiltFarmTiles`, chop/dock candidate scans) run on the job-spawn cadence, not per frame — keep it that way; never move them into the per-tick path (perf budget, Roadmap Phase 4).
- Houses occupy multiple tiles but `houses` stores one entry per house (origin + w/h); house *tiles* carry `houseOriginX/Y` back-references. Keep both in sync when touching housing.
