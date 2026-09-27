/* ============================================================
 * render.js — all drawing.
 *
 * New: Day/night cycle overlay, campfires with warm point-light
 * glow, improved ravine depth (per-layer gradient from edge colour
 * to near-black, wider stripes for deeper zones).
 *
 * Centring: offsetX/Y are computed so that the land centroid
 * (landCX,landCY from jobs.js) maps to the canvas centre.
 * ============================================================ */

let canvas, ctx;
let tileSize=1, offsetX=0, offsetY=0, tick=0;

function initRender(canvasEl) { canvas=canvasEl; ctx=canvas.getContext('2d'); }

function resize() {
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    tileSize=Math.max(1,Math.floor(Math.min(canvas.width/CONFIG.GRID_COLS,
                                             canvas.height/CONFIG.GRID_ROWS)));
    // Centre the land centroid on screen, then clamp so grid stays visible.
    const gridW=CONFIG.GRID_COLS*tileSize, gridH=CONFIG.GRID_ROWS*tileSize;
    const idealOX=Math.round(canvas.width/2  - landCX*tileSize);
    const idealOY=Math.round(canvas.height/2 - landCY*tileSize);
    // Clamp: don't let the grid fall off screen edges more than necessary.
    offsetX=Math.max(Math.min(idealOX, 0), canvas.width-gridW);
    offsetY=Math.max(Math.min(idealOY, 0), canvas.height-gridH);
}

// ---- Ravine depth colour -----------------------------------
// Returns a colour that darkens progressively with depth-layer.
// layer 0 = just below the rim, larger = deeper.
// baseType is the tile that's dropping (ravine_edge / ravine_stone / ravine_void).
function ravineLayerColour(baseType, layer) {
    // Rim colours by type.
    const rimR = baseType==='ravine_void'?8 : baseType==='ravine_stone'?30 : 74;
    const rimG = baseType==='ravine_void'?8 : baseType==='ravine_stone'?30 : 58;
    const rimB = baseType==='ravine_void'?8 : baseType==='ravine_stone'?20 : 42;
    // Fade to near-black with depth.
    const t=Math.min(1, layer/14);
    const r=Math.round(rimR*(1-t)+3*t);
    const g=Math.round(rimG*(1-t)+3*t);
    const b=Math.round(rimB*(1-t)+3*t);
    return `rgb(${r},${g},${b})`;
}

function strataColour(baseType, z) {
    // Standard above-ground cliff faces.
    if (z>=1) {
        if (baseType==='sandstone') return PALETTE.sandstone.front;
        if (baseType.includes('stone')) return PALETTE.stone.front;
        if (baseType==='dock')  return PALETTE.dock.front;
        if (baseType==='house') return HOUSE_PALETTE.wallFront;
        if (z===2) return PALETTE.grass.front;
        return PALETTE[baseType]?PALETTE[baseType].front:'#5a4a3a';
    }
    // Below ground: fixed deep colours.
    if (z===-1) return '#2a1a0a';
    if (z===-2) return '#141008';
    return '#060404';
}

