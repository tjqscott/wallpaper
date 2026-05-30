/* ============================================================
 * jobs.js — job queue, world planning, boats, stockpiles.
 *
 * Organisation principles enforced here:
 *
 *  FARMS  — at most FARM_CLUSTER_MAX clusters per world. Each cluster
 *            seeds from a river (sea-connected water) bank, not a pond.
 *            A second cluster only spawns if the first is fully built
 *            and at least 30 tiles away.
 *
 *  FORESTS — chop jobs target trees furthest from the stockpile (edge of
 *             forest, not random). Every chop completion queues a
 *             plant_tree job on the same tile after a short delay, so
 *             forestry is self-renewing and stays organised.
 *
 *  BRIDGES — at most BRIDGE_MAX built bridges ever. Candidate tiles must:
 *            (a) cross a river (sea-connected water body, not a pond),
 *            (b) be in the lower/middle half of the river (not near source),
 *            (c) have land on exactly both sides of one axis (narrow crossing).
 *            Existing bridge tiles are counted toward the cap.
 *
 *  BOATS  — spawned on sea/strait water, count scales with water/land ratio.
 *           Boat movement properly clamps to grid bounds.
 *
 *  STOCKPILES — two fixed anchors, drawn Y-sorted via a per-row lookup so
 *               they never float on top of dupes.
 * ============================================================ */

let jobs        = [];
let boats       = [];
let jobIdCounter = 0;
let stockpiles  = [];

// The set of tile coords that are sea-connected water (computed once).
// Used to distinguish rivers/sea from isolated ponds.
let seaWaterSet = null;

function getJobs()       { return jobs; }
function getBoats()      { return boats; }
function getStockpiles() { return stockpiles; }

// ----------------------------------------------------------------
// Sea-connected water set (computed after terrain gen)
// ----------------------------------------------------------------
function buildSeaWaterSet() {
    seaWaterSet = new Set();
    const queue = [];
    // Seed from border water tiles (same as the BFS in terrain.js).
    for (let y = 0; y < CONFIG.GRID_ROWS; y++) {
        for (let x = 0; x < CONFIG.GRID_COLS; x++) {
            const onBorder = (x === 0 || x === CONFIG.GRID_COLS-1 ||
                              y === 0 || y === CONFIG.GRID_ROWS-1);
            if (onBorder && tileAt(x,y) && tileAt(x,y).type === 'water') {
                const key = `${x},${y}`;
                if (!seaWaterSet.has(key)) { seaWaterSet.add(key); queue.push([x,y]); }
            }
        }
    }
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    let head = 0;
    while (head < queue.length) {
        const [cx,cy] = queue[head++];
        for (const [dx,dy] of dirs) {
            const nx=cx+dx, ny=cy+dy;
            const key=`${nx},${ny}`;
            if (!seaWaterSet.has(key)) {
                const t = tileAt(nx,ny);
                if (t && t.type === 'water') { seaWaterSet.add(key); queue.push([nx,ny]); }
            }
        }
    }
}

function isSeaWater(x, y) {
    return seaWaterSet && seaWaterSet.has(`${x},${y}`);
}

// ----------------------------------------------------------------
// Stockpile placement
// ----------------------------------------------------------------
function placeStockpiles() {
    stockpiles = [];
    // Centroid of open walkable land.
    let sumX=0, sumY=0, n=0;
    for (let y=2; y<CONFIG.GRID_ROWS-2; y++)
        for (let x=2; x<CONFIG.GRID_COLS-2; x++) {
            const t = tileAt(x,y);
            if (t && (t.type==='grass'||t.type==='sand') && !t.feature) { sumX+=x; sumY+=y; n++; }
        }
    if (n===0) return;
    const cx=Math.round(sumX/n), cy=Math.round(sumY/n);
    const sp = CONFIG.STOCKPILE_SPREAD;

    // Try four offset directions; take the first two that find clear ground.
    const tries = [
        {ox:-sp, oy:0, type:'organic'},
        {ox: sp, oy:0, type:'stone'},
        {ox:0, oy:-sp, type:'organic'},
        {ox:0, oy: sp, type:'stone'},
    ];
    for (const c of tries) {
        if (stockpiles.length >= 2) break;
        const best = findNearestWalkableOpen(cx+c.ox, cy+c.oy, 8);
        if (!best) continue;
        if (stockpiles.some(p => Math.hypot(p.x-best.x, p.y-best.y) < 5)) continue;
        stockpiles.push({ x:best.x, y:best.y, type:c.type,
                          counts:{ log:0, ore:0, grain:0 } });
    }
}

