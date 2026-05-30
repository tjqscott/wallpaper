/* ============================================================
 * jobs.js — world planning, jobs, boats, stockpiles, housing,
 *            zone layout, day/night, campfires.
 *
 * Zone model: at init, the land centroid is computed. Three
 * zones are then assigned based on compass bearing from centre:
 *   VILLAGE  — centre (stockpiles + houses)
 *   FOREST   — one quadrant (logging + replanting)
 *   FARM     — another quadrant (fields along the river)
 * This prevents tree-planting near farms or houses.
 *
 * Bridge planning: finds the perpendicular shortest crossing of
 * each river segment. Plans ALL tiles simultaneously before any
 * building starts. Only straight N-S or E-W spans. Min 12 tile
 * gap between bridges.
 *
 * Boats: guaranteed 2+ at world init, spawned directly (no job).
 *
 * Stockpile caps: physical stacks have a visual maximum.
 * ============================================================ */

let jobs         = [];
let boats        = [];
let jobIdCounter = 0;
let stockpiles   = [];
let houses       = [];
let docks        = [];
let campfires    = [];  // [{x,y}] — decorative fire positions

// Day/night: 0=noon, 0.5=midnight. Full cycle = CONFIG.DAY_TICKS.
let dayPhase  = 0.25;   // start slightly past dawn

let seaWaterSet     = null;
let islandCentroids = [];

// Zone membership per tile: 'village'|'forest'|'farm'|null
let zoneMap = null;
// Centroid of main island walkable land.
let landCX = 65, landCY = 37;

function getJobs()       { return jobs; }
function getBoats()      { return boats; }
function getStockpiles() { return stockpiles; }
function getHouses()     { return houses; }
function getDocks()      { return docks; }
function getCampfires()  { return campfires; }
function getDayPhase()   { return dayPhase; }

// ----------------------------------------------------------------
// Sea-connected water
// ----------------------------------------------------------------
function buildSeaWaterSet() {
    seaWaterSet=new Set();
    const queue=[];
    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        const onBorder=(x===0||x===CONFIG.GRID_COLS-1||y===0||y===CONFIG.GRID_ROWS-1);
        if (onBorder&&tileAt(x,y)&&tileAt(x,y).type==='water') {
            const k=`${x},${y}`;
            if (!seaWaterSet.has(k)) { seaWaterSet.add(k); queue.push([x,y]); }
        }
    }
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]]; let head=0;
    while (head<queue.length) {
        const [cx,cy]=queue[head++];
        for (const [dx,dy] of dirs) {
            const nx=cx+dx,ny=cy+dy,k=`${nx},${ny}`;
            if (!seaWaterSet.has(k)) {
                const t=tileAt(nx,ny);
                if (t&&t.type==='water') { seaWaterSet.add(k); queue.push([nx,ny]); }
            }
        }
    }
}
function isSeaWater(x,y) { return seaWaterSet&&seaWaterSet.has(`${x},${y}`); }

// ----------------------------------------------------------------
// Island centroid + zone map
// ----------------------------------------------------------------
function buildIslandCentroids() {
    const visited=new Set(); islandCentroids=[];
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    for (let y=2;y<CONFIG.GRID_ROWS-2;y++) {
        for (let x=2;x<CONFIG.GRID_COLS-2;x++) {
            const k=`${x},${y}`; if (visited.has(k)) continue;
            const t=tileAt(x,y); if (!t||!WALKABLE_TYPES.has(t.type)) continue;
            const body=[],q=[[x,y]]; visited.add(k); let head=0;
            while (head<q.length) {
                const [cx,cy]=q[head++]; body.push([cx,cy]);
                for (const [dx,dy] of dirs) {
                    const nx=cx+dx,ny=cy+dy,nk=`${nx},${ny}`;
                    if (!visited.has(nk)) {
                        const nt=tileAt(nx,ny);
                        if (nt&&WALKABLE_TYPES.has(nt.type)) { visited.add(nk); q.push([nx,ny]); }
                    }
                }
            }
            if (body.length<30) continue;
            let sx=0,sy=0;
            for (const [bx,by] of body) { sx+=bx; sy+=by; }
            islandCentroids.push({cx:sx/body.length,cy:sy/body.length,size:body.length});
        }
    }
    islandCentroids.sort((a,b)=>b.size-a.size);
    if (islandCentroids.length>0) {
        landCX=islandCentroids[0].cx;
        landCY=islandCentroids[0].cy;
    }
}