// ---------- Tree --------------------------------------------
function drawTree(px, py, seed) {
    const t=tileSize, cx=px+t/2;
    const sizeBonus=(seed*0.35)*t, groundY=py+0.55*t;
    ctx.fillStyle=TREE_PALETTE.shadow;
    ctx.fillRect(cx-0.45*t,groundY,0.9*t,0.25*t);
    const trunkW=Math.max(2,0.22*t),trunkH=0.85*t+sizeBonus,trunkTop=groundY-trunkH;
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

function drawSapling(px,py,saplingTick) {
    const t=tileSize,cx=px+t/2;
    const grow=Math.min(1,(saplingTick||0)/CONFIG.TREE_GROW_TICKS);
    const scale=0.25+grow*0.75,groundY=py+0.7*t;
    const trunkH=t*0.5*scale,trunkW=Math.max(1,t*0.12*scale),trunkTop=groundY-trunkH;
    ctx.fillStyle=TREE_PALETTE.saplingTrunk; ctx.fillRect(cx-trunkW/2,trunkTop,trunkW,trunkH);
    const lw1=t*0.9*scale,lh1=t*0.4*scale;
    ctx.fillStyle=TREE_PALETTE.saplingLeaf; ctx.fillRect(cx-lw1/2,trunkTop-lh1,lw1,lh1);
    ctx.fillStyle=TREE_PALETTE.leafLight;
    ctx.fillRect(cx-lw1*0.35,trunkTop-lh1-lh1*0.6,lw1*0.7,lh1*0.75);
}

// ---------- Farm --------------------------------------------
function drawFarm(px,py,drawY,seed,growthTick) {
    const t=tileSize;
    const pct=Math.min(1,(growthTick||0)/CONFIG.CROP_GROW_TICKS);
    const rows=Math.max(2,Math.floor(t/3));
    ctx.fillStyle='#6a4a10';
    for (let r=0;r<rows;r++) ctx.fillRect(px+1,drawY+(r/rows)*t+1,t-2,Math.max(1,t*0.06));
    let cropCol,cropH;
    if (pct<0.3)      { cropCol='#4a8020'; cropH=t*0.08*pct/0.3; }
    else if (pct<0.7) { cropCol='#5ab030'; cropH=t*0.08+t*0.12*(pct-0.3)/0.4; }
    else              { cropCol='#d4b820'; cropH=t*0.22; }
    if (cropH>1) {
        const sc=Math.max(2,Math.floor(t/4));
        for (let i=0;i<sc;i++) {
            ctx.fillStyle=cropCol;
            ctx.fillRect(px+2+(i/sc)*(t-4)+(seed*3%2),drawY+t*0.7-cropH,Math.max(1,t*0.07),cropH);
        }
    }
}

// ---------- Bridge ------------------------------------------
function drawBridge(px,py,drawY,tx,ty) {
    const t=tileSize;
    const tile=tileAt(tx,ty);
    let isEW;
    if (tile&&tile.bridgeAxis) isEW=tile.bridgeAxis==='h';
    else {
        const wW=tileAt(tx-1,ty),wE=tileAt(tx+1,ty);
        isEW=!!((wW&&WALKABLE_TYPES.has(wW.type))&&(wE&&WALKABLE_TYPES.has(wE.type)));
    }
    const pc=Math.max(2,Math.floor(t/3.5));
    ctx.fillStyle=BOAT_PALETTE.hullDark;
    if (isEW) {
        for (let p=0;p<pc;p++) ctx.fillRect(px+(p/pc)*t+1,drawY+1,Math.max(1,t*0.16),t-2);
        ctx.fillStyle=BOAT_PALETTE.hull;
        ctx.fillRect(px+1,drawY+1,t-2,Math.max(1,t*0.1));
        ctx.fillRect(px+1,drawY+t-Math.max(1,t*0.1)-1,t-2,Math.max(1,t*0.1));
    } else {
        for (let p=0;p<pc;p++) ctx.fillRect(px+1,drawY+(p/pc)*t+1,t-2,Math.max(1,t*0.16));
        ctx.fillStyle=BOAT_PALETTE.hull;
        ctx.fillRect(px+1,drawY+1,Math.max(1,t*0.1),t-2);
        ctx.fillRect(px+t-Math.max(1,t*0.1)-1,drawY+1,Math.max(1,t*0.1),t-2);
    }
}

// ---------- Dock --------------------------------------------
function drawDock(px,py,drawY,tx,ty) {
    const t=tileSize;
    const tile=tileAt(tx,ty);
    const dir=tile&&tile.dockDir?tile.dockDir:{dx:0,dy:1};
    const isNS=Math.abs(dir.dy)>Math.abs(dir.dx);
    const pc=Math.max(2,Math.floor(t/2.5));
    ctx.fillStyle=BOAT_PALETTE.hullDark;
    if (isNS) {
        for (let p=0;p<pc;p++) ctx.fillRect(px+1,drawY+(p/pc)*t+1,t-2,Math.max(2,t*0.18));
    } else {
        for (let p=0;p<pc;p++) ctx.fillRect(px+(p/pc)*t+1,drawY+1,Math.max(2,t*0.18),t-2);
    }
    ctx.fillStyle=BOAT_PALETTE.hull;
    const pw=Math.max(1,t*0.08);
    if (isNS) {
        ctx.fillRect(px+1,drawY+1,pw,t-2); ctx.fillRect(px+t-pw-1,drawY+1,pw,t-2);
    } else {
        ctx.fillRect(px+1,drawY+1,t-2,pw); ctx.fillRect(px+1,drawY+t-pw-1,t-2,pw);
    }
}

// ---------- House -------------------------------------------
function houseFullyBuilt(ox,oy,w,h) {
    for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) {
        const nt=tileAt(ox+dx,oy+dy);
        if (!nt||nt.type!=='house') return false;
    }
    return true;
}

// Per-tile pass only draws the construction scaffold. Finished
// houses are drawn as one composite sprite in drawHouse().
function drawHouseTile(px,py,drawY,tx,ty) {
    const tile=tileAt(tx,ty); if (!tile) return;
    if (houseFullyBuilt(tile.houseOriginX,tile.houseOriginY,tile.houseW||3,tile.houseH||2)) return;
    const t=tileSize;
    ctx.fillStyle='rgba(160,120,60,0.5)'; ctx.fillRect(px,drawY,t,t);
    ctx.fillStyle='rgba(80,50,20,0.7)';
    ctx.fillRect(px,drawY,t,Math.max(1,t*0.08));
    ctx.fillRect(px,drawY+t-Math.max(1,t*0.08),t,Math.max(1,t*0.08));
    ctx.fillRect(px,drawY,Math.max(1,t*0.08),t);
    ctx.fillRect(px+t-Math.max(1,t*0.08),drawY,Math.max(1,t*0.08),t);
}

