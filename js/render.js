/* ============================================================
 * render.js — all drawing.
 *
 * Stockpiles are now Y-sorted into the tile row loop so they
 * never float on top of dupes. A stockpile lookup map is built
 * each frame from getStockpiles() and consumed row-by-row.
 *
 * New visuals:
 *  - Saplings: tiny two-layer canopy, grows over TREE_GROW_TICKS.
 *  - Crop growth: farm tiles show seedling→growing→ripe colour.
 *  - Bridges: orientation-aware (E-W vs N-S planks).
 *  - Log pile / ore pile / grain sacks: drawn in-row so Y-sort works.
 * ============================================================ */

let canvas, ctx;
let tileSize=1, offsetX=0, offsetY=0, tick=0;

function initRender(canvasEl) { canvas=canvasEl; ctx=canvas.getContext('2d'); }

function resize() {
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    tileSize=Math.max(1,Math.floor(Math.min(canvas.width/CONFIG.GRID_COLS,
                                             canvas.height/CONFIG.GRID_ROWS)));
    offsetX=Math.floor((canvas.width -CONFIG.GRID_COLS*tileSize)/2);
    offsetY=Math.floor((canvas.height-CONFIG.GRID_ROWS*tileSize)/2);
}

function strataColour(baseType, z) {
    if (z<=-3) return '#050505';
    if (z===-2) return '#1a1a1a';
    if (z===-1) return '#2a221a';
    if (z===0)  return '#3a2a1a';
    if (z===1) {
        if (baseType==='sandstone') return PALETTE.sandstone.front;
        if (baseType.includes('stone')) return PALETTE.stone.front;
        return '#5a4a3a';
    }
    if (z===2) { if (baseType.includes('stone')) return '#707070'; return PALETTE.grass.front; }
    return PALETTE[baseType]?PALETTE[baseType].front:'#000';
}

// ---------- Tree -------------------------------------------
function drawTree(px, py, seed) {
    const t=tileSize, cx=px+t/2;
    const sizeBonus=(seed*0.35)*t, groundY=py+0.55*t;
    ctx.fillStyle=TREE_PALETTE.shadow;
    ctx.fillRect(cx-0.45*t, groundY, 0.9*t, 0.25*t);
    const trunkW=Math.max(2,0.22*t), trunkH=0.85*t+sizeBonus, trunkTop=groundY-trunkH;
    ctx.fillStyle=TREE_PALETTE.trunkDark; ctx.fillRect(cx-trunkW/2,trunkTop,trunkW,trunkH);
    ctx.fillStyle=TREE_PALETTE.trunkLight; ctx.fillRect(cx-trunkW/2,trunkTop,Math.max(1,trunkW*0.4),trunkH);
    let lw=1.5*t,lh=0.7*t,lb=trunkTop;
    ctx.fillStyle=TREE_PALETTE.leafDark;   ctx.fillRect(cx-lw/2,lb-lh,lw,lh);
    lb-=lh*0.85; lw=1.2*t; lh=0.6*t;
    ctx.fillStyle=TREE_PALETTE.leafMid;    ctx.fillRect(cx-lw/2,lb-lh,lw,lh);
    lb-=lh*0.85; lw=0.8*t; lh=0.5*t;
    ctx.fillStyle=TREE_PALETTE.leafLight;  ctx.fillRect(cx-lw/2,lb-lh,lw,lh);
    ctx.fillStyle=TREE_PALETTE.leafHighlight;
    ctx.fillRect(cx+0.1*t,lb-lh*0.9,Math.max(1,0.2*t),Math.max(1,0.2*t));
}