// Assign zones based on angle from land centroid.
// VILLAGE: a circle of radius ~15 around centroid.
// FOREST:  the quadrant with the most existing trees (pass 8 already placed them).
// FARM:    a quadrant adjacent to a river.
// Everything else: null (open/shared).
function buildZoneMap() {
    zoneMap=new Array(CONFIG.GRID_ROWS).fill(null).map(()=>new Array(CONFIG.GRID_COLS).fill(null));

    // Village zone: circular around land centroid.
    const villageR=18;
    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        if (Math.hypot(x-landCX,y-landCY)<villageR) zoneMap[y][x]='village';
    }

    // Count trees per quadrant (relative to centroid) to pick forest quadrant.
    const qTrees=[0,0,0,0]; // NE, NW, SW, SE
    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        const t=tileAt(x,y);
        if (!t||t.feature!=='tree') continue;
        const ang=Math.atan2(y-landCY,x-landCX); // -PI..PI
        const q=ang>=0 ? (ang<Math.PI/2?3:2) : (ang>=-Math.PI/2?0:1); // SE,SW,NW,NE
        qTrees[q]++;
    }
    const forestQ=qTrees.indexOf(Math.max(...qTrees));
    // Quadrant angle ranges: 0=NE(-PI/2..0), 1=NW(-PI..-PI/2), 2=SW(PI/2..PI), 3=SE(0..PI/2)
    const qAngMin=[(-Math.PI/2),(-Math.PI),(Math.PI/2),(0)];
    const qAngMax=[(0),(-Math.PI/2),(Math.PI),(Math.PI/2)];

    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        if (Math.hypot(x-landCX,y-landCY)<villageR) continue; // village takes priority
        const ang=Math.atan2(y-landCY,x-landCX);
        const qThis=ang>=0?(ang<Math.PI/2?3:2):(ang>=-Math.PI/2?0:1);
        if (qThis===forestQ) zoneMap[y][x]='forest';
    }

    // Farm zone: a different quadrant, closest to a river bank.
    // Find which non-forest, non-village quadrant has most river-adjacent grass.
    const qFarm=[0,0,0,0];
    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        const t=tileAt(x,y);
        if (!t||t.type!=='grass') continue;
        if (zoneMap[y][x]==='village'||zoneMap[y][x]==='forest') continue;
        let riverAdj=false;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if (isSeaWater(x+dx,y+dy)) { riverAdj=true; break; }
        }
        if (!riverAdj) continue;
        const ang=Math.atan2(y-landCY,x-landCX);
        const q=ang>=0?(ang<Math.PI/2?3:2):(ang>=-Math.PI/2?0:1);
        if (q!==forestQ) qFarm[q]++;
    }
    qFarm[forestQ]=-1;
    const farmQ=qFarm.indexOf(Math.max(...qFarm));

    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        if (zoneMap[y][x]) continue;
        const ang=Math.atan2(y-landCY,x-landCX);
        const q=ang>=0?(ang<Math.PI/2?3:2):(ang>=-Math.PI/2?0:1);
        if (q===farmQ) zoneMap[y][x]='farm';
    }
}

function tileZone(x,y) {
    if (!zoneMap||y<0||y>=CONFIG.GRID_ROWS||x<0||x>=CONFIG.GRID_COLS) return null;
    return zoneMap[y][x];
}

// ----------------------------------------------------------------
// Stockpile placement — village zone, minimise aggregate distance
// to land centroid.
// ----------------------------------------------------------------
function placeStockpiles() {
    stockpiles=[];
    // Score candidate positions by proximity to land centroid.
    let best=null, bestScore=Infinity;
    for (let y=3;y<CONFIG.GRID_ROWS-3;y++) for (let x=3;x<CONFIG.GRID_COLS-3;x++) {
        const t=tileAt(x,y);
        if (!t||(t.type!=='grass'&&t.type!=='sand')||t.feature) continue;
        if (tileZone(x,y)!=='village') continue;
        const d=Math.hypot(x-landCX,y-landCY);
        if (d<bestScore) { bestScore=d; best={x,y}; }
    }
    if (!best) {
        // Fallback: any flat open grass.
        for (let y=3;y<CONFIG.GRID_ROWS-3;y++) for (let x=3;x<CONFIG.GRID_COLS-3;x++) {
            const t=tileAt(x,y);
            if (!t||(t.type!=='grass'&&t.type!=='sand')||t.feature) continue;
            const d=Math.hypot(x-landCX,y-landCY);
            if (d<bestScore) { bestScore=d; best={x,y}; }
        }
    }
    if (!best) return;

    const cx=best.x,cy=best.y;
    const sp=CONFIG.STOCKPILE_SPREAD;
    const logAnchor=findYardAnchor(cx-sp,cy,3,'h');
    if (logAnchor) stockpiles.push({tiles:logAnchor,type:'organic',counts:{log:0,grain:0}});
    const oreAnchor=findYardAnchor(cx+sp,cy,2,'h');
    if (oreAnchor&&(!logAnchor||Math.hypot(oreAnchor[0].x-logAnchor[0].x,oreAnchor[0].y-logAnchor[0].y)>6))
        stockpiles.push({tiles:oreAnchor,type:'stone',counts:{ore:0}});
}

function findYardAnchor(sx,sy,tileCount,dir) {
    for (let r=0;r<=25;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
        if (Math.abs(dx)!==r&&Math.abs(dy)!==r) continue;
        const ax=Math.round(sx)+dx,ay=Math.round(sy)+dy;
        const tiles=[]; let ok=true;
        for (let i=0;i<tileCount;i++) {
            const tx=ax+(dir==='h'?i:0),ty=ay+(dir==='v'?i:0);
            const t=tileAt(tx,ty);
            if (!t||(t.type!=='grass'&&t.type!=='sand')||t.feature){ok=false;break;}
            if (stockpiles.some(sp=>sp.tiles.some(tt=>tt.x===tx&&tt.y===ty))){ok=false;break;}
            tiles.push({x:tx,y:ty});
        }
        if (ok&&tiles.length===tileCount) return tiles;
    }
    return null;
}

function stockpileForResource(resType) {
    if (resType==='ore') return stockpiles.find(s=>s.type==='stone')||stockpiles[0]||null;
    return stockpiles.find(s=>s.type==='organic')||stockpiles[0]||null;
}