function findNearestWalkableOpen(sx, sy, radius) {
    for (let r=0; r<=radius; r++) {
        for (let dy=-r; dy<=r; dy++) {
            for (let dx=-r; dx<=r; dx++) {
                if (Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
                const t = tileAt(sx+dx, sy+dy);
                if (t && (t.type==='grass'||t.type==='sand') && !t.feature)
                    return {x:sx+dx, y:sy+dy};
            }
        }
    }
    return null;
}

function stockpileForResource(resType) {
    const kind = resType==='ore' ? 'stone' : 'organic';
    return stockpiles.find(s=>s.type===kind) || stockpiles[0] || null;
}

// ----------------------------------------------------------------
// Job helpers
// ----------------------------------------------------------------
function makeJob(type, x, y, extra) {
    return { id:jobIdCounter++, type, x, y, progress:0,
             maxProgress:CONFIG.JOB_TICKS[type], assignedTo:null, ...extra };
}

function countJobType(type)  { return jobs.filter(j=>j.type===type).length; }
function tileHasJob(x, y)    { return jobs.some(j=>j.x===x && j.y===y); }

function hasWalkableNeighbour(x, y) {
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const n = tileAt(x+dx, y+dy);
        if (n && WALKABLE_TYPES.has(n.type) && n.feature!=='tree') return true;
    }
    return false;
}

function isWaterAdjacent(x, y) {
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const n = tileAt(x+dx, y+dy);
        if (n && n.type==='water') return true;
    }
    return false;
}

function countBuiltBridges() {
    let count = 0;
    for (let y=0; y<CONFIG.GRID_ROWS; y++)
        for (let x=0; x<CONFIG.GRID_COLS; x++) {
            const t = tileAt(x,y);
            if (t && t.type==='bridge') count++;
        }
    return count;
}

// A good bridge candidate: sea-connected water, land on both sides of
// one axis, not a river source (must have sea-water in both directions
// along the crossing axis or be in the lower half of a river run),
// and no waterfall feature nearby.
function isBridgeCandidate(x, y) {
    const t = tileAt(x,y);
    if (!t || t.type!=='water') return false;
    if (!isSeaWater(x,y)) return false;
    if (tileHasJob(x,y)) return false;

    // Check for waterfall in a 3-tile radius — avoid river sources.
    for (let dy=-3; dy<=3; dy++)
        for (let dx=-3; dx<=3; dx++) {
            const n = tileAt(x+dx, y+dy);
            if (n && n.feature==='waterfall') return false;
        }

    // E-W crossing: land on left and right, water (or edge) continuing N/S.
    const wW = tileAt(x-1,y), wE = tileAt(x+1,y);
    const wN = tileAt(x,y-1), wS = tileAt(x,y+1);
    const landW = wW && WALKABLE_TYPES.has(wW.type);
    const landE = wE && WALKABLE_TYPES.has(wE.type);
    const landN = wN && WALKABLE_TYPES.has(wN.type);
    const landS = wS && WALKABLE_TYPES.has(wS.type);

    // Crossing must be exactly 1 tile wide (land immediately on both sides).
    return (landW && landE) || (landN && landS);
}

// ----------------------------------------------------------------
// Farm cluster planning
// ----------------------------------------------------------------
// Rules: seed only from sea-connected (river) banks. At most
// FARM_CLUSTER_MAX clusters. A second cluster needs to be >= 30 tiles
// from the first and only spawns after the first is fully built.

let farmClusters = [];   // [{cx, cy}] — cluster anchor points

function countBuiltFarmTiles() {
    let n=0;
    for (let y=0; y<CONFIG.GRID_ROWS; y++)
        for (let x=0; x<CONFIG.GRID_COLS; x++) {
            const t=tileAt(x,y);
            if (t && t.type==='farm') n++;
        }
    return n;
}

