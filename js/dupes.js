/* ============================================================
 * dupes.js — spawn, AI, A* pathfinding, drawing.
 *
 * Key fixes:
 *  - Arrival detection uses job tile proximity, not work-pos.
 *  - Jobs are validated before work begins; stale jobs released.
 *  - A* node key uses x*200+y (grid is 130 wide, safe up to 200).
 *  - Movement is smooth sub-tile; no teleportation.
 * ============================================================ */

const dupes = [];
function getDupes() { return dupes; }

// ---- Tile helpers ------------------------------------------

function isTileWalkable(x, y) {
    const t = tileAt(x, y);
    return t && WALKABLE_TYPES.has(t.type)
           && t.feature !== 'tree' && t.feature !== 'sapling'
           && t.type !== 'house';
}

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

// ---- A* pathfinding ----------------------------------------
// Returns array of {x,y} waypoints (NOT including start, INCLUDING goal).
// Hard cap: 3000 nodes. On single-island worlds the paths are short.

function astar(sx, sy, gx, gy) {
    if (sx===gx && sy===gy) return [];
    const W = 200; // key width — safe for GRID_COLS=130
    const key = (x,y) => x * W + y;

    // Binary-heap open set for performance.
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();
    // Simple sorted array (small paths, good enough).
    const open = [];
    const closed = new Set();

    const sk = key(sx,sy);
    gScore.set(sk, 0);
    fScore.set(sk, Math.abs(gx-sx)+Math.abs(gy-sy));
    open.push({x:sx,y:sy,f:0});

    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    let iters = 0;

    while (open.length > 0 && iters < 3000) {
        iters++;
        // Find min-f node.
        let bi=0;
        for (let i=1;i<open.length;i++) if (open[i].f < open[bi].f) bi=i;
        const cur = open.splice(bi,1)[0];
        const ck = key(cur.x,cur.y);
        if (closed.has(ck)) continue;
        closed.add(ck);

        if (cur.x===gx && cur.y===gy) {
            // Reconstruct.
            const path=[];
            let k=ck;
            while (cameFrom.has(k)) {
                const p=cameFrom.get(k);
                path.unshift(p);
                k=key(p.x,p.y);
            }
            path.push({x:gx,y:gy});
            return path;
        }

        const cg = gScore.get(ck)||0;
        for (const [dx,dy] of dirs) {
            const nx=cur.x+dx, ny=cur.y+dy;
            if (!isTileWalkable(nx,ny)) continue;
            const nk=key(nx,ny);
            if (closed.has(nk)) continue;
            const ng=cg+1;
            if (ng < (gScore.get(nk)??Infinity)) {
                gScore.set(nk,ng);
                const nf=ng+Math.abs(gx-nx)+Math.abs(gy-ny);
                fScore.set(nk,nf);
                cameFrom.set(nk,{x:cur.x,y:cur.y});
                open.push({x:nx,y:ny,f:nf});
            }
        }
    }
    return null;
}

// ---- Pathfinding helpers -----------------------------------

// Set a routed destination. Returns true if a path was found or the
// goal is already adjacent. Never teleports.
function setPathedTarget(d, gx, gy) {
    if (!isTileWalkable(gx,gy)) {
        const near=nearestWalkable(gx,gy,4);
        if (!near) return false;
        gx=near.x; gy=near.y;
    }
    const sx=Math.floor(d.x), sy=Math.floor(d.y);
    const path=astar(sx,sy,gx,gy);
    if (!path || path.length===0) {
        // Already there or unreachable.
        if (sx===gx&&sy===gy) { d.path=[]; d.tx=gx+0.5; d.ty=gy+0.5; return true; }
        return false;
    }
    d.path=path;
    d.pathGoalX=gx; d.pathGoalY=gy;
    const next=d.path[0];
    d.tx=next.x+0.5; d.ty=next.y+0.5;
    return true;
}

function advancePath(d) {
    if (d.path.length>0) d.path.shift();
    if (d.path.length>0) {
        const next=d.path[0];
        d.tx=next.x+0.5; d.ty=next.y+0.5;
        return true;
    }
    return false; // arrived
}

// ---- Spawn -------------------------------------------------

function randomSpawnTile() {
    for (let attempt=0;attempt<300;attempt++) {
        const x=Math.floor(Math.random()*CONFIG.GRID_COLS);
        const y=Math.floor(Math.random()*CONFIG.GRID_ROWS);
        if (isTileWalkable(x,y)) return {x,y};
    }
    return null;
}