// Sapling: tiny trunk + two small canopy tiers, grows over time.
function drawSapling(px, py, saplingTick) {
    const t=tileSize, cx=px+t/2;
    const grow=Math.min(1, (saplingTick||0)/CONFIG.TREE_GROW_TICKS);
    // At grow=0: tiny stub. At grow=1: full tree. Interpolate between.
    const scale=0.25+grow*0.75;
    const groundY=py+0.7*t;
    const trunkH=t*0.5*scale, trunkW=Math.max(1,t*0.12*scale);
    const trunkTop=groundY-trunkH;
    ctx.fillStyle=TREE_PALETTE.saplingTrunk;
    ctx.fillRect(cx-trunkW/2, trunkTop, trunkW, trunkH);
    // Two canopy tiers.
    const lw1=t*0.9*scale, lh1=t*0.4*scale;
    ctx.fillStyle=TREE_PALETTE.saplingLeaf;
    ctx.fillRect(cx-lw1/2, trunkTop-lh1, lw1, lh1);
    const lw2=lw1*0.7, lh2=lh1*0.75;
    ctx.fillStyle=TREE_PALETTE.leafLight;
    ctx.fillRect(cx-lw2/2, trunkTop-lh1-lh2*0.8, lw2, lh2);
}

// ---------- Farm -------------------------------------------
// Growth stages: seedling (0-30%) → growing (30-70%) → ripe (70-100%).
function drawFarm(px, py, drawY, seed, growthTick) {
    const t=tileSize;
    const gt=growthTick||0, maxG=CONFIG.CROP_GROW_TICKS;
    const pct=Math.min(1, gt/maxG);

    // Furrow lines — always present.
    const rows=Math.max(2,Math.floor(t/3));
    ctx.fillStyle='#6a4a10';
    for (let r=0;r<rows;r++) {
        const fy=drawY+(r/rows)*t+1;
        ctx.fillRect(px+1,fy,t-2,Math.max(1,t*0.06));
    }

    // Crop colour and height by stage.
    let cropCol, cropH;
    if (pct<0.3)      { cropCol='#4a8020'; cropH=t*0.08*pct/0.3; }        // seedling — tiny green nub
    else if (pct<0.7) { cropCol='#5ab030'; cropH=t*0.08+t*0.12*(pct-0.3)/0.4; } // growing
    else              { cropCol='#d4b820'; cropH=t*0.22; }               // ripe — golden wheat height

    if (cropH>1) {
        const sproutCount=Math.max(2,Math.floor(t/4));
        for (let i=0;i<sproutCount;i++) {
            const sx=px+2+(i/sproutCount)*(t-4)+(seed*3%2);
            const sy=drawY+t*0.7;
            ctx.fillStyle=cropCol;
            ctx.fillRect(sx,sy-cropH,Math.max(1,t*0.07),cropH);
        }
    }
}

// ---------- Bridge -----------------------------------------
// Orientation-aware: check E-W or N-S neighbours to pick plank direction.
function drawBridge(px, py, drawY, tx, ty) {
    const t=tileSize;
    // Determine orientation: if east/west neighbours are walkable, this is
    // an E-W bridge so planks run N-S (perpendicular to travel).
    const wW=tileAt(tx-1,ty), wE=tileAt(tx+1,ty);
    const landE=wE&&WALKABLE_TYPES.has(wE.type);
    const landW=wW&&WALKABLE_TYPES.has(wW.type);
    const isEW=(landE&&landW);

    const plankCount=Math.max(2,Math.floor(t/3.5));
    ctx.fillStyle=BOAT_PALETTE.hullDark;
    if (isEW) {
        // E-W travel → planks are vertical (N-S).
        for (let p=0;p<plankCount;p++) {
            const bx=px+(p/plankCount)*t+1;
            ctx.fillRect(bx, drawY+1, Math.max(1,t*0.16), t-2);
        }
        // Horizontal rails top and bottom.
        ctx.fillStyle=BOAT_PALETTE.hull;
        ctx.fillRect(px+1,drawY+1,t-2,Math.max(1,t*0.1));
        ctx.fillRect(px+1,drawY+t-Math.max(1,t*0.1)-1,t-2,Math.max(1,t*0.1));
    } else {
        // N-S travel → planks are horizontal (E-W).
        for (let p=0;p<plankCount;p++) {
            const by=drawY+(p/plankCount)*t+1;
            ctx.fillRect(px+1,by,t-2,Math.max(1,t*0.16));
        }
        // Vertical rails left and right.
        ctx.fillStyle=BOAT_PALETTE.hull;
        ctx.fillRect(px+1,drawY+1,Math.max(1,t*0.1),t-2);
        ctx.fillRect(px+t-Math.max(1,t*0.1)-1,drawY+1,Math.max(1,t*0.1),t-2);
    }
}