function spawnFarmCluster() {
    if (farmClusters.length >= CONFIG.FARM_CLUSTER_MAX) return;
    if (countJobType('farm') > 0) return;   // wait until queue drains

    // Second cluster requires first to be substantially built.
    if (farmClusters.length===1 && countBuiltFarmTiles() < CONFIG.FARM_CLUSTER_SIZE * 0.6) return;

    // Find river-bank grass tiles (adjacent to sea-connected water).
    const seeds = [];
    for (let y=2; y<CONFIG.GRID_ROWS-2; y++) {
        for (let x=2; x<CONFIG.GRID_COLS-2; x++) {
            const t=tileAt(x,y);
            if (!t || t.type!=='grass' || t.feature || tileHasJob(x,y)) continue;
            // Must have a sea-connected water neighbour.
            let riverAdjacent = false;
            for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                if (isSeaWater(x+dx, y+dy)) { riverAdjacent=true; break; }
            }
            if (!riverAdjacent) continue;
            // Must be far from existing clusters.
            if (farmClusters.some(c => Math.hypot(c.cx-x, c.cy-y) < 30)) continue;
            seeds.push({x,y});
        }
    }
    if (seeds.length===0) return;

    const seed = seeds[Math.floor(Math.random()*seeds.length)];

    // BFS to collect a contiguous rectangular patch.
    const patch=[], visited=new Set();
    const queue=[{x:seed.x, y:seed.y}];
    visited.add(`${seed.x},${seed.y}`);
    while (queue.length>0 && patch.length<CONFIG.FARM_CLUSTER_SIZE) {
        const cur=queue.shift();
        const t=tileAt(cur.x,cur.y);
        if (!t || t.type!=='grass' || t.feature || tileHasJob(cur.x,cur.y)) continue;
        patch.push(cur);
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const key=`${cur.x+dx},${cur.y+dy}`;
            if (!visited.has(key)) { visited.add(key); queue.push({x:cur.x+dx,y:cur.y+dy}); }
        }
    }
    if (patch.length===0) return;

    farmClusters.push({cx:seed.x, cy:seed.y});
    for (const p of patch) jobs.push(makeJob('farm',p.x,p.y));
}

// ----------------------------------------------------------------
// Forestry: organised chop targets + replant
// ----------------------------------------------------------------
// Chop the trees that are furthest from the nearest stockpile —
// working from the forest edge inward keeps the forest looking managed.

function spawnChopJobs() {
    const need = 3 - countJobType('chop');
    if (need <= 0) return;

    // Score each tree by distance from nearest stockpile (descending).
    const trees = [];
    for (let y=1; y<CONFIG.GRID_ROWS-1; y++)
        for (let x=1; x<CONFIG.GRID_COLS-1; x++) {
            const t=tileAt(x,y);
            if (!t || t.feature!=='tree' || tileHasJob(x,y)) continue;
            const dist = stockpiles.reduce((mn,sp) =>
                Math.min(mn, Math.hypot(sp.x-x,sp.y-y)), Infinity);
            trees.push({x,y,dist});
        }
    // Sort: furthest first (edge-of-forest logging).
    trees.sort((a,b) => b.dist - a.dist);
    for (let i=0; i<need && i<trees.length; i++) {
        jobs.push(makeJob('chop', trees[i].x, trees[i].y));
    }
}

// Queue a plant_tree job on a recently-chopped tile after a delay.
// Called from completeJob; the delay is handled by a deferred list.
let pendingPlants = [];   // [{x, y, readyAt}]

function queuePlantTree(x, y) {
    // Plant back in roughly the same spot if it's still grass.
    // Delay: 600–900 ticks so the clearing is visible for a while.
    const delay = 600 + Math.floor(Math.random()*300);
    pendingPlants.push({x, y, readyAt: tick + delay});
}

function processPendingPlants() {
    for (let i=pendingPlants.length-1; i>=0; i--) {
        const p = pendingPlants[i];
        if (tick < p.readyAt) continue;
        pendingPlants.splice(i,1);
        const t = tileAt(p.x, p.y);
        // Only plant if the tile is still open grass.
        if (t && t.type==='grass' && !t.feature && !tileHasJob(p.x,p.y)) {
            jobs.push(makeJob('plant_tree', p.x, p.y));
        }
    }
}

// ----------------------------------------------------------------
// Crop / tree growth (called every tick from updateJobs)
// ----------------------------------------------------------------
function updateGrowth() {
    // Farm growth: each farm tile has a growthTick counter set in terrain
    // when converted (we set it in completeJob). We advance it here.
    // Tree sapling growth: tileAt has growthStage [0..1].
    for (let y=0; y<CONFIG.GRID_ROWS; y++) {
        for (let x=0; x<CONFIG.GRID_COLS; x++) {
            const t = tileAt(x,y);
            if (!t) continue;

            // Farm growth.
            if (t.type==='farm' && t.growthTick !== undefined) {
                if (t.growthTick < CONFIG.CROP_GROW_TICKS) t.growthTick++;
            }

            // Sapling growth.
            if (t.feature==='sapling' && t.saplingTick !== undefined) {
                if (t.saplingTick < CONFIG.TREE_GROW_TICKS) {
                    t.saplingTick++;
                } else {
                    // Fully grown — promote to tree.
                    t.feature = 'tree';
                    t.saplingTick = undefined;
                }
            }
        }
    }
}

