/* ============================================================
 * render.js
 * All drawing. Reads from the map (terrain.js) and dupe list (dupes.js).
 *
 * Drawing order, row by row (Y-sorted so things behind get drawn first):
 *   1. Z-extrusion (cliff faces) below the tile
 *   2. Top face of the tile
 *   3. Directional inner shadows
 *   4. Ground decorations (water sparkle, grass tufts, waterfall foam)
 *   5. Trees
 *   6. Dupes whose floor-tile is on this row
 * ============================================================ */

let canvas, ctx;
let tileSize = 1;
let offsetX = 0;
let offsetY = 0;
let tick = 0;

function initRender(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const tileW = Math.floor(canvas.width / CONFIG.GRID_COLS);
    const tileH = Math.floor(canvas.height / CONFIG.GRID_ROWS);
    tileSize = Math.max(1, Math.min(tileW, tileH));
    offsetX = Math.floor((canvas.width  - (CONFIG.GRID_COLS * tileSize)) / 2);
    offsetY = Math.floor((canvas.height - (CONFIG.GRID_ROWS * tileSize)) / 2);
}

// Strata colours for the vertical cliff face. Picks darker bands as Z
// drops below sea level so ravine depth reads as "deep".
function strataColour(baseType, z) {
    if (z <= -3) return '#050505';
    if (z === -2) return '#1a1a1a';
    if (z === -1) return '#2a221a';
    if (z ===  0) return '#3a2a1a';
    if (z ===  1) {
        if (baseType === 'sandstone')     return PALETTE.sandstone.front;
        if (baseType.includes('stone'))   return PALETTE.stone.front;
        return '#5a4a3a';
    }
    if (z === 2) {
        if (baseType.includes('stone'))   return '#707070';
        return PALETTE.grass.front;
    }
    return PALETTE[baseType] ? PALETTE[baseType].front : '#000';
}

// ---------- Tree (Gemini 2 silhouette) ----------------------
// Three thin canopy slabs stacked on a slim trunk. Crucially smaller
// than the previous stacked-block tree, so it doesn't dominate the grid.
function drawTree(px, py, seed) {
    const t = tileSize;
    // Per-tree wobble for variety. `seed` is [0,1) from terrain.
    const heightVar = (seed * 0.4) * t;
    const cx = px + t / 2;        // centre x of the tile

    // Soft ground shadow.
    ctx.fillStyle = TREE_PALETTE.shadow;
    ctx.fillRect(cx - 0.45 * t, py + 0.55 * t, 0.9 * t, 0.25 * t);

    // Trunk — slim, two-tone for tiny shading.
    const trunkW = Math.max(2, 0.22 * t);
    const trunkH = 0.85 * t;
    ctx.fillStyle = TREE_PALETTE.trunkDark;
    ctx.fillRect(cx - trunkW / 2, py + 0.55 * t - trunkH, trunkW, trunkH);
    ctx.fillStyle = TREE_PALETTE.trunkLight;
    ctx.fillRect(cx - trunkW / 2, py + 0.55 * t - trunkH, Math.max(1, trunkW * 0.4), trunkH);

    // Three canopy slabs, each smaller + higher.
    // The bottom one is the widest darkest, top one is the smallest brightest.
    const canopyTop = py + 0.55 * t - trunkH - heightVar;

    // Layer 1 — widest, dark.
    let lw = 1.5 * t, lh = 0.7 * t;
    ctx.fillStyle = TREE_PALETTE.leafDark;
    ctx.fillRect(cx - lw / 2, canopyTop - lh, lw, lh);

    // Layer 2 — mid.
    lw = 1.2 * t; lh = 0.6 * t;
    ctx.fillStyle = TREE_PALETTE.leafMid;
    ctx.fillRect(cx - lw / 2, canopyTop - lh * 1.7, lw, lh);

    // Layer 3 — top, brightest.
    lw = 0.8 * t; lh = 0.5 * t;
    ctx.fillStyle = TREE_PALETTE.leafLight;
    ctx.fillRect(cx - lw / 2, canopyTop - lh * 2.9, lw, lh);

    // Tiny highlight pixel on the top-right of the canopy.
    ctx.fillStyle = TREE_PALETTE.leafHighlight;
    ctx.fillRect(cx + 0.1 * t, canopyTop - lh * 2.8, Math.max(1, 0.2 * t), Math.max(1, 0.2 * t));
}

