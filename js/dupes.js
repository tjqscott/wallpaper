/* ============================================================
 * dupes.js — spawn, AI, drawing.
 *
 * Water-walking fix: every tx/ty assignment is validated against
 * WALKABLE_TYPES before being accepted. Stockpile targets are also
 * verified; if the stockpile tile itself is somehow non-walkable the
 * dupe finds the nearest walkable tile adjacent to it.
 *
 * AI phases:  idle → travel → work → carry → idle
 * ============================================================ */

const dupes = [];
function getDupes() { return dupes; }

// ---- Tile safety helpers -----------------------------------

function isTileWalkable(x, y) {
    const t = tileAt(x, y);
    return t && WALKABLE_TYPES.has(t.type) && t.feature !== 'tree' && t.feature !== 'sapling';
}

// Find the nearest walkable tile to (cx,cy) within radius, excluding trees/saplings.
function nearestWalkable(cx, cy, radius) {
    for (let r = 0; r <= radius; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                if (isTileWalkable(cx+dx, cy+dy)) return {x: cx+dx, y: cy+dy};
            }
        }
    }
    return null;
}

// Set dupe target; silently refuse if the resolved tile isn't walkable.
function setTarget(d, gx, gy) {
    if (isTileWalkable(gx, gy)) {
        d.tx = gx + 0.5; d.ty = gy + 0.5;
        return true;
    }
    // Try nearby.
    const near = nearestWalkable(gx, gy, 3);
    if (near) { d.tx = near.x + 0.5; d.ty = near.y + 0.5; return true; }
    return false;
}

// ---- Spawn -------------------------------------------------

function randomSpawnTile() {
    for (let attempt = 0; attempt < 200; attempt++) {
        const x = Math.floor(Math.random() * CONFIG.GRID_COLS);
        const y = Math.floor(Math.random() * CONFIG.GRID_ROWS);
        if (isTileWalkable(x, y)) return {x, y};
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
            x: spawn.x + 0.5, y: spawn.y + 0.5,
            tx: spawn.x + 0.5, ty: spawn.y + 0.5,
            wait: Math.random() * 120,
            dir: Math.random() < 0.5 ? 1 : -1,
            bobPhase: Math.random() * Math.PI * 2,
            skin:    DUPE_PALETTE.skinTones[i % DUPE_PALETTE.skinTones.length],
            clothes: DUPE_PALETTE.clothes[i % DUPE_PALETTE.clothes.length],
            state: 'walk',
            carrying: false, carryColor: '#c89a5a',
            carryTimer: 0, carryResource: null, carryTarget: null,
            job: null, jobPhase: null,
        });
    }
}

// ---- Wander target -----------------------------------------

function pickNewTarget(d) {
    const radius = 6;
    const cx = Math.floor(d.x), cy = Math.floor(d.y);
    for (let attempt = 0; attempt < 30; attempt++) {
        const nx = cx + Math.floor((Math.random()*2-1) * radius);
        const ny = cy + Math.floor((Math.random()*2-1) * radius);
        if (isTileWalkable(nx, ny)) { d.tx = nx+0.5; d.ty = ny+0.5; return; }
    }
    // Fall back to current position.
    d.tx = d.x; d.ty = d.y;
}

// ---- Work position -----------------------------------------
// Find a walkable tile adjacent to (jx,jy) to stand while working.
function pickWorkPosition(jx, jy) {
    for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]) {
        if (isTileWalkable(jx+dx, jy+dy)) return {x:jx+dx+0.5, y:jy+dy+0.5};
    }
    return null;
}

// ---- Stockpile target --------------------------------------
// Returns a safe walkable position at or near the stockpile.
function stockpileWalkTarget(sp) {
    if (!sp) return null;
    if (isTileWalkable(sp.x, sp.y)) return {x:sp.x+0.5, y:sp.y+0.5};
    const near = nearestWalkable(sp.x, sp.y, 4);
    if (near) return {x:near.x+0.5, y:near.y+0.5};
    return null;
}

// ---- Main update -------------------------------------------