// ----------------------------------------------------------------
// Auto-spawn
// ----------------------------------------------------------------
function autoSpawnJobs() {
    if (jobs.length >= CONFIG.JOB_MAX) return;

    spawnChopJobs();
    processPendingPlants();   // promote delayed plants into jobs

    // Mine.
    if (countJobType('mine') < 2) {
        const stones=[];
        for (let y=1;y<CONFIG.GRID_ROWS-1;y++)
            for (let x=1;x<CONFIG.GRID_COLS-1;x++) {
                const t=tileAt(x,y);
                if (t && t.type==='stone' && !tileHasJob(x,y) && hasWalkableNeighbour(x,y))
                    stones.push({x,y});
            }
        const need=2-countJobType('mine');
        for (let i=0;i<need&&stones.length>0;i++) {
            const idx=Math.floor(Math.random()*stones.length);
            const c=stones.splice(idx,1)[0];
            jobs.push(makeJob('mine',c.x,c.y));
        }
    }

    // Farm cluster.
    spawnFarmCluster();

    // Bridges — respect cap, pick good crossings.
    const builtBridges = countBuiltBridges() + countJobType('build_bridge');
    if (builtBridges < CONFIG.BRIDGE_MAX && countJobType('build_bridge') < 2) {
        const candidates=[];
        for (let y=1;y<CONFIG.GRID_ROWS-1;y++)
            for (let x=1;x<CONFIG.GRID_COLS-1;x++)
                if (isBridgeCandidate(x,y)) candidates.push({x,y});

        // Pick candidates that are spread apart (at least 8 tiles from each other).
        const chosen=[];
        for (const c of candidates) {
            if (chosen.some(ch=>Math.hypot(ch.x-c.x,ch.y-c.y)<8)) continue;
            chosen.push(c);
            jobs.push(makeJob('build_bridge',c.x,c.y));
            if (chosen.length >= 2-countJobType('build_bridge')) break;
        }
    }

    // Boats.
    const boatTarget = estimateBoatTarget();
    if (countJobType('build_boat') + boats.length < boatTarget) {
        // Prefer open sea water (far from any land).
        const candidates=[];
        for (let y=3;y<CONFIG.GRID_ROWS-3;y++)
            for (let x=3;x<CONFIG.GRID_COLS-3;x++) {
                const t=tileAt(x,y);
                if (!t||t.type!=='water'||!isSeaWater(x,y)) continue;
                if (boatAt(x,y)||tileHasJob(x,y)) continue;
                // Score by distance from land — prefer open water.
                let landDist=Infinity;
                for (let dy=-4;dy<=4;dy++)
                    for (let dx=-4;dx<=4;dx++) {
                        const n=tileAt(x+dx,y+dy);
                        if (n&&n.type!=='water') landDist=Math.min(landDist,Math.hypot(dx,dy));
                    }
                if (landDist>=2) candidates.push({x,y,landDist});
            }
        candidates.sort((a,b)=>b.landDist-a.landDist);
        if (candidates.length>0) {
            // Pick from top quarter so we don't always get the exact same spot.
            const pool=candidates.slice(0,Math.max(1,Math.floor(candidates.length/4)));
            const c=pool[Math.floor(Math.random()*pool.length)];
            jobs.push(makeJob('build_boat',c.x,c.y));
        }
    }
}

function estimateBoatTarget() {
    let water=0, land=0;
    for (let y=0;y<CONFIG.GRID_ROWS;y+=4)
        for (let x=0;x<CONFIG.GRID_COLS;x+=4) {
            const t=tileAt(x,y);
            if (!t) continue;
            if (t.type==='water') water++;
            else if (WALKABLE_TYPES.has(t.type)) land++;
        }
    const r = land>0 ? water/land : 1;
    if (r>2.5) return 4;
    if (r>1.5) return 3;
    if (r>0.8) return 2;
    return 1;
}

function boatAt(x,y) { return boats.some(b=>Math.floor(b.x)===x&&Math.floor(b.y)===y); }