// Composite cottage sprite anchored at the house origin. Drawn when
// the row loop reaches the house's south row so Y-sorting holds.
function drawHouse(h) {
    if (!houseFullyBuilt(h.x,h.y,h.w,h.h)) return;
    const t=tileSize;
    const origin=tileAt(h.x,h.y);
    const z=(h.z!==undefined?h.z:(origin?origin.z:2));
    const px=offsetX+h.x*t, py=offsetY+h.y*t-z*CONFIG.Z_MULT;
    const W=h.w*t, H=h.h*t;
    const groundY=py+H;

    // Ground shadow.
    ctx.fillStyle='rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(px+W/2,groundY-t*0.06,W*0.56,t*0.26,0,0,Math.PI*2); ctx.fill();

    // Front wall (plaster + timber frame).
    const wallH=t*0.92, wallTopY=groundY-wallH;
    const wx0=px+t*0.06, wx1=px+W-t*0.06, wW=wx1-wx0;
    ctx.fillStyle=HOUSE_PALETTE.plaster; ctx.fillRect(wx0,wallTopY,wW,wallH);
    // Stone footing.
    ctx.fillStyle=HOUSE_PALETTE.wallStone;
    ctx.fillRect(wx0,groundY-Math.max(2,t*0.14),wW,Math.max(2,t*0.14));
    ctx.fillStyle='rgba(0,0,0,0.18)';
    ctx.fillRect(wx0,groundY-Math.max(2,t*0.14),wW,Math.max(1,t*0.04));
    // Timber: corner posts, eave beam, studs.
    const tb=Math.max(1,t*0.09);
    ctx.fillStyle=HOUSE_PALETTE.timber;
    ctx.fillRect(wx0,wallTopY,tb,wallH);
    ctx.fillRect(wx1-tb,wallTopY,tb,wallH);
    ctx.fillRect(wx0,wallTopY,wW,tb);
    ctx.fillRect(wx0+wW*0.33-tb/2,wallTopY,tb,wallH*0.55);
    ctx.fillRect(wx0+wW*0.67-tb/2,wallTopY,tb,wallH*0.55);

    // Door — centre of the front wall.
    const dw=Math.max(3,t*0.42), dh=Math.max(4,t*0.62);
    const dx0=px+W/2-dw/2, dy0=groundY-dh-t*0.02;
    ctx.fillStyle=HOUSE_PALETTE.doorFrame; ctx.fillRect(dx0-tb*0.6,dy0-tb*0.6,dw+tb*1.2,dh+tb*0.6);
    ctx.fillStyle=HOUSE_PALETTE.door; ctx.fillRect(dx0,dy0,dw,dh);
    ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(dx0+dw*0.15,dy0+dh*0.1,dw*0.28,dh*0.8);
    ctx.fillStyle=HOUSE_PALETTE.doorFrame;
    ctx.fillRect(dx0+dw*0.72,dy0+dh*0.45,Math.max(1,dw*0.12),Math.max(1,dh*0.12));

    // Windows — left and right of the door, warm-lit at night.
    const dark=nightDarkness();
    const ww=Math.max(3,t*0.4), wh=Math.max(3,t*0.34);
    for (const wxc of [px+W*0.19, px+W*0.81]) {
        const wx2=wxc-ww/2, wy2=wallTopY+wallH*0.3;
        ctx.fillStyle=HOUSE_PALETTE.wallWindowFr; ctx.fillRect(wx2-1,wy2-1,ww+2,wh+2);
        ctx.fillStyle=dark>0.3?HOUSE_PALETTE.windowGlow:HOUSE_PALETTE.wallWindow;
        ctx.fillRect(wx2,wy2,ww,wh);
        ctx.fillStyle=HOUSE_PALETTE.wallWindowFr;
        ctx.fillRect(wx2+ww/2-Math.max(1,t*0.025),wy2,Math.max(1,t*0.05),wh);
        ctx.fillRect(wx2,wy2+wh/2-Math.max(1,t*0.025),ww,Math.max(1,t*0.05));
        if (dark<=0.3) {
            ctx.fillStyle='rgba(200,230,255,0.3)';
            ctx.fillRect(wx2+1,wy2+1,Math.floor(ww*0.3),Math.floor(wh*0.3));
        }
    }

    // Gabled roof — back slope, ridge, front slope with shingles.
    const over=t*0.14;
    const rx0=px-over, rx1=px+W+over, rW=rx1-rx0;
    const roofTopY=py-t*0.22, ridgeY=py+t*0.34, eaveY=wallTopY+t*0.1;
    ctx.fillStyle=HOUSE_PALETTE.roofB; ctx.fillRect(rx0,roofTopY,rW,ridgeY-roofTopY);
    ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fillRect(rx0,roofTopY,rW,Math.max(1,t*0.06));
    ctx.fillStyle=HOUSE_PALETTE.roofA; ctx.fillRect(rx0,ridgeY,rW,eaveY-ridgeY);
    ctx.fillStyle=HOUSE_PALETTE.roofLight; ctx.fillRect(rx0,ridgeY+t*0.05,rW,Math.max(1,t*0.07));
    ctx.fillStyle='rgba(0,0,0,0.16)';
    const rows2=Math.max(2,Math.floor((eaveY-ridgeY)/(t*0.24)));
    for (let r=1;r<=rows2;r++)
        ctx.fillRect(rx0,ridgeY+r*(eaveY-ridgeY)/(rows2+0.3),rW,Math.max(1,t*0.05));
    // Ridge cap + eave shadow on the wall.
    ctx.fillStyle=HOUSE_PALETTE.roofRidge;
    ctx.fillRect(rx0-t*0.04,ridgeY-Math.max(1,t*0.07),rW+t*0.08,Math.max(2,t*0.12));
    ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(rx0,eaveY-Math.max(1,t*0.05),rW,Math.max(1,t*0.05));
    ctx.fillStyle='rgba(0,0,0,0.20)'; ctx.fillRect(wx0,eaveY,wW,Math.max(1,t*0.10));

    // Chimney on the back slope + smoke.
    const cw=Math.max(3,t*0.24), ch=Math.max(4,t*0.42);
    const cx2=px+W*0.72, cy2=roofTopY-ch*0.55;
    ctx.fillStyle=HOUSE_PALETTE.chimney; ctx.fillRect(cx2,cy2,cw,ch);
    ctx.fillStyle='rgba(0,0,0,0.2)'; ctx.fillRect(cx2+cw*0.6,cy2,cw*0.4,ch);
    ctx.fillStyle=HOUSE_PALETTE.chimneyTop; ctx.fillRect(cx2-1,cy2,cw+2,Math.max(1,ch*0.2));
    if (tick%80<40) {
        const sa=(Math.sin(tick*0.04+h.x)*0.3+0.4);
        ctx.fillStyle=HOUSE_PALETTE.smoke+sa+')';
        ctx.beginPath(); ctx.arc(cx2+cw/2,cy2-Math.max(2,t*0.15),Math.max(2,t*0.13),0,Math.PI*2); ctx.fill();
        ctx.fillStyle=HOUSE_PALETTE.smoke+(sa*0.6)+')';
        ctx.beginPath(); ctx.arc(cx2+cw/2+1,cy2-Math.max(2,t*0.30),Math.max(2,t*0.10),0,Math.PI*2); ctx.fill();
    }
}