function updateDupes() {
    for (const d of dupes) {
        d.bobPhase += d.state==='walk' ? 0.18 : 0.05;

        // ----- Working -----
        if (d.state === 'work') {
            if (!d.job) { d.state='idle'; d.wait=20; continue; }
            workOnJob(d);
            // Job may have just completed — check if we now carry something.
            if (!d.job && d.carrying && d.carryTarget) {
                const dest = stockpileWalkTarget(d.carryTarget);
                if (dest) {
                    d.tx = dest.x; d.ty = dest.y;
                    d.jobPhase = 'carry';
                    d.state = 'walk';
                    d.wait = 900;
                } else {
                    // Can't reach stockpile — drop it.
                    d.carrying = false; d.carryResource = null;
                    d.carryTarget = null; d.jobPhase = null;
                    d.state = 'idle'; d.wait = 30;
                }
            }
            continue;
        }

        // ----- Idle / walk -----
        d.wait--;

        // Carry-timer fallback.
        if (d.carrying && d.carryTimer > 0) {
            d.carryTimer--;
            if (d.carryTimer <= 0) {
                d.carrying=false; d.carryResource=null; d.carryTarget=null; d.jobPhase=null;
            }
        }

        // Guard against current position being on water (shouldn't happen,
        // but if terrain changed snap back to nearest walkable).
        if (!isTileWalkable(Math.floor(d.x), Math.floor(d.y))) {
            const safe = nearestWalkable(Math.floor(d.x), Math.floor(d.y), 5);
            if (safe) { d.x=safe.x+0.5; d.y=safe.y+0.5; d.tx=d.x; d.ty=d.y; }
        }

        if (d.wait <= 0 && d.jobPhase !== 'carry') {
            // Look for a job.
            if (!d.job && !d.carrying) {
                const j = findNearestJob(Math.floor(d.x), Math.floor(d.y));
                if (j) {
                    const wp = pickWorkPosition(j.x, j.y);
                    if (wp) {
                        assignJob(d, j);
                        d.tx = wp.x; d.ty = wp.y;
                        d.state = 'walk'; d.jobPhase = 'travel'; d.wait = 700;
                        continue;
                    }
                    // No safe standing position — skip this job.
                }
            }

            // Wander.
            if (d.state==='walk' && Math.random()<0.25) {
                d.state='idle'; d.wait=40+Math.random()*80;
            } else {
                d.state='walk'; pickNewTarget(d);
                d.wait=120+Math.random()*240;
            }
        }

        if (d.state !== 'walk') continue;

        const dx = d.tx - d.x, dy = d.ty - d.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 0.15) {
            if (d.jobPhase==='travel' && d.job) {
                d.state='work'; d.jobPhase='work';
                d.dir = d.job.x > d.x ? 1 : -1;
            } else if (d.jobPhase==='carry' && d.carrying) {
                depositResource(d);
                d.jobPhase=null; d.state='idle'; d.wait=20+Math.random()*40;
            } else {
                d.state='idle'; d.wait=20+Math.random()*40;
            }
            continue;
        }

        const speed = d.carrying ? 0.035 : 0.045;
        d.x += (dx/dist)*speed;
        d.y += (dy/dist)*speed;
        if (Math.abs(dx)>0.01) d.dir = dx>0 ? 1 : -1;

        // If mid-wander destination became non-walkable, re-target.
        if (!d.jobPhase) {
            if (!isTileWalkable(Math.floor(d.tx), Math.floor(d.ty))) pickNewTarget(d);
        }
    }
}

