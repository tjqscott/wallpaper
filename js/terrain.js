/* ============================================================
 * terrain.js
 * Procedural island generation. Each pass is its own function so
 * the pipeline reads top-to-bottom in `generateMap()`.
 *
 * Order matters:
 *   1. base terrain (height-from-distance + noise)
 *   2. BFS sea-distance (used by rivers + later passes)
 *   3. rivers (carved downhill from inland springs)
 *   4. ravines (tectonic chasms with darkened depth)
 *   5. waterfalls (water tiles sitting north of lower ground)
 *   6. cleanup (orphan stone tiles → grass)
 *   7. shadows (per-tile directional flags)
 *   8. flora placement (trees, away from rock)
 * ============================================================ */

let map = [];

function getMap() { return map; }

// Look up a tile safely; returns null outside bounds.
function tileAt(x, y) {
    if (x < 0 || x >= CONFIG.GRID_COLS || y < 0 || y >= CONFIG.GRID_ROWS) return null;
    return map[y][x];
}

// ---------- Pass 1: base terrain ----------------------------

// Single circular blob contribution.
function radialBlob(wx, wy, cx, cy, r) {
    return 1 - Math.hypot(wx - cx, wy - cy) / r;
}

// Smooth ramp: 0 at x<=0, 1 at x>=1, cubic ease between.
function smoothstep(x) {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
}

function pickLandShape() {
    const cols = CONFIG.GRID_COLS, rows = CONFIG.GRID_ROWS;

    // Always centred on the grid — the domain warp and fbm modulation provide
    // all the positional variety needed; shifting the centre just pushes land
    // off-screen and wastes playable space.
    const cx = cols * 0.5;
    const cy = rows * 0.5;

    const archetype = Math.floor(hash(3, 0) * 6);

    if (archetype === 0) {
        // Large single island.
        const r = 36 + hash(4, 0) * 10;
        return (wx, wy) => radialBlob(wx, wy, cx, cy, r);
    }

    if (archetype === 1) {
        // Elongated landmass — Iceland / Japan shape.
        // High stretch ratio + random rotation fills the viewport edge-to-edge.
        const stretch = 2.6 + hash(4, 0) * 1.6;
        const r = 28 + hash(5, 0) * 10;
        const angle = hash(6, 0) * Math.PI;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        return (wx, wy) => {
            const dx = wx - cx, dy = wy - cy;
            const lx = dx * cos + dy * sin;
            const ly = -dx * sin + dy * cos;
            return 1 - Math.hypot(lx / stretch, ly) / r;
        };
    }

    if (archetype === 2) {
        // Twin landmasses with a visible strait.
        const sep = 32 + hash(4, 0) * 20;
        const ang = hash(5, 0) * Math.PI * 2;
        const c1x = cx + Math.cos(ang) * sep * 0.5;
        const c1y = cy + Math.sin(ang) * sep * 0.5;
        const c2x = cx - Math.cos(ang) * sep * 0.5;
        const c2y = cy - Math.sin(ang) * sep * 0.5;
        const r1 = 24 + hash(6, 0) * 10;
        const r2 = 20 + hash(7, 0) * 10;
        return (wx, wy) => Math.max(
            radialBlob(wx, wy, c1x, c1y, r1),
            radialBlob(wx, wy, c2x, c2y, r2)
        );
    }

    if (archetype === 3) {
        // Peninsulas — a meaty core with 3-4 full-sized lobes that create
        // genuine fjords and headlands between them. Lobes at full weight (1.0)
        // so they actually read as land, not just a bumpy coastline.
        const coreR = 24 + hash(4, 0) * 8;
        const lobeCount = 3 + Math.floor(hash(5, 0) * 2);
        const lobes = [];
        for (let i = 0; i < lobeCount; i++) {
            // Space lobes unevenly so they don't form a symmetrical star.
            const ang = (i / lobeCount) * Math.PI * 2
                      + hash(6, i) * (Math.PI * 2 / lobeCount) * 0.7;
            const dist = coreR * (0.8 + hash(7, i) * 0.6);
            lobes.push({
                cx: cx + Math.cos(ang) * dist,
                cy: cy + Math.sin(ang) * dist,
                r: 16 + hash(8, i) * 12,
            });
        }
        return (wx, wy) => Math.max(
            radialBlob(wx, wy, cx, cy, coreR),
            ...lobes.map(l => radialBlob(wx, wy, l.cx, l.cy, l.r))
        );
    }

    if (archetype === 4) {
        // Archipelago — 4-5 islands spread wide. Each island is large enough
        // to feel inhabited; total land area similar to a single island.
        const count = 4 + Math.floor(hash(4, 0) * 2);
        const islands = [];
        for (let i = 0; i < count; i++) {
            const spread = 26 + hash(5, i) * 18;
            const ang = (i / count) * Math.PI * 2 + hash(6, i);
            islands.push({
                cx: cx + Math.cos(ang) * spread,
                cy: cy + Math.sin(ang) * spread,
                r: 14 + hash(7, i) * 10,
            });
        }
        return (wx, wy) => islands.reduce((best, isl) =>
            Math.max(best, radialBlob(wx, wy, isl.cx, isl.cy, isl.r)), 0);
    }

    // archetype === 5: drowned ridge — land emerges from a noise ridge
    // rather than a blob, producing a jagged spinal shape like a submerged
    // mountain range. Looks completely different from all the blob archetypes.
    const ridgeAng = hash(4, 0) * Math.PI;
    const ridgeCos = Math.cos(ridgeAng), ridgeSin = Math.sin(ridgeAng);
    const ridgeLen = 40 + hash(5, 0) * 30;   // half-length of the spine
    const ridgeW   = 18 + hash(6, 0) * 10;   // width of the ridge
    return (wx, wy) => {
        const dx = wx - cx, dy = wy - cy;
        // Along-spine and cross-spine distances.
        const along = dx * ridgeCos + dy * ridgeSin;
        const cross = -dx * ridgeSin + dy * ridgeCos;
        // Falloff along the spine (caps the ends naturally).
        const spineT = 1 - Math.abs(along) / ridgeLen;
        if (spineT <= 0) return -1;
        // Width varies along the spine using a low-freq noise so the ridge
        // bulges and pinches rather than being a uniform sausage.
        const localW = ridgeW * (0.5 + smoothNoise(along * 0.03 + 7, 0) * 0.7);
        return 1 - Math.abs(cross) / localW;
    };
}