function spawnDupes() {
    dupes.length=0;
    for (let i=0;i<CONFIG.DUPE_COUNT;i++) {
        const spawn=randomSpawnTile();
        if (!spawn) continue;
        dupes.push({
            id:i,
            name:DUPE_NAMES[i%DUPE_NAMES.length],
            x:spawn.x+0.5, y:spawn.y+0.5,
            tx:spawn.x+0.5, ty:spawn.y+0.5,
            wait:Math.random()*60,
            dir:Math.random()<0.5?1:-1,
            bobPhase:Math.random()*Math.PI*2,
            skin:DUPE_PALETTE.skinTones[i%DUPE_PALETTE.skinTones.length],
            clothes:DUPE_PALETTE.clothes[i%DUPE_PALETTE.clothes.length],
            state:'idle',
            carrying:false, carryColor:'#c89a5a',
            carryTimer:0, carryResource:null, carryTarget:null,
            job:null, jobPhase:null,
            path:[], pathGoalX:null, pathGoalY:null,
            workStandX:null, workStandY:null, // tile they stand on to work
        });
    }
}

// ---- Wander ------------------------------------------------

function pickNewTarget(d) {
    const cx=Math.floor(d.x), cy=Math.floor(d.y);
    // Try increasing radius until we find a walkable tile.
    for (let attempt=0;attempt<40;attempt++) {
        const radius=4+Math.floor(Math.random()*6);
        const nx=cx+Math.floor((Math.random()*2-1)*radius);
        const ny=cy+Math.floor((Math.random()*2-1)*radius);
        if (isTileWalkable(nx,ny) && setPathedTarget(d,nx,ny)) return;
    }
    // Fall back to stay.
    d.path=[]; d.tx=d.x; d.ty=d.y;
}

// ---- Work position -----------------------------------------
// Returns the grid tile the dupe should STAND on, adjacent to job tile.
function pickWorkPosition(jx, jy) {
    for (const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]]) {
        const nx=jx+dx, ny=jy+dy;
        if (isTileWalkable(nx,ny)) return {x:nx,y:ny};
    }
    return null;
}

// Validate that a job is still actionable (tile state matches job type).
function isJobValid(j) {
    if (!j) return false;
    const t=tileAt(j.x,j.y);
    if (!t) return false;
    if (j.type==='chop'    && t.feature!=='tree') return false;
    if (j.type==='mine'    && t.type!=='stone'&&t.type!=='stone_high') return false;
    if (j.type==='build_bridge' && t.type!=='water') return false;
    if (j.type==='build_dock'   && t.type!=='water') return false;
    if (j.type==='plant_tree'   && (t.type!=='grass'||t.feature)) return false;
    return true;
}

// ---- Main update -------------------------------------------