// ---------- Stockpile drawing ------------------------------
// Called from within the tile-row loop so Y-sorting is correct.
// Each function draws at (px,py) = top-left of the tile in screen space.

function drawStockpileAt(sp, px, py) {
    const t=tileSize;

    // Bare dirt patch — tinted overlay rather than a solid rect, so the
    // tile underneath still reads through slightly.
    ctx.fillStyle='rgba(80,55,28,0.55)';
    ctx.fillRect(px, py+t*0.1, t, t*0.85);

    if (sp.type==='organic') {
        // Log pile on left half.
        drawLogPileAt(px+t*0.04, py, t*0.48, t, sp.counts.log||0);
        // Grain sacks on right half.
        drawGrainSacksAt(px+t*0.54, py, t*0.42, t, sp.counts.grain||0);
    } else {
        // Ore pile full width.
        drawOrePileAt(px+t*0.05, py, t*0.9, t, sp.counts.ore||0);
    }
}

function drawLogPileAt(bx, py, availW, t, count) {
    if (count===0) return;
    const rows=Math.min(7,Math.max(1,Math.ceil(count/2)));
    const logW=availW, logH=Math.max(2,t*0.11);
    const gap=Math.max(0,t*0.015);
    for (let r=0;r<rows;r++) {
        const y=py+t*0.82-r*(logH+gap);
        const rw=logW*(1-r*0.07);
        // Drop shadow.
        ctx.fillStyle='rgba(0,0,0,0.28)';
        ctx.fillRect(bx+1,y+logH,rw-2,Math.max(1,logH*0.28));
        // Log body (two-tone horizontal band).
        ctx.fillStyle=STOCKPILE_PALETTE.logA;
        ctx.fillRect(bx,y,rw,logH);
        ctx.fillStyle=STOCKPILE_PALETTE.logB;
        ctx.fillRect(bx,y,rw,Math.max(1,logH*0.32));
        // End-grain ovals.
        const er=Math.max(1,logH*0.42);
        ctx.fillStyle=STOCKPILE_PALETTE.logEnd;
        ctx.beginPath(); ctx.ellipse(bx+er,y+logH/2,er*0.65,er,0,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(bx+rw-er,y+logH/2,er*0.65,er,0,0,Math.PI*2); ctx.fill();
    }
}

function drawOrePileAt(bx, py, availW, t, count) {
    if (count===0) return;
    const scale=Math.min(1.8,0.4+count*0.1);
    const pileW=availW*scale, pileH=t*0.28*scale;
    const by=py+t*0.78;
    // Ground shadow.
    ctx.fillStyle='rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(bx+pileW/2,by+pileH*0.12,pileW*0.5,pileH*0.25,0,0,Math.PI*2);
    ctx.fill();
    const lumps=Math.min(14,4+Math.floor(count*0.35));
    for (let i=0;i<lumps;i++) {
        const lx=bx+(i/lumps)*pileW*0.88+pileW*0.06;
        const ly=by-pileH*(0.28+Math.sin(i*2.1)*0.22);
        const lw=Math.max(2,pileW*(0.16+Math.sin(i*1.6)*0.05));
        const lh=Math.max(2,lw*0.68);
        ctx.fillStyle=(i%3===0)?STOCKPILE_PALETTE.oreB:STOCKPILE_PALETTE.oreA;
        ctx.fillRect(lx,ly,lw,lh);
        if (i%4===0) {
            ctx.fillStyle=STOCKPILE_PALETTE.oreShine;
            ctx.fillRect(lx+lw*0.6,ly+lh*0.1,Math.max(1,lw*0.22),Math.max(1,lh*0.22));
        }
    }
}

function drawGrainSacksAt(bx, py, availW, t, count) {
    if (count===0) return;
    const sacks=Math.min(6,count);
    const sw=Math.min(availW*0.88, Math.max(3,t*0.36));
    const sh=Math.max(3,t*0.20);
    for (let i=0;i<sacks;i++) {
        const col=i%2, row=Math.floor(i/2);
        const sx=bx+col*(sw*0.52);
        const sy=py+t*0.80-row*(sh+1);
        ctx.fillStyle=STOCKPILE_PALETTE.grainSack; ctx.fillRect(sx,sy,sw,sh);
        ctx.fillStyle=STOCKPILE_PALETTE.grainSackDark;
        ctx.fillRect(sx,sy,sw,Math.max(1,sh*0.2));
        ctx.fillRect(sx,sy+sh-Math.max(1,sh*0.14),sw,Math.max(1,sh*0.14));
        ctx.fillStyle=STOCKPILE_PALETTE.grainStitch;
        ctx.fillRect(sx+sw*0.38,sy+sh*0.22,Math.max(1,sw*0.25),Math.max(1,sh*0.56));
    }
}

// ---------- Boats ------------------------------------------
function drawBoat(b) {
    const px=offsetX+b.x*tileSize, py=offsetY+b.y*tileSize;
    const t=tileSize, bob=Math.sin(b.phase)*t*0.05;
    const cx=px, cy=py+t*0.52+bob;
    const heading=b.heading, movingRight=Math.cos(heading)>=0;

    // Wake.
    const wakeAng=heading+Math.PI;
    const w1x=cx+Math.cos(wakeAng)*t*0.5, w1y=cy+Math.sin(wakeAng)*t*0.28+t*0.04;
    ctx.fillStyle=BOAT_PALETTE.wake;
    ctx.beginPath(); ctx.ellipse(w1x,w1y,t*0.52,t*0.13,wakeAng,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=BOAT_PALETTE.wakeEdge;
    ctx.beginPath();
    ctx.ellipse(w1x-Math.cos(wakeAng)*t*0.28,w1y-Math.sin(wakeAng)*t*0.28,
                t*0.76,t*0.10,wakeAng,0,Math.PI*2); ctx.fill();

    // Hull polygon.
    const hW=t*0.70, hH=Math.max(3,t*0.19), hx=cx-hW/2, hy=cy-hH;
    ctx.fillStyle=BOAT_PALETTE.hull;
    ctx.beginPath();
    ctx.moveTo(hx,          cy);
    ctx.lineTo(hx+hW,       cy);
    ctx.lineTo(hx+hW-hH*0.45, hy);
    ctx.lineTo(hx+hH*0.45,    hy);
    ctx.closePath(); ctx.fill();

    // Gunwale stripe.
    ctx.fillStyle=BOAT_PALETTE.hullDark;
    ctx.beginPath();
    ctx.moveTo(hx+hH*0.45,      hy);
    ctx.lineTo(hx+hW-hH*0.45,   hy);
    ctx.lineTo(hx+hW-hH*0.45,   hy+hH*0.36);
    ctx.lineTo(hx+hH*0.45,      hy+hH*0.36);
    ctx.closePath(); ctx.fill();

    // Keel rib.
    ctx.fillStyle=BOAT_PALETTE.hullRib;
    ctx.fillRect(cx-Math.max(1,t*0.035),hy+hH*0.36,Math.max(1,t*0.065),hH*0.64);

    // Mast.
    const mastH=t*0.82, mastW=Math.max(1,t*0.06), mastTop=hy-mastH;
    ctx.fillStyle=BOAT_PALETTE.mast; ctx.fillRect(cx-mastW/2,mastTop,mastW,mastH);

    // Sail — bezier belly.
    const sailH=mastH*0.76, sailMaxW=t*0.50;
    const sailSide=movingRight?1:-1;
    const stX=cx, stY=mastTop+mastH*0.04;
    const sbX=cx, sbY=stY+sailH;
    const cpX=cx+sailSide*sailMaxW, cpY=(stY+sbY)/2;
    ctx.fillStyle=b.sailColor;
    ctx.beginPath(); ctx.moveTo(stX,stY); ctx.quadraticCurveTo(cpX,cpY,sbX,sbY);
    ctx.lineTo(stX,stY); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,0.13)';
    ctx.beginPath(); ctx.moveTo(stX,stY);
    ctx.quadraticCurveTo(cpX*0.65+stX*0.35,cpY,sbX,sbY);
    ctx.lineTo(stX,stY); ctx.closePath(); ctx.fill();
}

// ---------- Build stockpile row lookup ---------------------
// Returns a Map: rowIndex → [stockpile, ...] for fast per-row lookup.
function buildStockpileRowMap() {
    const m = new Map();
    for (const sp of getStockpiles()) {
        const row = sp.y;
        if (!m.has(row)) m.set(row, []);
        m.get(row).push(sp);
    }
    return m;
}

// ---------- Single tile ------------------------------------
function drawTile(x, y) {
    const tile=getMap()[y][x];
    const px=offsetX+x*tileSize, py=offsetY+y*tileSize;
    const drawY=py-tile.z*CONFIG.Z_MULT;

    // 1. Z-extrusion.
    const southZ=(y+1<CONFIG.GRID_ROWS)?getMap()[y+1][x].z:PALETTE.water.z;
    const drop=tile.z-southZ;
    if (drop>0) {
        for (let layer=0;layer<drop;layer++) {
            const curZ=tile.z-layer;
            ctx.fillStyle=strataColour(tile.type,curZ);
            ctx.fillRect(px,drawY+tileSize+layer*CONFIG.Z_MULT,tileSize+0.5,CONFIG.Z_MULT+0.5);
            if (curZ<0) {
                ctx.fillStyle=`rgba(0,0,0,${Math.min(0.85,-curZ*0.25)})`;
                ctx.fillRect(px,drawY+tileSize+layer*CONFIG.Z_MULT,tileSize+0.5,CONFIG.Z_MULT+0.5);
            }
            if (tile.feature==='waterfall') {
                let f=((tick*0.08)-layer*0.15)%1; if(f<0)f+=1;
                ctx.fillStyle='rgba(56,139,186,0.85)';
                ctx.fillRect(px,drawY+tileSize+layer*CONFIG.Z_MULT,tileSize+0.5,CONFIG.Z_MULT+0.5);
                ctx.fillStyle=`rgba(200,230,255,${0.15+f*0.45})`;
                ctx.fillRect(px+tileSize*0.25,drawY+tileSize+layer*CONFIG.Z_MULT,tileSize*0.5,CONFIG.Z_MULT+0.5);
            }
        }
        ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(px,drawY+tileSize,tileSize,1);
    }

    // 2. Top face.
    let topColor=PALETTE[tile.type]?PALETTE[tile.type].top:'#888';
    if (tile.type.includes('stone')&&tile.type!=='sandstone') {
        const wobble=fbm(x*0.05,y*0.05,1)*5, s=fbm(0,(y+wobble)*0.1,2);
        topColor=tile.type==='stone_high'?(s>0.5?'#a0a0a0':s>0.3?'#888888':'#707070')
                                         :(s>0.5?'#8a8a8a':s>0.3?'#737373':'#5a5a5a');
    }
    ctx.fillStyle=topColor; ctx.fillRect(px,drawY,tileSize+0.5,tileSize+0.5);

    // 3. Shadows.
    ctx.fillStyle='rgba(0,0,0,0.35)';
    const sw=Math.max(1,Math.floor(tileSize*0.4));
    if(tile.shadow.w) ctx.fillRect(px,             drawY,              sw,           tileSize+0.5);
    if(tile.shadow.e) ctx.fillRect(px+tileSize-sw, drawY,              sw,           tileSize+0.5);
    if(tile.shadow.n) ctx.fillRect(px,             drawY,              tileSize+0.5, sw);
    if(tile.shadow.s) ctx.fillRect(px,             drawY+tileSize-sw,  tileSize+0.5, sw);

    // 4. Decorations.
    if (tile.type==='water') {
        const flow=Math.sin(x*0.2+y*0.1+tick*0.05);
        if (flow>0.5&&tile.seed>0.3) {
            ctx.fillStyle='rgba(255,255,255,0.15)';
            ctx.fillRect(px+tileSize*0.3,drawY+tileSize*0.4,Math.max(1,tileSize*0.4),2);
        }
        if (tile.seed>0.9) {
            const sparkle=(Math.sin(tick*0.1+tile.seed*50)+1)/2;
            ctx.fillStyle=`rgba(255,255,255,${sparkle*0.5})`;
            ctx.fillRect(px+tileSize*0.6,drawY+tileSize*0.2,2,2);
        }
        if (tile.feature==='waterfall') {
            ctx.fillStyle='rgba(255,255,255,0.6)';
            ctx.fillRect(px+tileSize*0.2,drawY+tileSize*0.6,tileSize*0.6,tileSize*0.4);
        }
    } else if (tile.type==='farm') {
        drawFarm(px,py,drawY,tile.seed,tile.growthTick);
    } else if (tile.type==='bridge') {
        drawBridge(px,py,drawY,x,y);
    } else if (tile.type.includes('grass')&&tile.seed>0.85&&!tile.feature) {
        const dark=hash(x+1,y)>0.5;
        ctx.fillStyle=dark?(tile.type==='grass_dark'?'#2a5a1a':'#4a8c3a')
                          :(tile.type==='grass_dark'?'#4a8c3a':'#6bcf5a');
        const tw=Math.max(1,Math.floor(tileSize*0.15)), th=Math.max(2,Math.floor(tileSize*0.25));
        const ox=Math.floor(tileSize*0.2+tile.seed*tileSize*0.3);
        const oy=Math.floor(tileSize*0.2+hash(y,x)*tileSize*0.3);
        ctx.fillRect(px+ox,drawY+oy,tw,th*2); ctx.fillRect(px+ox+tw,drawY+oy+th,tw,th);
    }

    // 5. Tree / sapling.
    if (tile.feature==='tree')    drawTree(px,drawY,tile.seed);
    if (tile.feature==='sapling') drawSapling(px,drawY,tile.saplingTick);
}

// ---------- Dupe row grouping ------------------------------
function groupDupesByRow() {
    const b=Array.from({length:CONFIG.GRID_ROWS},()=>[]);
    for (const d of getDupes()) b[Math.max(0,Math.min(CONFIG.GRID_ROWS-1,Math.floor(d.y)))].push(d);
    return b;
}

function drawDupesInRow(rowBucket) {
    for (const d of rowBucket) {
        const gx=Math.floor(d.x),gy=Math.floor(d.y);
        const tH=tileAt(gx,gy), tS=tileAt(gx,gy+1);
        const zH=tH?tH.z:0, zS=tS?tS.z:zH;
        const z=zH+(zS-zH)*(d.y-gy);
        drawDupe(ctx, d, offsetX+d.x*tileSize, offsetY+d.y*tileSize-z*CONFIG.Z_MULT,
                 Math.max(0.6,tileSize/6));
    }
}

// ---------- Main render ------------------------------------
function render() {
    ctx.fillStyle='#0b0e14';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    const dupeBuckets=groupDupesByRow();
    const stockpileRows=buildStockpileRowMap();

    for (let y=0;y<CONFIG.GRID_ROWS;y++) {
        for (let x=0;x<CONFIG.GRID_COLS;x++) drawTile(x,y);

        // Draw stockpiles whose anchor row is y — they sort correctly with dupes.
        if (stockpileRows.has(y)) {
            for (const sp of stockpileRows.get(y)) {
                const tile=tileAt(sp.x,sp.y);
                if (!tile) continue;
                drawStockpileAt(sp,
                    offsetX+sp.x*tileSize,
                    offsetY+sp.y*tileSize-tile.z*CONFIG.Z_MULT);
            }
        }

        drawDupesInRow(dupeBuckets[y]);
    }

    // Boats drawn last — they float on water above everything.
    for (const b of getBoats()) drawBoat(b);
}
