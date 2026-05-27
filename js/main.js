/* ============================================================
 * main.js
 * Boots the world and runs the loop. Everything else is in the
 * other files; this one just wires them together.
 * ============================================================ */

let animFrameId = null;

function regenerate() {
    generateMap();
    spawnDupes();
}

function animate() {
    tick++;
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