function updateDupes() {
    for (const d of dupes) {
        d.bobPhase += d.state==='walk' ? 0.18 : 0.05;

        // === WORKING ===
        if (d.state==='work') {
            // Validate job still makes sense.
            if (!d.job || !isJobValid(d.job)) {
                releaseJob(d);
                d.state='idle'; d.wait=20; continue;
            }

            // Must be standing on the right tile.
            const sx=Math.floor(d.x), sy=Math.floor(d.y);
            if (d.workStandX!==null &&
                (sx!==d.workStandX||sy!==d.workStandY)) {
                // Drifted off work tile — re-navigate.
                if (!setPathedTarget(d,d.workStandX,d.workStandY)) {
                    releaseJob(d); d.state='idle'; d.wait=20;
                } else {
                    d.state='walk'; d.jobPhase='travel';
                }
                continue;
            }

            workOnJob(d);

            // Job completed — may now be carrying.
            if (!d.job && d.carrying && d.carryTarget) {
                const dest=stockpileWalkTarget(d.carryTarget);
                if (dest) {
                    const dgx=Math.floor(dest.x), dgy=Math.floor(dest.y);
                    if (setPathedTarget(d,dgx,dgy)) {
                        d.jobPhase='carry'; d.state='walk'; d.wait=9999;
                    } else {
                        d.carrying=false; d.carryResource=null; d.carryTarget=null;
                        d.state='idle'; d.wait=30;
                    }
                } else {
                    d.carrying=false; d.carryResource=null; d.carryTarget=null;
                    d.jobPhase=null; d.state='idle'; d.wait=30;
                }
            } else if (!d.job) {
                d.jobPhase=null; d.state='idle'; d.wait=20;
            }
            continue;
        }

        // === IDLE / WALK ===
        d.wait--;

        // Carry-timer safety fallback (shouldn't normally expire).
        if (d.carrying && d.carryTimer>0) {
            d.carryTimer--;
            if (d.carryTimer<=0) {
                d.carrying=false; d.carryResource=null;
                d.carryTarget=null; d.jobPhase=null;
            }
        }

        // Snap off water.
        if (!isTileWalkable(Math.floor(d.x),Math.floor(d.y))) {
            const safe=nearestWalkable(Math.floor(d.x),Math.floor(d.y),6);
            if (safe) {
                d.x=safe.x+0.5; d.y=safe.y+0.5;
                d.tx=d.x; d.ty=d.y; d.path=[];
            }
        }

        if (d.wait<=0 && d.jobPhase!=='carry') {
            // Look for a job if idle.
            if (!d.job && !d.carrying) {
                const j=findNearestJob(Math.floor(d.x),Math.floor(d.y));
                if (j && isJobValid(j)) {
                    const wp=pickWorkPosition(j.x,j.y);
                    if (wp && setPathedTarget(d,wp.x,wp.y)) {
                        assignJob(d,j);
                        d.workStandX=wp.x; d.workStandY=wp.y;
                        d.state='walk'; d.jobPhase='travel'; d.wait=9999;
                        continue;
                    }
                    // Can't reach — mark job unreachable for a bit.
                    if (j) j._skipUntil=(j._skipUntil||0)+300;
                }
            }

            // Wander.
            if (Math.random()<0.3 && d.state==='walk') {
                d.state='idle'; d.wait=30+Math.random()*60;
            } else {
                d.state='walk'; pickNewTarget(d);
                d.wait=90+Math.random()*180;
            }
        }

        if (d.state!=='walk') continue;

        // Move toward current waypoint.
        const dx=d.tx-d.x, dy=d.ty-d.y;
        const dist=Math.hypot(dx,dy);

        if (dist<0.12) {
            // Reached waypoint — advance or arrive.
            const stillGoing=advancePath(d);
            if (!stillGoing) {
                // Path complete.
                if (d.jobPhase==='travel' && d.job) {
                    // Must be adjacent to job tile to start working.
                    const adjDist=Math.hypot(Math.floor(d.x)-d.job.x,
                                             Math.floor(d.y)-d.job.y);
                    if (adjDist<=1.5) {
                        d.state='work'; d.jobPhase='work';
                        d.dir = d.job.x>d.x ? 1 : -1;
                    } else {
                        // Arrived at wrong tile — re-route.
                        const wp=pickWorkPosition(d.job.x,d.job.y);
                        if (wp && setPathedTarget(d,wp.x,wp.y)) {
                            d.workStandX=wp.x; d.workStandY=wp.y;
                        } else {
                            releaseJob(d); d.state='idle'; d.wait=20;
                        }
                    }
                } else if (d.jobPhase==='carry' && d.carrying) {
                    depositResource(d);
                    d.jobPhase=null; d.workStandX=null; d.workStandY=null;
                    d.state='idle'; d.wait=20+Math.random()*30;
                } else {
                    d.state='idle'; d.wait=15+Math.random()*30;
                }
            }
            continue;
        }

        const speed = d.carrying ? 0.038 : 0.050;
        d.x += (dx/dist)*speed;
        d.y += (dy/dist)*speed;
        if (Math.abs(dx)>0.01) d.dir=dx>0?1:-1;

        // Re-path if current waypoint became unwalkable (e.g. tree planted there).
        if (d.jobPhase!=='travel' && d.jobPhase!=='carry') {
            if (!isTileWalkable(Math.floor(d.tx),Math.floor(d.ty))) {
                pickNewTarget(d);
            }
        }
    }
}

