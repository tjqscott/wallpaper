/* ============================================================
 * main.js
 * Boots the world and runs the loop.
 * ============================================================ */

let animFrameId = null;

function regenerate() {
    generateMap();
    spawnDupes();
    initJobs();   // clear old jobs/boats/resources, spawn first wave
}

function animate() {
    tick++;
    updateJobs();     // job queue, boats, resource decay
    updateDupes();    // dupe AI (picks jobs, walks, works)
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