function stockpileWalkTarget(sp) {
    if (!sp) return null;
    for (const tt of sp.tiles) {
        if (isTileWalkable(tt.x,tt.y)) return {x:tt.x+0.5,y:tt.y+0.5};
    }
    for (const tt of sp.tiles) {
        const near=nearestWalkable(tt.x,tt.y,4);
        if (near) return {x:near.x+0.5,y:near.y+0.5};
    }
    return null;
}

// Physical stack cap: don't overfill beyond visual max.
const STOCKPILE_CAP = { log:12, grain:9, ore:8 };
function stockpileIsFull(sp, resType) {
    const cap=STOCKPILE_CAP[resType]||10;
    return (sp.counts[resType]||0)>=cap;
}

// ----------------------------------------------------------------
// Campfire placement
// ----------------------------------------------------------------
function placeCampfires() {
    campfires=[];
    // Place 2–3 campfires on flat grass near stockpile, in the village zone.
    if (stockpiles.length===0) return;
    const cx=stockpiles[0].tiles[0].x, cy=stockpiles[0].tiles[0].y;
    const tries=[
        {dx:-3,dy:2},{dx:3,dy:2},{dx:0,dy:4},
        {dx:-4,dy:-1},{dx:4,dy:-1},
    ];
    for (const {dx,dy} of tries) {
        if (campfires.length>=3) break;
        const fx=cx+dx,fy=cy+dy;
        const t=tileAt(fx,fy);
        if (t&&(t.type==='grass'||t.type==='sand')&&!t.feature)
            campfires.push({x:fx,y:fy,phase:Math.random()*Math.PI*2});
    }
}

// ----------------------------------------------------------------
// Job helpers
// ----------------------------------------------------------------
function makeJob(type,x,y,extra) {
    return {id:jobIdCounter++,type,x,y,progress:0,
            maxProgress:CONFIG.JOB_TICKS[type],assignedTo:null,...extra};
}
function countJobType(type) { return jobs.filter(j=>j.type===type).length; }
function tileHasJob(x,y)    { return jobs.some(j=>j.x===x&&j.y===y); }

function hasWalkableNeighbour(x,y) {
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const n=tileAt(x+dx,y+dy);
        if (n&&WALKABLE_TYPES.has(n.type)&&n.feature!=='tree') return true;
    }
    return false;
}

function countBuiltBridges() {
    let c=0;
    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        const t=tileAt(x,y); if (t&&t.type==='bridge') c++;
    }
    return c;
}

// ----------------------------------------------------------------
// Bridge planning — straight perpendicular spans only
// ----------------------------------------------------------------
// Algorithm:
// 1. Scan every E-W and N-S line across the map.
// 2. For each consecutive run of river water (3–8 tiles), check
//    land on both terminal sides.
// 3. Accept only runs where EVERY tile in the run is river water
//    (not open sea — must be connected to sea but have land ≤8
//    tiles away on BOTH sides of the axis).
// 4. Sort by span length ascending (shortest crossing first).
// 5. No bridge within 12 tiles of any existing bridge or planned span.

let plannedBridgeSpans = []; // [{tiles, axis}] finalised plans

function planBridges() {
    plannedBridgeSpans=[];
    const allCrossings=[];

    function tryRun(run, axis) {
        if (run.length<3||run.length>8) return;
        const first=run[0],last=run[run.length-1];
        // Check land immediately at both ends.
        let landA,landB;
        if (axis==='h') {
            const tA=tileAt(first.x-1,first.y),tB=tileAt(last.x+1,last.y);
            landA=tA&&WALKABLE_TYPES.has(tA.type);
            landB=tB&&WALKABLE_TYPES.has(tB.type);
        } else {
            const tA=tileAt(first.x,first.y-1),tB=tileAt(last.x,last.y+1);
            landA=tA&&WALKABLE_TYPES.has(tA.type);
            landB=tB&&WALKABLE_TYPES.has(tB.type);
        }
        if (!landA||!landB) return;
        // Ensure it's river not open sea: land within 8 tiles on both sides of axis.
        const mid=run[Math.floor(run.length/2)];
        let closeN=false,closeS=false;
        if (axis==='h') {
            for (let dy=1;dy<=8;dy++) {
                const t1=tileAt(mid.x,mid.y-dy),t2=tileAt(mid.x,mid.y+dy);
                if (t1&&WALKABLE_TYPES.has(t1.type)) closeN=true;
                if (t2&&WALKABLE_TYPES.has(t2.type)) closeS=true;
            }
        } else {
            for (let dx=1;dx<=8;dx++) {
                const t1=tileAt(mid.x-dx,mid.y),t2=tileAt(mid.x+dx,mid.y);
                if (t1&&WALKABLE_TYPES.has(t1.type)) closeN=true;
                if (t2&&WALKABLE_TYPES.has(t2.type)) closeS=true;
            }
        }
        if (!closeN||!closeS) return; // it's open sea
        // No waterfall nearby.
        for (const {x,y} of run) {
            for (let dy=-3;dy<=3;dy++) for (let dx=-3;dx<=3;dx++) {
                const n=tileAt(x+dx,y+dy);
                if (n&&n.feature==='waterfall') return;
            }
        }
        allCrossings.push({tiles:run.map(r=>({x:r.x,y:r.y})),axis,len:run.length});
    }

    // Horizontal scan.
    for (let y=2;y<CONFIG.GRID_ROWS-2;y++) {
        let run=[];
        for (let x=0;x<CONFIG.GRID_COLS;x++) {
            const t=tileAt(x,y);
            if (t&&t.type==='water'&&isSeaWater(x,y)) run.push({x,y});
            else { tryRun(run,'h'); run=[]; }
        }
        tryRun(run,'h');
    }
    // Vertical scan.
    for (let x=2;x<CONFIG.GRID_COLS-2;x++) {
        let run=[];
        for (let y=0;y<CONFIG.GRID_ROWS;y++) {
            const t=tileAt(x,y);
            if (t&&t.type==='water'&&isSeaWater(x,y)) run.push({x,y});
            else { tryRun(run,'v'); run=[]; }
        }
        tryRun(run,'v');
    }

    // Sort shortest first; deduplicate overlapping spans.
    allCrossings.sort((a,b)=>a.len-b.len);
    const chosenMids=[];
    for (const cr of allCrossings) {
        if (plannedBridgeSpans.length>=4) break;
        const mid=cr.tiles[Math.floor(cr.tiles.length/2)];
        // Must be ≥12 tiles from any already-chosen mid.
        if (chosenMids.some(m=>Math.hypot(m.x-mid.x,m.y-mid.y)<12)) continue;
        plannedBridgeSpans.push(cr);
        chosenMids.push(mid);
    }
}