// ---- Drawing -----------------------------------------------
function drawDupe(ctx, d, px, py, unit) {
    const bobRaw = d.state==='walk' ? Math.abs(Math.sin(d.bobPhase*2))
                 : d.state==='work' ? Math.abs(Math.sin(d.bobPhase*3))*0.3
                                    : Math.abs(Math.sin(d.bobPhase*0.5))*0.5;
    const bob=-bobRaw*0.5*unit;
    const x=px, y=py+bob, flip=d.dir<0;

    ctx.save();
    if (flip) { ctx.translate(x,0); ctx.scale(-1,1); ctx.translate(-x,0); }

    ctx.fillStyle=DUPE_PALETTE.shadow;
    ctx.beginPath(); ctx.ellipse(x,py,2.4*unit,0.9*unit,0,0,Math.PI*2); ctx.fill();

    const legH=2.8*unit,bodyH=4.2*unit;
    const bodyTop=y-legH-bodyH,headH=3.0*unit,headTop=bodyTop-headH;
    const swing=d.state==='walk'?Math.sin(d.bobPhase*2):0;
    const legW=1.3*unit;
    ctx.fillStyle=DUPE_PALETTE.legs;
    ctx.fillRect(x-1.4*unit,y-legH,legW,legH-Math.max(0,swing)*0.9*unit);
    ctx.fillRect(x+0.1*unit, y-legH,legW,legH-Math.max(0,-swing)*0.9*unit);

    ctx.fillStyle=d.clothes;
    ctx.fillRect(x-1.7*unit,bodyTop,3.4*unit,bodyH);
    ctx.fillStyle='rgba(255,255,255,0.10)';
    ctx.fillRect(x-0.6*unit,bodyTop+0.2*unit,1.2*unit,bodyH-0.4*unit);

    let armSwing=0;
    if (d.state==='walk') armSwing=Math.sin(d.bobPhase*2)*0.7*unit;
    if (d.state==='work') armSwing=Math.sin(d.bobPhase*6)*1.2*unit;
    const armTop=bodyTop+0.4*unit,armH=2.6*unit;
    ctx.fillStyle=d.clothes;
    ctx.fillRect(x-2.6*unit,armTop-armSwing,0.9*unit,armH);
    ctx.fillRect(x+1.7*unit,armTop+armSwing,0.9*unit,armH);

    ctx.fillStyle=d.skin;
    ctx.fillRect(x-1.4*unit,headTop,2.8*unit,headH);
    ctx.fillStyle=d.clothes;
    ctx.fillRect(x-1.4*unit,headTop,2.8*unit,0.9*unit);

    ctx.fillStyle=DUPE_PALETTE.eye;
    const eyeY=headTop+1.3*unit,eyeX=x+0.4*unit;
    ctx.fillRect(eyeX-0.7*unit,eyeY,0.7*unit,0.7*unit);
    ctx.fillRect(eyeX+0.4*unit,eyeY,0.7*unit,0.7*unit);

    if (d.carrying) {
        const cs=1.6*unit,ct=headTop-cs*0.8;
        ctx.fillStyle=d.carryColor; ctx.fillRect(x-cs/2,ct,cs,cs);
        ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(x-cs/2,ct,cs,Math.max(1,cs*0.25));
    }

    if (d.state==='work'&&Math.sin(d.bobPhase*6)>0.7) {
        ctx.fillStyle='rgba(255,230,80,0.9)';
        ctx.fillRect(x+2.2*unit,armTop-armSwing-0.5*unit,Math.max(1,unit*0.8),Math.max(1,unit*0.8));
    }
    ctx.restore();

    // Name tag.
    if (tick%240<60&&Math.floor(tick/240)%Math.max(1,dupes.length)===d.id) {
        const tagY=py+bob-(3.0+2.8+4.2)*unit-12;
        const tagW=Math.max(28,d.name.length*4+8);
        ctx.fillStyle=DUPE_PALETTE.nameTagBg;
        ctx.fillRect(x-tagW/2,tagY,tagW,8);
        ctx.fillStyle=DUPE_PALETTE.nameTagFg;
        ctx.font='6px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(d.name,x,tagY+4);
    }

    // Progress bar while working.
    if (d.state==='work'&&d.job) {
        const bW=14,bH=2,bX=x-bW/2;
        const bY=py+bob-(3.0+2.8+4.2)*unit-5;
        const pct=d.job.progress/d.job.maxProgress;
        ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(bX,bY,bW,bH);
        ctx.fillStyle=JOB_PALETTE[d.job.type]||'#fff'; ctx.fillRect(bX,bY,bW*pct,bH);
    }
}