function generateBaseTerrain() {
    const landShape = pickLandShape();
    const cols = CONFIG.GRID_COLS, rows = CONFIG.GRID_ROWS;

    // Per-axis safe-zone falloff: smoothstep over a MARGIN-tile band at each
    // edge. Using smoothstep (not pow) gives a clear visible water border
    // without a hard rectangular line. Multiplying X and Y falloffs together
    // rounds the corners organically.
    const MARGIN = 7;   // water border width in tiles — between old (10) and recent (4)
    function edgeFalloff(x, y) {
        const fx = smoothstep(x / MARGIN) * smoothstep((cols - 1 - x) / MARGIN);
        const fy = smoothstep(y / MARGIN) * smoothstep((rows - 1 - y) / MARGIN);
        return fx * fy;
    }

    map = [];
    for (let y = 0; y < rows; y++) {
        map[y] = [];
        for (let x = 0; x < cols; x++) {
            // Two-pass domain warp: coarse bends the whole island, fine
            // roughens the coastline.
            const coarseX = fbm(x * 0.025, y * 0.025, 3) * 22;
            const coarseY = fbm(x * 0.025 + 40, y * 0.025 + 40, 3) * 22;
            const fineX   = fbm(x * 0.07 + 80,  y * 0.07 + 80,  2) * 7;
            const fineY   = fbm(x * 0.07 + 120, y * 0.07 + 120, 2) * 7;
            const wx = x + coarseX + fineX;
            const wy = y + coarseY + fineY;

            let landBase = landShape(wx, wy);

            // Large-scale fbm modulation — punches bays and builds headlands.
            // Amplitude scales with landBase proximity to the coast (near 0)
            // so bays are deep near the shoreline but don't erode the interior.
            const warpField = fbm(x * 0.04 + 200, y * 0.04 + 200, 4) - 0.5;
            const coastProximity = 1 - Math.abs(Math.min(1, Math.max(-1, landBase / 0.4)));
            landBase += warpField * 0.5 * coastProximity;

            // Soft edge falloff — multiplied, not clamped, so no hard line.
            landBase *= edgeFalloff(x, y);

            let type = 'water';
            let z = PALETTE.water.z;

            if (landBase > 0.06) { type = 'sand';       z = PALETTE.sand.z; }
            if (landBase > 0.13) { type = 'grass';      z = PALETTE.grass.z; }
            if (landBase > 0.55) { type = 'grass_dark'; z = PALETTE.grass_dark.z; }

            if (type === 'grass' || type === 'grass_dark') {
                const mnt = fbm(x * 0.1, y * 0.1, 3);
                if      (mnt > 0.75) { type = 'stone_high'; z = PALETTE.stone_high.z; }
                else if (mnt > 0.65) { type = 'stone';      z = PALETTE.stone.z; }
            }

            // Inland ponds.
            if (type === 'grass' || type === 'sand') {
                if (fbm(x * 0.06 + 300, y * 0.06 + 300, 2) > 0.75) {
                    type = 'water';
                    z = PALETTE.water.z;
                }
            }

            map[y][x] = {
                type, z,
                seed: hash(x, y),
                shadow: {},
                feature: null,
            };
        }
    }
}