// ----------------------------------------------------------------
// Forest management — forest zone only
// ----------------------------------------------------------------
function spawnChopJobs() {
    const maxActive=CONFIG.CHOP_CONCURRENT;
    const active=countJobType('chop');
    const need=maxActive-active;
    if (need<=0) return;

    // Only chop trees in the forest zone. Score by proximity to stockpile.
    const trees=[];
    for (let y=1;y<CONFIG.GRID_ROWS-1;y++) for (let x=1;x<CONFIG.GRID_COLS-1;x++) {
        const t=tileAt(x,y);
        if (!t||t.feature!=='tree'||tileHasJob(x,y)) continue;
        if (tileZone(x,y)!=='forest') continue;  // only in forest zone
        if (!hasWalkableNeighbour(x,y)) continue;
        const dist=stockpiles.reduce((mn,sp)=>
            Math.min(mn,...sp.tiles.map(tt=>Math.hypot(tt.x-x,tt.y-y))),Infinity);
        trees.push({x,y,dist});
    }
    // Closest accessible trees first.
    trees.sort((a,b)=>a.dist-b.dist);
    for (let i=0;i<need&&i<trees.length;i++) {
        if (!tileHasJob(trees[i].x,trees[i].y))
            jobs.push(makeJob('chop',trees[i].x,trees[i].y));
    }
}

let pendingPlants=[];

function queuePlantTree(x,y) {
    // Replant in the forest zone, finding a gap surrounded by existing trees.
    const target=findForestGap(x,y,12);
    const tx=target?target.x:x, ty=target?target.y:y;
    // Only plant in forest zone.
    if (tileZone(tx,ty)!=='forest'&&tileZone(x,y)!=='forest') return;
    const plantX=tileZone(tx,ty)==='forest'?tx:x;
    const plantY=tileZone(tx,ty)==='forest'?ty:y;
    pendingPlants.push({x:plantX,y:plantY,readyAt:tick+400+Math.floor(Math.random()*200)});
}

function findForestGap(cx,cy,radius) {
    let best=null,bestScore=0;
    for (let dy=-radius;dy<=radius;dy++) for (let dx=-radius;dx<=radius;dx++) {
        const nx=cx+dx,ny=cy+dy,t=tileAt(nx,ny);
        if (!t||t.type!=='grass'||t.feature||tileHasJob(nx,ny)) continue;
        if (tileZone(nx,ny)!=='forest') continue;
        let treeCt=0;
        for (const [ex,ey] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
            const n=tileAt(nx+ex,ny+ey);
            if (n&&n.feature==='tree') treeCt++;
        }
        if (treeCt>bestScore) { bestScore=treeCt; best={x:nx,y:ny}; }
    }
    return best;
}

function processPendingPlants() {
    for (let i=pendingPlants.length-1;i>=0;i--) {
        const p=pendingPlants[i]; if (tick<p.readyAt) continue;
        pendingPlants.splice(i,1);
        const t=tileAt(p.x,p.y);
        if (t&&t.type==='grass'&&!t.feature&&!tileHasJob(p.x,p.y))
            jobs.push(makeJob('plant_tree',p.x,p.y));
    }
}

// ----------------------------------------------------------------
// Farm planning — farm zone, river-adjacent
// ----------------------------------------------------------------
let farmClusters=[];

function countBuiltFarmTiles() {
    let n=0;
    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        const t=tileAt(x,y); if (t&&t.type==='farm') n++;
    }
    return n;
}

