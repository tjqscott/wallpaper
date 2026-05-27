/* ============================================================
 * dupes.js
 * Minimal dupe layer: spawn, wander, draw.
 *
 * Pulled almost verbatim from the Claude Factory dupe drawing —
 * 10x14 body proportions, bobbing legs, swinging arms, visible
 * carried item, periodic name tag. Scaled to current tileSize.
 *
 * Movement is intentionally tiny: pick a nearby walkable tile,
 * walk toward it, repeat. This is a foundation, not the colony AI.
 * ============================================================ */

const dupes = [];

function getDupes() { return dupes; }

// Pick a random walkable spawn tile. Returns {x, y} grid coords or null.
function randomSpawnTile() {
    for (let attempt = 0; attempt < 200; attempt++) {
        const x = Math.floor(Math.random() * CONFIG.GRID_COLS);
        const y = Math.floor(Math.random() * CONFIG.GRID_ROWS);
        const t = tileAt(x, y);
        if (t && WALKABLE_TYPES.has(t.type) && t.feature !== 'tree') {
            return { x, y };
        }
    }
    return null;
}

function spawnDupes() {
    dupes.length = 0;
    for (let i = 0; i < CONFIG.DUPE_COUNT; i++) {
        const spawn = randomSpawnTile();
        if (!spawn) continue;
        dupes.push({
            id: i,
            name: DUPE_NAMES[i % DUPE_NAMES.length],
            // Position in grid space (floats). Render converts to pixels.
            x: spawn.x + 0.5,
            y: spawn.y + 0.5,
            // Target the dupe is wandering toward.
            tx: spawn.x + 0.5,
            ty: spawn.y + 0.5,
            // Pick-new-target countdown.
            wait: Math.random() * 120,
            dir: Math.random() < 0.5 ? 1 : -1,   // 1 = facing right, -1 = facing left
            bobPhase: Math.random() * Math.PI * 2,
            skin:    DUPE_PALETTE.skinTones[i % DUPE_PALETTE.skinTones.length],
            clothes: DUPE_PALETTE.clothes[i % DUPE_PALETTE.clothes.length],
            state: 'walk',                       // 'walk' | 'idle'
            carrying: Math.random() < 0.3,       // small chance of starting loaded
            carryColor: ['#c89a5a', '#8a8a8a', '#a0d080'][Math.floor(Math.random() * 3)],
        });
    }
}

// Pick a new random walkable target within `radius` of the dupe's current tile.
function pickNewTarget(d) {
    const radius = 6;
    const cx = Math.floor(d.x), cy = Math.floor(d.y);
    for (let attempt = 0; attempt < 20; attempt++) {
        const nx = cx + Math.floor((Math.random() * 2 - 1) * radius);
        const ny = cy + Math.floor((Math.random() * 2 - 1) * radius);
        const t = tileAt(nx, ny);
        if (t && WALKABLE_TYPES.has(t.type) && t.feature !== 'tree') {
            d.tx = nx + 0.5;
            d.ty = ny + 0.5;
            return;
        }
    }
    // Fallback: stay put.
    d.tx = d.x;
    d.ty = d.y;
}

function updateDupes() {
    for (const d of dupes) {
        d.bobPhase += d.state === 'walk' ? 0.18 : 0.05;
        d.wait -= 1;

        if (d.wait <= 0) {
            // Flip between walking and brief idle pauses.
            if (d.state === 'walk' && Math.random() < 0.25) {
                d.state = 'idle';
                d.wait = 40 + Math.random() * 80;
            } else {
                d.state = 'walk';
                pickNewTarget(d);
                d.wait = 120 + Math.random() * 240;
                // Toggle carry occasionally.
                if (Math.random() < 0.15) d.carrying = !d.carrying;
            }
        }

        if (d.state !== 'walk') continue;

        const dx = d.tx - d.x;
        const dy = d.ty - d.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.05) continue;

        const speed = d.carrying ? 0.02 : 0.03;
        d.x += (dx / dist) * speed;
        d.y += (dy / dist) * speed;
        if (Math.abs(dx) > 0.01) d.dir = dx > 0 ? 1 : -1;

        // Safety: if the dupe somehow ended up on a non-walkable tile
        // (e.g. terrain regenerated under their feet), pick a new target.
        const here = tileAt(Math.floor(d.x), Math.floor(d.y));
        if (!here || !WALKABLE_TYPES.has(here.type)) {
            pickNewTarget(d);
        }
    }
}