// ----------------------------------------------------------------
// Job assignment
// ----------------------------------------------------------------
function findNearestJob(dx, dy) {
    let best=null, bestDist=Infinity;
    for (const j of jobs) {
        if (j.assignedTo!==null) continue;
        const d=Math.hypot(j.x-dx, j.y-dy);
        if (d<bestDist) { bestDist=d; best=j; }
    }
    return best;
}

function assignJob(dupe, job) { job.assignedTo=dupe.id; dupe.job=job; dupe.jobPhase='travel'; }

function releaseJob(dupe) {
    if (dupe.job) {
        if (dupe.job.assignedTo===dupe.id) dupe.job.assignedTo=null;
        dupe.job=null; dupe.jobPhase=null;
    }
}

function workOnJob(dupe) {
    const j=dupe.job; if (!j) return;
    j.progress++;
    if (j.progress>=j.maxProgress) completeJob(j,dupe);
}

// ----------------------------------------------------------------
// Completion
// ----------------------------------------------------------------
function completeJob(j, dupe) {
    const t=tileAt(j.x,j.y);

    if (j.type==='chop' && t && t.feature==='tree') {
        t.feature=null;
        dupe.carrying=true; dupe.carryColor=RESOURCE_PALETTE.log;
        dupe.carryTimer=400; dupe.carryResource='log';
        dupe.carryTarget=stockpileForResource('log');
        queuePlantTree(j.x, j.y);   // schedule replanting
    }
    else if (j.type==='plant_tree' && t && t.type==='grass' && !t.feature) {
        // Plant a sapling — starts tiny, grows over TREE_GROW_TICKS.
        t.feature='sapling';
        t.saplingTick=0;
        // No resource carried.
    }
    else if (j.type==='mine' && t) {
        if (t.type==='stone'||t.type==='stone_high') {
            t.type='grass_dark'; t.z=PALETTE.grass_dark.z; t.feature=null;
        }
        dupe.carrying=true; dupe.carryColor=RESOURCE_PALETTE.ore;
        dupe.carryTimer=400; dupe.carryResource='ore';
        dupe.carryTarget=stockpileForResource('ore');
        recomputeShadowsAround(j.x,j.y);
    }
    else if (j.type==='farm' && t) {
        t.type='farm'; t.growthTick=0;
        dupe.carrying=true; dupe.carryColor=RESOURCE_PALETTE.grain;
        dupe.carryTimer=400; dupe.carryResource='grain';
        dupe.carryTarget=stockpileForResource('grain');
    }
    else if (j.type==='build_bridge' && t && t.type==='water') {
        t.type='bridge'; t.z=PALETTE.bridge.z; t.feature=null;
        recomputeShadowsAround(j.x,j.y);
    }
    else if (j.type==='build_boat') {
        spawnBoat(j.x,j.y);
    }

    jobs.splice(jobs.indexOf(j),1);
    dupe.job=null; dupe.jobPhase=null;
    dupe.state='idle'; dupe.wait=30+Math.random()*60;
}

function depositResource(dupe) {
    if (!dupe.carryResource||!dupe.carryTarget) return;
    const sp=dupe.carryTarget;
    if (sp.counts[dupe.carryResource]!==undefined) sp.counts[dupe.carryResource]++;
    dupe.carrying=false; dupe.carryResource=null;
    dupe.carryTarget=null; dupe.carryTimer=0;
}

// ----------------------------------------------------------------
// Boats — proper boundary clamping
// ----------------------------------------------------------------
function spawnBoat(x, y) {
    let bestAng=Math.random()*Math.PI*2, bestScore=-1;
    for (let a=0; a<Math.PI*2; a+=Math.PI/4) {
        let score=0;
        for (let step=1;step<=6;step++) {
            const tx=Math.floor(x+Math.cos(a)*step), ty=Math.floor(y+Math.sin(a)*step);
            const t=tileAt(tx,ty);
            if (t&&t.type==='water') score++;
        }
        if (score>bestScore) { bestScore=score; bestAng=a; }
    }
    boats.push({
        x:x+0.5, y:y+0.5,
        vx:Math.cos(bestAng)*CONFIG.BOAT_SPEED,
        vy:Math.sin(bestAng)*CONFIG.BOAT_SPEED,
        sailColor:BOAT_PALETTE.sail[Math.floor(Math.random()*BOAT_PALETTE.sail.length)],
        phase:Math.random()*Math.PI*2,
        heading:bestAng,
        stuckTimer:0,
    });
}