function spawnFarmCluster() {
    if (farmClusters.length>=CONFIG.FARM_CLUSTER_MAX) return;
    if (countJobType('farm')>0) return;
    if (farmClusters.length===1&&countBuiltFarmTiles()<CONFIG.FARM_CLUSTER_SIZE*0.6) return;

    // River-bank grass in farm zone.
    const bankTiles=[];
    for (let y=2;y<CONFIG.GRID_ROWS-2;y++) for (let x=2;x<CONFIG.GRID_COLS-2;x++) {
        const t=tileAt(x,y);
        if (!t||t.type!=='grass'||t.feature||tileHasJob(x,y)) continue;
        if (tileZone(x,y)!=='farm') continue;
        if (farmClusters.some(c=>Math.hypot(c.cx-x,c.cy-y)<25)) continue;
        let riverAdj=false;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])
            if (isSeaWater(x+dx,y+dy)) { riverAdj=true; break; }
        if (!riverAdj) continue;
        bankTiles.push({x,y});
    }
    if (bankTiles.length===0) return;

    const seed=bankTiles[Math.floor(hash(tick%97,farmClusters.length)*bankTiles.length)];
    const bankSet=new Set(bankTiles.map(t=>`${t.x},${t.y}`));
    const patch=[],visited=new Set();
    const q=[seed]; visited.add(`${seed.x},${seed.y}`);
    while (q.length>0&&patch.length<CONFIG.FARM_CLUSTER_SIZE) {
        q.sort((a,b)=>(bankSet.has(`${a.x},${a.y}`)?0:1)-(bankSet.has(`${b.x},${b.y}`)?0:1));
        const cur=q.shift();
        const t=tileAt(cur.x,cur.y);
        if (!t||t.type!=='grass'||t.feature||tileHasJob(cur.x,cur.y)) continue;
        patch.push(cur);
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx=cur.x+dx,ny=cur.y+dy,nk=`${nx},${ny}`;
            if (!visited.has(nk)) { visited.add(nk); q.push({x:nx,y:ny}); }
        }
    }
    if (patch.length===0) return;
    farmClusters.push({cx:seed.x,cy:seed.y});
    for (const p of patch) jobs.push(makeJob('farm',p.x,p.y));
}

// ----------------------------------------------------------------
// Growth
// ----------------------------------------------------------------
function updateGrowth() {
    for (let y=0;y<CONFIG.GRID_ROWS;y++) for (let x=0;x<CONFIG.GRID_COLS;x++) {
        const t=tileAt(x,y); if (!t) continue;
        if (t.type==='farm'&&t.growthTick!==undefined&&t.growthTick<CONFIG.CROP_GROW_TICKS) t.growthTick++;
        if (t.feature==='sapling'&&t.saplingTick!==undefined) {
            if (t.saplingTick<CONFIG.TREE_GROW_TICKS) t.saplingTick++;
            else { t.feature='tree'; t.saplingTick=undefined; }
        }
    }
}

// ----------------------------------------------------------------
// Housing — village zone, clustered around stockpile
// ----------------------------------------------------------------
function countBuiltHouses() { return houses.length; }

function spawnHouseJob() {
    if (countBuiltHouses()+countJobType('build_house')>=CONFIG.HOUSE_MAX) return;
    if (countJobType('build_house')>0) return;
    const cx=stockpiles.length>0?stockpiles[0].tiles[0].x:landCX;
    const cy=stockpiles.length>0?stockpiles[0].tiles[0].y:landCY;

    for (let r=4;r<=24;r++) {
        for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
            if (Math.abs(dx)!==r&&Math.abs(dy)!==r) continue;
            const ax=Math.round(cx)+dx,ay=Math.round(cy)+dy;
            if (tileZone(ax,ay)!=='village'&&tileZone(ax,ay)!==null) continue;
            if (!canPlaceHouse(ax,ay,3,2)) continue;
            for (let hy=0;hy<2;hy++) for (let hx=0;hx<3;hx++) {
                if (!tileHasJob(ax+hx,ay+hy))
                    jobs.push(makeJob('build_house',ax+hx,ay+hy,
                        {houseOriginX:ax,houseOriginY:ay,houseW:3,houseH:2}));
            }
            return;
        }
    }
}

function canPlaceHouse(ax,ay,w,h) {
    for (let hy=-1;hy<=h;hy++) for (let hx=-1;hx<=w;hx++) {
        const t=tileAt(ax+hx,ay+hy); if (!t) return false;
        const inside=(hx>=0&&hx<w&&hy>=0&&hy<h);
        if (inside) {
            if (t.type!=='grass'&&t.type!=='grass_dark'&&t.type!=='sand') return false;
            if (t.feature) return false;
            if (t.type==='house') return false;
            if (tileHasJob(ax+hx,ay+hy)) return false;
        }
    }
    for (const ho of houses) {
        if (ax<ho.x+ho.w+2&&ax+w>ho.x-2&&ay<ho.y+ho.h+2&&ay+h>ho.y-2) return false;
    }
    return true;
}

// ----------------------------------------------------------------
// Dock placement
// ----------------------------------------------------------------
function spawnDocks() {
    if (docks.length+countJobType('build_dock')>=CONFIG.DOCK_MAX) return;
    const candidates=[];
    for (let y=2;y<CONFIG.GRID_ROWS-2;y++) for (let x=2;x<CONFIG.GRID_COLS-2;x++) {
        const t=tileAt(x,y);
        if (!t||(t.type!=='grass'&&t.type!=='sand')||t.feature||tileHasJob(x,y)) continue;
        for (const [dx,dy] of [[0,-1],[0,1],[1,0],[-1,0]]) {
            const wx=x+dx,wy=y+dy;
            if (!isSeaWater(wx,wy)) continue;
            const wx2=wx+dx,wy2=wy+dy;
            const t2=tileAt(wx2,wy2);
            if (t2&&t2.type==='water'&&isSeaWater(wx2,wy2)
                &&!docks.some(d=>Math.hypot(d.x-wx,d.y-wy)<6)
                &&!tileHasJob(wx,wy)&&!tileHasJob(wx2,wy2)) {
                candidates.push({x:wx,y:wy,dx,dy});
            }
            break;
        }
    }
    if (candidates.length===0) return;
    candidates.sort((a,b)=>Math.hypot(a.x-landCX,a.y-landCY)-Math.hypot(b.x-landCX,b.y-landCY));
    const pick=candidates[Math.floor(Math.random()*Math.min(5,candidates.length))];
    if (!pick) return;
    jobs.push(makeJob('build_dock',pick.x,pick.y,{dockDir:{dx:pick.dx,dy:pick.dy}}));
    const x2=pick.x+pick.dx,y2=pick.y+pick.dy;
    if (tileAt(x2,y2)&&tileAt(x2,y2).type==='water'&&!tileHasJob(x2,y2))
        jobs.push(makeJob('build_dock',x2,y2,{dockDir:{dx:pick.dx,dy:pick.dy}}));
}