// ================================================================
// STOCKPILE DRAWING
// ================================================================

function drawStockpileYardTile(sp,tileIdx,px,py) {
    const t=tileSize;
    ctx.fillStyle='rgba(60,40,15,0.45)'; ctx.fillRect(px,py,t,t);
    ctx.fillStyle='rgba(40,25,8,0.30)';
    ctx.fillRect(px+t*0.1,py+t*0.65,t*0.8,t*0.06);
    ctx.fillRect(px+t*0.2,py+t*0.78,t*0.55,t*0.04);
    if (sp.type==='organic') {
        if (tileIdx===0) drawLogPileEndOn(px,py,sp.counts.log||0);
        else             drawGrainSackPile(px,py,sp.counts.grain||0);
    } else {
        drawRockHeap(px,py,sp.counts.ore||0,tileIdx);
    }
}

// ---- Log pile (end-on circles) -----------------------------
function drawLogPileEndOn(px,py,count) {
    const t=tileSize;
    if (count===0) { ctx.fillStyle=STOCKPILE_PALETTE.logA; ctx.fillRect(px+t*0.2,py+t*0.84,t*0.6,Math.max(1,t*0.06)); return; }
    const rows=Math.min(4,Math.max(1,count<=2?1:count<=5?2:count<=9?3:4));
    const rowCounts=[rows,Math.max(0,rows-1),Math.max(0,rows-2),Math.max(0,rows-3)];
    const totalW=t*0.92;
    const r=Math.max(2,(totalW/(rowCounts[0]*2+0.2))*0.92);
    const diameter=r*2;
    const rowH=r*1.72;
    const baseY=py+t*0.88-r*0.4;

    ctx.fillStyle='rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(px+t*0.5,baseY+r*0.3,totalW*0.46,r*0.35,0,0,Math.PI*2); ctx.fill();

    for (let row=rows-1;row>=0;row--) {
        const n=rowCounts[row]; if (n<=0) continue;
        const rowW=n*diameter+(n-1)*r*0.08;
        const rowStartX=px+t*0.5-rowW/2+r;
        const cy=baseY-(row*rowH);
        const offsetX=row%2===0?0:r;
        for (let i=0;i<n;i++) {
            const cx=rowStartX+i*(diameter+r*0.08)+offsetX;
            ctx.fillStyle=STOCKPILE_PALETTE.logA;
            ctx.beginPath(); ctx.ellipse(cx,cy,r,r*0.82,0,0,Math.PI*2); ctx.fill();
            ctx.fillStyle=STOCKPILE_PALETTE.logEndDark;
            ctx.beginPath(); ctx.ellipse(cx,cy,r*0.78,r*0.64,0,0,Math.PI*2); ctx.fill();
            ctx.fillStyle=STOCKPILE_PALETTE.logEnd;
            ctx.beginPath(); ctx.ellipse(cx,cy,r*0.52,r*0.43,0,0,Math.PI*2); ctx.fill();
            ctx.fillStyle='rgba(255,220,160,0.55)';
            ctx.beginPath(); ctx.ellipse(cx-r*0.15,cy-r*0.15,r*0.22,r*0.18,0,0,Math.PI*2); ctx.fill();
            ctx.strokeStyle='rgba(80,40,10,0.35)'; ctx.lineWidth=Math.max(0.5,r*0.06);
            ctx.beginPath(); ctx.ellipse(cx,cy,r*0.65,r*0.53,0,0,Math.PI*2); ctx.stroke();
            ctx.beginPath(); ctx.ellipse(cx,cy,r*0.35,r*0.29,0,0,Math.PI*2); ctx.stroke();
            ctx.strokeStyle='rgba(30,15,5,0.4)'; ctx.lineWidth=Math.max(0.5,r*0.04);
            for (let a=0;a<Math.PI*2;a+=Math.PI/4) {
                ctx.beginPath();
                ctx.moveTo(cx+Math.cos(a)*r*0.79,cy+Math.sin(a)*r*0.65);
                ctx.lineTo(cx+Math.cos(a)*r*0.98,cy+Math.sin(a)*r*0.81);
                ctx.stroke();
            }
            ctx.lineWidth=1;
            if ((i+row)%3===0) {
                ctx.fillStyle='rgba(40,20,5,0.5)';
                ctx.beginPath(); ctx.ellipse(cx+r*0.28,cy-r*0.12,r*0.14,r*0.10,0.4,0,Math.PI*2); ctx.fill();
            }
        }
    }
}