// ---------- Pass 2: BFS distance from the open sea ----------
function computeSeaDistanceMap() {
    const rows = CONFIG.GRID_ROWS, cols = CONFIG.GRID_COLS;
    const dist = Array.from({ length: rows }, () => new Array(cols).fill(9999));
    const queue = [];

    // Seed BFS from every water tile on the canvas border.
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const onBorder = (x === 0 || x === cols - 1 || y === 0 || y === rows - 1);
            if (onBorder && map[y][x].type === 'water') {
                dist[y][x] = 0;
                queue.push([x, y]);
            }
        }
    }

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let head = 0;
    while (head < queue.length) {
        const [cx, cy] = queue[head++];
        for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows
                && dist[ny][nx] > dist[cy][cx] + 1) {
                dist[ny][nx] = dist[cy][cx] + 1;
                queue.push([nx, ny]);
            }
        }
    }
    return dist;
}

// ---------- Pass 3: rivers ----------------------------------
function carveRivers(seaDist) {
    const n = CONFIG.RIVER_COUNT_MIN +
              Math.floor(Math.random() * (CONFIG.RIVER_COUNT_MAX - CONFIG.RIVER_COUNT_MIN + 1));
    for (let r = 0; r < n; r++) {
        carveOneRiver(seaDist, r);
    }
}

function carveOneRiver(seaDist, riverIndex) {
    // Find a high-elevation inland spring.
    let startX = 0, startY = 0, ok = false;
    for (let attempt = 0; attempt < 60 && !ok; attempt++) {
        const rx = 15 + Math.random() * (CONFIG.GRID_COLS - 30);
        const ry = 15 + Math.random() * (CONFIG.GRID_ROWS - 30);
        const ix = Math.floor(rx), iy = Math.floor(ry);
        if (map[iy][ix].z >= PALETTE.grass.z && seaDist[iy][ix] > 12) {
            startX = ix; startY = iy; ok = true;
        }
    }
    if (!ok) return;

    // Walk toward the sea with momentum + a touch of fbm jitter.
    let x = startX, y = startY;
    const path = [[x, y]];
    let vx = 0, vy = 0;

    for (let step = 0; step < 400; step++) {
        const ix = Math.floor(x), iy = Math.floor(y);
        if (ix < 0 || ix >= CONFIG.GRID_COLS
            || iy < 0 || iy >= CONFIG.GRID_ROWS
            || seaDist[iy][ix] === 0) break;

        // Sample 16 directions, pick the one with the biggest sea-distance drop.
        let bestAng = null, bestDrop = -1;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
            const nx = x + Math.cos(a) * 2, ny = y + Math.sin(a) * 2;
            const nix = Math.floor(nx), niy = Math.floor(ny);
            if (nix >= 0 && nix < CONFIG.GRID_COLS && niy >= 0 && niy < CONFIG.GRID_ROWS) {
                const drop = seaDist[iy][ix] - seaDist[niy][nix];
                if (drop > bestDrop) { bestDrop = drop; bestAng = a; }
            }
        }
        if (bestAng === null) break;

        // Momentum blend so the river curves rather than zig-zagging.
        vx = vx * 0.7 + Math.cos(bestAng) * 0.3;
        vy = vy * 0.7 + Math.sin(bestAng) * 0.3;
        const ang = Math.atan2(vy, vx) + (fbm(step * 0.05, riverIndex * 10, 1) * 0.5 - 0.25);
        vx = Math.cos(ang); vy = Math.sin(ang);

        x += vx * 0.8; y += vy * 0.8;
        const ix2 = Math.floor(x), iy2 = Math.floor(y);
        if (ix2 >= 0 && ix2 < CONFIG.GRID_COLS && iy2 >= 0 && iy2 < CONFIG.GRID_ROWS) {
            path.push([ix2, iy2]);
        } else break;
    }

    // Apply the brush along the path.
    // Core (d < 1.3): water.
    // Bank (1.3 ≤ d < 2.5): gentle grass — but ONLY on tiles that are already
    // inland grass. Never touch sand (coast), never touch existing water (ocean
    // or pond), and never change a tile's z — that's what was creating the
    // unnatural grass-on-beach ledges and ocean-adjacent grass patches.
    for (const [px, py] of path) {
        for (let cy = py - 3; cy <= py + 3; cy++) {
            for (let cx = px - 3; cx <= px + 3; cx++) {
                const t = tileAt(cx, cy);
                if (!t) continue;
                const d = Math.hypot(cx - px, cy - py);
                if (d < 1.3) {
                    t.type = 'water'; t.z = PALETTE.water.z;
                } else if (d < 2.5) {
                    // Bank tiles: only soften inland grass/grass_dark.
                    // Never write to sand, water, stone, or ravine tiles.
                    // Never change z — just swap the type so no cliff appears.
                    if (t.type === 'grass_dark') {
                        // Soften dark grass to regular grass near the bank.
                        // Also bring z down to grass level so no cliff forms
                        // between river edge and bank.
                        t.type = 'grass';
                        t.z = PALETTE.grass.z;
                    }
                    // All other types (sand, water, stone, sandstone, ravine_*) are left alone.
                }
            }
        }
    }
}

