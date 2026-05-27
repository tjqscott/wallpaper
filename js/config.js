/* ============================================================
 * config.js
 * All tunable constants live here. No logic. Just data.
 * Anything you might want to tweak should be in this file.
 * ============================================================ */

const CONFIG = {
    // World grid. Sized to fit a 16:9 viewport without scrolling.
    GRID_COLS: 130,
    GRID_ROWS: 75,

    // Vertical pixel multiplier per Z-level. Higher = more dramatic cliffs.
    Z_MULT: 3,

    // How many dupes spawn each day. Spec target is 15-25 thriving;
    // start lower for performance + visual clarity while we iterate.
    DUPE_COUNT: 12,

    // Tree density gates. fbm(0.1) gives a slow-varying value that picks
    // out forest *regions*; the seed gate then thins within those regions
    // so they look organic rather than carpet-bombed.
    TREE_DENSITY_THRESHOLD: 0.48,
    TREE_SEED_GATE: 0.55,

    // Minimum tiles between any tree and any stone/ravine tile.
    TREE_ROCK_CLEARANCE: 2,

    // River count range (inclusive low, exclusive high).
    RIVER_COUNT_MIN: 1,
    RIVER_COUNT_MAX: 3,

    // Ravine count range.
    RAVINE_COUNT_MIN: 1,
    RAVINE_COUNT_MAX: 3,
};

// Tile palette. `z` is the canonical elevation for that tile type.
// `top` = top face colour, `front` = cliff-face colour when extruded.
const PALETTE = {
    water:        { top: '#388bba', front: '#226187', z:  0 },
    sand:         { top: '#d4b870', front: '#a88c4b', z:  1 },
    sandstone:    { top: '#c4aa6c', front: '#a08850', z:  1 },
    grass:        { top: '#5aac4a', front: '#3a7a2a', z:  2 },
    grass_dark:   { top: '#4a8c3a', front: '#2a5a1a', z:  3 },
    stone:        { top: '#8a8a8a', front: '#5a5a5a', z:  5 },
    stone_high:   { top: '#a0a0a0', front: '#707070', z:  7 },
    ravine_edge:  { top: '#4a3a2a', front: '#3a2a1a', z: -1 },
    ravine_stone: { top: '#303030', front: '#202020', z: -2 },
    ravine_void:  { top: '#080808', front: '#050505', z: -3 },
};

// Tree palette (Gemini 2 style — slim trunk, three-tier canopy).
const TREE_PALETTE = {
    shadow: 'rgba(0,0,0,0.3)',
    trunkDark:  '#3a2818',
    trunkLight: '#5a3828',
    leafDark:   '#1e4013',
    leafMid:    '#2a5a1a',
    leafLight:  '#3a7a2a',
    leafHighlight: '#4acc4a',
};

// Dupe palettes — small variety so each dupe is recognisable.
// Mirrors Claude Factory but trimmed to the bits we actually use.
const DUPE_PALETTE = {
    skinTones: ['#f5c5a0', '#c8a07a', '#e8b090', '#d4955a'],
    clothes:   ['#3a70a0', '#7a3a70', '#3a7a40', '#7a6a20', '#7a3030'],
    legs: '#222',
    shadow: 'rgba(0,0,0,0.3)',
    eye: '#111',
    nameTagBg: 'rgba(0,0,0,0.7)',
    nameTagFg: '#cfd8dc',
};

// Dupe names — short, characterful, recycled if more dupes than names.
const DUPE_NAMES = [
    'Abel', 'Frankie', 'Nikola', 'Marie', 'Ada', 'Turing',
    'Grace', 'Emmy', 'Liang', 'Otis', 'Ren', 'Iris',
    'Bart', 'Cleo', 'Yusuf', 'Mara',
];

// A tile is "walkable" for a dupe iff its type is in this set.
// Water, ravines, and high stone are off-limits — they stay grounded.
const WALKABLE_TYPES = new Set([
    'sand', 'sandstone', 'grass', 'grass_dark', 'stone',
]);
