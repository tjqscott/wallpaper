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
function generateBaseTerrain() {
    map = [];
    for (let y = 0; y < CONFIG.GRID_ROWS; y++) {
        map[y] = [];
        for (let x = 0; x < CONFIG.GRID_COLS; x++) {
            // Domain warp so the coastline isn't a clean ellipse.
            const warpX = fbm(x * 0.04, y * 0.04, 2) * 15;
            const warpY = fbm(x * 0.04 + 100, y * 0.04 + 100, 2) * 15;
            const wx = x + warpX, wy = y + warpY;

            // Two falloffs blended → a main island + an optional smaller one.
            const dMain = Math.hypot(wx - 65, wy - 37) / 40;
            const dSec  = Math.hypot(wx - 105, wy - 55) / 18;
            const landBase = Math.max(1 - dMain, (1 - dSec) * 0.9);

            let type = 'water';
            let z = PALETTE.water.z;

            if (landBase > 0.10) { type = 'sand';       z = PALETTE.sand.z; }
            if (landBase > 0.25) { type = 'grass';      z = PALETTE.grass.z; }
            if (landBase > 0.60) { type = 'grass_dark'; z = PALETTE.grass_dark.z; }

            if (type === 'grass' || type === 'grass_dark') {
                const mnt = fbm(x * 0.1, y * 0.1, 3);
                if      (mnt > 0.75) { type = 'stone_high'; z = PALETTE.stone_high.z; }
                else if (mnt > 0.65) { type = 'stone';      z = PALETTE.stone.z; }
            }

            // Inland ponds — small water blobs that aren't part of the sea.
            if (type === 'grass' || type === 'sand') {
                if (fbm(x * 0.06 + 300, y * 0.06 + 300, 2) > 0.75) {
                    type = 'water';
                    z = PALETTE.water.z;
                }
            }

            map[y][x] = {
                type, z,
                seed: hash(x, y),     // per-tile [0,1) for stable decorations
                shadow: {},           // filled in pass 7
                feature: null,        // 'tree' | 'waterfall' | null
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

    // Apply the brush along the path: a 1-tile water core with sandy/grassy banks.
    for (const [px, py] of path) {
        for (let cy = py - 3; cy <= py + 3; cy++) {
            for (let cx = px - 3; cx <= px + 3; cx++) {
                const t = tileAt(cx, cy);
                if (!t) continue;
                const d = Math.hypot(cx - px, cy - py);
                if (d < 1.3) {
                    t.type = 'water'; t.z = PALETTE.water.z;
                } else if (d < 2.5 && t.z > PALETTE.water.z) {
                    if (seaDist[cy][cx] <= 3) {
                        t.type = 'sand'; t.z = PALETTE.sand.z;
                    } else if (t.z < PALETTE.stone.z && t.type !== 'grass_dark') {
                        t.type = 'grass'; t.z = PALETTE.grass.z;
                    }
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
