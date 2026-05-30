/* ============================================================
 * main.js — boot, loop.
 * resize() is called AFTER regenerate() so that offsetX/Y
 * are computed with the correct landCX/landCY from jobs.js.
 * ============================================================ */

let animFrameId = null;

function regenerate() {
    generateMap();
    spawnDupes();
    initJobs();
    resize();   // re-centre after landCX/CY are known
}

function animate() {
    tick++;
    updateJobs();
    updateDupes();
    render();
    animFrameId = requestAnimationFrame(animate);
}

function start() {
    initRender(document.getElementById('canvas'));
    resize();
    regenerate();
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animate();
}

window.addEventListener('resize', resize);
document.getElementById('btn-regen').addEventListener('click', regenerate);

start();