// ---------- Drawing ----------------------------------------
// Faithful port of the Claude Factory dupe — 10x14ish in absolute units,
// rescaled to `unit` so it looks right at any tile size.
//
// (px, py) is the dupe's foot anchor in canvas pixels.
function drawDupe(ctx, d, px, py, unit) {
    const bob = d.state === 'walk' ? Math.sin(d.bobPhase * 2) * 0.6 * unit
                                   : Math.sin(d.bobPhase * 0.5) * 0.3 * unit;
    const x = px;
    const y = py + bob;
    const flip = d.dir < 0;

    ctx.save();
    if (flip) {
        ctx.translate(x, 0);
        ctx.scale(-1, 1);
        ctx.translate(-x, 0);
    }

    // Foot shadow.
    ctx.fillStyle = DUPE_PALETTE.shadow;
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 2.4 * unit, 0.9 * unit, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (swing while walking).
    const legSwing = d.state === 'walk' ? Math.sin(d.bobPhase * 2) * 1.0 * unit : 0;
    ctx.fillStyle = DUPE_PALETTE.legs;
    ctx.fillRect(x - 1.4 * unit, y - 2.4 * unit, 1.3 * unit, 2.6 * unit + legSwing);
    ctx.fillRect(x + 0.1 * unit, y - 2.4 * unit, 1.3 * unit, 2.6 * unit - legSwing);

    // Body.
    ctx.fillStyle = d.clothes;
    ctx.fillRect(x - 1.7 * unit, y - 6.4 * unit, 3.4 * unit, 4.0 * unit);
    // Subtle highlight stripe down the front for shading.
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x - 0.6 * unit, y - 6.2 * unit, 1.2 * unit, 3.6 * unit);

    // Arms (swing while walking).
    const armSwing = d.state === 'walk' ? Math.sin(d.bobPhase * 2) * 0.8 * unit : 0;
    ctx.fillStyle = d.clothes;
    ctx.fillRect(x - 2.6 * unit, y - 6.0 * unit + armSwing, 0.9 * unit, 2.4 * unit);
    ctx.fillRect(x + 1.7 * unit, y - 6.0 * unit - armSwing, 0.9 * unit, 2.4 * unit);

    // Carried item (drawn above the head).
    if (d.carrying) {
        ctx.fillStyle = d.carryColor;
        ctx.fillRect(x - 1.7 * unit, y - 11.0 * unit, 3.4 * unit, 2.6 * unit);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 0.4;
        ctx.strokeRect(x - 1.7 * unit, y - 11.0 * unit, 3.4 * unit, 2.6 * unit);
    }

    // Head.
    ctx.fillStyle = d.skin;
    ctx.fillRect(x - 1.4 * unit, y - 9.3 * unit, 2.8 * unit, 3.0 * unit);
    // Hair/cap band.
    ctx.fillStyle = d.clothes;
    ctx.fillRect(x - 1.4 * unit, y - 9.6 * unit, 2.8 * unit, 1.0 * unit);

    // Eyes — shift forward when "walking" (here: always slightly forward).
    ctx.fillStyle = DUPE_PALETTE.eye;
    const eyeX = x + 0.4 * unit;
    ctx.fillRect(eyeX - 0.7 * unit, y - 8.0 * unit, 0.7 * unit, 0.7 * unit);
    ctx.fillRect(eyeX + 0.4 * unit, y - 8.0 * unit, 0.7 * unit, 0.7 * unit);

    ctx.restore();

    // Name tag — appears for 60 ticks every 240, cycled per-dupe so they
    // don't all flash at once.
    if (tick % 240 < 60 && Math.floor(tick / 240) % Math.max(1, dupes.length) === d.id) {
        const tagW = Math.max(28, d.name.length * 4 + 8);
        ctx.fillStyle = DUPE_PALETTE.nameTagBg;
        ctx.fillRect(x - tagW / 2, y - 13.5 * unit, tagW, 8);
        ctx.fillStyle = DUPE_PALETTE.nameTagFg;
        ctx.font = '6px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.name, x, y - 13.5 * unit + 4);
    }
}