// ----------------------------------------------------------------
// Job assignment / completion
// ----------------------------------------------------------------
function findNearestJob(dx,dy) {
    let best=null,bestDist=Infinity;
    for (const j of jobs) {
        if (j.assignedTo!==null) continue;
        if (j._skipUntil&&tick<j._skipUntil) continue;
        const d=Math.hypot(j.x-dx,j.y-dy);
        if (d<bestDist) { bestDist=d; best=j; }
    }
    return best;
}
function assignJob(dupe,job) { job.assignedTo=dupe.id; dupe.job=job; dupe.jobPhase='travel'; }
function releaseJob(dupe) {
    if (dupe.job) {
        if (dupe.job.assignedTo===dupe.id) dupe.job.assignedTo=null;
        dupe.job=null; dupe.jobPhase=null; dupe.workStandX=null; dupe.workStandY=null;
    }
}
function workOnJob(dupe) {
    const j=dupe.job; if (!j) return;
    j.progress++;
    if (j.progress>=j.maxProgress) completeJob(j,dupe);
}

function completeJob(j,dupe) {
    const t=tileAt(j.x,j.y);

    if (j.type==='chop'&&t&&t.feature==='tree') {
        t.feature=null;
        const sp=stockpileForResource('log');
        if (sp&&!stockpileIsFull(sp,'log')) {
            dupe.carrying=true; dupe.carryColor=RESOURCE_PALETTE.log;
            dupe.carryTimer=800; dupe.carryResource='log'; dupe.carryTarget=sp;
        }
        queuePlantTree(j.x,j.y);
    }
    else if (j.type==='plant_tree'&&t&&t.type==='grass'&&!t.feature) {
        t.feature='sapling'; t.saplingTick=0;
    }
    else if (j.type==='mine'&&t&&(t.type==='stone'||t.type==='stone_high')) {
        t.type='grass_dark'; t.z=PALETTE.grass_dark.z; t.feature=null;
        const sp=stockpileForResource('ore');
        if (sp&&!stockpileIsFull(sp,'ore')) {
            dupe.carrying=true; dupe.carryColor=RESOURCE_PALETTE.ore;
            dupe.carryTimer=800; dupe.carryResource='ore'; dupe.carryTarget=sp;
        }
        recomputeShadowsAround(j.x,j.y);
    }
    else if (j.type==='farm'&&t) {
        t.type='farm'; t.growthTick=0;
        const sp=stockpileForResource('grain');
        if (sp&&!stockpileIsFull(sp,'grain')) {
            dupe.carrying=true; dupe.carryColor=RESOURCE_PALETTE.grain;
            dupe.carryTimer=800; dupe.carryResource='grain'; dupe.carryTarget=sp;
        }
    }
    else if (j.type==='build_bridge'&&t&&t.type==='water') {
        t.type='bridge'; t.z=PALETTE.bridge.z; t.feature=null;
        recomputeShadowsAround(j.x,j.y);
    }
    else if (j.type==='build_dock'&&t&&t.type==='water') {
        t.type='dock'; t.z=PALETTE.dock.z; t.feature=null; t.dockDir=j.dockDir;
        docks.push({x:j.x,y:j.y});
        recomputeShadowsAround(j.x,j.y);
    }
    else if (j.type==='build_boat') {
        spawnBoat(j.x,j.y);
    }
    else if (j.type==='build_house'&&t) {
        t.type='house'; t.z=PALETTE.house.z; t.feature=null;
        t.houseOriginX=j.houseOriginX; t.houseOriginY=j.houseOriginY;
        t.houseW=j.houseW; t.houseH=j.houseH;
        recomputeShadowsAround(j.x,j.y);
        if (!houses.some(h=>h.x===j.houseOriginX&&h.y===j.houseOriginY))
            houses.push({x:j.houseOriginX,y:j.houseOriginY,w:j.houseW,h:j.houseH});
    }

    jobs.splice(jobs.indexOf(j),1);
    dupe.job=null; dupe.jobPhase=null; dupe.workStandX=null; dupe.workStandY=null;
    dupe.state='idle'; dupe.wait=20+Math.random()*40;
}

function depositResource(dupe) {
    if (!dupe.carryResource||!dupe.carryTarget) return;
    const sp=dupe.carryTarget;
    if (sp.counts[dupe.carryResource]!==undefined) {
        if (!stockpileIsFull(sp,dupe.carryResource))
            sp.counts[dupe.carryResource]++;
    }
    dupe.carrying=false; dupe.carryResource=null; dupe.carryTarget=null; dupe.carryTimer=0;
}

