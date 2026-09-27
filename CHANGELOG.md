# Changelog

## 2026-07-11

- Rewrote bridge planning in jobs.js to connectivity-driven component joins/detour shortcuts because the old river test rejected real crossings and accepted open-sea inlets.
- Stored bridge span axis on tiles and used it in drawBridge because neighbour-inferred orientation rendered half-built spans sideways.
- Replaced per-tile house rendering with a composite cottage sprite on a levelled plot because the fake z=4 extrusion produced chopped roofs and cliff-face windows.
- Reordered regenerate() to initJobs-before-spawnDupes and added per-island spawning with stranded castaways to ground the upcoming boat-rescue loop (rescue itself unfinished — see .dory/history/2026-07-11-bridges-houses-boat-handoff.md).
- Generalised astar with a passability predicate to support boat navigation over sea water.
- Added docs/ROADMAP.md and docs/SYSTEMS.md because future sessions need a phased plan and a systems reference without re-reading the codebase.