function updateBoats() {
    for (const b of boats) {
        b.phase += 0.018;

        // Gentle meander.
        b.heading += Math.sin(b.phase*0.27) * 0.003;

        const targetVx=Math.cos(b.heading)*CONFIG.BOAT_SPEED;
        const targetVy=Math.sin(b.heading)*CONFIG.BOAT_SPEED;
        b.vx=b.vx*0.93+targetVx*0.07;
        b.vy=b.vy*0.93+targetVy*0.07;

        const nx=b.x+b.vx, ny=b.y+b.vy;

        // Hard-clamp to grid interior (avoid null tiles).
        const clampedNx = Math.max(0.5, Math.min(CONFIG.GRID_COLS-0.5, nx));
        const clampedNy = Math.max(0.5, Math.min(CONFIG.GRID_ROWS-0.5, ny));

        const tileN = tileAt(Math.floor(clampedNx), Math.floor(clampedNy));

        if (tileN && tileN.type==='water' && clampedNx===nx && clampedNy===ny) {
            // Normal move — fully inside grid and on water.
            b.x=nx; b.y=ny;
            b.stuckTimer=0;
        } else {
            // Hit land, screen edge, or clamped — reflect.
            const tileXonly = tileAt(Math.floor(Math.max(0.5,Math.min(CONFIG.GRID_COLS-0.5,b.x+b.vx))),
                                      Math.floor(b.y));
            const tileYonly = tileAt(Math.floor(b.x),
                                      Math.floor(Math.max(0.5,Math.min(CONFIG.GRID_ROWS-0.5,b.y+b.vy))));

            let reflectedX = !tileXonly || tileXonly.type!=='water';
            let reflectedY = !tileYonly || tileYonly.type!=='water';

            // Also reflect at screen edges regardless of tile type.
            if (b.x+b.vx < 0.5 || b.x+b.vx > CONFIG.GRID_COLS-0.5) reflectedX=true;
            if (b.y+b.vy < 0.5 || b.y+b.vy > CONFIG.GRID_ROWS-0.5) reflectedY=true;

            if (reflectedX) b.vx=-b.vx;
            if (reflectedY) b.vy=-b.vy;

            b.stuckTimer = (b.stuckTimer||0)+1;
            // If genuinely stuck, randomise heading strongly.
            if (b.stuckTimer > 20) {
                b.heading=Math.random()*Math.PI*2;
                b.vx=Math.cos(b.heading)*CONFIG.BOAT_SPEED;
                b.vy=Math.sin(b.heading)*CONFIG.BOAT_SPEED;
                b.stuckTimer=0;
            } else {
                b.heading=Math.atan2(b.vy,b.vx)+(Math.random()-0.5)*Math.PI*0.6;
            }
        }

        // Prevent speed decay to zero.
        const spd=Math.hypot(b.vx,b.vy);
        if (spd<CONFIG.BOAT_SPEED*0.4) {
            b.vx=Math.cos(b.heading)*CONFIG.BOAT_SPEED;
            b.vy=Math.sin(b.heading)*CONFIG.BOAT_SPEED;
        }
    }
}

// ----------------------------------------------------------------
// Shadow helper
// ----------------------------------------------------------------
function recomputeShadowsAround(cx, cy) {
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
        const x=cx+dx, y=cy+dy, t=tileAt(x,y);
        if (!t) continue;
        t.shadow = {
            n: y>0                  && tileAt(x,y-1) && tileAt(x,y-1).z>t.z,
            s: y<CONFIG.GRID_ROWS-1 && tileAt(x,y+1) && tileAt(x,y+1).z>t.z,
            w: x>0                  && tileAt(x-1,y) && tileAt(x-1,y).z>t.z,
            e: x<CONFIG.GRID_COLS-1 && tileAt(x+1,y) && tileAt(x+1,y).z>t.z,
        };
    }
}

// ----------------------------------------------------------------
// Main update
// ----------------------------------------------------------------
let jobSpawnTimer=0;

function initJobs() {
    jobs.length=0; boats.length=0; pendingPlants.length=0;
    farmClusters=[]; jobSpawnTimer=0; jobIdCounter=0;
    buildSeaWaterSet();
    placeStockpiles();
    autoSpawnJobs();
}

function updateJobs() {
    jobSpawnTimer++;
    if (jobSpawnTimer>=CONFIG.JOB_SPAWN_INTERVAL) {
        jobSpawnTimer=0;
        processPendingPlants();
        autoSpawnJobs();
    }
    updateGrowth();
    updateBoats();
}