// ---------- Single tile ------------------------------------
function drawTile(x, y) {
    const tile = getMap()[y][x];
    const px = offsetX + x * tileSize;
    const py = offsetY + y * tileSize;
    const drawY = py - tile.z * CONFIG.Z_MULT;

    // 1. Z-extrusion: draw cliff face down to the southern neighbour's height.
    const southZ = (y + 1 < CONFIG.GRID_ROWS) ? getMap()[y + 1][x].z : PALETTE.water.z;
    const drop = tile.z - southZ;
    if (drop > 0) {
        for (let layer = 0; layer < drop; layer++) {
            const curZ = tile.z - layer;
            ctx.fillStyle = strataColour(tile.type, curZ);
            ctx.fillRect(px, drawY + tileSize + layer * CONFIG.Z_MULT,
                         tileSize + 0.5, CONFIG.Z_MULT + 0.5);

            // Extra darkening for sub-zero (ravine) Z levels.
            if (curZ < 0) {
                ctx.fillStyle = `rgba(0,0,0,${Math.min(0.85, -curZ * 0.25)})`;
                ctx.fillRect(px, drawY + tileSize + layer * CONFIG.Z_MULT,
                             tileSize + 0.5, CONFIG.Z_MULT + 0.5);
            }

            // Waterfall — paint the cliff face as flowing water.
            if (tile.feature === 'waterfall') {
                let f = ((tick * 0.08) - layer * 0.15) % 1;
                if (f < 0) f += 1;
                ctx.fillStyle = 'rgba(56, 139, 186, 0.9)';
                ctx.fillRect(px, drawY + tileSize + layer * CONFIG.Z_MULT,
                             tileSize + 0.5, CONFIG.Z_MULT + 0.5);
                ctx.fillStyle = `rgba(200, 230, 255, ${0.2 + f * 0.6})`;
                ctx.fillRect(px + tileSize * 0.2, drawY + tileSize + layer * CONFIG.Z_MULT,
                             tileSize * 0.6, CONFIG.Z_MULT + 0.5);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(px + tileSize * 0.4, drawY + tileSize + layer * CONFIG.Z_MULT,
                             1.5, CONFIG.Z_MULT + 0.5);
            }
        }
        // Thin ambient occlusion line at the base of the cliff.
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(px, drawY + tileSize, tileSize, 1);
    }

    // 2. Top face — stone gets per-row strata for visual interest.
    let topColor = PALETTE[tile.type].top;
    if (tile.type.includes('stone') && tile.type !== 'sandstone') {
        const wobble = fbm(x * 0.05, y * 0.05, 1) * 5;
        const s = fbm(0, (y + wobble) * 0.1, 2);
        if (tile.type === 'stone_high') {
            topColor = s > 0.5 ? '#a0a0a0' : (s > 0.3 ? '#888888' : '#707070');
        } else if (tile.type === 'stone') {
            topColor = s > 0.5 ? '#8a8a8a' : (s > 0.3 ? '#737373' : '#5a5a5a');
        }
    }
    ctx.fillStyle = topColor;
    ctx.fillRect(px, drawY, tileSize + 0.5, tileSize + 0.5);

    // 3. Directional inner shadow — cheap depth cue from neighbour heights.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    const sw = Math.max(1, Math.floor(tileSize * 0.4));
    if (tile.shadow.w) ctx.fillRect(px,              drawY,                 sw,             tileSize + 0.5);
    if (tile.shadow.e) ctx.fillRect(px + tileSize - sw, drawY,              sw,             tileSize + 0.5);
    if (tile.shadow.n) ctx.fillRect(px,              drawY,                 tileSize + 0.5, sw);
    if (tile.shadow.s) ctx.fillRect(px,              drawY + tileSize - sw, tileSize + 0.5, sw);

    // 4. Ground decorations.
    if (tile.type === 'water') {
        const flow = Math.sin(x * 0.2 + y * 0.1 + tick * 0.05);
        if (flow > 0.5 && tile.seed > 0.3) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillRect(px + tileSize * 0.3, drawY + tileSize * 0.4,
                         Math.max(1, tileSize * 0.4), 2);
        }
        if (tile.seed > 0.9) {
            const sparkle = (Math.sin(tick * 0.1 + tile.seed * 50) + 1) / 2;
            ctx.fillStyle = `rgba(255,255,255,${sparkle * 0.5})`;
            ctx.fillRect(px + tileSize * 0.6, drawY + tileSize * 0.2, 2, 2);
        }
        if (tile.feature === 'waterfall') {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fillRect(px + tileSize * 0.2, drawY + tileSize * 0.6,
                         tileSize * 0.6, tileSize * 0.4);
        }
    } else if (tile.type.includes('grass') && tile.seed > 0.85 && tile.feature !== 'tree') {
        // Sparse grass tufts on non-tree grass.
        const dark = hash(x + 1, y) > 0.5;
        ctx.fillStyle = dark
            ? (tile.type === 'grass_dark' ? '#2a5a1a' : '#4a8c3a')
            : (tile.type === 'grass_dark' ? '#4a8c3a' : '#6bcf5a');
        const tw = Math.max(1, Math.floor(tileSize * 0.15));
        const th = Math.max(2, Math.floor(tileSize * 0.25));
        const ox = Math.floor(tileSize * 0.2 + tile.seed * tileSize * 0.3);
        const oy = Math.floor(tileSize * 0.2 + hash(y, x) * tileSize * 0.3);
        ctx.fillRect(px + ox,      drawY + oy,      tw, th * 2);
        ctx.fillRect(px + ox + tw, drawY + oy + th, tw, th);
    }

    // 5. Tree.
    if (tile.feature === 'tree') {
        drawTree(px, drawY, tile.seed);
    }
}