// ----------------------------------------------------------------
// Boats — spawned directly at init and guaranteed
// ----------------------------------------------------------------
function isCoastal(x,y) {
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const n=tileAt(x+dx,y+dy);
        if (n&&WALKABLE_TYPES.has(n.type)) return true;
    }
    return false;
}

function findCoastalWaterNear(cx,cy) {
    for (let r=0;r<=25;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
        if (Math.abs(dx)!==r&&Math.abs(dy)!==r) continue;
        const nx=cx+dx,ny=cy+dy,t=tileAt(nx,ny);
        if (t&&t.type==='water'&&isSeaWater(nx,ny)&&isCoastal(nx,ny)) return {x:nx,y:ny};
    }
    return null;
}

function pickBoatDestination(b) {
    const bx=Math.floor(b.x),by=Math.floor(b.y);

    // Prefer dock tiles.
    if (docks.length>0) {
        const far=docks.filter(d=>Math.hypot(d.x-bx,d.y-by)>10);
        if (far.length>0) {
            const d=far[Math.floor(Math.random()*far.length)];
            b.destX=d.x+0.5; b.destY=d.y+0.5; return;
        }
    }

    // Multi-island: opposite island coast.
    if (islandCentroids.length>=2) {
        let target=islandCentroids[0],best=0;
        for (const isl of islandCentroids) {
            const d=Math.hypot(isl.cx-bx,isl.cy-by);
            if (d>best) { best=d; target=isl; }
        }
        const dest=findCoastalWaterNear(Math.round(target.cx),Math.round(target.cy));
        if (dest) { b.destX=dest.x+0.5; b.destY=dest.y+0.5; return; }
    }

    // Circumnavigation.
    const coasts=[];
    for (let y=2;y<CONFIG.GRID_ROWS-2;y+=2) for (let x=2;x<CONFIG.GRID_COLS-2;x+=2) {
        const t=tileAt(x,y);
        if (!t||t.type!=='water'||!isSeaWater(x,y)||!isCoastal(x,y)) continue;
        const d=Math.hypot(x-bx,y-by);
        if (d>12) coasts.push({x,y,d});
    }
    if (coasts.length===0) { b.destX=null; b.destY=null; return; }
    coasts.sort((a,bb)=>bb.d-a.d);
    const pool=coasts.slice(0,Math.max(1,Math.floor(coasts.length/6)));
    const c=pool[Math.floor(Math.random()*pool.length)];
    b.destX=c.x+0.5; b.destY=c.y+0.5;
}

function spawnBoat(x,y) {
    const b={
        x:x+0.5,y:y+0.5,vx:0,vy:0,
        sailColor:BOAT_PALETTE.sail[Math.floor(Math.random()*BOAT_PALETTE.sail.length)],
        phase:Math.random()*Math.PI*2,
        heading:Math.random()*Math.PI*2,
        stuckTimer:0,destX:null,destY:null,dockTimer:0,
    };
    pickBoatDestination(b);
    boats.push(b);
}

function spawnInitialBoats() {
    // Find open sea tiles well away from land.
    const cands=[];
    for (let y=3;y<CONFIG.GRID_ROWS-3;y+=2) for (let x=3;x<CONFIG.GRID_COLS-3;x+=2) {
        const t=tileAt(x,y);
        if (!t||t.type!=='water'||!isSeaWater(x,y)) continue;
        let ld=Infinity;
        for (let dy=-6;dy<=6;dy++) for (let dx=-6;dx<=6;dx++) {
            const n=tileAt(x+dx,y+dy);
            if (n&&n.type!=='water') ld=Math.min(ld,Math.hypot(dx,dy));
        }
        if (ld>=4) cands.push({x,y,ld});
    }
    cands.sort((a,b)=>b.ld-a.ld);
    // Spawn up to BOAT_MIN boats spread apart.
    const spawned=[];
    for (const c of cands) {
        if (spawned.length>=CONFIG.BOAT_MIN) break;
        if (spawned.some(s=>Math.hypot(s.x-c.x,s.y-c.y)<20)) continue;
        spawnBoat(c.x,c.y);
        spawned.push(c);
    }
}

