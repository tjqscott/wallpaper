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

function radialBlob(wx, wy, cx, cy, r) {
    return 1 - Math.hypot(wx - cx, wy - cy) / r;
}

function smoothstep(x) {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
}

function pickLandShape() {
    const cols = CONFIG.GRID_COLS, rows = CONFIG.GRID_ROWS;
    const cx = cols * 0.5;
    const cy = rows * 0.5;
    const archetype = Math.floor(hash(3, 0) * 6);

    if (archetype === 0) {
        const r = 36 + hash(4, 0) * 10;
        return (wx, wy) => radialBlob(wx, wy, cx, cy, r);
    }

    if (archetype === 1) {
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
        const coreR = 24 + hash(4, 0) * 8;
        const lobeCount = 3 + Math.floor(hash(5, 0) * 2);
        const lobes = [];
        for (let i = 0; i < lobeCount; i++) {
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

    // archetype === 5: drowned ridge
    const ridgeAng = hash(4, 0) * Math.PI;
    const ridgeCos = Math.cos(ridgeAng), ridgeSin = Math.sin(ridgeAng);
    const ridgeLen = 40 + hash(5, 0) * 30;
    const ridgeW   = 18 + hash(6, 0) * 10;
    return (wx, wy) => {
        const dx = wx - cx, dy = wy - cy;
        const along = dx * ridgeCos + dy * ridgeSin;
        const cross = -dx * ridgeSin + dy * ridgeCos;
        const spineT = 1 - Math.abs(along) / ridgeLen;
        if (spineT <= 0) return -1;
        const localW = ridgeW * (0.5 + smoothNoise(along * 0.03 + 7, 0) * 0.7);
        return 1 - Math.abs(cross) / localW;
    };
}

function generateBaseTerrain() {
    const landShape = pickLandShape();
    const cols = CONFIG.GRID_COLS, rows = CONFIG.GRID_ROWS;

    const MARGIN = 7;
    function edgeFalloff(x, y) {
        const fx = smoothstep(x / MARGIN) * smoothstep((cols - 1 - x) / MARGIN);
        const fy = smoothstep(y / MARGIN) * smoothstep((rows - 1 - y) / MARGIN);
        return fx * fy;
    }

    map = [];
    for (let y = 0; y < rows; y++) {
        map[y] = [];
        for (let x = 0; x < cols; x++) {
            const coarseX = fbm(x * 0.025, y * 0.025, 3) * 22;
            const coarseY = fbm(x * 0.025 + 40, y * 0.025 + 40, 3) * 22;
            const fineX   = fbm(x * 0.07 + 80,  y * 0.07 + 80,  2) * 7;
            const fineY   = fbm(x * 0.07 + 120, y * 0.07 + 120, 2) * 7;
            const wx = x + coarseX + fineX;
            const wy = y + coarseY + fineY;

            let landBase = landShape(wx, wy);

            const warpField = fbm(x * 0.04 + 200, y * 0.04 + 200, 4) - 0.5;
            const coastProximity = 1 - Math.abs(Math.min(1, Math.max(-1, landBase / 0.4)));
            landBase += warpField * 0.5 * coastProximity;
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

    let x = startX, y = startY;
    const path = [[x, y]];
    let vx = 0, vy = 0;

    for (let step = 0; step < 400; step++) {
        const ix = Math.floor(x), iy = Math.floor(y);
        if (ix < 0 || ix >= CONFIG.GRID_COLS
            || iy < 0 || iy >= CONFIG.GRID_ROWS
            || seaDist[iy][ix] === 0) break;

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

    for (const [px, py] of path) {
        for (let cy = py - 3; cy <= py + 3; cy++) {
            for (let cx = px - 3; cx <= px + 3; cx++) {
                const t = tileAt(cx, cy);
                if (!t) continue;
                const d = Math.hypot(cx - px, cy - py);
                if (d < 1.3) {
                    t.type = 'water'; t.z = PALETTE.water.z;
                } else if (d < 2.5) {
                    if (t.type === 'grass_dark') {
                        t.type = 'grass';
                        t.z = PALETTE.grass.z;
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
        if (cur.z <= PALETTE.water.z && cur.type !== 'ravine_void') break;

        for (let cy = iy - 8; cy <= iy + 8; cy++) {
            for (let cx = ix - 8; cx <= ix + 8; cx++) {
                const t = tileAt(cx, cy);
                if (!t) continue;
                if (t.type === 'water') continue;

                const d = Math.hypot(cx - rx, cy - ry)
                        + (smoothNoise(cx * 0.3, cy * 0.3) - 0.5) * 1.5;

                if (t.type === 'sand' && d < 3.5) {
                    t.type = 'sandstone'; t.z = PALETTE.sandstone.z;
                }

                if (d < 7.0) {
                    if (t.z >= PALETTE.stone.z) {
                        t.type = 'grass_dark'; t.z = PALETTE.grass_dark.z;
                    } else if (d < 5.5 && t.z === PALETTE.grass.z) {
                        t.type = 'stone'; t.z = PALETTE.stone.z;
                    }
                }

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
function placeFlora() {
    const clearance = CONFIG.TREE_ROCK_CLEARANCE;
    for (let y = 0; y < CONFIG.GRID_ROWS; y++) {
        for (let x = 0; x < CONFIG.GRID_COLS; x++) {
            const t = map[y][x];
            if (t.type !== 'grass' && t.type !== 'grass_dark') continue;

            const density = fbm(x * 0.1, y * 0.1, 2);
            if (density <= CONFIG.TREE_DENSITY_THRESHOLD) continue;
            if (t.seed <= CONFIG.TREE_SEED_GATE) continue;

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