// Group dupes by their floor row so they composite correctly with terrain.
function groupDupesByRow() {
    const buckets = Array.from({ length: CONFIG.GRID_ROWS }, () => []);
    for (const d of getDupes()) {
        const row = Math.max(0, Math.min(CONFIG.GRID_ROWS - 1, Math.floor(d.y)));
        buckets[row].push(d);
    }
    return buckets;
}

function drawDupesInRow(rowBucket) {
    for (const d of rowBucket) {
        const tile = tileAt(Math.floor(d.x), Math.floor(d.y));
        const z = tile ? tile.z : 0;
        // Foot anchor in canvas pixels, lifted by the tile's elevation.
        const px = offsetX + d.x * tileSize;
        const py = offsetY + d.y * tileSize - z * CONFIG.Z_MULT + tileSize * 0.5;
        // Scale dupe to look right at any tile size. ~14 absolute units tall.
        const unit = Math.max(0.6, tileSize / 6);
        drawDupe(ctx, d, px, py, unit);
    }
}

function render() {
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const dupeBuckets = groupDupesByRow();

    for (let y = 0; y < CONFIG.GRID_ROWS; y++) {
        for (let x = 0; x < CONFIG.GRID_COLS; x++) {
            drawTile(x, y);
        }
        // Y-sort dupes: draw any dupe whose feet are in this row right
        // after the row is finished. Terrain below them is already drawn,
        // and rows further south will overdraw if a dupe extends into them.
        drawDupesInRow(dupeBuckets[y]);
    }
}
