# Island Colony

A daily-resetting living-island wallpaper for Wallpaper Engine. Each day
generates a fresh procedural world. You don't play it — you glance at it.

Open `index.html` in a browser to see the current state. Click
**Regenerate** to roll a new seed.

---

## Vision

A passive, zero-intervention diorama. You are a god observing a small
colony of dupes who live, work, and build on a procedurally-generated
island. Every morning the world is new. By evening it has been
transformed by what the dupes did to it. Tomorrow, gone — fresh world.

The point is glanceability and delight. You look at it between tasks,
notice the colony has expanded since last time you looked, and smile.

### Hard rules

- **No UI.** No health bars, no resource counters, no stat panels.
  Everything readable from the world itself: stockpile size shows
  resources, machine sprite shows tech tier, dupe clothes show
  prosperity, forest density shows ecology.
- **No player input.** You never click anything. No pausing, no
  managing, no decisions. The button to regenerate is for development;
  in production the world rolls over once per real-world day.
- **No failure.** The colony cannot die. If they run out of advanced
  resources they regress to simpler tech — farming, foraging, basic
  shelter — and continue. "Fail" means "regress to a sustainable
  state," never "go extinct."
- **No persistence.** Nothing carries between days. No save file, no
  family trees, no remembered grudges. Each day is its own self-
  contained story.

### Aesthetic direction

- **Pixel-art, Minecraft-charming but grittier.** Blocky, warm, a bit
  industrial. Not cute-and-clean, not photoreal.
- **Top-down topographic, not true isometric.** True iso was tried and
  produced viewport orphans (empty corners on a 16:9 canvas). The
  current system fakes depth via Z-extrusion: tiles have an integer
  elevation and a vertical "cliff face" gets drawn down from their
  southern edge. This fits a 16:9 viewport exactly with no scrolling.
- **Warm light, no blue night.** When day/night lands, lanterns and
  fires give amber glows. Night gets darker, not bluer.
- **One big differentiator per day.** A ravine, a volcano, a twin
  island, a swamp — one immediately-visible geographic feature that
  changes how the colony develops. (Partly present: ravines and rivers
  exist. The "named feature" picker is still to come.)

### What dupes need to feel like (from the original prototype)

This is the soul of the project. The Claude Factory file in the
references has the original sprite that this is faithful to:

- Bobbing walk cycle (small vertical oscillation)
- Legs and arms swinging in opposition while walking
- Direction flip when changing horizontal direction
- Carried items rendered visibly above the head
- Speech bubbles with short personality lines (planned)
- Name tags that appear occasionally, not always
- Work sparks and particles at machines (planned)
- Mood-affecting face (smile / frown, planned)

If a future change makes a dupe look "modernised," "simplified," or
"smoother" — undo it. The chunky 10×14-ish sprite is the point.

---

## What's implemented now

- 130×75 grid, fits a 16:9 viewport exactly, no scrolling.
- Top-down terrain with Z-extrusion for cliffs and ravines.
- Procedural rivers carved from inland springs to the open sea, with
  momentum-blended paths and waterfalls where they spill off cliffs.
- Procedural ravines with darkened depth bands and natural cliff edges.
- Forests of stacked-canopy trees, clustered by fbm noise, automatically
  staying clear of stone and ravines (2-tile clearance).
- 12 dupes wandering between walkable tiles, with the original sprite's
  bobbing/swinging/carrying behaviour, periodic name tags, and clothing
  variety.

## What's deliberately not implemented yet

These are scoped out of the current refactor — adding them is the next
work, not a regression:

- Houses (organic emergence near workplaces)
- Machines (workbenches, furnaces, chests, windmills, water wheels)
- Stockpiles physically stacked in the world
- Jobs and work behaviours for dupes
- Speech bubbles and mood
- Day/night cycle and warm point lights
- The "big differentiator" picker (one named feature per day)
- Clothing progression as the colony advances tech
- Tech progression at all — paths through pottery, husbandry, recycling,
  power generation, etc., emerging from what each day's island provides