function drawGrainSackPile(px,py,count) {
    const t=tileSize; if (count===0) return;
    const sacks=Math.min(9,Math.max(1,count));
    const cols=2,sw=t*0.46,sh=Math.max(4,t*0.24),gap=t*0.02;
    ctx.fillStyle='rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(px+t*0.5,py+t*0.92,t*0.38,t*0.07,0,0,Math.PI*2); ctx.fill();
    for (let i=sacks-1;i>=0;i--) {
        const col=i%cols,row=Math.floor(i/cols);
        const sx=px+t*0.04+col*(sw+gap),sy=py+t*0.88-(row+1)*(sh+gap);
        ctx.fillStyle=STOCKPILE_PALETTE.grainSack; ctx.fillRect(sx,sy,sw,sh);
        ctx.fillStyle=STOCKPILE_PALETTE.grainSackDark;
        ctx.fillRect(sx,sy,sw,Math.max(1,sh*0.18));
        ctx.fillRect(sx,sy+sh-Math.max(1,sh*0.15),sw,Math.max(1,sh*0.15));
        ctx.fillStyle=STOCKPILE_PALETTE.grainStitch;
        ctx.fillRect(sx+sw*0.35,sy+sh*0.13,sw*0.3,Math.max(1,sh*0.07));
    }
}

function drawRockHeap(px,py,count,tileIdx) {
    const t=tileSize;
    if (count===0&&tileIdx===0) {
        for (let i=0;i<4;i++) { ctx.fillStyle=STOCKPILE_PALETTE.oreA; ctx.fillRect(px+t*(0.15+i*0.18),py+t*0.85,Math.max(2,t*0.08),Math.max(2,t*0.08)); }
        return;
    }
    const scale=tileIdx===0?Math.min(2.2,0.5+(count||0)*0.08):Math.min(1.0,0.3+(count||0)*0.04);
    const heapW=t*scale,heapH=t*0.55*scale,cx=px+t*0.5,baseY=py+t*0.88;
    ctx.fillStyle='rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.ellipse(cx,baseY+heapH*0.08,heapW*0.52,heapH*0.22,0,0,Math.PI*2); ctx.fill();
    const lumpCount=Math.min(22,Math.max(5,Math.floor(8+scale*7)));
    const lumps=[];
    for (let i=0;i<lumpCount;i++) {
        const hx=hash(px*7+i,py*13+tileIdx*37),hy=hash(py*11+i*3,px*19+tileIdx*53),hs=hash(i*17,tileIdx*29);
        const lx=cx-heapW*0.42+hx*heapW*0.84;
        const ly=baseY-(1-(hy*0.7+0.15))*heapH;
        const lw=Math.max(3,heapW*(0.12+hs*0.12));
        const lh=Math.max(3,lw*(0.55+hash(i,tileIdx)*0.35));
        lumps.push({lx,ly,lw,lh,hs,i});
    }
    lumps.sort((a,b)=>a.ly-b.ly);
    for (const {lx,ly,lw,lh,hs,i} of lumps) {
        if (ly<py-t*1.4) continue;
        ctx.fillStyle=(i%4===0)?STOCKPILE_PALETTE.oreB:STOCKPILE_PALETTE.oreA;
        const jx=(hs-0.5)*lw*0.2;
        ctx.fillRect(lx+jx,ly,lw,lh);
        ctx.fillStyle='rgba(0,0,0,0.30)'; ctx.fillRect(lx+jx,ly+lh*0.65,lw,Math.max(1,lh*0.35));
        if (i%4===0) { ctx.fillStyle=STOCKPILE_PALETTE.oreShine; ctx.fillRect(lx+jx+lw*0.55,ly+lh*0.08,Math.max(1,lw*0.28),Math.max(1,lh*0.25)); }
    }
}