// ---------- Pass 4: ravines ---------------------------------
function carveRavines() {
    const n = CONFIG.RAVINE_COUNT_MIN +
              Math.floor(Math.random() * (CONFIG.RAVINE_COUNT_MAX - CONFIG.RAVINE_COUNT_MIN + 1));
    for (let r = 0; r < n; r++) {
        carveOneRavine(r);
    }
}

// True if any tile within `r` of (cx, cy) is water. Used by the ravine
// carver to leave a land buffer between chasms and rivers/sea, which
// otherwise creates jarring water-on-cliff-edge artefacts.
function hasWaterNearby(cx, cy, r) {
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            const t = tileAt(cx + dx, cy + dy);
            if (t && t.type === 'water') return true;
        }
    }
    return false;
}

function carveOneRavine(ravineIndex) {
    let rx = 0, ry = 0, ok = false;
    for (let attempt = 0; attempt < 50 && !ok; attempt++) {
        rx = 20 + Math.random() * (CONFIG.GRID_COLS - 40);
        ry = 20 + Math.random() * (CONFIG.GRID_ROWS - 40);
        if (map[Math.floor(ry)][Math.floor(rx)].z >= PALETTE.grass.z) ok = true;
    }
    if (!ok) return;

    const baseDir = Math.random() * Math.PI * 2;
    const length = 80 + Math.random() * 80;

    for (let step = 0; step < length; step++) {
        const ang = baseDir + (fbm(step * 0.02, ravineIndex * 100, 2) - 0.5) * Math.PI * 1.5;
        rx += Math.cos(ang) * 1.2;
        ry += Math.sin(ang) * 1.2;
        const ix = Math.floor(rx), iy = Math.floor(ry);
        const cur = tileAt(ix, iy);
        if (!cur) break;
        // Stop if we've punched out to the ocean.
        if (cur.z <= PALETTE.water.z && cur.type !== 'ravine_void') break;

        // Brush a band 8 tiles wide; carving deepest at the centre.
        for (let cy = iy - 8; cy <= iy + 8; cy++) {
            for (let cx = ix - 8; cx <= ix + 8; cx++) {
                const t = tileAt(cx, cy);
                if (!t) continue;
                // Never overwrite water — keeps coastlines & rivers intact.
                if (t.type === 'water') continue;

                const d = Math.hypot(cx - rx, cy - ry)
                        + (smoothNoise(cx * 0.3, cy * 0.3) - 0.5) * 1.5;

                // Sand at the chasm edge bakes into sandstone.
                if (t.type === 'sand' && d < 3.5) {
                    t.type = 'sandstone'; t.z = PALETTE.sandstone.z;
                }

                // Soften surrounding cliffs.
                if (d < 7.0) {
                    if (t.z >= PALETTE.stone.z) {
                        t.type = 'grass_dark'; t.z = PALETTE.grass_dark.z;
                    } else if (d < 5.5 && t.z === PALETTE.grass.z) {
                        t.type = 'stone'; t.z = PALETTE.stone.z;
                    }
                }

                // The chasm itself, deepest first so darker rings overwrite lighter ones.
                // Skip the deep carving if water is close — this prevents rivers
                // and the sea from butting up against ravine cliffs, which looks bad.
                if (hasWaterNearby(cx, cy, 2)) continue;
                if (d < 1.5) {
                    t.type = 'ravine_void';  t.z = PALETTE.ravine_void.z;
                } else if (d < 3.0 && t.z > PALETTE.ravine_stone.z) {
                    t.type = 'ravine_stone'; t.z = PALETTE.ravine_stone.z;
                } else if (d < 4.5 && t.z > PALETTE.ravine_edge.z) {
                    t.type = 'ravine_edge';  t.z = PALETTE.ravine_edge.z;
                }
            }
        }
    }
}