---

## File map

```
index.html        shell + script tags
js/config.js      tunable numbers, palettes, name lists
js/noise.js       hash, smoothNoise, fbm (seeded)
js/terrain.js     eight generation passes in order
js/dupes.js       spawn, wander AI, sprite drawing
js/render.js      tile render, tree render, Y-sorted dupe render
js/main.js        boot, animate loop, button wiring
```

Scripts load as plain `<script>` tags (not modules) so the page works
from `file://` and inside Wallpaper Engine without a server. All
top-level `let`/`const`/`function` declarations are shared across files.

## Where to edit, for which change

| Want to change                            | Edit                          |
|-------------------------------------------|-------------------------------|
| Number of dupes / trees / rivers          | `config.js` CONFIG            |
| Tile colours, dupe palette, tree colours  | `config.js` PALETTE / *_PALETTE |
| How trees look                            | `render.js` drawTree          |
| How dupes look                            | `dupes.js` drawDupe           |
| How dupes move                            | `dupes.js` updateDupes        |
| How the island is shaped                  | `terrain.js` generateBaseTerrain |
| How rivers flow                           | `terrain.js` carveOneRiver    |
| How ravines look                          | `terrain.js` carveOneRavine   |
| Add a new tile type                       | `config.js` PALETTE + `terrain.js` |
| Add a new pass to map gen                 | New function in `terrain.js`, call it from `generateMap()` |

## Editing rules of thumb

- Each file is intentionally short. If a file grows past ~300 lines it
  probably wants splitting again — that's a sign a new concept is
  emerging that deserves its own home.
- No magic numbers in logic files. If you find yourself typing a number
  twice, it goes to `config.js`.
- The eight passes in `terrain.js` are ordered for a reason. New passes
  should specify where they slot in and why.
- Globals are shared across scripts. Prefix new module-level names with
  the module name (e.g. `dupeFoo`, not `foo`) to avoid collisions.

---

## Things that have already been tried and rejected

Recording these so future iterations don't relearn the same lessons:

- **True isometric projection.** Created empty corners on 16:9 displays
  that couldn't be filled without scrolling. Replaced with top-down
  topographic + Z-extrusion.
- **Side-view perspective.** Made the island feel tiny and cramped. The
  current top-down view shows the whole world at once, which the spec
  requires.
- **Flowing grass animations.** Created visual noise and motion artefacts
  on what's supposed to be a calm wallpaper. Removed.
- **Excessive water motion.** Same problem. The current water has subtle
  sparkle and gentle ripple lines, nothing more.
- **Flat circle trees / pasted-sprite trees.** Didn't integrate with the
  Z-extrusion of the rest of the terrain. The current stacked-block
  canopy reads as part of the world.
- **Floating UI stockpiles.** Looked gauche. Stockpiles (when added)
  must be physical objects in the world.
- **Massive map-spanning differentiators.** Overwhelmed the playable
  area. Features should be present and visible but not dominate.
- **Smoothed / modernised dupe sprites.** Lost the chunky charm of the
  original. The current sprite is a faithful port of the Claude Factory
  prototype; keep it that way.

---

## Running it

No build step, no `npm install`, no server. Just open `index.html`.

For Wallpaper Engine: point it at `index.html`. The whole `colony/`
folder should ship together.

## Open questions (intentionally unresolved)

These are decisions for when the relevant feature lands, not blockers:

1. Do dupes auto-build bridges when rivers block important paths, or do
   rivers only generate where they don't fully segment the island?
2. Should every world have a big differentiator, or should some days be
   deliberately "vanilla" for variety?
3. When machines upgrade, do dupes replace them with new sprites, or do
   the existing sprites transform in place (wood → stone → iron)?
4. Do dupe names persist across days (so you recognise individuals) or
   reset each morning?
5. Should rare easter-egg events (meteor showers, auroras, migrations)
   happen on some days?