function buildStockpileRowMap() {
    const m=new Map();
    for (const sp of getStockpiles()) {
        sp.tiles.forEach((tt,idx)=>{
            if (!m.has(tt.y)) m.set(tt.y,[]);
            m.get(tt.y).push({sp,tileIdx:idx,x:tt.x,y:tt.y});
        });
    }
    return m;
}

// ---------- Boats -------------------------------------------
function drawBoat(b) {
    const px=offsetX+b.x*tileSize,py=offsetY+b.y*tileSize;
    const t=tileSize,bob=Math.sin(b.phase)*t*0.05;
    const cx=px,cy=py+t*0.52+bob;
    const heading=b.heading,movingRight=Math.cos(heading)>=0;
    const wakeAng=heading+Math.PI;
    const w1x=cx+Math.cos(wakeAng)*t*0.5,w1y=cy+Math.sin(wakeAng)*t*0.28+t*0.04;
    ctx.fillStyle=BOAT_PALETTE.wake;
    ctx.beginPath(); ctx.ellipse(w1x,w1y,t*0.52,t*0.13,wakeAng,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=BOAT_PALETTE.wakeEdge;
    ctx.beginPath(); ctx.ellipse(w1x-Math.cos(wakeAng)*t*0.28,w1y-Math.sin(wakeAng)*t*0.28,t*0.76,t*0.10,wakeAng,0,Math.PI*2); ctx.fill();
    const hW=t*0.70,hH=Math.max(3,t*0.19),hx=cx-hW/2,hy=cy-hH;
    ctx.fillStyle=BOAT_PALETTE.hull;
    ctx.beginPath(); ctx.moveTo(hx,cy); ctx.lineTo(hx+hW,cy); ctx.lineTo(hx+hW-hH*0.45,hy); ctx.lineTo(hx+hH*0.45,hy); ctx.closePath(); ctx.fill();
    ctx.fillStyle=BOAT_PALETTE.hullDark;
    ctx.beginPath(); ctx.moveTo(hx+hH*0.45,hy); ctx.lineTo(hx+hW-hH*0.45,hy); ctx.lineTo(hx+hW-hH*0.45,hy+hH*0.36); ctx.lineTo(hx+hH*0.45,hy+hH*0.36); ctx.closePath(); ctx.fill();
    ctx.fillStyle=BOAT_PALETTE.hullRib;
    ctx.fillRect(cx-Math.max(1,t*0.035),hy+hH*0.36,Math.max(1,t*0.065),hH*0.64);
    const mastH=t*0.82,mastW=Math.max(1,t*0.06),mastTop=hy-mastH;
    ctx.fillStyle=BOAT_PALETTE.mast; ctx.fillRect(cx-mastW/2,mastTop,mastW,mastH);
    const sailH=mastH*0.76,sailMaxW=t*0.50,sailSide=movingRight?1:-1;
    const stX=cx,stY=mastTop+mastH*0.04,sbX=cx,sbY=stY+sailH;
    const cpX=cx+sailSide*sailMaxW,cpY=(stY+sbY)/2;
    ctx.fillStyle=b.sailColor;
    ctx.beginPath(); ctx.moveTo(stX,stY); ctx.quadraticCurveTo(cpX,cpY,sbX,sbY); ctx.lineTo(stX,stY); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,0.13)';
    ctx.beginPath(); ctx.moveTo(stX,stY); ctx.quadraticCurveTo(cpX*0.65+stX*0.35,cpY,sbX,sbY); ctx.lineTo(stX,stY); ctx.closePath(); ctx.fill();
}