// ---- Drawing -----------------------------------------------
function drawDupe(ctx, d, px, py, unit) {
    const bobRaw = d.state==='walk'  ? Math.abs(Math.sin(d.bobPhase*2))
                 : d.state==='work'  ? Math.abs(Math.sin(d.bobPhase*3))*0.3
                                     : Math.abs(Math.sin(d.bobPhase*0.5))*0.5;
    const bob = -bobRaw*0.5*unit;
    const x=px, y=py+bob, flip=d.dir<0;

    ctx.save();
    if (flip) { ctx.translate(x,0); ctx.scale(-1,1); ctx.translate(-x,0); }

    ctx.fillStyle=DUPE_PALETTE.shadow;
    ctx.beginPath();
    ctx.ellipse(x, py, 2.4*unit, 0.9*unit, 0, 0, Math.PI*2);
    ctx.fill();

    const legH=2.8*unit, bodyH=4.2*unit;
    const bodyTop=y-legH-bodyH, headH=3.0*unit, headTop=bodyTop-headH;

    const swing = d.state==='walk' ? Math.sin(d.bobPhase*2) : 0;
    const legW=1.3*unit;
    ctx.fillStyle=DUPE_PALETTE.legs;
    ctx.fillRect(x-1.4*unit, y-legH, legW, legH-Math.max(0,swing)*0.9*unit);
    ctx.fillRect(x+0.1*unit,  y-legH, legW, legH-Math.max(0,-swing)*0.9*unit);

    ctx.fillStyle=d.clothes;
    ctx.fillRect(x-1.7*unit, bodyTop, 3.4*unit, bodyH);
    ctx.fillStyle='rgba(255,255,255,0.10)';
    ctx.fillRect(x-0.6*unit, bodyTop+0.2*unit, 1.2*unit, bodyH-0.4*unit);

    let armSwing=0;
    if (d.state==='walk') armSwing=Math.sin(d.bobPhase*2)*0.7*unit;
    if (d.state==='work') armSwing=Math.sin(d.bobPhase*6)*1.2*unit;
    const armTop=bodyTop+0.4*unit, armH=2.6*unit;
    ctx.fillStyle=d.clothes;
    ctx.fillRect(x-2.6*unit, armTop-armSwing, 0.9*unit, armH);
    ctx.fillRect(x+1.7*unit, armTop+armSwing, 0.9*unit, armH);

    ctx.fillStyle=d.skin;
    ctx.fillRect(x-1.4*unit, headTop, 2.8*unit, headH);
    ctx.fillStyle=d.clothes;
    ctx.fillRect(x-1.4*unit, headTop, 2.8*unit, 0.9*unit);

    ctx.fillStyle=DUPE_PALETTE.eye;
    const eyeY=headTop+1.3*unit, eyeX=x+0.4*unit;
    ctx.fillRect(eyeX-0.7*unit, eyeY, 0.7*unit, 0.7*unit);
    ctx.fillRect(eyeX+0.4*unit, eyeY, 0.7*unit, 0.7*unit);

    if (d.carrying) {
        const cs=1.6*unit, ct=headTop-cs*0.8;
        ctx.fillStyle=d.carryColor;
        ctx.fillRect(x-cs/2, ct, cs, cs);
        ctx.fillStyle='rgba(0,0,0,0.35)';
        ctx.fillRect(x-cs/2, ct, cs, Math.max(1,cs*0.25));
    }

    if (d.state==='work' && Math.sin(d.bobPhase*6)>0.7) {
        ctx.fillStyle='rgba(255,230,80,0.9)';
        ctx.fillRect(x+2.2*unit, armTop-armSwing-0.5*unit,
                     Math.max(1,unit*0.8), Math.max(1,unit*0.8));
    }

    ctx.restore();

    // Name tag.
    if (tick%240<60 && Math.floor(tick/240)%Math.max(1,dupes.length)===d.id) {
        const tagY=py+bob-(3.0+2.8+4.2)*unit-12;
        const tagW=Math.max(28,d.name.length*4+8);
        ctx.fillStyle=DUPE_PALETTE.nameTagBg;
        ctx.fillRect(x-tagW/2, tagY, tagW, 8);
        ctx.fillStyle=DUPE_PALETTE.nameTagFg;
        ctx.font='6px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(d.name, x, tagY+4);
    }

    // Progress bar while working.
    if (d.state==='work' && d.job) {
        const bW=14, bH=2, bX=x-bW/2;
        const bY=py+bob-(3.0+2.8+4.2)*unit-5;
        const pct=d.job.progress/d.job.maxProgress;
        ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(bX,bY,bW,bH);
        ctx.fillStyle=JOB_PALETTE[d.job.type]||'#fff'; ctx.fillRect(bX,bY,bW*pct,bH);
    }
}
