/* ============================================================
 * noise.js
 * Deterministic hash + value noise + fractal Brownian motion.
 * Seeded by `seedOffset` (set when a new map is generated) so the
 * same seed produces the same world.
 * ============================================================ */

let seedOffset = 0;

function setSeed(s) {
    seedOffset = s;
}

function newRandomSeed() {
    seedOffset = Math.floor(Math.random() * 100000);
    return seedOffset;
}

// Integer hash → [0,1). Cheap, stable, no global state besides seedOffset.
function hash(x, y) {
    let h = Math.imul(x * 374761393 + y * 668265263 + seedOffset, 374761393);
    h = (h ^ (h >>> 13)) * 3266489917;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise (bilinear with smoothstep blend).
function smoothNoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const n00 = hash(ix, iy),     n10 = hash(ix + 1, iy);
    const n01 = hash(ix, iy + 1), n11 = hash(ix + 1, iy + 1);
    return n00 * (1 - ux) * (1 - uy)
         + n10 * ux       * (1 - uy)
         + n01 * (1 - ux) * uy
         + n11 * ux       * uy;
}

// Fractal Brownian motion. Layers smoothNoise at decreasing amplitude.
function fbm(x, y, octaves) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) {
        v += a * smoothNoise(x * f, y * f);
        f *= 2;
        a *= 0.5;
    }
    return v;
}