function updateBoats() {
    for (const b of boats) {
        b.phase+=0.018;
        if (b.dockTimer>0) { b.dockTimer--; if (b.dockTimer<=0) pickBoatDestination(b); continue; }

        if (b.destX!==null&&b.destY!==null) {
            const dx=b.destX-b.x,dy=b.destY-b.y,dist=Math.hypot(dx,dy);
            if (dist<1.5) { b.dockTimer=60+Math.floor(Math.random()*100); b.vx=0; b.vy=0; continue; }
            let diff=Math.atan2(dy,dx)-b.heading;
            while (diff>Math.PI) diff-=Math.PI*2; while (diff<-Math.PI) diff+=Math.PI*2;
            b.heading+=diff*0.06+Math.sin(b.phase*0.27)*0.002;
        } else { b.heading+=Math.sin(b.phase*0.27)*0.003; }

        const tvx=Math.cos(b.heading)*CONFIG.BOAT_SPEED,tvy=Math.sin(b.heading)*CONFIG.BOAT_SPEED;
        b.vx=b.vx*0.93+tvx*0.07; b.vy=b.vy*0.93+tvy*0.07;

        const nx=b.x+b.vx,ny=b.y+b.vy;
        const cnx=Math.max(0.5,Math.min(CONFIG.GRID_COLS-0.5,nx));
        const cny=Math.max(0.5,Math.min(CONFIG.GRID_ROWS-0.5,ny));
        const tN=tileAt(Math.floor(cnx),Math.floor(cny));

        if (tN&&(tN.type==='water'||tN.type==='dock')&&cnx===nx&&cny===ny) {
            b.x=nx; b.y=ny; b.stuckTimer=0;
        } else {
            const txo=tileAt(Math.floor(Math.max(0.5,Math.min(CONFIG.GRID_COLS-0.5,b.x+b.vx))),Math.floor(b.y));
            const tyo=tileAt(Math.floor(b.x),Math.floor(Math.max(0.5,Math.min(CONFIG.GRID_ROWS-0.5,b.y+b.vy))));
            if (!txo||(txo.type!=='water'&&txo.type!=='dock')) b.vx=-b.vx;
            if (!tyo||(tyo.type!=='water'&&tyo.type!=='dock')) b.vy=-b.vy;
            b.stuckTimer=(b.stuckTimer||0)+1;
            if (b.stuckTimer>20) {
                pickBoatDestination(b);
                b.heading=Math.random()*Math.PI*2;
                b.vx=Math.cos(b.heading)*CONFIG.BOAT_SPEED;
                b.vy=Math.sin(b.heading)*CONFIG.BOAT_SPEED;
                b.stuckTimer=0;
            } else {
                b.heading=Math.atan2(b.vy,b.vx)+(Math.random()-0.5)*Math.PI*0.5;
            }
        }
        const spd=Math.hypot(b.vx,b.vy);
        if (spd<CONFIG.BOAT_SPEED*0.5) { b.vx=Math.cos(b.heading)*CONFIG.BOAT_SPEED; b.vy=Math.sin(b.heading)*CONFIG.BOAT_SPEED; }
    }
}

// ----------------------------------------------------------------
// Shadow helper
// ----------------------------------------------------------------
function recomputeShadowsAround(cx,cy) {
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
        const x=cx+dx,y=cy+dy,t=tileAt(x,y); if (!t) continue;
        t.shadow={
            n:y>0&&tileAt(x,y-1)&&tileAt(x,y-1).z>t.z,
            s:y<CONFIG.GRID_ROWS-1&&tileAt(x,y+1)&&tileAt(x,y+1).z>t.z,
            w:x>0&&tileAt(x-1,y)&&tileAt(x-1,y).z>t.z,
            e:x<CONFIG.GRID_COLS-1&&tileAt(x+1,y)&&tileAt(x+1,y).z>t.z,
        };
    }
}

// ----------------------------------------------------------------
// Auto-spawn jobs
// ----------------------------------------------------------------
function autoSpawnJobs() {
    if (jobs.length>=CONFIG.JOB_MAX) return;
    spawnChopJobs();
    processPendingPlants();

    // Mining.
    if (countJobType('mine')<2) {
        const stones=[];
        for (let y=1;y<CONFIG.GRID_ROWS-1;y++) for (let x=1;x<CONFIG.GRID_COLS-1;x++) {
            const t=tileAt(x,y);
            if (t&&t.type==='stone'&&!tileHasJob(x,y)&&hasWalkableNeighbour(x,y)) stones.push({x,y});
        }
        const need=2-countJobType('mine');
        for (let i=0;i<need&&stones.length>0;i++) {
            const idx=Math.floor(Math.random()*stones.length);
            const c=stones.splice(idx,1)[0];
            jobs.push(makeJob('mine',c.x,c.y));
        }
    }

    spawnFarmCluster();

    // Bridges from pre-planned spans.
    const builtBridges=countBuiltBridges()+countJobType('build_bridge');
    if (builtBridges<CONFIG.BRIDGE_MAX&&countJobType('build_bridge')<4) {
        for (const span of plannedBridgeSpans) {
            if (span.tiles.every(t2=>tileAt(t2.x,t2.y)&&tileAt(t2.x,t2.y).type==='bridge')) continue;
            if (span.tiles.some(t2=>tileHasJob(t2.x,t2.y))) continue;
            if (builtBridges+span.tiles.length>CONFIG.BRIDGE_MAX) break;
            for (const tile of span.tiles) {
                const t2=tileAt(tile.x,tile.y);
                if (t2&&t2.type==='water'&&!tileHasJob(tile.x,tile.y))
                    jobs.push(makeJob('build_bridge',tile.x,tile.y));
            }
            break; // one span at a time
        }
    }

    spawnDocks();

    // Houses after some logs stocked.
    const logStock=stockpiles.reduce((s,sp)=>s+(sp.counts.log||0),0);
    if (logStock>=3) spawnHouseJob();
}

// ----------------------------------------------------------------
// Day/night cycle
// ----------------------------------------------------------------
function updateDayNight() {
    dayPhase=(dayPhase+1/CONFIG.DAY_TICKS)%1.0;
}

// ----------------------------------------------------------------
// Main update
// ----------------------------------------------------------------
let jobSpawnTimer=0;

function initJobs() {
    jobs.length=0; boats.length=0; pendingPlants.length=0;
    farmClusters=[]; houses=[]; docks=[]; campfires=[];
    plannedBridgeSpans=[];
    jobSpawnTimer=0; jobIdCounter=0; dayPhase=0.2;

    buildSeaWaterSet();
    buildIslandCentroids();
    buildZoneMap();
    placeStockpiles();
    planBridges();
    placeCampfires();
    spawnInitialBoats();
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
    updateDayNight();
}