// ---------- Campfire ----------------------------------------
function drawCampfire(cf) {
    const px=offsetX+cf.x*tileSize, py=offsetY+cf.y*tileSize;
    const tile=tileAt(cf.x,cf.y); if (!tile) return;
    const drawY=py-tile.z*CONFIG.Z_MULT;
    const t=tileSize, cx=px+t/2, cy=drawY+t*0.68;
    cf.phase=(cf.phase||0)+0.08;

    // Logs cross on ground.
    ctx.fillStyle='#5a3010';
    ctx.fillRect(cx-t*0.28,cy-t*0.07,t*0.56,Math.max(2,t*0.09));
    ctx.fillRect(cx-t*0.07,cy-t*0.25,Math.max(2,t*0.09),t*0.5);

    // Flame layers (flicker).
    const flicker=Math.sin(cf.phase)*0.15+0.85;
    const fh=Math.max(3,t*0.45*flicker);
    const fw=Math.max(2,t*0.22);
    ctx.fillStyle=`rgba(255,80,20,0.9)`;
    ctx.beginPath(); ctx.ellipse(cx,cy-fh*0.3,fw*0.7,fh*0.55,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=`rgba(255,180,30,0.85)`;
    ctx.beginPath(); ctx.ellipse(cx+Math.sin(cf.phase*1.3)*fw*0.2,cy-fh*0.55,fw*0.45,fh*0.42,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=`rgba(255,240,120,0.9)`;
    ctx.beginPath(); ctx.ellipse(cx,cy-fh*0.7,fw*0.25,fh*0.28,0,0,Math.PI*2); ctx.fill();

    // Ground glow disc (drawn before fire in the main loop — but drawn here too for self-glow).
    ctx.fillStyle=`rgba(255,120,20,0.12)`;
    ctx.beginPath(); ctx.ellipse(cx,cy+t*0.05,t*0.8,t*0.25,0,0,Math.PI*2); ctx.fill();
}

// ---------- Day/night overlay + campfire point lights --------
// Darkness: 0 at noon, 1 at midnight. Shared by overlay and sprites.
function nightDarkness() {
    const phase=getDayPhase(); // 0=dawn, 0.25=noon, 0.5=midnight, 0.75=pre-dawn
    return Math.pow(Math.max(0, Math.cos((phase-0.25)*Math.PI*2)*-0.5+0.5), 1.4);
}

function drawNightOverlay() {
    const darkness=nightDarkness();
    if (darkness<0.02) return; // fully day — skip

    // Base night overlay.
    const nightAlpha=darkness*0.72;
    const nightR=Math.round(5+darkness*10),nightG=Math.round(8+darkness*15),nightB=Math.round(25+darkness*40);
    ctx.fillStyle=`rgba(${nightR},${nightG},${nightB},${nightAlpha})`;
    ctx.fillRect(0,0,canvas.width,canvas.height);

    if (darkness<0.1) return; // no point lights needed in near-daylight

    // Campfire warm point lights (punched out of the darkness).
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const fires=getCampfires();
    // Also light from house chimneys at night.
    const allLights=[...fires];
    for (const h of getHouses()) {
        allLights.push({x:h.x+1,y:h.y,phase:(tick*0.05)});
    }

    for (const cf of allLights) {
        const px=offsetX+cf.x*tileSize,py=offsetY+cf.y*tileSize;
        const tile=tileAt(cf.x,cf.y); if (!tile) continue;
        const drawY=py-tile.z*CONFIG.Z_MULT;
        const cx2=px+tileSize/2, cy2=drawY+tileSize*0.6;
        const radius=tileSize*(3+darkness*5);
        const flicker=Math.sin((cf.phase||0)+tick*0.04)*0.15;
        const r2=radius*(0.85+flicker);
        const grad=ctx.createRadialGradient(cx2,cy2,0,cx2,cy2,r2);
        grad.addColorStop(0,`rgba(255,140,30,${0.18*darkness})`);
        grad.addColorStop(0.5,`rgba(220,80,10,${0.08*darkness})`);
        grad.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=grad;
        ctx.beginPath(); ctx.arc(cx2,cy2,r2,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
}

// ---------- Single tile ------------------------------------
function drawTile(x,y) {
    const tile=getMap()[y][x];
    const px=offsetX+x*tileSize,py=offsetY+y*tileSize;
    const drawY=py-tile.z*CONFIG.Z_MULT;

    // Z-extrusion — south cliff face.
    const southZ=(y+1<CONFIG.GRID_ROWS)?getMap()[y+1][x].z:PALETTE.water.z;
    const drop=tile.z-southZ;
    if (drop>0) {
        const isRavine=tile.type.startsWith('ravine_');
        for (let layer=0;layer<drop;layer++) {
            const curZ=tile.z-layer;
            let col;
            if (isRavine) {
                // Graduated ravine depth: each layer gets progressively darker.
                col=ravineLayerColour(tile.type,layer);
            } else {
                col=strataColour(tile.type,curZ);
            }
            ctx.fillStyle=col;
            ctx.fillRect(px,drawY+tileSize+layer*CONFIG.Z_MULT,tileSize+0.5,CONFIG.Z_MULT+0.5);

            // Extra darkening for deep ravine layers.
            if (isRavine && layer>3) {
                ctx.fillStyle=`rgba(0,0,0,${Math.min(0.7,(layer-3)*0.08)})`;
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

    // Top face. House plots get a flat foundation colour; the cottage
    // sprite is drawn over it at the house's south row.
    {
        let topColor=PALETTE[tile.type]?PALETTE[tile.type].top:'#888';
        if (tile.type==='house') topColor=HOUSE_PALETTE.foundation;
        else if (tile.type.includes('stone')&&tile.type!=='sandstone') {
            const wobble=fbm(x*0.05,y*0.05,1)*5,s=fbm(0,(y+wobble)*0.1,2);
            topColor=tile.type==='stone_high'?(s>0.5?'#a0a0a0':s>0.3?'#888888':'#707070'):(s>0.5?'#8a8a8a':s>0.3?'#737373':'#5a5a5a');
        }
        ctx.fillStyle=topColor; ctx.fillRect(px,drawY,tileSize+0.5,tileSize+0.5);
    }

    // Shadows.
    ctx.fillStyle='rgba(0,0,0,0.35)';
    const sw=Math.max(1,Math.floor(tileSize*0.4));
    if(tile.shadow.w) ctx.fillRect(px,drawY,sw,tileSize+0.5);
    if(tile.shadow.e) ctx.fillRect(px+tileSize-sw,drawY,sw,tileSize+0.5);
    if(tile.shadow.n) ctx.fillRect(px,drawY,tileSize+0.5,sw);
    if(tile.shadow.s) ctx.fillRect(px,drawY+tileSize-sw,tileSize+0.5,sw);

    // Tile decorations.
    if (tile.type==='water') {
        const flow=Math.sin(x*0.2+y*0.1+tick*0.05);
        if (flow>0.5&&tile.seed>0.3) { ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(px+tileSize*0.3,drawY+tileSize*0.4,Math.max(1,tileSize*0.4),2); }
        if (tile.seed>0.9) { const sp=(Math.sin(tick*0.1+tile.seed*50)+1)/2; ctx.fillStyle=`rgba(255,255,255,${sp*0.5})`; ctx.fillRect(px+tileSize*0.6,drawY+tileSize*0.2,2,2); }
        if (tile.feature==='waterfall') { ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillRect(px+tileSize*0.2,drawY+tileSize*0.6,tileSize*0.6,tileSize*0.4); }
    } else if (tile.type==='farm') {
        drawFarm(px,py,drawY,tile.seed,tile.growthTick);
    } else if (tile.type==='bridge') {
        drawBridge(px,py,drawY,x,y);
    } else if (tile.type==='dock') {
        drawDock(px,py,drawY,x,y);
    } else if (tile.type==='house') {
        drawHouseTile(px,py,drawY,x,y);
    } else if (tile.type.includes('grass')&&tile.seed>0.85&&!tile.feature) {
        const dark=hash(x+1,y)>0.5;
        ctx.fillStyle=dark?(tile.type==='grass_dark'?'#2a5a1a':'#4a8c3a'):(tile.type==='grass_dark'?'#4a8c3a':'#6bcf5a');
        const tw=Math.max(1,Math.floor(tileSize*0.15)),th=Math.max(2,Math.floor(tileSize*0.25));
        const ox=Math.floor(tileSize*0.2+tile.seed*tileSize*0.3),oy=Math.floor(tileSize*0.2+hash(y,x)*tileSize*0.3);
        ctx.fillRect(px+ox,drawY+oy,tw,th*2); ctx.fillRect(px+ox+tw,drawY+oy+th,tw,th);
    }
    if (tile.feature==='tree')    drawTree(px,drawY,tile.seed);
    if (tile.feature==='sapling') drawSapling(px,drawY,tile.saplingTick);
}

// ---------- Main render ------------------------------------
function groupDupesByRow() {
    const b=Array.from({length:CONFIG.GRID_ROWS},()=>[]);
    for (const d of getDupes()) b[Math.max(0,Math.min(CONFIG.GRID_ROWS-1,Math.floor(d.y)))].push(d);
    return b;
}
function drawDupesInRow(rowBucket) {
    for (const d of rowBucket) {
        const gx=Math.floor(d.x),gy=Math.floor(d.y);
        const tH=tileAt(gx,gy),tS=tileAt(gx,gy+1);
        const zH=tH?tH.z:0,zS=tS?tS.z:zH;
        const z=zH+(zS-zH)*(d.y-gy);
        drawDupe(ctx,d,offsetX+d.x*tileSize,offsetY+d.y*tileSize-z*CONFIG.Z_MULT,Math.max(0.6,tileSize/6));
    }
}

// Campfires sorted by row for Y-sort.
function buildCampfireRowMap() {
    const m=new Map();
    for (const cf of getCampfires()) {
        if (!m.has(cf.y)) m.set(cf.y,[]);
        m.get(cf.y).push(cf);
    }
    return m;
}

function render() {
    ctx.fillStyle='#0b0e14';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    const dupeBuckets=groupDupesByRow();
    const stockpileRows=buildStockpileRowMap();
    const campfireRows=buildCampfireRowMap();
    // Houses draw at their south row so dupes north of them are occluded.
    const houseRows=new Map();
    for (const h of getHouses()) {
        const row=h.y+h.h-1;
        if (!houseRows.has(row)) houseRows.set(row,[]);
        houseRows.get(row).push(h);
    }

    for (let y=0;y<CONFIG.GRID_ROWS;y++) {
        for (let x=0;x<CONFIG.GRID_COLS;x++) drawTile(x,y);

        if (houseRows.has(y)) for (const h of houseRows.get(y)) drawHouse(h);

        if (stockpileRows.has(y)) {
            for (const entry of stockpileRows.get(y)) {
                const tile=tileAt(entry.x,entry.y); if (!tile) continue;
                drawStockpileYardTile(entry.sp,entry.tileIdx,
                    offsetX+entry.x*tileSize,
                    offsetY+entry.y*tileSize-tile.z*CONFIG.Z_MULT);
            }
        }

        if (campfireRows.has(y)) {
            for (const cf of campfireRows.get(y)) drawCampfire(cf);
        }

        drawDupesInRow(dupeBuckets[y]);
    }

    for (const b of getBoats()) drawBoat(b);

    // Night overlay drawn last — on top of everything.
    drawNightOverlay();
}
