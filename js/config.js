/* ============================================================
 * config.js — all tunable constants and palettes. No logic.
 * ============================================================ */

const CONFIG = {
    GRID_COLS: 130,
    GRID_ROWS: 75,
    Z_MULT: 3,
    DUPE_COUNT: 12,

    TREE_DENSITY_THRESHOLD: 0.48,
    TREE_SEED_GATE: 0.55,
    TREE_ROCK_CLEARANCE: 2,

    RIVER_COUNT_MIN: 1,
    RIVER_COUNT_MAX: 3,
    RAVINE_COUNT_MIN: 1,
    RAVINE_COUNT_MAX: 3,

    JOB_TICKS: {
        chop:         120,
        mine:         200,
        farm:         300,
        build_bridge: 280,
        build_boat:   400,
        plant_tree:   180,   // replanting after chop
    },
    JOB_SPAWN_INTERVAL: 420,
    JOB_MAX: 20,

    // Max farm tiles in one cluster; hard limit of 2 clusters per world.
    FARM_CLUSTER_SIZE: 12,
    FARM_CLUSTER_MAX:  2,

    // How many ticks for a planted tree to reach full size.
    TREE_GROW_TICKS: 1800,
    // How many ticks for a farm tile to cycle seed→sprout→ripe→harvested.
    CROP_GROW_TICKS: 900,

    // Max bridges that can ever be built in this world.
    BRIDGE_MAX: 8,

    BOAT_SPEED: 0.007,
    STOCKPILE_SPREAD: 10,
};

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
    farm:         { top: '#8b6914', front: '#5a4010', z:  2 },
    bridge:       { top: '#8a6840', front: '#5a4428', z:  1 },
};

const TREE_PALETTE = {
    shadow:        'rgba(0,0,0,0.3)',
    trunkDark:     '#3a2818',
    trunkLight:    '#5a3828',
    leafDark:      '#1e4013',
    leafMid:       '#2a5a1a',
    leafLight:     '#3a7a2a',
    leafHighlight: '#4acc4a',
    saplingTrunk:  '#5a3828',
    saplingLeaf:   '#3a6a28',
};

const DUPE_PALETTE = {
    skinTones: ['#f5c5a0', '#c8a07a', '#e8b090', '#d4955a'],
    clothes:   ['#3a70a0', '#7a3a70', '#3a7a40', '#7a6a20', '#7a3030'],
    legs:       '#222',
    shadow:     'rgba(0,0,0,0.3)',
    eye:        '#111',
    nameTagBg:  'rgba(0,0,0,0.7)',
    nameTagFg:  '#cfd8dc',
};

// Used only for the dupe progress bar colour while working.
const JOB_PALETTE = {
    chop:         'rgba(220,160,60,0.9)',
    mine:         'rgba(160,160,200,0.9)',
    farm:         'rgba(100,180,60,0.9)',
    build_bridge: 'rgba(160,120,60,0.9)',
    build_boat:   'rgba(60,140,200,0.9)',
    plant_tree:   'rgba(80,160,80,0.9)',
};

const RESOURCE_PALETTE = {
    log:   '#7a5030',
    ore:   '#a0a0c0',
    grain: '#e0c060',
};

const BOAT_PALETTE = {
    hull:     '#c8a050',
    hullDark: '#7a5828',
    hullRib:  '#9a7238',
    mast:     '#5a3818',
    sail:     ['#e8d0a0', '#c0d8e0', '#e0b890', '#b8c8a0', '#d8b0b0'],
    wake:     'rgba(255,255,255,0.22)',
    wakeEdge: 'rgba(255,255,255,0.08)',
};

const STOCKPILE_PALETTE = {
    ground:        '#5a4828',
    groundEdge:    '#3a2a18',
    logA:          '#7a5030',
    logB:          '#5a3818',
    logEnd:        '#9a6840',
    oreA:          '#909090',
    oreB:          '#b0b0c8',
    oreShine:      '#d0d0e8',
    grainSack:     '#d0b060',
    grainSackDark: '#a08040',
    grainStitch:   '#c09030',
};

const DUPE_NAMES = [
    'Abel','Frankie','Nikola','Marie','Ada','Turing',
    'Grace','Emmy','Liang','Otis','Ren','Iris',
    'Bart','Cleo','Yusuf','Mara',
];

const WALKABLE_TYPES = new Set([
    'sand','sandstone','grass','grass_dark','stone','farm','bridge',
]);