// ---------- Pass 5: waterfalls ------------------------------
// Any water tile that sits directly north of a lower tile spills.
function detectWaterfalls() {
    for (let y = 0; y < CONFIG.GRID_ROWS - 1; y++) {
        for (let x = 0; x < CONFIG.GRID_COLS; x++) {
            const t = map[y][x];
            if (t.type === 'water' && map[y + 1][x].z < t.z) {
                t.feature = 'waterfall';
            }
        }
    }
}

// ---------- Pass 6: stone cleanup ---------------------------
// Lonely stone tiles with no stone neighbours get demoted to grass.
function cleanupOrphanStone() {
    for (let y = 1; y < CONFIG.GRID_ROWS - 1; y++) {
        for (let x = 1; x < CONFIG.GRID_COLS - 1; x++) {
            const t = map[y][x];
            if (t.z < PALETTE.stone.z) continue;
            const neighbours =
                (map[y - 1][x].z >= PALETTE.stone.z) +
                (map[y + 1][x].z >= PALETTE.stone.z) +
                (map[y][x - 1].z >= PALETTE.stone.z) +
                (map[y][x + 1].z >= PALETTE.stone.z);
            if (neighbours === 0) {
                t.type = 'grass_dark';
                t.z = PALETTE.grass_dark.z;
            }
        }
    }
}

// ---------- Pass 7: per-tile directional shadows ------------
function computeShadows() {
    for (let y = 0; y < CONFIG.GRID_ROWS; y++) {
        for (let x = 0; x < CONFIG.GRID_COLS; x++) {
            const t = map[y][x];
            t.shadow = {
                n: y > 0                       && map[y - 1][x].z > t.z,
                s: y < CONFIG.GRID_ROWS - 1    && map[y + 1][x].z > t.z,
                w: x > 0                       && map[y][x - 1].z > t.z,
                e: x < CONFIG.GRID_COLS - 1    && map[y][x + 1].z > t.z,
            };
        }
    }
}

// ---------- Pass 8: flora placement -------------------------
// Trees prefer grass, stay clear of rock/ravine, cluster via fbm density.
function placeFlora() {
    const clearance = CONFIG.TREE_ROCK_CLEARANCE;
    for (let y = 0; y < CONFIG.GRID_ROWS; y++) {
        for (let x = 0; x < CONFIG.GRID_COLS; x++) {
            const t = map[y][x];
            if (t.type !== 'grass' && t.type !== 'grass_dark') continue;

            const density = fbm(x * 0.1, y * 0.1, 2);
            if (density <= CONFIG.TREE_DENSITY_THRESHOLD) continue;
            if (t.seed <= CONFIG.TREE_SEED_GATE) continue;

            // Reject anything within `clearance` of stone/ravine — keeps
            // forests visually distinct from rocky areas.
            let blocked = false;
            for (let dy = -clearance; dy <= clearance && !blocked; dy++) {
                for (let dx = -clearance; dx <= clearance && !blocked; dx++) {
                    const n = tileAt(x + dx, y + dy);
                    if (n && (n.type.includes('stone') || n.type.startsWith('ravine_'))) {
                        blocked = true;
                    }
                }
            }
            if (!blocked) t.feature = 'tree';
        }
    }
}

// ---------- Entrypoint --------------------------------------
function generateMap() {
    newRandomSeed();
    generateBaseTerrain();
    const seaDist = computeSeaDistanceMap();
    carveRivers(seaDist);
    carveRavines();
    detectWaterfalls();
    cleanupOrphanStone();
    computeShadows();
    placeFlora();
}