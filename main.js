"use strict";

// ============================================================
// Sandfall — a falling-sand alchemy sandbox
// One Uint8 grid, simple local rules, surprising chemistry.
// Plus a little population of people who try to live in the mess.
// ============================================================

// ---------- world ----------
// A wide side-scrolling world at the original 200-tall resolution. The camera is
// a fixed 1:1 window that pans horizontally (WASD / drag / wheel) — no zoom, so
// every pixel is always drawn at full size, which keeps Game of Life crisp.
const W = 900, H = 200;
const VIEW_W = 450, VIEW_H = 200;
const N = W * H;

const E = {
  EMPTY: 0, WALL: 1, SAND: 2, WATER: 3, OIL: 4, FIRE: 5, SMOKE: 6,
  STEAM: 7, PLANT: 8, LAVA: 9, STONE: 10, ACID: 11, ICE: 12, GLASS: 13,
  LIFE: 14, SUPPORT: 15, WOOD: 16,
};
const ERASER = -1;
const PEOPLE = 100; // a tool sentinel, never stored in the cell grid

const cells = new Uint8Array(N);   // element id per cell
const life = new Uint8Array(N);    // countdown for fire/smoke/steam, age for life
const shade = new Uint8Array(N);   // per-cell color variation, fixed at spawn
const stamp = new Uint32Array(N);  // frame a cell last moved (skip double updates)
const lifeNext = new Uint8Array(N); // scratch buffer for the next GoL generation
let frame = 0;

// Simulation time is deliberately slower than the display refresh. Keeping a
// fixed step makes the falling-sand rules and people move at the same speed on
// every monitor, while the Life cadence below is expressed in elapsed time
// instead of display frames.
const SIM_STEP_MS = 1000 / 60;
const LIFE_STEP_MS = 100;
// Per-frame safety limits retain any unprocessed accumulator backlog. Thirty
// world ticks cover 4× speed during a 10 FPS frame; excess backlog is retained.
const MAX_WORLD_CATCH_UP_STEPS = 30;
const MAX_LIFE_CATCH_UP_STEPS = 20;
const MAX_LOGO_CATCH_UP_STEPS = 20;
const SIM_SPEEDS = [0.5, 1, 2, 4];
let simulationSpeedIndex = 1;
let lifeElapsedMs = 0;

// lookup tables (arrays beat Sets in the hot loop); sized past the last id
const IS_LIQUID = new Uint8Array(32);
IS_LIQUID[E.WATER] = IS_LIQUID[E.OIL] = IS_LIQUID[E.LAVA] = IS_LIQUID[E.ACID] = 1;
const IS_GAS = new Uint8Array(32);
IS_GAS[E.SMOKE] = IS_GAS[E.STEAM] = 1;
const DENSITY = new Uint8Array(32);
DENSITY[E.OIL] = 2; DENSITY[E.WATER] = 3; DENSITY[E.ACID] = 3; DENSITY[E.LAVA] = 4;
const DISSOLVES = new Uint8Array(32); // what acid can eat
DISSOLVES[E.SAND] = DISSOLVES[E.STONE] = DISSOLVES[E.PLANT] =
  DISSOLVES[E.OIL] = DISSOLVES[E.ICE] = DISSOLVES[E.LIFE] =
  DISSOLVES[E.SUPPORT] = DISSOLVES[E.WOOD] = 1;
// what the people can stand on / bump into
const SOLID_P = new Uint8Array(32);
SOLID_P[E.WALL] = SOLID_P[E.SAND] = SOLID_P[E.STONE] =
  SOLID_P[E.GLASS] = SOLID_P[E.PLANT] = SOLID_P[E.ICE] =
  SOLID_P[E.LIFE] = SOLID_P[E.SUPPORT] = SOLID_P[E.WOOD] = 1;
// FLAMMABLE: chance (in %) a neighbouring fire sets this alight. Wood is the
// most eager to burn and carries a flame along a whole beam or up a trunk.
const FLAMMABLE = new Uint8Array(32);
FLAMMABLE[E.PLANT] = 10; FLAMMABLE[E.OIL] = 35; FLAMMABLE[E.SUPPORT] = 5; FLAMMABLE[E.WOOD] = 44;

const NEIGHBORS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const NEIGHBORS8 = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

function idx(x, y) { return y * W + x; }
function cellAt(x, y) { return (x < 0 || x >= W || y < 0 || y >= H) ? E.WALL : cells[y * W + x]; }

function setCell(i, e, l = 0) {
  cells[i] = e;
  life[i] = l;
  shade[i] = (Math.random() * 256) | 0;
}

function swapCells(i, j) {
  const e = cells[i], l = life[i], s = shade[i];
  cells[i] = cells[j]; life[i] = life[j]; shade[i] = shade[j];
  cells[j] = e; life[j] = l; shade[j] = s;
  stamp[i] = frame; stamp[j] = frame;
}

// ---------- element behaviors ----------

function updatePowder(x, y, i) {
  if (y + 1 >= H) return;
  const dn = i + W, b = cells[dn];
  if (b === E.EMPTY || IS_GAS[b]) { swapCells(i, dn); return; }
  if (IS_LIQUID[b] && Math.random() < 0.7) { swapCells(i, dn); return; }
  const dir = Math.random() < 0.5 ? -1 : 1;
  for (let s = 0; s < 2; s++) {
    const d = s === 0 ? dir : -dir;
    const nx = x + d;
    if (nx < 0 || nx >= W) continue;
    const j = dn + d, t = cells[j];
    if (t === E.EMPTY || IS_GAS[t] || (IS_LIQUID[t] && Math.random() < 0.5)) {
      swapCells(i, j);
      return;
    }
  }
}

function updateLiquid(x, y, i, e, dispersion) {
  const dens = DENSITY[e];
  if (y + 1 < H) {
    const dn = i + W, b = cells[dn];
    if (b === E.EMPTY || IS_GAS[b]) { swapCells(i, dn); return; }
    if (IS_LIQUID[b] && DENSITY[b] < dens && Math.random() < 0.35) { swapCells(i, dn); return; }
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let s = 0; s < 2; s++) {
      const d = s === 0 ? dir : -dir;
      const nx = x + d;
      if (nx < 0 || nx >= W) continue;
      const j = dn + d, t = cells[j];
      if (t === E.EMPTY || IS_GAS[t]) { swapCells(i, j); return; }
    }
  }
  // spread sideways along the surface
  const dir = Math.random() < 0.5 ? -1 : 1;
  for (let s = 0; s < 2; s++) {
    const d = s === 0 ? dir : -dir;
    let j = i, moved = 0;
    for (let n = 1; n <= dispersion; n++) {
      const nx = x + d * n;
      if (nx < 0 || nx >= W) break;
      if (cells[j + d] !== E.EMPTY) break;
      j += d; moved++;
    }
    if (moved > 0) { swapCells(i, j); return; }
  }
}

function updateFire(x, y, i) {
  for (const [dx, dy] of NEIGHBORS8) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = idx(nx, ny), t = cells[j];
    if (t === E.WATER) {
      // quenched: fire dies, some water flashes to steam
      if (Math.random() < 0.6) setCell(j, E.STEAM, 90 + Math.random() * 90);
      setCell(i, E.SMOKE, 15 + Math.random() * 20);
      return;
    }
    if (FLAMMABLE[t] && Math.random() < FLAMMABLE[t] / 100) setCell(j, E.FIRE, 22 + FLAMMABLE[t] + Math.random() * 30);
    else if (t === E.ICE && Math.random() < 0.3) setCell(j, E.WATER);
    else if (t === E.LIFE) setCell(j, Math.random() < 0.5 ? E.SMOKE : E.EMPTY, 10 + Math.random() * 10);
  }
  if (life[i] <= 1) {
    setCell(i, Math.random() < 0.5 ? E.SMOKE : E.EMPTY, 20 + Math.random() * 40);
    return;
  }
  life[i]--;
  // flicker upward
  if (Math.random() < 0.6) {
    const dx = (Math.random() * 3 | 0) - 1;
    const nx = x + dx, ny = y - 1;
    if (nx >= 0 && nx < W && ny >= 0) {
      const j = idx(nx, ny);
      if (cells[j] === E.EMPTY) swapCells(i, j);
    }
  }
}

function updateGas(x, y, i, e) {
  if (life[i] <= 1) {
    setCell(i, e === E.STEAM && Math.random() < 0.4 ? E.WATER : E.EMPTY);
    return;
  }
  life[i]--;
  const r = Math.random();
  let dx = 0, dy = 0;
  if (r < 0.6) dy = -1;
  else if (r < 0.78) { dy = -1; dx = Math.random() < 0.5 ? -1 : 1; }
  else if (r < 0.96) dx = Math.random() < 0.5 ? -1 : 1;
  else return;
  const nx = x + dx, ny = y + dy;
  if (ny < 0) { setCell(i, E.EMPTY); return; } // escapes out the top
  if (nx < 0 || nx >= W) return;
  const j = idx(nx, ny);
  if (cells[j] === E.EMPTY) swapCells(i, j);
}

function updatePlant(x, y, i) {
  for (const [dx, dy] of NEIGHBORS4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = idx(nx, ny);
    if (cells[j] === E.WATER && Math.random() < 0.03) setCell(j, E.PLANT);
  }
}

function updateLava(x, y, i) {
  for (const [dx, dy] of NEIGHBORS4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = idx(nx, ny), t = cells[j];
    if (t === E.WATER) {
      setCell(i, E.STONE);
      setCell(j, E.STEAM, 90 + Math.random() * 90);
      return;
    }
    if (t === E.SAND && Math.random() < 0.02) setCell(j, E.GLASS);
    else if (FLAMMABLE[t] && Math.random() < 0.4) setCell(j, E.FIRE, 30 + Math.random() * 30);
    else if (t === E.ICE && Math.random() < 0.5) setCell(j, E.WATER);
    else if (t === E.LIFE) setCell(j, E.FIRE, 15 + Math.random() * 15);
  }
  // spit the occasional spark
  if (y > 0 && Math.random() < 0.005) {
    const j = i - W;
    if (cells[j] === E.EMPTY) setCell(j, E.FIRE, 10 + Math.random() * 15);
  }
  if (Math.random() < 0.45) updateLiquid(x, y, i, E.LAVA, 1); // viscous
}

function updateAcid(x, y, i) {
  for (const [dx, dy] of NEIGHBORS4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = idx(nx, ny), t = cells[j];
    if (t === E.WATER && Math.random() < 0.04) { setCell(i, E.WATER); return; } // diluted
    if (DISSOLVES[t] && Math.random() < 0.06) {
      setCell(j, Math.random() < 0.15 ? E.SMOKE : E.EMPTY, 15 + Math.random() * 15);
      if (Math.random() < 0.25) { setCell(i, E.EMPTY); return; } // acid spent
    }
  }
  updateLiquid(x, y, i, E.ACID, 4);
}

function updateIce(x, y, i) {
  for (const [dx, dy] of NEIGHBORS4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = idx(nx, ny);
    if (cells[j] === E.WATER && Math.random() < 0.015) setCell(j, E.ICE);
  }
}

// Conway's Game of Life, run as one simultaneous generation from a snapshot.
// LIFE is the only "alive" element; births land only in empty air, so terrain,
// water and sand form walls that gliders shatter against. life[] doubles as age.
function stepLife() {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let n = 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + NEIGHBORS8[d][0], ny = y + NEIGHBORS8[d][1];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (cells[nx + ny * W] === E.LIFE) n++;
      }
      const c = cells[i];
      if (c === E.LIFE) lifeNext[i] = (n === 2 || n === 3) ? 1 : 0;
      else if (c === E.EMPTY) lifeNext[i] = (n === 3) ? 1 : 0;
      else lifeNext[i] = 0; // occupied by matter: no room to be born
    }
  }
  for (let i = 0; i < N; i++) {
    const wasLife = cells[i] === E.LIFE;
    if (lifeNext[i]) {
      if (wasLife) { if (life[i] < 250) life[i]++; } // survivor ages
      else setCell(i, E.LIFE, 0);                    // newborn
    } else if (wasLife) {
      setCell(i, E.EMPTY);                           // starved or overcrowded
    }
  }
}

function advanceLifeElapsed(elapsedMs) {
  if (!(elapsedMs > 0)) return;
  // Life follows elapsed wall-clock time while running. The page lifecycle
  // handlers below discard time spent hidden; visible backlog is drained over
  // later frames when a single frame exceeds the defensive work limit.
  lifeElapsedMs += elapsedMs;
  let generations = 0;
  while (lifeElapsedMs >= LIFE_STEP_MS && generations < MAX_LIFE_CATCH_UP_STEPS) {
    stepLife();
    lifeElapsedMs -= LIFE_STEP_MS;
    generations++;
  }
}

function step() {
  frame++;
  for (let y = H - 1; y >= 0; y--) {
    const ltr = ((frame + y) & 1) === 0; // alternate scan direction: no drift bias
    for (let k = 0; k < W; k++) {
      const x = ltr ? k : W - 1 - k;
      const i = y * W + x;
      if (stamp[i] === frame) continue;
      switch (cells[i]) {
        case E.SAND: updatePowder(x, y, i); break;
        case E.WATER: updateLiquid(x, y, i, E.WATER, 5); break;
        case E.OIL: updateLiquid(x, y, i, E.OIL, 2); break;
        case E.FIRE: updateFire(x, y, i); break;
        case E.SMOKE: updateGas(x, y, i, E.SMOKE); break;
        case E.STEAM: updateGas(x, y, i, E.STEAM); break;
        case E.PLANT: updatePlant(x, y, i); break;
        case E.LAVA: updateLava(x, y, i); break;
        case E.ACID: updateAcid(x, y, i); break;
        case E.ICE: updateIce(x, y, i); break;
      }
    }
  }
  updatePeople();
  updateCritters();
}

function manualStep() {
  step();
  advanceLifeElapsed(SIM_STEP_MS);
}

// ============================================================
// People — little agents that live on top of the grid.
// They aren't cells: each keeps its own position and velocity,
// reads the grid for collision, and gets drawn as a 3px figure.
// ============================================================

const PTYPES = {
  wanderer: {
    label: "wanderer", color: [212, 216, 226],
    desc: "takes a short stroll or hop, then pauses",
  },
  adventurer: {
    label: "adventurer", color: [226, 150, 66],
    desc: "roams in bursts and vaults walls and gaps",
  },
  platformer: {
    label: "platformer", color: [86, 210, 112],
    desc: "mixes smaller arcs and avoids repeating recent platforms",
  },
  daredevil: {
    label: "daredevil", color: [228, 74, 58],
    desc: "pathfinds through curved, gravity-driven flights",
  },
  digger: {
    label: "builder", color: [216, 178, 74],
    desc: "carves broad angled tunnels and sometimes raises towers",
  },
  swimmer: {
    label: "swimmer", color: [70, 202, 226],
    desc: "seeks water, paddles, and holds its breath longer",
  },
};

const MAX_PEOPLE = 400;
const people = [];
const deaths = [];
const GRAV = 0.05, MAX_FALL = 2.5, MAX_RISE = 3.2;

let peopleType = "wanderer";

function spawnPerson(x, y, type) {
  if (people.length >= MAX_PEOPLE) return;
  const oxygenMax = type === "swimmer" ? 360 : 210;
  const shaftFirst = type === "digger" && Math.random() < 0.58;
  people.push({
    x, y, vx: 0, vy: 0, type,
    dir: Math.random() < 0.5 ? -1 : 1,
    t: (Math.random() * 120) | 0, next: 20 + Math.random() * 80,
    onGround: false, blocked: false, desiredVx: null, walkUntil: 0,
    seed: (Math.random() * 255) | 0,
    hp: 100, hurt: 0, oxygen: oxygenMax, oxygenMax,
    airPeak: y, support: null, target: null, flight: null,
    jumpHistory: [], jumpCount: 0, lastJumpDir: 0,
    digMode: shaftFirst ? "shaft" : "level", digStartY: y,
    digDepth: shaftFirst ? 12 + Math.random() * 18 : 0, digStarted: false,
    tunnelHalf: Math.random() < 0.68 ? 1 : 2,
    tunnelHeight: Math.random() < 0.72 ? 4 : 5,
    slopeDir: 1, slopeSteps: 0, slopeTick: 0, slopeX: x, slopeY: y,
    pillarX: x, pillarY: y, pillarTop: y, pillarWidth: 1,
  });
}

function removePeopleNear(cx, cy, r) {
  for (let k = people.length - 1; k >= 0; k--) {
    const p = people[k];
    if (Math.abs(p.x - cx) <= r && Math.abs(p.y - cy) <= r) people.splice(k, 1);
  }
}

function solidP(x, y) {
  if (x < 0 || x >= W) return 1;   // side walls
  if (y >= H) return 1;            // floor
  if (y < 0) return 0;             // open sky
  return SOLID_P[cells[y * W + x]];
}

function bodyClear(x, y) {
  return !solidP(x, y) && !solidP(x, y - 1) && !solidP(x, y - 2);
}

function dangerousCell(c) {
  return c === E.FIRE || c === E.LAVA || c === E.ACID;
}

function safeLanding(x, y) {
  if (x < 2 || x >= W - 2 || y < 3 || y >= H - 1) return false;
  if (!solidP(x, y + 1) || !bodyClear(x, y)) return false;
  if (cellAt(x, y) === E.WATER || cellAt(x, y - 1) === E.WATER || cellAt(x, y - 2) === E.WATER) return false;
  for (let oy = -2; oy <= 1; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      if (dangerousCell(cellAt(x + ox, y + oy))) return false;
    }
  }
  return true;
}

// Direction to the NEAREST water, -1 / 0 / +1. Measures both sides independently
// so it never prefers left just because the left check ran first; on a genuine
// tie it keeps the swimmer's current heading instead of snapping one way.
function waterDir(x, y, prefer = 0) {
  let leftD = Infinity, rightD = Infinity;
  for (let d = 1; d <= 110; d++) {
    if (leftD === Infinity && (cellAt(x - d, y) === E.WATER || cellAt(x - d, y + 1) === E.WATER)) leftD = d;
    if (rightD === Infinity && (cellAt(x + d, y) === E.WATER || cellAt(x + d, y + 1) === E.WATER)) rightD = d;
    if (leftD !== Infinity && rightD !== Infinity) break;
  }
  if (leftD === Infinity && rightD === Infinity) return 0;
  if (leftD < rightD) return -1;
  if (rightD < leftD) return 1;
  return prefer; // equidistant: don't bias, hold course
}

// If heat or acid is close, ordinary people put survival ahead of personality.
function dangerDir(x, y) {
  for (let d = 1; d <= 13; d++) {
    for (let oy = -2; oy <= 2; oy++) {
      if (dangerousCell(cellAt(x - d, y + oy))) return 1;
      if (dangerousCell(cellAt(x + d, y + oy))) return -1;
    }
  }
  return 0;
}

function tryDig(x, y) {
  const c = cellAt(x, y);
  if (c === E.SAND || c === E.PLANT || c === E.STONE || c === E.GLASS || c === E.SUPPORT) {
    setCell(idx(x, y), E.EMPTY);
    return true;
  }
  return false;
}

function diggableCell(c) {
  return c === E.SAND || c === E.PLANT || c === E.STONE || c === E.GLASS || c === E.SUPPORT;
}

function burrowMaterial(c) {
  return c === E.SAND || c === E.PLANT || c === E.STONE || c === E.GLASS;
}

function placeSupport(x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return false;
  const c = cellAt(x, y);
  if (c === E.EMPTY || c === E.SAND || c === E.STONE || c === E.GLASS || c === E.PLANT) {
    setCell(idx(x, y), E.SUPPORT);
    return true;
  }
  return false;
}

function carveTunnelSlice(x, y, halfWidth, height) {
  for (let dx = -halfWidth; dx <= halfWidth; dx++) {
    for (let dy = -height + 1; dy <= 0; dy++) tryDig(x + dx, y + dy);
  }
}

// Every branch gets a real upper and lower platform, wider than the open
// passage. This is the normal tunnel framing, not the occasional tall tower.
function shoreTunnel(x, y, halfWidth = 1, height = 4) {
  for (let dx = -halfWidth - 1; dx <= halfWidth + 1; dx++) {
    placeSupport(x + dx, y - height);
    placeSupport(x + dx, y + 1);
  }
}

function carveShaftSlice(x, y, halfWidth, height) {
  for (let dx = -halfWidth; dx <= halfWidth; dx++) {
    for (let dy = -height + 1; dy <= 2; dy++) tryDig(x + dx, y + dy);
  }
}

// Vertical shafts are the same generous width, with rails on both sides.
function shoreShaft(x, y, halfWidth = 1, height = 4) {
  for (let dy = -height + 1; dy <= 1; dy++) {
    placeSupport(x - halfWidth - 1, y + dy);
    placeSupport(x + halfWidth + 1, y + dy);
  }
}

function carveJunction(x, y, halfWidth = 1, height = 4) {
  carveTunnelSlice(x, y, halfWidth + 1, height);
  shoreTunnel(x, y, halfWidth + 1, height);
}

function nearbyBurrowMaterial(x, y, halfWidth, height) {
  for (let dx = -halfWidth - 1; dx <= halfWidth + 1; dx++) {
    for (let dy = -height; dy <= 2; dy++) {
      if (burrowMaterial(cellAt(x + dx, y + dy))) return true;
    }
  }
  return false;
}

function beginSlope(p, x, y) {
  p.digMode = "slope";
  p.slopeDir = Math.random() < 0.72 ? 1 : -1; // mostly descend, occasionally climb
  p.slopeSteps = 9 + Math.random() * 19;
  p.slopeTick = 0;
  p.slopeX = x + p.dir * (p.tunnelHalf + 1);
  p.slopeY = y;
  p.next = p.t + 85 + Math.random() * 115;
  carveJunction(x, y, p.tunnelHalf, p.tunnelHeight);
}

function beginPillar(p, x, y) {
  p.digMode = "pillar";
  p.pillarWidth = Math.random() < 0.35 ? 2 : 1;
  p.pillarX = x + p.dir * (p.tunnelHalf + 1);
  p.pillarY = y + 1;
  const tallTower = Math.random() < 0.24;
  const height = tallTower ? 38 + Math.random() * 48 : 12 + Math.random() * 25;
  p.pillarTop = Math.max(3, Math.round(y - height));
  shoreTunnel(x, y, p.tunnelHalf, p.tunnelHeight);
}

function arcClear(p, vx, vy, ticks) {
  for (let t = 2; t < ticks - 2; t++) {
    const x = Math.round(p.x + vx * t);
    const y = Math.round(p.y + vy * t + GRAV * t * t * 0.5);
    if (x < 1 || x >= W - 1 || y < 3 || y >= H - 1 || !bodyClear(x, y)) return false;
  }
  return true;
}

// Solve a ballistic arc for an actual destination instead of choosing a jump
// height. Different ledges therefore naturally get different launch strengths.
function solveArc(p, tx, ty, options = {}) {
  const dx = tx - p.x, dy = ty - p.y;
  const minTicks = options.minTicks || 24;
  const maxTicks = options.maxTicks || 100;
  const maxVX = options.maxVX || 1.75;
  const maxRise = options.maxRise || MAX_RISE;
  const tickStep = options.tickStep || 4;
  const feasible = [];
  for (let ticks = minTicks; ticks <= maxTicks; ticks += tickStep) {
    const vx = dx / ticks;
    const vy = (dy - GRAV * ticks * ticks * 0.5) / ticks;
    if (Math.abs(vx) < (options.minVX || 0) || Math.abs(vx) > maxVX || vy > -0.38 || vy < -maxRise) continue;
    if (!arcClear(p, vx, vy, ticks)) continue;
    const cost = Math.abs(vy) + Math.abs(vx) * 0.35 + ticks * 0.002;
    feasible.push({ vx, vy, ticks, cost });
  }
  if (!feasible.length) return null;
  const styles = [0.08, 0.38, 0.68, 0.22];
  const style = options.variant === undefined ? p.jumpCount : options.variant;
  const fraction = styles[(style + (p.seed & 3)) & 3];
  return feasible[Math.min(feasible.length - 1, Math.floor((feasible.length - 1) * fraction))];
}

function findLanding(p, options) {
  const fx = Math.round(p.x), fy = Math.round(p.y);
  const xmin = Math.max(2, fx - options.rangeX);
  const xmax = Math.min(W - 3, fx + options.rangeX);
  const ymin = Math.max(3, fy - options.rangeUp);
  const ymax = Math.min(H - 2, fy + options.rangeDown);
  const minDx = options.minDx || 7;
  const recent = options.avoidRecent ? p.jumpHistory.filter(h => p.t - h.t < 700) : [];
  let best = null;
  const candidates = [];
  for (let x = xmin + ((p.seed + frame) & 1); x <= xmax; x += 2) {
    const dx = x - fx;
    if (Math.abs(dx) < minDx) continue;
    for (let y = ymin; y <= ymax; y++) {
      if (!safeLanding(x, y)) continue;
      if (Math.abs(y - fy) < 2 && Math.abs(dx) < 20) continue;
      if (recent.some(h => Math.hypot(x - h.x, y - h.y) < 12)) continue;
      if (options.ignore && options.ignore.some(h => Math.hypot(x - h.x, y - h.y) < 14)) continue;
      const dist = Math.hypot(dx, y - fy);
      let score = dist * (options.preferFar ? 1 : 0.32) + Math.max(0, fy - y) * 0.75;
      if (cellAt(x, y + 1) === E.LIFE) score += 14; // living platforms are especially tempting
      if (p.lastJumpDir && Math.sign(dx) !== p.lastJumpDir) score += 5 + Math.random() * 7;
      score += Math.sin(x * 0.17 + y * 0.11 + p.seed + p.jumpCount * 1.9) * 7;
      score += Math.random() * 18;
      const candidate = { x, y, arc: null, score };
      if (options.flying) {
        if (!best || score > best.score) best = candidate;
      } else candidates.push(candidate);
    }
  }
  if (!options.flying) {
    candidates.sort((a, b) => b.score - a.score);
    const tries = Math.min(options.maxTries || 32, candidates.length);
    for (let n = 0; n < tries; n++) {
      const candidate = candidates[n];
      candidate.arc = solveArc(p, candidate.x, candidate.y, options.arc || {});
      if (candidate.arc) return candidate;
    }
  }
  return best;
}

function launchTo(p, landing, pauseMin, pauseMax) {
  p.jumpHistory.unshift({ x: Math.round(p.x), y: Math.round(p.y), t: p.t });
  if (p.jumpHistory.length > 5) p.jumpHistory.length = 5;
  p.jumpCount++;
  p.vx = landing.arc.vx;
  p.vy = landing.arc.vy;
  p.dir = p.vx < 0 ? -1 : 1;
  p.lastJumpDir = p.dir;
  p.target = { x: landing.x, y: landing.y, pauseMin, pauseMax };
  p.next = p.t + landing.arc.ticks + 20; // also throttles replanning if an evolving world spoils the arc
  p.onGround = false;
  p.airPeak = p.y;
}

const FLIGHT_GRID = 4;
const FLIGHT_GW = Math.ceil(W / FLIGHT_GRID);
const FLIGHT_GH = Math.ceil(H / FLIGHT_GRID);
const FLIGHT_N = FLIGHT_GW * FLIGHT_GH;
const flightScore = new Float32Array(FLIGHT_N);
const flightCame = new Int32Array(FLIGHT_N);
const flightClosed = new Uint8Array(FLIGHT_N);
const flightPassable = new Uint8Array(FLIGHT_N);

function flightClearAt(x, y) {
  x = Math.round(x); y = Math.round(y);
  // Allow the true edge rows/columns: a daredevil resting against a border still
  // needs its own cell to read as flight-clear, or it can never plot a takeoff.
  if (x < 1 || x >= W - 1 || y < 2 || y >= H) return false;
  if (!bodyClear(x, y) || !bodyClear(x - 1, y) || !bodyClear(x + 1, y)) return false;
  for (let oy = -2; oy <= 1; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      if (dangerousCell(cellAt(x + ox, y + oy))) return false;
    }
  }
  return true;
}

function flightSegmentClear(x0, y0, x1, y1) {
  const distance = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(distance / 0.7));
  for (let n = 1; n <= steps; n++) {
    const t = n / steps;
    if (!flightClearAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

function flightNodePoint(node) {
  const gx = node % FLIGHT_GW, gy = (node / FLIGHT_GW) | 0;
  return {
    x: Math.min(W - 3, 2 + gx * FLIGHT_GRID),
    y: Math.min(H - 2, 3 + gy * FLIGHT_GRID),
  };
}

function buildFlightPassability() {
  for (let node = 0; node < FLIGHT_N; node++) {
    const point = flightNodePoint(node);
    flightPassable[node] = flightClearAt(point.x, point.y) ? 1 : 0;
  }
  return flightPassable;
}

function nearestFlightNode(x, y, passable) {
  const cgx = Math.max(0, Math.min(FLIGHT_GW - 1, Math.round((x - 2) / FLIGHT_GRID)));
  const cgy = Math.max(0, Math.min(FLIGHT_GH - 1, Math.round((y - 3) / FLIGHT_GRID)));
  for (let radius = 0; radius <= 5; radius++) {
    let best = -1, bestDist = Infinity;
    for (let gy = Math.max(0, cgy - radius); gy <= Math.min(FLIGHT_GH - 1, cgy + radius); gy++) {
      for (let gx = Math.max(0, cgx - radius); gx <= Math.min(FLIGHT_GW - 1, cgx + radius); gx++) {
        if (Math.max(Math.abs(gx - cgx), Math.abs(gy - cgy)) !== radius) continue;
        const node = gy * FLIGHT_GW + gx, point = flightNodePoint(node);
        if (!passable[node]) continue;
        const dist = Math.hypot(point.x - x, point.y - y);
        if (dist < bestDist) { best = node; bestDist = dist; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function heapPush(heap, entry) {
  let i = heap.length;
  heap.push(entry);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].f <= entry.f) break;
    heap[i] = heap[parent]; i = parent;
  }
  heap[i] = entry;
}

function heapPop(heap) {
  const root = heap[0], last = heap.pop();
  if (heap.length && last) {
    let i = 0;
    while (true) {
      let child = i * 2 + 1;
      if (child >= heap.length) break;
      if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++;
      if (heap[child].f >= last.f) break;
      heap[i] = heap[child]; i = child;
    }
    heap[i] = last;
  }
  return root;
}

// Coarse A* gives each flyer a safe corridor. We retain short waypoint spacing
// so inertial steering and gravity round the route into a curve instead of a line.
function planFlightPath(p, landing, passable = buildFlightPassability()) {
  const start = nearestFlightNode(p.x, p.y, passable);
  const goal = nearestFlightNode(landing.x, landing.y - 6, passable);
  if (start < 0 || goal < 0) return null;

  flightScore.fill(Infinity);
  flightCame.fill(-1);
  flightClosed.fill(0);
  const heap = [];
  flightScore[start] = 0;
  const goalPoint = flightNodePoint(goal);
  heapPush(heap, { node: start, f: Math.hypot(p.x - goalPoint.x, p.y - goalPoint.y) });
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false, expanded = 0;
  while (heap.length && expanded < FLIGHT_N) {
    const current = heapPop(heap).node;
    if (flightClosed[current]) continue;
    flightClosed[current] = 1; expanded++;
    if (current === goal) { found = true; break; }
    const gx = current % FLIGHT_GW, gy = (current / FLIGHT_GW) | 0;
    for (const [dx, dy, cost] of dirs) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= FLIGHT_GW || ny < 0 || ny >= FLIGHT_GH) continue;
      const next = ny * FLIGHT_GW + nx;
      if (flightClosed[next]) continue;
      if (!passable[next]) continue;
      // For a diagonal move, both neighboring cardinal cells must be clear so
      // the coarse route cannot cut through an obstacle corner.
      if (dx && dy && (!passable[gy * FLIGHT_GW + nx] || !passable[ny * FLIGHT_GW + gx])) continue;
      const tentative = flightScore[current] + cost;
      if (tentative >= flightScore[next]) continue;
      flightScore[next] = tentative;
      flightCame[next] = current;
      const h = Math.hypot(nx - (goal % FLIGHT_GW), ny - ((goal / FLIGHT_GW) | 0));
      heapPush(heap, { node: next, f: tentative + h });
    }
  }
  if (!found) return null;

  const raw = [];
  for (let node = goal; node >= 0; node = flightCame[node]) {
    raw.push(flightNodePoint(node));
    if (node === start) break;
  }
  raw.reverse();
  if (!flightSegmentClear(p.x, p.y, raw[0].x, raw[0].y)) return null;
  const path = [raw[0]];
  let i = 0;
  while (i < raw.length - 1) {
    let j = Math.min(raw.length - 1, i + 5);
    while (j > i + 1 && !flightSegmentClear(raw[i].x, raw[i].y, raw[j].x, raw[j].y)) j--;
    path.push(raw[j]);
    i = j;
  }
  const approach = { x: landing.x, y: Math.max(3, landing.y - 5) };
  const tail = path.length ? path[path.length - 1] : flightNodePoint(start);
  if (!flightSegmentClear(tail.x, tail.y, approach.x, approach.y)) return null;
  if (!flightSegmentClear(approach.x, approach.y, landing.x, landing.y)) return null;
  if (!path.length || Math.hypot(tail.x - approach.x, tail.y - approach.y) > 2) path.push(approach);
  path.push({ x: landing.x, y: landing.y });
  return path;
}

function startDaredevilFlight(p) {
  const ignored = [];
  const passable = buildFlightPassability();
  for (let attempt = 0; attempt < 5; attempt++) {
    const landing = findLanding(p, {
      rangeX: W - 6, rangeUp: 135, rangeDown: 110, preferFar: true, flying: true, ignore: ignored,
    });
    if (!landing) return false;
    const path = planFlightPath(p, landing, passable);
    if (path) {
      p.flight = {
        x: landing.x, y: landing.y, path, index: 0,
        stuck: 0, replans: 0, recoveries: 0, lastX: p.x, lastY: p.y,
        phase: Math.random() * Math.PI * 2,
      };
      p.target = { x: landing.x, y: landing.y, pauseMin: 95, pauseMax: 210 };
      p.dir = landing.x < p.x ? -1 : 1;
      p.vx = 0.18 * p.dir;
      p.vy = -0.28 - Math.random() * 0.22;
      p.onGround = false;
      return true;
    }
    ignored.push(landing);
  }
  return false;
}

function replanFlight(p) {
  const f = p.flight;
  if (!f || f.replans >= 4) return false;
  const path = planFlightPath(p, { x: f.x, y: f.y });
  if (!path) return false;
  f.path = path; f.index = 0; f.stuck = 0; f.replans++;
  return true;
}

function recoverFlight(p) {
  const f = p.flight;
  if (!f) return false;
  if (f.recoveries >= 4) {
    p.flight = null; p.target = null;
    return startDaredevilFlight(p); // choose a different reachable landing
  }
  const toward = f.x < p.x ? -1 : 1;
  const directions = [[0, -1], [toward, -1], [-toward, -1], [toward, 0], [-toward, 0]];
  let escape = null;
  for (let radius = 7; radius <= 22 && !escape; radius += 5) {
    for (const [dx, dy] of directions) {
      const x = Math.max(2, Math.min(W - 3, p.x + dx * radius));
      const y = Math.max(3, Math.min(H - 2, p.y + dy * radius));
      if (flightClearAt(x, y) && flightSegmentClear(p.x, p.y, x, y)) { escape = { x, y }; break; }
    }
  }
  if (!escape) return false;
  f.path = [
    escape,
    { x: f.x, y: Math.max(3, f.y - 7) },
    { x: f.x, y: f.y },
  ];
  f.index = 0; f.stuck = 0; f.replans = 0; f.recoveries++;
  p.vx *= 0.25; p.vy = Math.min(p.vy, -0.32);
  return true;
}

function followSupport(p) {
  const s = p.support;
  if (!s || !p.onGround) return;
  const exact = cellAt(s.x, s.y);
  if (s.type === E.LIFE) {
    if (exact === E.LIFE) return;
  } else if (exact === s.type && shade[idx(s.x, s.y)] === s.shade) {
    return;
  }
  let best = null;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = s.x + dx, y = s.y + dy;
      if (x < 1 || x >= W - 1 || y < 1 || y >= H) continue;
      const c = cellAt(x, y);
      const match = s.type === E.LIFE
        ? c === E.LIFE
        : c === s.type && shade[idx(x, y)] === s.shade;
      if (!match) continue;
      const px = Math.round(p.x) + dx, py = Math.round(p.y) + dy;
      if (!bodyClear(px, py)) continue;
      const score = Math.abs(dx) + Math.abs(dy) * 1.2;
      if (!best || score < best.score) best = { x, y, dx, dy, score };
    }
  }
  if (best) {
    p.x += best.dx; p.y += best.dy;
    s.x = best.x; s.y = best.y;
  } else {
    p.support = null;
    p.onGround = false;
  }
}

function recordSupport(p) {
  if (!p.onGround) { p.support = null; return; }
  const x = Math.round(p.x), y = Math.round(p.y) + 1;
  if (x < 0 || x >= W || y < 0 || y >= H) { p.support = null; return; }
  const type = cellAt(x, y);
  if (!SOLID_P[type]) { p.support = null; return; }
  p.support = { x, y, type, shade: shade[idx(x, y)] };
}

// per-type intent: sets p.vx and occasionally launches a jump (p.vy)
function decide(p) {
  const fx = Math.round(p.x), fy = Math.round(p.y);
  const panic = p.type !== "daredevil" && p.type !== "digger" ? dangerDir(fx, fy) : 0;
  if (panic) {
    p.dir = panic;
    p.desiredVx = 0.56 * panic;
    if (p.onGround && p.t >= p.next) {
      p.vy = -0.8 - Math.random() * 0.4;
      p.next = p.t + 24;
    }
    return;
  }
  switch (p.type) {

    case "wanderer": {
      if (p.onGround && p.t >= p.next) {
        const r = Math.random();
        if (r < 0.28) p.vy = -0.5 - Math.random() * 0.2;
        if (r < 0.48) p.dir = -p.dir;
        p.walkUntil = p.t + (r > 0.36 ? 24 + Math.random() * 55 : 0);
        p.next = p.walkUntil + 45 + Math.random() * 105;
      }
      if (p.t < p.walkUntil) p.desiredVx = 0.14 * p.dir;
      break;
    }

    case "adventurer": {
      if (p.onGround) {
        if (p.t >= p.next) {
          if (Math.random() < 0.35) p.dir = -p.dir;
          p.walkUntil = p.t + 85 + Math.random() * 135;
          p.next = p.walkUntil + 35 + Math.random() * 100;
        }
        if (p.t < p.walkUntil) {
          p.desiredVx = 0.42 * p.dir;
          const wall = solidP(fx + p.dir, fy) || solidP(fx + p.dir, fy - 1);
          const gap = !solidP(fx + p.dir, fy + 1);
          if (wall || (gap && Math.random() < 0.4)) p.vy = -0.92 - Math.random() * 0.3;
          if (p.blocked && Math.random() < 0.5) p.dir = -p.dir;
        }
      }
      break;
    }

    case "platformer": {
      if (p.onGround && p.t >= p.next) {
        const landing = findLanding(p, {
          rangeX: 62, rangeUp: 38, rangeDown: 42, minDx: 12,
          preferFar: false, flying: false, avoidRecent: true, maxTries: 26,
          arc: { minTicks: 24, maxTicks: 84, tickStep: 2, minVX: 0.18, maxVX: 1.0, maxRise: 2.05, variant: p.jumpCount },
        });
        if (landing) {
          launchTo(p, landing, 34 + (p.jumpCount % 3) * 9, 86 + (p.jumpCount % 2) * 24);
        } else {
          if (p.blocked || Math.random() < 0.45) p.dir = -p.dir;
          p.walkUntil = p.t + 24 + Math.random() * 42;
          p.next = p.walkUntil + 35 + Math.random() * 60;
        }
      }
      if (p.onGround && p.t < p.walkUntil) p.desiredVx = 0.22 * p.dir;
      break;
    }

    case "daredevil": {
      if (p.onGround && p.t >= p.next) {
        if (!startDaredevilFlight(p)) {
          // No flightable corridor from right here (wedged against a border or
          // stuck in a pit). Fire off a plain ballistic hop to break loose, then
          // try to launch again from wherever it lands. Turn around when we're
          // blocked so we don't just hop into the same wall forever.
          if (p.blocked || Math.random() < 0.35) p.dir = -p.dir;
          p.vy = -1.8;
          p.vx = (0.5 + Math.random() * 0.3) * p.dir;
          p.onGround = false;
          p.next = p.t + 32 + Math.random() * 28;
        }
      }
      break;
    }

    case "digger": {
      const halfWidth = p.tunnelHalf, tunnelHeight = p.tunnelHeight;
      if (p.digMode === "pillar") {
        p.vx = 0;
        const py = p.pillarY;
        for (let w = 0; w < p.pillarWidth; w++) placeSupport(p.pillarX + w, py);
        if (((py - p.pillarTop) % 7) === 0) {
          for (let dx = -2; dx <= p.pillarWidth + 1; dx++) placeSupport(p.pillarX + dx, py);
        }
        p.pillarY--;
        if (p.pillarY < p.pillarTop || py <= 3) {
          p.digMode = "level";
          p.next = p.t + 75 + Math.random() * 120;
        }
      } else if (p.digMode === "shaft") {
        if (!p.digStarted) {
          if (!p.onGround || !nearbyBurrowMaterial(fx, fy + 1, halfWidth, tunnelHeight)) {
            p.digMode = "level";
            p.next = p.t + 55 + Math.random() * 80;
            break;
          }
          p.digStarted = true;
          p.digStartY = fy;
          if (!p.digDepth) p.digDepth = 10 + Math.random() * 20;
        }
        p.vx = 0;
        if (!nearbyBurrowMaterial(fx, fy + 2, halfWidth, tunnelHeight)) {
          p.digMode = "level";
          p.digStarted = false;
          p.next = p.t + 55 + Math.random() * 80;
          break;
        }
        carveShaftSlice(fx, fy, halfWidth, tunnelHeight);
        shoreShaft(fx, fy, halfWidth, tunnelHeight);
        if (fy - p.digStartY >= p.digDepth || fy >= H - 8) {
          carveJunction(fx, fy, halfWidth, tunnelHeight);
          p.digMode = "level";
          p.digStarted = false;
          p.dir = Math.random() < 0.5 ? -1 : 1;
          p.next = p.t + 75 + Math.random() * 115;
        }
      } else if (p.digMode === "slope") {
        if (!Number.isFinite(p.slopeX) || !Number.isFinite(p.slopeY)) { p.slopeX = fx; p.slopeY = fy; }
        if (p.slopeTick === 0 && Math.round(p.slopeX) === fx) p.slopeX = fx + p.dir * (halfWidth + 1);
        const buildX = Math.round(p.slopeX);
        p.slopeX += p.dir;
        const verticalStep = (p.slopeTick++ & 1) === 0 ? p.slopeDir : 0;
        p.slopeY += verticalStep;
        const tunnelY = Math.round(p.slopeY);
        p.desiredVx = 0.17 * p.dir;
        carveTunnelSlice(buildX, tunnelY, halfWidth, tunnelHeight);
        shoreTunnel(buildX, tunnelY, halfWidth, tunnelHeight);
        if (verticalStep < 0 && p.onGround && bodyClear(fx, fy - 1)) {
          p.y -= 0.6; p.vy = 0;
        }
        p.slopeSteps--;
        if (p.slopeSteps <= 0 || fy >= H - 9 || fy <= tunnelHeight + 2) {
          carveJunction(fx, Math.round(p.y), halfWidth, tunnelHeight);
          p.digMode = "level";
          p.next = p.t + 65 + Math.random() * 115;
        }
      } else {
        const ax = fx + p.dir;
        let earthAhead = false;
        for (let look = 1; look <= halfWidth + 2 && !earthAhead; look++) {
          for (let side = -halfWidth; side <= halfWidth; side++) {
            for (let dy = -tunnelHeight; dy <= 1; dy++) {
              const c = cellAt(fx + p.dir * look + side, fy + dy);
              if (burrowMaterial(c)) { earthAhead = true; break; }
            }
            if (earthAhead) break;
          }
        }
        const existingTunnelAhead = cellAt(ax, fy - tunnelHeight) === E.SUPPORT && cellAt(ax, fy + 1) === E.SUPPORT;
        const tunnelContinues = cellAt(ax + p.dir, fy - tunnelHeight) === E.SUPPORT && cellAt(ax + p.dir, fy + 1) === E.SUPPORT;
        if (!earthAhead) {
          if (existingTunnelAhead && tunnelContinues) p.desiredVx = 0.17 * p.dir;
          else {
            p.vx *= 0.45;
            if (p.onGround && p.t >= p.next) {
              p.dir = -p.dir;
              p.next = p.t + 45 + Math.random() * 70;
            }
          }
          break;
        }

        p.desiredVx = 0.19 * p.dir;
        carveTunnelSlice(ax, fy, halfWidth, tunnelHeight);
        shoreTunnel(ax, fy, halfWidth, tunnelHeight);
        if (p.blocked) {
          if (Math.random() < 0.12) p.dir = -p.dir;
        }
        if (p.onGround && p.t >= p.next) {
          const r = Math.random();
          if (r < 0.47 && fy < H - 15) {
            carveJunction(fx, fy, halfWidth, tunnelHeight);
            p.digMode = "shaft";
            p.digStarted = true;
            p.digStartY = fy;
            p.digDepth = 9 + Math.random() * 20;
            carveShaftSlice(fx, fy, halfWidth, tunnelHeight);
          } else if (r < 0.78) {
            beginSlope(p, fx, fy);
          } else if (r < 0.91) {
            beginPillar(p, fx, fy);
          } else {
            p.dir = -p.dir;
            p.next = p.t + 70 + Math.random() * 125;
          }
        }
      }
      break;
    }

    case "swimmer": {
      // Count water at the feet, the head, OR directly below: a swimmer bobbing
      // at the surface is still "in the water" and must use the paddle logic, not
      // the seek-water logic. Missing that case was the old always-swims-left bug,
      // because the seeker used to resolve ties toward the left.
      const wet = cellAt(fx, fy) === E.WATER || cellAt(fx, fy - 1) === E.WATER || cellAt(fx, fy + 1) === E.WATER;
      if (wet) {
        if (p.t >= p.next) { p.next = p.t + 26 + Math.random() * 40; p.dir = Math.random() < 0.5 ? -1 : 1; }
        // Steer directly (not via desiredVx): buoyancy keeps vy negative, which
        // would otherwise suppress the desiredVx path and let the swimmer coast.
        const targetVx = 0.2 * p.dir;
        p.vx += Math.max(-0.04, Math.min(0.04, targetVx - p.vx));
        // turn back before leaving the pool so swimmers actually swim laps
        const ahead = cellAt(fx + p.dir, fy) === E.WATER || cellAt(fx + p.dir, fy + 1) === E.WATER;
        if (!ahead && Math.random() < 0.6) p.dir = -p.dir;
      } else {
        const wd = waterDir(fx, fy, p.dir);
        if (wd !== 0) {
          p.dir = wd; p.desiredVx = 0.28 * p.dir;
          if (p.onGround && p.blocked) p.vy = -0.9;
        } else {
          if (p.t < p.walkUntil) p.desiredVx = 0.14 * p.dir;
          if (p.onGround && p.t >= p.next) { p.next = p.t + 60 + Math.random() * 90; if (Math.random() < 0.4) p.dir = -p.dir; }
        }
      }
      break;
    }
  }
}

function physicsFlying(p) {
  const f = p.flight;
  let waypoint = f.path[Math.min(f.index, f.path.length - 1)];
  let dx = waypoint.x - p.x, dy = waypoint.y - p.y;
  let dist = Math.hypot(dx, dy);
  while (dist < 3.2 && f.index < f.path.length - 1) {
    f.index++;
    waypoint = f.path[f.index];
    dx = waypoint.x - p.x; dy = waypoint.y - p.y; dist = Math.hypot(dx, dy);
  }

  const finalApproach = f.index === f.path.length - 1;
  if (finalApproach && dist < 1.6) {
    if (safeLanding(Math.round(f.x), Math.round(f.y))) {
      p.x = f.x; p.y = f.y; p.vx = p.vy = 0;
      p.flight = null; p.onGround = true;
      return { landed: true, drop: 0 };
    }
    // A moving Life destination can disappear. Drop out of powered flight
    // instead of hovering forever around a landing that no longer exists.
    p.flight = null; p.target = null; p.next = p.t + 55;
    p.onGround = false;
    return { landed: false, drop: 0 };
  }

  if (((p.t + p.seed) & 15) === 0 && !flightSegmentClear(p.x, p.y, waypoint.x, waypoint.y)) {
    if (!replanFlight(p) && !recoverFlight(p)) {
      p.flight = null; p.target = null; p.onGround = false;
      return { landed: false, drop: 0 };
    }
    waypoint = p.flight.path[0];
    dx = waypoint.x - p.x; dy = waypoint.y - p.y; dist = Math.hypot(dx, dy);
  }

  const ux = dist > 0.01 ? dx / dist : 0;
  const uy = dist > 0.01 ? dy / dist : 0;
  const phase = p.t * 0.061 + f.phase;
  const targetDistance = Math.hypot(f.x - p.x, f.y - p.y);
  const landingZone = targetDistance < 28 || f.index >= f.path.length - 2;
  let targetSpeed = 0.58 + (Math.sin(phase * 0.73) * 0.5 + 0.5) * 0.48;
  if (uy > 0.25) targetSpeed += uy * 0.32; // gain speed in the dive, then pull out
  if (landingZone) targetSpeed = Math.min(targetSpeed, 0.72);

  // Powered lift steers toward the A* corridor, while partial gravity and a
  // gentle perpendicular weave create curved climbs, banks, and swoops.
  p.vy += GRAV * 0.72;
  p.vx += (ux * targetSpeed - p.vx) * (landingZone ? 0.16 : 0.105);
  p.vy += (uy * targetSpeed - p.vy) * (landingZone ? 0.17 : 0.088);
  const weave = landingZone ? 0 : Math.sin(phase) * 0.027;
  p.vx += -uy * weave;
  p.vy += ux * weave;
  const speed = Math.hypot(p.vx, p.vy);
  const maxSpeed = 1.58;
  if (speed > maxSpeed) { p.vx *= maxSpeed / speed; p.vy *= maxSpeed / speed; }

  const nx = p.x + p.vx, ny = p.y + p.vy;
  if (!flightSegmentClear(p.x, p.y, nx, ny)) {
    const impact = Math.hypot(p.vx, p.vy);
    if (impact >= 0.92) return { landed: false, drop: 0, crashed: true };
    if (targetDistance < 30 && safeLanding(Math.round(f.x), Math.round(f.y))) {
      // If a bank cut the corner of the landing platform, pull straight up,
      // align over its center, and make another slow descent.
      p.y = Math.max(3, p.y - 1.2);
      p.vx *= 0.2; p.vy = -0.38;
      f.path = [
        { x: p.x, y: Math.max(3, p.y - 6) },
        { x: f.x, y: Math.max(3, f.y - 5) },
        { x: f.x, y: f.y },
      ];
      f.index = 0; f.stuck = 0;
      return { landed: false, drop: 0 };
    }
    p.vx *= -0.28; p.vy = Math.min(p.vy * -0.25, -0.18);
    if (!replanFlight(p) && !recoverFlight(p)) {
      p.flight = null; p.target = null; p.onGround = false;
    }
    return { landed: false, drop: 0 };
  }

  p.x = nx; p.y = ny;
  const moved = Math.hypot(p.x - f.lastX, p.y - f.lastY);
  f.stuck = moved < 0.025 ? f.stuck + 1 : 0;
  f.lastX = p.x; f.lastY = p.y;
  if (f.stuck > 24) {
    if (!replanFlight(p) && !recoverFlight(p)) { p.flight = null; p.target = null; }
    else { p.vy -= 0.28; p.vx += 0.16 * p.dir; }
  }
  p.onGround = false; p.blocked = false;
  return { landed: false, drop: 0 };
}

function physics(p) {
  if (p.flight) return physicsFlying(p);
  const wasGround = p.onGround;
  const fxNow = Math.round(p.x), fyNow = Math.round(p.y);
  const buoyant = p.type === "swimmer" &&
    (cellAt(fxNow, fyNow) === E.WATER || cellAt(fxNow, fyNow - 1) === E.WATER);

  const onIce = p.onGround && cellAt(fxNow, fyNow + 1) === E.ICE;
  if (p.desiredVx !== null && p.vy > -0.1) {
    const accel = onIce ? 0.026 : 0.11;
    const delta = Math.max(-accel, Math.min(accel, p.desiredVx - p.vx));
    p.vx += delta;
  } else if (p.onGround && p.vy > -0.1) {
    p.vx *= onIce ? 0.995 : 0.68;
    if (!onIce && Math.abs(p.vx) < 0.015) p.vx = 0;
  }

  // vertical
  if (buoyant) { p.vy -= 0.05; p.vy *= 0.86; }
  else p.vy += GRAV;
  if (p.vy > MAX_FALL) p.vy = MAX_FALL;
  if (p.vy < -MAX_RISE) p.vy = -MAX_RISE;
  const verticalSpeed = p.vy;
  const verticalSteps = Math.max(1, Math.ceil(Math.abs(verticalSpeed) / 0.45));
  const verticalStep = verticalSpeed / verticalSteps;
  let fx = Math.round(p.x), fy = Math.round(p.y);
  let landed = false;
  for (let s = 0; s < verticalSteps; s++) {
    p.y += verticalStep;
    fx = Math.round(p.x); fy = Math.round(p.y);
    if (verticalSpeed >= 0) {
      if (solidP(fx, fy + 1)) { p.y = fy; landed = !wasGround; p.vy = 0; break; }
      if (solidP(fx, fy)) { p.y = fy - 1; landed = !wasGround; p.vy = 0; break; }
    } else if (solidP(fx, fy - 3)) {
      p.vy = 0; break;
    }
  }
  fx = Math.round(p.x);
  fy = Math.round(p.y);
  p.onGround = solidP(fx, fy + 1) === 1;

  // horizontal
  if (p.vx !== 0) {
    const horizontalSpeed = p.vx;
    const horizontalSteps = Math.max(1, Math.ceil(Math.abs(horizontalSpeed) / 0.45));
    const horizontalStep = horizontalSpeed / horizontalSteps;
    p.blocked = false;
    for (let s = 0; s < horizontalSteps; s++) {
      const nx = p.x + horizontalStep, nix = Math.round(nx);
      fy = Math.round(p.y);
      if (solidP(nix, fy) || solidP(nix, fy - 1)) {
        // step up a single-cell ledge if the space above it is clear
        if (p.onGround && solidP(nix, fy) && !solidP(nix, fy - 1) && !solidP(nix, fy - 2)) {
          p.y -= 1; p.x = nx;
        } else { p.vx = 0; p.blocked = true; break; }
      } else p.x = nx;
    }
  }

  // bounds
  if (p.x < 1) { p.x = 1; p.dir = 1; }
  if (p.x > W - 2) { p.x = W - 2; p.dir = -1; }
  if (p.y < 3) { p.y = 3; if (p.vy < 0) p.vy = 0; }
  if (p.y > H - 1) { p.y = H - 1; p.vy = 0; p.onGround = true; }
  p.onGround = solidP(Math.round(p.x), Math.round(p.y) + 1) === 1;

  if (!p.onGround) {
    if (wasGround) p.airPeak = p.y;
    else p.airPeak = Math.min(p.airPeak, p.y);
  }
  const drop = landed ? Math.max(0, p.y - p.airPeak) : 0;
  if (landed) p.airPeak = p.y;
  return { landed, drop };
}

function airNearby(x, y) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const c = cellAt(x + dx, y + dy);
      if (c === E.EMPTY || c === E.PLANT) return true; // plants make sealed gardens breathable
    }
  }
  return false;
}

function kickSand(p, drop) {
  if (drop < 15) return;
  const x = Math.round(p.x), y = Math.round(p.y) + 1;
  if (cellAt(x, y) !== E.SAND || Math.random() > 0.45) return;
  const d = Math.random() < 0.5 ? -1 : 1;
  const tx = x + d, ty = y - 1;
  if (cellAt(tx, ty) === E.EMPTY) swapCells(idx(x, y), idx(tx, ty));
}

function littleWorldInteractions(p, landing) {
  const x = Math.round(p.x), y = Math.round(p.y) + 1;
  if (landing.landed) kickSand(p, landing.drop);
  // A moving rider occasionally leaves a newborn Life cell beside a living
  // platform, making tiny footprints that can alter the next generation.
  if (p.onGround && cellAt(x, y) === E.LIFE && Math.abs(p.vx) > 0.08 && Math.random() < 0.003) {
    const d = Math.random() < 0.5 ? -1 : 1;
    const jx = x + d;
    if (cellAt(jx, y) === E.EMPTY) setCell(idx(jx, y), E.LIFE, 0);
  }
}

function killPerson(k, p, cause) {
  const duration = cause === "burn" ? 48 : cause === "drown" ? 78 : cause === "fall" ? 105 : cause === "impact" ? 72 : 68;
  deaths.push({
    x: p.x, y: p.y, cause, age: 0, duration,
    color: PTYPES[p.type].color, dir: p.dir, seed: p.seed, vx: p.vx, vy: p.vy,
  });
  if (deaths.length > 220) deaths.shift();
  if (cause === "burn") {
    const x = Math.round(p.x), y = Math.max(0, Math.round(p.y) - 1);
    if (cellAt(x, y) === E.EMPTY) setCell(idx(x, y), E.SMOKE, 20 + Math.random() * 25);
  }
  people.splice(k, 1);
}

function applyFallDamage(k, p, landing) {
  if (!landing.landed || landing.drop <= 0) return false;
  const support = cellAt(Math.round(p.x), Math.round(p.y) + 1);
  let threshold = 33, scale = 2.05;
  if (p.type === "platformer" || p.type === "daredevil") { threshold = 48; scale = 0.72; }
  else if (p.type === "adventurer") { threshold = 39; scale = 1.35; }
  if (landing.controlled) { threshold += 18; scale *= 0.28; }
  if (support === E.LIFE) { threshold += 24; scale *= 0.25; } // living platforms cushion a landing
  const damage = Math.max(0, landing.drop - threshold) * scale;
  if (damage <= 0) return false;
  p.hp -= damage; p.hurt = 28;
  if (p.hp <= 0) { killPerson(k, p, "fall"); return true; }
  return false;
}

function updateBreathingAndHazards(k, p) {
  const x = Math.round(p.x), y = Math.round(p.y);
  const body = [cellAt(x, y), cellAt(x, y - 1), cellAt(x, y - 2)];
  if (body.includes(E.FIRE) || body.includes(E.LAVA)) {
    killPerson(k, p, "burn"); return true;
  }
  if (body.includes(E.ACID) && Math.random() < 0.25) {
    killPerson(k, p, "acid"); return true;
  }
  const submerged = cellAt(x, y - 2) === E.WATER;
  const breathable = airNearby(x, y - 2);
  if (submerged) p.oxygen -= p.type === "swimmer" ? 0.62 : 1;
  else if (!breathable) p.oxygen -= 1.25;
  else p.oxygen = Math.min(p.oxygenMax, p.oxygen + 4);
  if (p.oxygen <= 0) {
    killPerson(k, p, submerged ? "drown" : "suffocate");
    return true;
  }
  return false;
}

function updateDeaths() {
  for (let k = deaths.length - 1; k >= 0; k--) {
    deaths[k].age++;
    if (deaths[k].age >= deaths[k].duration) deaths.splice(k, 1);
  }
}

function updatePeople() {
  for (let k = people.length - 1; k >= 0; k--) {
    const p = people[k];
    p.t++;
    if (p.hurt > 0) p.hurt--;
    p.desiredVx = null;
    followSupport(p);
    decide(p);
    const landing = physics(p);
    if (landing.crashed) { killPerson(k, p, "impact"); continue; }
    if (landing.landed && p.target) {
      if (Math.abs(p.x - p.target.x) < 5) {
        p.vx = 0;
        landing.controlled = true;
        p.next = p.t + p.target.pauseMin + Math.random() * (p.target.pauseMax - p.target.pauseMin);
      } else {
        p.next = Math.max(p.next, p.t + 24 + Math.random() * 36);
      }
      p.target = null;
    }
    if (applyFallDamage(k, p, landing)) continue;
    littleWorldInteractions(p, landing);
    if (updateBreathingAndHazards(k, p)) continue;
    recordSupport(p);
  }
  updateDeaths();
}

// ============================================================
// Critters — a second, smaller species that just lives in the
// world alongside the people. Four kinds, each with its own
// habitat and gait: birds ride the sky, fish dart in water,
// beetles trundle the ground, and fireflies drift toward people.
// ============================================================

const CRITTERS = 101; // tool sentinel, never stored in the grid (people is 100)

const CTYPES = {
  bird: { label: "bird", color: [176, 196, 226], desc: "rides the sky, flees fire, dives for fish" },
  fish: { label: "fish", color: [232, 146, 74], desc: "schools in water, suffocates if it beaches" },
  frog: { label: "frog", color: [86, 178, 96], desc: "hops the shallows, tongues down fireflies" },
  firefly: { label: "firefly", color: [206, 255, 130], desc: "a drifting glow, drawn to the nearest person" },
};

const MAX_CRITTERS = 600;
const critters = [];
let critterType = "bird";
const CRITTER_GRAV = 0.05;

function spawnCritter(x, y, type) {
  if (critters.length >= MAX_CRITTERS) return;
  critters.push({
    x, y, vx: 0, vy: 0, type,
    dir: Math.random() < 0.5 ? -1 : 1,
    t: (Math.random() * 120) | 0, next: 0, seed: Math.random() * 6.28,
    grounded: false, air: 180, airMax: 180,
    tvx: 0, tvy: 0, dive: null, tongue: 0, tongueX: 0, tongueY: 0,
    doomed: false, doomedCause: "fade",
  });
}

function removeCrittersNear(cx, cy, r) {
  for (let k = critters.length - 1; k >= 0; k--) {
    const c = critters[k];
    if (Math.abs(c.x - cx) <= r && Math.abs(c.y - cy) <= r) critters.splice(k, 1);
  }
}

function nearestPerson(x, y, range) {
  let best = null, bd = range * range;
  for (const p of people) {
    const dx = p.x - x, dy = p.y - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = { dx, dy, dist: Math.sqrt(d) || 1 }; }
  }
  return best;
}

function nearestCritter(x, y, type, range) {
  let best = null, bd = range * range;
  for (const c of critters) {
    if (c.type !== type || c.doomed) continue;
    const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function critterBounds(c) {
  if (c.x < 1) { c.x = 1; c.dir = 1; }
  if (c.x > W - 2) { c.x = W - 2; c.dir = -1; }
  if (c.y < 1) { c.y = 1; if (c.vy < 0) c.vy = 0; }
  if (c.y > H - 2) { c.y = H - 2; if (c.vy > 0) c.vy = 0; }
}

// Every critter death leaves a little mark that fades out (or burns up), then
// the critter is removed. cause "burn" for fire/lava, "fade" for everything else
// (drowning, suffocation, being eaten).
function critterDie(k, cause) {
  const c = critters[k];
  deaths.push({
    x: c.x, y: c.y, cause: cause === "burn" ? "burn" : "fade",
    age: 0, duration: cause === "burn" ? 30 : 46,
    color: CTYPES[c.type].color, dir: c.dir, seed: (c.seed * 40) | 0, vx: c.vx, vy: c.vy, small: true,
  });
  if (deaths.length > 240) deaths.shift();
  critters.splice(k, 1);
}

function updateBird(c) {
  const fx = Math.round(c.x), fy = Math.round(c.y);
  if (c.dive) {                                              // stooping on a fish
    const f = c.dive;
    if (f.doomed || cellAt(Math.round(f.x), Math.round(f.y)) !== E.WATER) c.dive = null;
    else {
      const dx = f.x - c.x, dy = f.y - c.y, d = Math.hypot(dx, dy) || 1;
      c.vx += (dx / d * 1.3 - c.vx) * 0.22;
      c.vy += (dy / d * 1.3 - c.vy) * 0.22;
      c.x += c.vx; c.y += c.vy;
      if (d < 2.6) { f.doomed = true; f.doomedCause = "fade"; c.dive = null; c.vy = -1.3; } // snatched
      critterBounds(c);
      return;
    }
  }
  if (c.t >= c.next) { c.next = c.t + 40 + Math.random() * 90; if (Math.random() < 0.3) c.dir = -c.dir; }
  const flee = dangerDir(fx, fy);                            // -1/+1 away from heat, 0 if clear
  let tvx = 0.55 * c.dir;
  let tvy = Math.sin(c.t * 0.09 + c.seed) * 0.3;             // easy undulation
  if (solidP(fx, fy + 3) || solidP(fx + c.dir * 2, fy)) tvy -= 0.5; // pull up off the terrain
  if (fy < 12) tvy += 0.25;                                  // don't leave the top
  if (flee) { tvx = 0.95 * flee; tvy -= 0.5; }
  c.vx += (tvx - c.vx) * 0.1;
  c.vy += (tvy - c.vy) * 0.16;
  c.x += c.vx; c.y += c.vy;
  if (solidP(Math.round(c.x) + c.dir, Math.round(c.y))) c.dir = -c.dir; // turn at a wall
  if (!flee && Math.random() < 0.0025) {                     // very occasionally, dive on a fish below
    const f = nearestCritter(c.x, c.y, "fish", 64);
    if (f && f.y > c.y + 6) c.dive = f;
  }
  critterBounds(c);
}

function updateFish(k, c) {
  const fx = Math.round(c.x), fy = Math.round(c.y);
  if (cellAt(fx, fy) === E.WATER) {
    c.air = Math.min(c.airMax, c.air + 4);
    if (c.t >= c.next) {                                     // pick a fresh 2-D heading now and then
      c.next = c.t + 20 + Math.random() * 40;
      c.tvx = (0.25 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1);
      c.tvy = (Math.random() - 0.5) * 0.7;
    }
    const np = nearestPerson(c.x, c.y, 22);
    if (np) c.tvx = Math.abs(c.tvx) * (np.dx < 0 ? 1 : -1);  // bolt from a wader
    let sx = 0, sy = 0;                                       // separation so they don't stack in a line
    for (const o of critters) {
      if (o === c || o.type !== "fish") continue;
      const dx = c.x - o.x, dy = c.y - o.y, d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < 9) { sx += dx / d2; sy += dy / d2; }
    }
    c.vx += (c.tvx - c.vx) * 0.08 + sx * 0.35;
    c.vy += (c.tvy - c.vy) * 0.08 + sy * 0.35;
    // move only into water; reflect off the surface, bottom and banks so it never beaches itself
    const nx = c.x + c.vx, ny = c.y + c.vy;
    if (cellAt(Math.round(nx), Math.round(ny)) === E.WATER) { c.x = nx; c.y = ny; }
    else if (cellAt(Math.round(nx), fy) === E.WATER) { c.x = nx; c.vy = -c.vy * 0.4; c.tvy = -c.tvy; }
    else if (cellAt(fx, Math.round(ny)) === E.WATER) { c.y = ny; c.vx = -c.vx * 0.4; c.tvx = -c.tvx; }
    else { c.vx = -c.vx * 0.5; c.vy = -c.vy * 0.5; c.tvx = -c.tvx; }
    if (c.vx < -0.02) c.dir = -1; else if (c.vx > 0.02) c.dir = 1;
  } else {
    c.air -= 1;                                              // beached (water pulled away, or dropped by a bird)
    c.vy += CRITTER_GRAV;
    if (c.t >= c.next) { c.next = c.t + 12; if (solidP(fx, fy + 1)) c.vy = -0.85; c.vx = 0.5 * (waterDir(fx, fy, c.dir) || c.dir); }
    c.x += c.vx; c.y += c.vy;
    if (c.vy > 0 && solidP(Math.round(c.x), Math.round(c.y) + 1)) { c.y = Math.round(c.y); c.vy = 0; }
    if (c.air <= 0) { critterDie(k, "fade"); return true; }
  }
  critterBounds(c);
  return false;
}

function updateFrog(c) {
  c.vy += CRITTER_GRAV; if (c.vy > 2) c.vy = 2;
  c.y += c.vy;
  let fx = Math.round(c.x), fy = Math.round(c.y);
  if (c.vy >= 0 && solidP(fx, fy + 1)) { c.y = fy; c.vy = 0; c.grounded = true; }
  else if (solidP(fx, fy)) { c.y = fy - 1; c.vy = 0; c.grounded = true; }
  else c.grounded = false;
  fy = Math.round(c.y);
  if (c.grounded) {
    c.vx *= 0.8; if (Math.abs(c.vx) < 0.02) c.vx = 0;        // land and settle
    if (c.tongue <= 0 && Math.random() < 0.014) {            // flick the tongue at a close firefly
      const ff = nearestCritter(c.x, c.y, "firefly", 15);
      if (ff) { ff.doomed = true; ff.doomedCause = "fade"; c.tongue = 8; c.tongueX = ff.x; c.tongueY = ff.y; c.dir = ff.x < c.x ? -1 : 1; }
    }
    if (c.t >= c.next) {                                     // a hop
      c.next = c.t + 46 + Math.random() * 80;
      const np = nearestPerson(c.x, c.y, 20);
      if (np) c.dir = np.dx < 0 ? 1 : -1; else if (Math.random() < 0.4) c.dir = -c.dir;
      c.vy = -1.0 - Math.random() * 0.35;
      c.vx = (0.4 + Math.random() * 0.3) * c.dir;
    }
  } else {                                                   // mid-hop travel
    const nx = c.x + c.vx, nix = Math.round(nx);
    if (solidP(nix, fy) && solidP(nix, fy - 1)) { c.vx = 0; c.dir = -c.dir; } else c.x = nx;
  }
  critterBounds(c);
}

function updateFirefly(k, c) {
  const fx = Math.round(c.x), fy = Math.round(c.y);
  if (cellAt(fx, fy) === E.WATER) { critterDie(k, "fade"); return true; } // doused
  let ax = Math.sin(c.t * 0.11 + c.seed) * 0.13;
  let ay = Math.cos(c.t * 0.08 + c.seed * 2) * 0.1 - 0.02;   // gentle drift, faint lift
  const np = nearestPerson(c.x, c.y, 70);
  if (np) { ax += (np.dx / np.dist) * 0.13; ay += (np.dy / np.dist) * 0.13; } // follow people
  c.vx = (c.vx + ax) * 0.9;
  c.vy = (c.vy + ay) * 0.9;
  c.x += c.vx; c.y += c.vy;
  if (solidP(Math.round(c.x), Math.round(c.y))) { c.y -= 1; c.vy = -0.2; } // don't sink into ground
  critterBounds(c);
  return false;
}

function updateCritters() {
  for (let k = critters.length - 1; k >= 0; k--) {
    const c = critters[k];
    c.t++;
    if (c.tongue > 0) c.tongue--;
    if (c.doomed) { critterDie(k, c.doomedCause); continue; }  // eaten / marked for death, removed safely here
    const here = cellAt(Math.round(c.x), Math.round(c.y));
    if (here === E.FIRE || here === E.LAVA) {                 // any critter burns up
      const i = idx(Math.round(c.x), Math.max(0, Math.round(c.y) - 1));
      if (cells[i] === E.EMPTY) setCell(i, E.SMOKE, 12 + Math.random() * 12);
      critterDie(k, "burn");
      continue;
    }
    let died = false;
    switch (c.type) {
      case "bird": updateBird(c); break;
      case "fish": died = updateFish(k, c); break;
      case "frog": updateFrog(c); break;
      case "firefly": died = updateFirefly(k, c); break;
    }
    if (died) continue;
    if (c.type !== "fish") {                                  // suffocate if buried in solid material
      if (SOLID_P[cellAt(Math.round(c.x), Math.round(c.y))]) {
        c.air -= 3;
        if (c.air <= 0) { critterDie(k, "fade"); continue; }
      } else c.air = Math.min(c.airMax, c.air + 4);
    }
  }
}

function drawCritters() {
  for (const c of critters) {
    const fx = Math.round(c.x), fy = Math.round(c.y);
    const col = CTYPES[c.type].color;
    if (c.type === "bird") {
      const flap = (frame >> 2 & 1) ? 1 : 0;                  // little wing beat
      putPx(fx, fy, col[0], col[1], col[2]);
      putPx(fx - 1, fy - flap, col[0] * 0.85, col[1] * 0.85, col[2] * 0.85);
      putPx(fx + 1, fy - flap, col[0] * 0.85, col[1] * 0.85, col[2] * 0.85);
    } else if (c.type === "fish") {
      putPx(fx, fy, col[0], col[1], col[2]);
      putPx(fx - c.dir, fy, col[0] * 0.7, col[1] * 0.7, col[2] * 0.7); // tail behind it
    } else if (c.type === "frog") {
      putPx(fx, fy, col[0], col[1], col[2]);                  // body
      putPx(fx, fy - 1, col[0] * 1.15, col[1] * 1.15, col[2] * 1.15); // head
      putPx(fx - c.dir, fy, col[0] * 0.7, col[1] * 0.7, col[2] * 0.7); // haunch
      if (c.tongue > 0) {                                     // tongue snapping out to the firefly
        const tx = Math.round(c.tongueX), ty = Math.round(c.tongueY), hy = fy - 1;
        const steps = Math.max(1, Math.abs(tx - fx) + Math.abs(ty - hy));
        for (let s = 0; s <= steps; s++) { const t = s / steps; putPx(Math.round(fx + (tx - fx) * t), Math.round(hy + (ty - hy) * t), 226, 96, 120); }
      }
    } else { // firefly: pulsing glow
      const pulse = 0.55 + 0.45 * Math.sin(c.t * 0.2 + c.seed);
      blendPx(fx, fy, 255, 250, 190, pulse);
      blendPx(fx - 1, fy, col[0], col[1], col[2], pulse * 0.5);
      blendPx(fx + 1, fy, col[0], col[1], col[2], pulse * 0.5);
      blendPx(fx, fy - 1, col[0], col[1], col[2], pulse * 0.5);
      blendPx(fx, fy + 1, col[0], col[1], col[2], pulse * 0.5);
    }
  }
}

// bulk-remove tools for the menus (instant, for tidying up an over-crowded world)
function killPeopleOfType(t) { for (let k = people.length - 1; k >= 0; k--) if (people[k].type === t) people.splice(k, 1); }
function killAllPeople() { people.length = 0; }
function killCrittersOfType(t) { for (let k = critters.length - 1; k >= 0; k--) if (critters[k].type === t) critters.splice(k, 1); }
function killAllCritters() { critters.length = 0; }

// ---------- rendering ----------

const canvas = document.getElementById("world");
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// Draw the complete world off-screen, then crop it into the compact viewport.
// This preserves the crisp original presentation while making the world larger
// than the screen and practical to explore.
const worldBuffer = document.createElement("canvas");
worldBuffer.width = W;
worldBuffer.height = H;
const worldCtx = worldBuffer.getContext("2d");
worldCtx.imageSmoothingEnabled = false;
const img = worldCtx.createImageData(W, H);
const px = img.data;

const minimap = document.getElementById("minimap");
minimap.width = 200;
minimap.height = Math.round(200 * H / W);
const minimapCtx = minimap.getContext("2d");
minimapCtx.imageSmoothingEnabled = false;
const viewInfo = document.getElementById("view-info");

// Fixed 1:1 camera window, no zoom. The visible slice of the world is blitted
// at native size (source size === destination size), so no pixel is ever merged
// or dropped — the whole point, since Game of Life needs every cell. The window
// pans horizontally across the wide world; height matches the world exactly.
let cameraX = VIEW_W * 0.5;
let cameraY = H * 0.5;

function clampCamera() {
  cameraX = Math.max(VIEW_W * 0.5, Math.min(W - VIEW_W * 0.5, cameraX));
  cameraY = Math.max(VIEW_H * 0.5, Math.min(H - VIEW_H * 0.5, cameraY));
}

function viewRect() {
  clampCamera();
  const x = Math.max(0, Math.min(W - VIEW_W, Math.round(cameraX - VIEW_W * 0.5)));
  const y = Math.max(0, Math.min(H - VIEW_H, Math.round(cameraY - VIEW_H * 0.5)));
  return { x, y, cols: VIEW_W, rows: VIEW_H };
}

const REGIONS = [
  [150, "the village"], [320, "the climbs"], [470, "the updraft"],
  [630, "frostmere"], [830, "the life gardens"], [W, "the meadow"],
];
function updateViewInfo() {
  const cx = cameraX;
  let name = REGIONS[REGIONS.length - 1][1];
  for (const [edge, label] of REGIONS) { if (cx < edge) { name = label; break; } }
  viewInfo.textContent = name;
}

function resetCamera() { cameraX = VIEW_W * 0.5; cameraY = H * 0.5; updateViewInfo(); }

function renderMinimap(view) {
  minimapCtx.clearRect(0, 0, minimap.width, minimap.height);
  minimapCtx.drawImage(worldBuffer, 0, 0, W, H, 0, 0, minimap.width, minimap.height);
  minimapCtx.strokeStyle = "rgba(255, 232, 175, 0.95)";
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(
    view.x / W * minimap.width + 0.5,
    view.y / H * minimap.height + 0.5,
    Math.max(1, view.cols / W * minimap.width - 1),
    Math.max(1, view.rows / H * minimap.height - 1),
  );
}

// [r, g, b, variation]
const COLORS = [];
COLORS[E.EMPTY] = [5, 6, 10, 0];
COLORS[E.WALL] = [90, 95, 106, 10];
COLORS[E.SAND] = [224, 176, 96, 26];
COLORS[E.WATER] = [42, 108, 212, 18];
COLORS[E.OIL] = [104, 78, 48, 12];
COLORS[E.PLANT] = [62, 160, 78, 30];
COLORS[E.STONE] = [138, 141, 148, 16];
COLORS[E.ACID] = [128, 222, 42, 24];
COLORS[E.ICE] = [168, 216, 240, 14];
COLORS[E.GLASS] = [172, 202, 208, 8];
COLORS[E.SUPPORT] = [150, 118, 84, 20];   // packed earth / scaffolding
COLORS[E.WOOD] = [128, 84, 44, 24];       // timber: warm, grainy brown

function putPx(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const p = (y * W + x) * 4;
  px[p] = r < 0 ? 0 : r > 255 ? 255 : r;
  px[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
  px[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  px[p + 3] = 255;
}

function blendPx(x, y, r, g, b, alpha) {
  if (x < 0 || x >= W || y < 0 || y >= H || alpha <= 0) return;
  const p = (y * W + x) * 4;
  const a = Math.min(1, alpha);
  px[p] = px[p] * (1 - a) + r * a;
  px[p + 1] = px[p + 1] * (1 - a) + g * a;
  px[p + 2] = px[p + 2] * (1 - a) + b * a;
}

function drawPeople() {
  for (const p of people) {
    const fx = Math.round(p.x), fy = Math.round(p.y);
    const c = PTYPES[p.type].color;
    const j = (p.seed & 7) - 3;                    // tiny per-person tint jitter
    const flash = p.hurt > 0 && ((p.hurt >> 2) & 1) ? 75 : 0;
    const r = Math.min(255, c[0] + j + flash), g = Math.min(255, c[1] + j + flash), b = Math.min(255, c[2] + j + flash);
    const walking = p.onGround && Math.abs(p.vx) > 0.04;
    const airborne = !p.onGround;
    const flying = !!p.flight;

    const breathTint = p.oxygen < p.oxygenMax * 0.22 ? 55 : 0;
    putPx(fx, fy - 2, 240 - breathTint, 202 - breathTint * 0.3, 164 + breathTint);
    putPx(fx, fy - 1, r, g, b);                    // torso
    putPx(fx, fy, r * 0.55, g * 0.55, b * 0.55);   // legs (darker)

    if (flying) {                                  // arms spread like tiny wings
      putPx(fx - 2, fy - 1, r * 0.7, g * 0.7, b * 0.7);
      putPx(fx - 1, fy - 1, r * 0.85, g * 0.85, b * 0.85);
      putPx(fx + 1, fy - 1, r * 0.85, g * 0.85, b * 0.85);
      putPx(fx + 2, fy - 1, r * 0.7, g * 0.7, b * 0.7);
    } else if (airborne) {                         // arms up mid-jump
      putPx(fx - 1, fy - 1, r * 0.8, g * 0.8, b * 0.8);
      putPx(fx + 1, fy - 1, r * 0.8, g * 0.8, b * 0.8);
    } else if (walking) {                          // one leg forward, animated
      const step = ((frame >> 2) & 1) ? p.dir : -p.dir;
      putPx(fx + step, fy, r * 0.55, g * 0.55, b * 0.55);
    }
  }
}

function drawDeaths() {
  for (const d of deaths) {
    const x = Math.round(d.x), baseY = Math.round(d.y);
    const t = d.age / d.duration;
    const c = d.color;
    if (d.small) {                                   // a critter dying: a tiny fade or burn-up
      const fade = 1 - t;
      if (d.cause === "burn") {
        const rise = Math.floor(d.age * 0.12);
        blendPx(x, baseY - rise, 255, 140 + ((d.age + d.seed) & 63), 30, fade);
        blendPx(x + ((d.seed >> 1 & 1) ? 1 : -1), baseY - 1 - rise, 255, 90, 20, fade * 0.7);
      } else {                                       // fade away, drifting up a touch
        const rise = Math.floor(d.age * 0.06);
        blendPx(x, baseY - rise, c[0], c[1], c[2], fade * 0.85);
        blendPx(x, baseY - 1 - rise, c[0] * 1.1, c[1] * 1.1, c[2] * 1.1, fade * 0.5);
      }
      continue;
    }
    if (d.cause === "impact") {
      const fade = 1 - t;
      const spread = Math.min(4, d.age * 0.09);
      const sx = Math.sign(d.vx || d.dir), sy = Math.sign(d.vy || 0);
      blendPx(x + Math.round(sx * spread), baseY - 2 + Math.round(sy * spread), 235, 184, 150, fade);
      blendPx(x - Math.round(sx * spread * 0.6), baseY - 1, c[0], c[1], c[2], fade * 0.9);
      blendPx(x + Math.round(sx * spread * 0.35), baseY + Math.round(sy * spread * 0.5), 245, 232, 205, fade * 0.75);
      blendPx(x - Math.round(sx * spread), baseY - Math.round(sy * spread), c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, fade * 0.7);
    } else if (d.cause === "fall") {
      const slump = Math.min(1, d.age / 18);
      const fade = d.age < d.duration - 28 ? 1 : (d.duration - d.age) / 28;
      const headX = x + Math.round(d.dir * 2 * slump);
      const headY = baseY - 2 + Math.round(2 * slump);
      blendPx(headX, headY, 230, 184, 150, fade);
      blendPx(x + Math.round(d.dir * slump), baseY, c[0], c[1], c[2], fade);
      blendPx(x - d.dir, baseY, c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, fade);
      blendPx(x + d.dir * 2, baseY, c[0] * 0.45, c[1] * 0.45, c[2] * 0.45, fade);
    } else if (d.cause === "burn") {
      const fade = 1 - t;
      const rise = Math.floor(d.age * 0.08);
      blendPx(x, baseY - 1 - rise, 255, 120 + ((d.age + d.seed) & 63), 24, fade);
      blendPx(x - 1, baseY - ((d.age + d.seed) & 3), 255, 72, 12, fade * 0.85);
      blendPx(x + 1, baseY - 2 - ((d.age + d.seed * 3) & 5), 255, 190, 45, fade * 0.8);
      if (d.age < 22) blendPx(x, baseY, c[0], c[1] * 0.45, c[2] * 0.2, 1 - d.age / 22);
    } else if (d.cause === "drown") {
      const fade = 1 - t;
      const rise = Math.floor(d.age / 26);
      blendPx(x, baseY - 2 - rise, 116, 188, 235, fade * 0.7);
      blendPx(x, baseY - 1 - rise, c[0], c[1], Math.min(255, c[2] + 65), fade * 0.65);
      blendPx(x, baseY - rise, c[0] * 0.5, c[1] * 0.65, 210, fade * 0.55);
      const bx = x + (((d.age + d.seed) >> 3) & 1 ? 2 : -2);
      blendPx(bx, baseY - 3 - Math.floor(d.age / 8), 175, 225, 255, fade * 0.8);
    } else {
      const fade = 1 - t;
      const jitter = ((d.age + d.seed) & 3) - 1;
      const tint = d.cause === "acid" ? [128, 238, 48] : [150, 156, 174];
      blendPx(x + jitter, baseY - 2, tint[0], tint[1], tint[2], fade);
      blendPx(x, baseY - 1, c[0], c[1], c[2], fade * 0.7);
      blendPx(x - jitter, baseY, tint[0], tint[1], tint[2], fade * 0.5);
    }
  }
}

function render() {
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const e = cells[i];
    let r, g, b;
    if (e === E.FIRE) {
      const heat = Math.min(life[i] * 5, 160);
      r = 255; g = 90 + heat + (shade[i] & 31); b = 20 + (heat >> 2);
      if (g > 255) g = 255;
    } else if (e === E.LAVA) {
      const flick = (shade[i] + frame * 2) & 63;
      r = 216 + (flick >> 2); g = 56 + flick; b = 18;
    } else if (e === E.SMOKE) {
      const v = 50 + life[i] + (shade[i] & 15);
      r = v; g = v; b = v + 5;
    } else if (e === E.STEAM) {
      const v = 120 + (life[i] >> 1) + (shade[i] & 15);
      r = v; g = v + 6; b = v + 12;
    } else if (e === E.LIFE) {
      const t = life[i] > 40 ? 1 : life[i] / 40; // 0 newborn -> 1 old
      const flick = shade[i] & 15;
      r = 150 - t * 110 + flick;        // bright cyan-white fading to deep teal
      g = 255 - t * 60;
      b = 220 - t * 70 + (flick >> 1);
    } else {
      const c = COLORS[e];
      const v = c[3] === 0 ? 0 : ((shade[i] / 255) - 0.5) * 2 * c[3];
      r = c[0] + v; g = c[1] + v; b = c[2] + v;
    }
    px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255;
  }
  drawPeople();
  drawCritters();
  drawDeaths();
  worldCtx.putImageData(img, 0, 0);
  const view = viewRect();
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  // 1:1 blit of the visible slice — source and destination are the same size,
  // so no pixel is ever merged or dropped. CSS upscales the canvas crisply.
  ctx.drawImage(worldBuffer, view.x, view.y, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
  renderMinimap(view);
  updateViewInfo();
}

// ---------- painting ----------

let currentElement = E.SAND;
let brushRadius = 4;
let paused = false;

function stampBrush(cx, cy, elem) {
  const r = brushRadius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = idx(x, y);
      const t = cells[i];
      if (elem === ERASER) {
        if (t !== E.EMPTY) setCell(i, E.EMPTY);
      } else if (elem === E.WALL || elem === E.PLANT || elem === E.ICE || elem === E.STONE || elem === E.WOOD) {
        if (t !== elem) setCell(i, elem);
      } else if (elem === E.LIFE) {
        if (t === E.EMPTY) setCell(i, E.LIFE); // seed into open air only
      } else if (elem === E.FIRE) {
        if (t === E.EMPTY || t === E.OIL || t === E.PLANT || t === E.ICE) {
          setCell(i, E.FIRE, 40 + Math.random() * 40);
        }
      } else {
        if (t === E.EMPTY && Math.random() < 0.7) setCell(i, elem);
      }
    }
  }
}

function paintLine(x0, y0, x1, y1, elem) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stampBrush(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), elem);
  }
}

let painting = false, strokeElement = E.SAND, lastX = 0, lastY = 0;
let panning = false, panLastX = 0, panLastY = 0;
let pastePattern = null;   // active Game-of-Life preset, stamped on left-click
let peopleAccum = 0;       // distance accumulator, so a drag spreads people out

function canvasCoords(ev) {
  const rect = canvas.getBoundingClientRect();
  const view = viewRect();
  return [
    Math.max(0, Math.min(W - 1, Math.floor(view.x + (ev.clientX - rect.left) / rect.width * view.cols))),
    Math.max(0, Math.min(H - 1, Math.floor(view.y + (ev.clientY - rect.top) / rect.height * view.rows))),
  ];
}

function panByScreen(deltaX, deltaY) {
  const rect = canvas.getBoundingClientRect();
  const view = viewRect();
  cameraX -= deltaX / rect.width * view.cols;
  cameraY -= deltaY / rect.height * view.rows;
  clampCamera();
}

// drop a preset centered on (cx, cy), into empty air only so terrain survives
function stampPattern(cx, cy, coords) {
  let maxX = 0, maxY = 0;
  for (const [dx, dy] of coords) { if (dx > maxX) maxX = dx; if (dy > maxY) maxY = dy; }
  const ox = cx - (maxX >> 1), oy = cy - (maxY >> 1);
  for (const [dx, dy] of coords) {
    const x = ox + dx, y = oy + dy;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const i = idx(x, y);
    if (cells[i] === E.EMPTY) setCell(i, E.LIFE);
  }
}

canvas.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  if (ev.button === 1 || (ev.button === 0 && ev.shiftKey)) {
    panning = true;
    panLastX = ev.clientX;
    panLastY = ev.clientY;
    canvas.classList.add("panning");
    return;
  }
  closeMenu();
  const [x, y] = canvasCoords(ev);
  if (pastePattern && ev.button === 0) { stampPattern(x, y, pastePattern); return; }
  painting = true;
  strokeElement = ev.button === 2 ? ERASER : currentElement;
  lastX = x; lastY = y; peopleAccum = 0;
  if (strokeElement === PEOPLE) spawnPerson(x, y, peopleType);
  else if (strokeElement === CRITTERS) spawnCritter(x, y, critterType);
  else {
    if (strokeElement === ERASER) { removePeopleNear(x, y, brushRadius + 1); removeCrittersNear(x, y, brushRadius + 1); }
    stampBrush(x, y, strokeElement);
  }
});

canvas.addEventListener("pointermove", (ev) => {
  if (panning) {
    panByScreen(ev.clientX - panLastX, ev.clientY - panLastY);
    panLastX = ev.clientX;
    panLastY = ev.clientY;
    return;
  }
  if (!painting) return;
  const [x, y] = canvasCoords(ev);
  if (strokeElement === PEOPLE) {
    peopleAccum += Math.hypot(x - lastX, y - lastY);
    while (peopleAccum >= 5) { peopleAccum -= 5; spawnPerson(x, y, peopleType); }
  } else if (strokeElement === CRITTERS) {
    peopleAccum += Math.hypot(x - lastX, y - lastY);
    while (peopleAccum >= 6) { peopleAccum -= 6; spawnCritter(x, y, critterType); }
  } else {
    if (strokeElement === ERASER) { removePeopleNear(x, y, brushRadius + 1); removeCrittersNear(x, y, brushRadius + 1); }
    paintLine(lastX, lastY, x, y, strokeElement);
  }
  lastX = x; lastY = y;
});

const endStroke = () => {
  painting = false;
  panning = false;
  canvas.classList.remove("panning");
};
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

// While the brush is held still, keep laying down material at the cursor each
// frame. That way a source like fire or water keeps flowing as its old cells
// burn off, rise, or fall away, instead of stopping the instant you hold still.
function emitHeld() {
  if (!painting || panning || pastePattern) return;
  if (strokeElement === PEOPLE || strokeElement === CRITTERS) return; // these only drip along a drag
  if (strokeElement === ERASER) { removePeopleNear(lastX, lastY, brushRadius + 1); removeCrittersNear(lastX, lastY, brushRadius + 1); }
  stampBrush(lastX, lastY, strokeElement);
}
// The wheel scrolls the world sideways (no zoom). A vertical wheel maps to
// horizontal travel, which is what a wide side-view wants.
canvas.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const amount = (ev.deltaX || ev.deltaY);
  cameraX += Math.sign(amount) * 26;
  clampCamera();
}, { passive: false });

// ---------- palette + anchored popover menus ----------

const PALETTE = [
  { e: E.SAND, label: "sand", key: "1" },
  { e: E.WATER, label: "water", key: "2" },
  { e: E.WALL, label: "wall", key: "3" },
  { e: E.PLANT, label: "plant", key: "4" },
  { e: E.FIRE, label: "fire", key: "5" },
  { e: E.OIL, label: "oil", key: "6" },
  { e: E.LAVA, label: "lava", key: "7" },
  { e: E.STONE, label: "stone", key: "8" },
  { e: E.ACID, label: "acid", key: "9" },
  { e: E.ICE, label: "ice", key: "0" },
  { e: E.WOOD, label: "wood", key: "o" },
  { e: E.LIFE, label: "life", key: "g", menu: "life" },
  { e: PEOPLE, label: "people", key: "p", menu: "people" },
  { e: CRITTERS, label: "critters", key: "k", menu: "critters" },
  { e: ERASER, label: "erase", key: "e" },
];

const SWATCH = {
  [E.SAND]: "#e0b060", [E.WATER]: "#2a6cd4", [E.WALL]: "#5a5f6a",
  [E.PLANT]: "#3ea04e", [E.FIRE]: "#ff8c28", [E.OIL]: "#684e30",
  [E.LAVA]: "#e04a12", [E.STONE]: "#8a8d94", [E.ACID]: "#80de2a",
  [E.ICE]: "#a8d8f0", [E.WOOD]: "#8a5a2e", [E.LIFE]: "#7cffd8",
  [PEOPLE]: "#cfd6e2", [CRITTERS]: "#b0c4e2", [ERASER]: "#05060a",
};

const paletteEl = document.getElementById("palette");
const buttons = new Map();
const subLabels = new Map();

for (const entry of PALETTE) {
  const { e, label, key, menu } = entry;
  const btn = document.createElement("button");
  btn.className = "element-btn";
  const tail = menu
    ? `<span class="sub"></span><span class="caret">&#9662;</span>`
    : `<span class="key">${key}</span>`;
  btn.innerHTML = `<span class="swatch" style="background:${SWATCH[e]}"></span><span class="lbl">${label}</span>${tail}`;
  btn.addEventListener("click", () => {
    selectElement(e);
    if (menu) openMenu(btn, menu);
  });
  paletteEl.appendChild(btn);
  buttons.set(e, btn);
  if (menu) subLabels.set(e, btn.querySelector(".sub"));
}

function highlightButton(e) {
  for (const [id, btn] of buttons) btn.classList.toggle("selected", id === e);
}

function selectElement(e) {
  currentElement = e;
  if (e !== E.LIFE) pastePattern = null; // leaving life leaves preset-stamp mode
  highlightButton(e);
}

// ---- popover ----

let openPop = null, openBtn = null;

function closeMenu() {
  if (!openPop) return;
  openPop.remove();
  openPop = openBtn = null;
  document.removeEventListener("pointerdown", onDocDown, true);
}

function onDocDown(ev) {
  if (openPop && !openPop.contains(ev.target) && ev.target !== openBtn && !openBtn.contains(ev.target)) {
    closeMenu();
  }
}

function openMenu(btn, kind) {
  if (openBtn === btn) { closeMenu(); return; } // toggle
  closeMenu();
  const items = kind === "life" ? LIFE_MENU : kind === "people" ? PEOPLE_MENU : CRITTER_MENU;
  const heads = { life: "game of life", people: "kind of person", critters: "kind of critter" };
  const pop = document.createElement("div");
  pop.className = "popover";
  pop.innerHTML = `<div class="popover-head">${heads[kind]}</div>`;
  const chosenVal = kind === "life" ? currentLifeChoice : kind === "people" ? peopleType : critterType;
  const killType = kind === "people" ? killPeopleOfType : kind === "critters" ? killCrittersOfType : null;
  const killAll = kind === "people" ? killAllPeople : kind === "critters" ? killAllCritters : null;
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "menu-row";
    const it = document.createElement("button");
    it.className = "popover-item" + (item.value === chosenVal ? " chosen" : "");
    it.innerHTML =
      `<span class="dot" style="background:${item.color}"></span>` +
      `<span class="p-text"><span class="p-name">${item.name}</span>` +
      (item.desc ? `<span class="p-desc">${item.desc}</span>` : "") + `</span>`;
    it.addEventListener("click", () => { item.pick(); closeMenu(); });
    row.appendChild(it);
    if (killType) {                                          // a skull to cull just this kind
      const skull = document.createElement("button");
      skull.className = "chip-kill";
      skull.title = `Remove all ${item.name}s`;
      skull.textContent = "☠";
      skull.addEventListener("click", (ev) => { ev.stopPropagation(); killType(item.value); });
      row.appendChild(skull);
    }
    pop.appendChild(row);
  }
  if (killAll) {                                             // one button to clear the whole species
    const all = document.createElement("button");
    all.className = "popover-item kill-all";
    all.innerHTML = `<span class="dot" style="background:#e0483a"></span><span class="p-text"><span class="p-name">&#9760; kill all ${kind === "people" ? "people" : "critters"}</span></span>`;
    all.addEventListener("click", () => { killAll(); closeMenu(); });
    pop.appendChild(all);
  }
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const pw = pop.offsetWidth;
  let left = r.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
  pop.style.left = `${Math.max(8, Math.round(left))}px`;
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  openPop = pop; openBtn = btn;
  setTimeout(() => document.addEventListener("pointerdown", onDocDown, true), 0);
}

window.addEventListener("resize", closeMenu);

// ---- controls ----

const brushSlider = document.getElementById("brush-size");
const brushValue = document.getElementById("brush-size-value");
brushSlider.addEventListener("input", () => {
  brushRadius = Number(brushSlider.value);
  brushValue.textContent = brushRadius;
});

const pauseBtn = document.getElementById("btn-pause");
const speedLabel = document.getElementById("speed-label");
const slowerBtn = document.getElementById("btn-slower");
const fasterBtn = document.getElementById("btn-faster");
function updateSpeedLabel() {
  const speed = SIM_SPEEDS[simulationSpeedIndex];
  speedLabel.textContent = `${speed}×`;
  speedLabel.setAttribute("aria-label", `Simulation speed ${speed}×`);
  slowerBtn.disabled = simulationSpeedIndex === 0;
  fasterBtn.disabled = simulationSpeedIndex === SIM_SPEEDS.length - 1;
}
function setSimulationSpeed(nextIndex) {
  simulationSpeedIndex = Math.max(0, Math.min(SIM_SPEEDS.length - 1, nextIndex));
  updateSpeedLabel();
}
function changeSimulationSpeed(direction) {
  setSimulationSpeed(simulationSpeedIndex + direction);
}
slowerBtn.addEventListener("click", () => changeSimulationSpeed(-1));
fasterBtn.addEventListener("click", () => changeSimulationSpeed(1));
updateSpeedLabel();
function setPaused(p) {
  paused = p;
  pauseBtn.classList.toggle("active", paused);
  pauseBtn.innerHTML = paused ? "&#9654; resume" : "&#10074;&#10074; pause";
}
pauseBtn.addEventListener("click", () => setPaused(!paused));
document.getElementById("btn-step").addEventListener("click", manualStep);
document.getElementById("btn-overview").addEventListener("click", resetCamera);
document.getElementById("btn-clear").addEventListener("click", clearWorld);
updateViewInfo();

function clearWorld() {
  cells.fill(E.EMPTY);
  life.fill(0);
  stamp.fill(0);
  lifeElapsedMs = 0;
  people.length = 0;
  critters.length = 0;
  deaths.length = 0;
}

// ---- regenerate the world + named save states ----

function regenerateWorld() {
  clearWorld();
  seedWorld(); // uses fresh randomness, so every regen is a slightly new world
}
document.getElementById("btn-reset").addEventListener("click", regenerateWorld);

// Save states: a name plus a full copy of the grid and everything living in it.
// They persist to localStorage (run-length encoded, since the world is mostly
// long runs of stone/empty/water) so they survive a reload or a regen, not just
// the current session. Loading one drops you right back into that exact moment.
const MAX_SAVES = 8;
const SAVE_KEY = "sandfall.saves.v1";
const saveStates = [];
const savesEl = document.getElementById("saves");
const saveNameInput = document.getElementById("save-name");

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i]; let j = i + 1;
    while (j < arr.length && arr[j] === v && j - i < 1e9) j++;
    out.push(v + "." + (j - i)); i = j;
  }
  return out.join(",");
}
function rleDecode(str, arr) {
  let i = 0;
  if (str) for (const tok of str.split(",")) { const dot = tok.indexOf("."); const v = +tok.slice(0, dot), n = +tok.slice(dot + 1); for (let k = 0; k < n; k++) arr[i++] = v; }
}

function snapshotState(name) {
  return {
    name,
    cells: cells.slice(), life: life.slice(), shade: shade.slice(),
    people: people.map((p) => structuredClone(p)),
    critters: critters.map((c) => structuredClone(c)),
    frame, lifeElapsedMs,
  };
}

function restoreState(s) {
  cells.set(s.cells); life.set(s.life);
  if (s.shade) shade.set(s.shade);
  else for (let i = 0; i < N; i++) shade[i] = (Math.random() * 256) | 0; // reloaded save: reroll the color noise
  stamp.fill(0);
  people.length = 0;
  for (const p of s.people) { const q = structuredClone(p); q.flight = null; people.push(q); } // let flyers replan
  critters.length = 0;
  for (const c of (s.critters || [])) critters.push(structuredClone(c));
  deaths.length = 0;
  frame = s.frame || 0;
  lifeElapsedMs = Number.isFinite(s.lifeElapsedMs) ? s.lifeElapsedMs : 0;
}

// shade is per-cell random noise (no runs, so not worth storing); it re-rolls on load.
function persistSaves() {
  try {
    const payload = saveStates.map((s) => ({
      name: s.name, cells: rleEncode(s.cells), life: rleEncode(s.life),
      people: s.people, critters: s.critters, frame: s.frame,
      lifeElapsedMs: s.lifeElapsedMs,
    }));
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (e) { /* private mode or over quota: keep them in memory for the session */ }
}

function loadPersistedSaves() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return; }
  if (!raw) return;
  try {
    for (const p of JSON.parse(raw)) {
      const cellsArr = new Uint8Array(N), lifeArr = new Uint8Array(N);
      rleDecode(p.cells, cellsArr); rleDecode(p.life, lifeArr);
      saveStates.push({ name: p.name, cells: cellsArr, life: lifeArr, shade: null, people: p.people || [], critters: p.critters || [], frame: p.frame || 0, lifeElapsedMs: Number.isFinite(p.lifeElapsedMs) ? p.lifeElapsedMs : 0 });
    }
  } catch (e) { /* corrupt payload: ignore */ }
}

function renderSaves() {
  savesEl.innerHTML = "";
  if (!saveStates.length) { savesEl.innerHTML = `<span class="saves-empty">none yet</span>`; return; }
  saveStates.forEach((s, i) => {
    const chip = document.createElement("div");
    chip.className = "save-chip";
    chip.innerHTML = `<button class="chip-load" title="Load this state">${escapeHtml(s.name)}</button><button class="chip-del" title="Delete this state">&times;</button>`;
    chip.querySelector(".chip-load").addEventListener("click", () => restoreState(s));
    chip.querySelector(".chip-del").addEventListener("click", () => { saveStates.splice(i, 1); renderSaves(); persistSaves(); });
    savesEl.appendChild(chip);
  });
}

function saveCurrentState() {
  const name = (saveNameInput.value || "").trim() || `state ${saveStates.length + 1}`;
  saveStates.push(snapshotState(name));
  while (saveStates.length > MAX_SAVES) saveStates.shift(); // keep the newest few
  saveNameInput.value = "";
  renderSaves();
  persistSaves();
}

document.getElementById("btn-save").addEventListener("click", saveCurrentState);
saveNameInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); saveCurrentState(); } });

loadPersistedSaves();
renderSaves();

// WASD scrolls the camera around the map. Held state is polled in the loop so
// motion is smooth and can combine (e.g. up-left) rather than stuttering.
const panKeys = { w: false, a: false, s: false, d: false };

function panCamera() {
  const speed = 5;
  let dx = 0, dy = 0;
  if (panKeys.a) dx -= 1;
  if (panKeys.d) dx += 1;
  if (panKeys.w) dy -= 1;
  if (panKeys.s) dy += 1;
  if (dx === 0 && dy === 0) return;
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; } // normalize diagonals
  cameraX += dx * speed;
  cameraY += dy * speed;
  clampCamera();
}

document.addEventListener("keydown", (ev) => {
  const target = ev.target;
  if (target instanceof HTMLElement && (
    target.matches("input, textarea, select, button, a, [contenteditable='true'], [role='button'], [role='textbox']")
    || target.isContentEditable
  )) return;
  const k = ev.key.toLowerCase();
  if (k === "w" || k === "a" || k === "s" || k === "d") {
    if (!ev.repeat) panKeys[k] = true;
    ev.preventDefault();
    return;
  }
  if (ev.key === " ") { ev.preventDefault(); setPaused(!paused); return; }
  if (ev.key === ".") { manualStep(); return; }
  if (ev.key === "-") { ev.preventDefault(); changeSimulationSpeed(-1); return; }
  if (ev.key === "=" || ev.key === "+") { ev.preventDefault(); changeSimulationSpeed(1); return; }
  if (ev.key === "f" || ev.key === "F") { resetCamera(); return; }
  if (ev.key === "c" || ev.key === "C") { clearWorld(); return; }
  if (ev.key === "[") { brushSlider.value = String(Math.max(1, brushRadius - 1)); brushSlider.dispatchEvent(new Event("input")); return; }
  if (ev.key === "]") { brushSlider.value = String(Math.min(16, brushRadius + 1)); brushSlider.dispatchEvent(new Event("input")); return; }
  if (ev.key === "Escape") { closeMenu(); return; }
  const entry = PALETTE.find((p) => p.key === k);
  if (entry) selectElement(entry.e);
});

document.addEventListener("keyup", (ev) => {
  const k = ev.key.toLowerCase();
  if (k === "w" || k === "a" || k === "s" || k === "d") panKeys[k] = false;
});
// dropping focus (tab-out, popover) must not leave a key stuck "held"
window.addEventListener("blur", () => { panKeys.w = panKeys.a = panKeys.s = panKeys.d = false; });

// ---------- opening scene ----------

function fillRect(x0, y0, x1, y1, e, prob = 1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if (prob === 1 || Math.random() < prob) setCell(idx(x, y), e);
    }
  }
}

// Gosper glider gun: a stable oscillator that emits a glider every 30 gens,
// each drifting toward the bottom-right. Coords relative to the pattern's corner.
const GLIDER_GUN = [
  [0, 4], [0, 5], [1, 4], [1, 5],
  [10, 4], [10, 5], [10, 6], [11, 3], [11, 7], [12, 2], [12, 8], [13, 2], [13, 8],
  [14, 5], [15, 3], [15, 7], [16, 4], [16, 5], [16, 6], [17, 5],
  [20, 2], [20, 3], [20, 4], [21, 2], [21, 3], [21, 4], [22, 1], [22, 5],
  [24, 0], [24, 1], [24, 5], [24, 6], [34, 2], [34, 3], [35, 2], [35, 3],
];

function placePattern(ox, oy, coords, e) {
  for (const [dx, dy] of coords) {
    const x = ox + dx, y = oy + dy;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    setCell(idx(x, y), e);
  }
}

// Classic Game-of-Life patterns, offered in the "life" menu.
const PRESETS = {
  glider: { label: "glider", cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] },
  lwss: {
    label: "lightweight spaceship",
    cells: [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
  },
  toad: { label: "toad (blinks)", cells: [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]] },
  beacon: { label: "beacon (blinks)", cells: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2], [3, 2], [2, 3], [3, 3]] },
  pulsar: {
    label: "pulsar",
    cells: [
      [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
      [0, 2], [5, 2], [7, 2], [12, 2], [0, 3], [5, 3], [7, 3], [12, 3], [0, 4], [5, 4], [7, 4], [12, 4],
      [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
      [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
      [0, 8], [5, 8], [7, 8], [12, 8], [0, 9], [5, 9], [7, 9], [12, 9], [0, 10], [5, 10], [7, 10], [12, 10],
      [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12],
    ],
  },
  pentadecathlon: {
    label: "pentadecathlon",
    cells: [[2, 0], [7, 0], [0, 1], [1, 1], [3, 1], [4, 1], [5, 1], [6, 1], [8, 1], [9, 1], [2, 2], [7, 2]],
  },
  gun: { label: "Gosper glider gun", cells: GLIDER_GUN },
  rpentomino: { label: "R-pentomino (chaos)", cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]] },
  acorn: { label: "acorn (chaos)", cells: [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]] },
};

// ---- build the two menus (data the popover renders) ----

let currentLifeChoice = "free";

const LIFE_MENU = [{
  value: "free", name: "free paint", desc: "draw live cells by hand", color: SWATCH[E.LIFE],
  pick() { currentLifeChoice = "free"; pastePattern = null; selectElement(E.LIFE); subLabels.get(E.LIFE).textContent = "free paint"; },
}];
for (const [key, preset] of Object.entries(PRESETS)) {
  LIFE_MENU.push({
    value: key, name: preset.label, color: SWATCH[E.LIFE],
    pick() {
      currentLifeChoice = key;
      pastePattern = preset.cells;
      selectElement(E.LIFE);
      subLabels.get(E.LIFE).textContent = preset.label;
    },
  });
}

const PEOPLE_MENU = Object.entries(PTYPES).map(([key, t]) => ({
  value: key, name: t.label, desc: t.desc,
  color: `rgb(${t.color[0]},${t.color[1]},${t.color[2]})`,
  pick() {
    peopleType = key;
    selectElement(PEOPLE);
    subLabels.get(PEOPLE).textContent = t.label;
  },
}));

const CRITTER_MENU = Object.entries(CTYPES).map(([key, t]) => ({
  value: key, name: t.label, desc: t.desc,
  color: `rgb(${t.color[0]},${t.color[1]},${t.color[2]})`,
  pick() {
    critterType = key;
    selectElement(CRITTERS);
    subLabels.get(CRITTERS).textContent = t.label;
  },
}));

// seed the sub-labels with their defaults
subLabels.get(E.LIFE).textContent = "free paint";
subLabels.get(PEOPLE).textContent = PTYPES[peopleType].label;
subLabels.get(CRITTERS).textContent = CTYPES[critterType].label;

selectElement(E.SAND);

// ---- terrain-painting helpers ----

function fillCol(x, y0, y1, e, prob = 1) {
  if (x < 0 || x >= W) return;
  for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= H) continue;
    if (prob === 1 || Math.random() < prob) setCell(idx(x, y), e);
  }
}

function blob(cx, cy, rx, ry, e, prob = 1) {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx || 1) + (y * y) / (ry * ry || 1) > 1) continue;
      const gx = cx + x, gy = cy + y;
      if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
      if (prob === 1 || Math.random() < prob) setCell(idx(gx, gy), e);
    }
  }
}

// Carve air only through the solid rock/dirt, so caves never eat bedrock,
// liquids or open sky.
function digBlob(cx, cy, r) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      const gx = cx + x, gy = cy + y;
      if (gx < 1 || gx >= W - 1 || gy < 2 || gy >= H - 8) continue;
      const c = cells[idx(gx, gy)];
      if (c === E.WALL || c === E.SUPPORT || c === E.STONE) setCell(idx(gx, gy), E.EMPTY);
    }
  }
}

// A little pixel tree: wooden trunk, leafy canopy.
function tree(x, groundY, trunkH) {
  for (let y = 1; y <= trunkH; y++) {
    const gy = groundY - y;
    if (gy > 3) setCell(idx(x, gy), E.WOOD);
  }
  blob(x, groundY - trunkH - 2, 4, 3, E.PLANT, 0.9);
  blob(x, groundY - trunkH - 4, 3, 2, E.PLANT, 0.7);
}

// A timber hut: wood walls and a pitched roof over a stone footing, with a
// doorway punched in the front so villagers can wander in and out.
function hut(x, groundY, w, h) {
  const left = x, right = x + w, top = groundY - h;
  for (let yy = top; yy <= groundY - 1; yy++) {
    setCell(idx(left, yy), E.WOOD);
    setCell(idx(right, yy), E.WOOD);
  }
  for (let xx = left; xx <= right; xx++) setCell(idx(xx, groundY - 1), E.WOOD); // floor beam
  for (let r = 0; r <= (w >> 1); r++) {                                          // pitched roof
    const ry = top - r;
    if (ry < 3) break;
    setCell(idx(left + r, ry), E.WOOD);
    setCell(idx(right - r, ry), E.WOOD);
    if (left + r >= right - r) { for (let xx = left + r; xx <= right - r; xx++) setCell(idx(xx, ry), E.WOOD); }
  }
  // hollow interior + a doorway on the ground
  for (let yy = top + 1; yy <= groundY - 2; yy++) for (let xx = left + 1; xx <= right - 1; xx++) setCell(idx(xx, yy), E.EMPTY);
  const door = left + 1 + ((w - 2) >> 1);
  setCell(idx(door, groundY - 1), E.EMPTY);
  setCell(idx(door, groundY - 2), E.EMPTY);
  setCell(idx(door - 1, groundY - 1), E.EMPTY);
}

function surfaceYAt(x) {
  for (let y = 0; y < H; y++) {
    const c = cells[idx(x, y)];
    if (SOLID_P[c] || IS_LIQUID[c]) return y;
  }
  return H - 8;
}

function spawnOn(x, type) {
  x = Math.max(2, Math.min(W - 3, x | 0));
  spawnPerson(x, Math.max(5, surfaceYAt(x) - 3), type);
}

// ============================================================
// The world — a wide side-scroller you pan through, laid out as
// a run of themed regions: a village, a platforming climb, an
// open flying updraft, a frozen lake, a Game of Life garden, and
// a meadow. Ground is stone and sand (wall only where built),
// carved by caves, with people living in every stretch.
// ============================================================

const BEDROCK = H - 4;

function baseHeight(x) {
  return 132 + Math.sin(x * 0.012) * 10 + Math.sin(x * 0.037 + 1.1) * 6 + Math.sin(x * 0.09 + 2.2) * 3;
}

function platform(x0, x1, y, e = E.STONE) {
  for (let x = x0; x <= x1; x++) if (x >= 0 && x < W && y >= 0 && y < H) setCell(idx(x, y), e);
}

function seedWorld() {
  const surf = new Array(W);
  fillRect(0, BEDROCK, W - 1, H - 1, E.WALL); // bedrock seam

  // ---- Pass A: a stone crust; sink a lake basin, drop a flying chasm ----
  for (let x = 0; x < W; x++) {
    let h = baseHeight(x);
    if (x >= 498 && x <= 602) { const t = Math.min(1, Math.min(x - 498, 602 - x) / 30); h += t * 34; }  // lake
    if (x >= 330 && x <= 460) { const t = Math.min(1, Math.min(x - 330, 460 - x) / 42); h += t * 46; }  // chasm
    const top = Math.max(58, Math.min(BEDROCK - 3, Math.round(h)));
    surf[x] = top;
    fillCol(x, top, BEDROCK - 1, E.STONE);
  }

  // ---- Pass B: caves worming through the stone ----
  for (let n = 0; n < 30; n++) {
    let x = 14 + Math.random() * (W - 28);
    let y = surf[Math.round(x)] + 10 + Math.random() * 40;
    let ang = Math.random() * Math.PI * 2;
    const len = 40 + Math.random() * 80, r = 2 + Math.random() * 2;
    for (let s = 0; s < len; s++) {
      ang += (Math.random() - 0.5) * 0.55;
      x += Math.cos(ang); y += Math.sin(ang) * 0.7;
      if (x < 6 || x >= W - 6 || y < surf[Math.round(x)] + 6 || y >= H - 5) break;
      digBlob(Math.round(x), Math.round(y), r);
    }
  }

  // ---- THE VILLAGE (0-150): grass, huts, a well, trees ----
  for (let x = 0; x < 150; x++) {
    setCell(idx(x, surf[x]), E.PLANT);
    if (Math.random() < 0.4) setCell(idx(x, surf[x] - 1), E.PLANT);
  }
  hut(14, surf[20], 13, 9);
  hut(52, surf[59], 15, 11);
  hut(98, surf[104], 12, 8);
  hut(126, surf[132], 13, 9);
  const wx = 82;                              // village well
  for (let y = surf[wx] - 1; y < surf[wx] + 11; y++) { setCell(idx(wx - 2, y), E.WALL); setCell(idx(wx + 2, y), E.WALL); }
  fillRect(wx - 1, surf[wx] + 2, wx + 1, surf[wx] + 10, E.WATER);
  setCell(idx(wx, surf[wx] - 3), E.WOOD);
  tree(38, surf[38], 6); tree(140, surf[140], 7);

  // ---- THE CLIMBS (150-320): staggered ledges to hop up (platformers) ----
  const climbHeights = [150, 138, 126, 114, 102, 90, 78, 66];
  for (let i = 0; i < climbHeights.length; i++) {
    const y = climbHeights[i];
    for (let seg = 0; seg < 3; seg++) {
      const x0 = 158 + seg * 54 + (i % 2) * 26;
      platform(x0, x0 + 12 + (i % 3) * 4, y, i > 5 ? E.WOOD : E.STONE);
    }
  }
  platform(232, 250, 54, E.WOOD); // a lookout at the top of the climb

  // ---- THE UPDRAFT (320-470): a deep chasm, pillars, floating perches ----
  const perches = [[334, 96], [360, 72], [392, 84], [352, 50], [408, 58], [436, 90], [420, 40], [376, 34]];
  for (const [px] of [[344], [378], [410], [440]]) fillCol(px, 92 + (px % 3) * 4, BEDROCK - 1, E.STONE); // pillars
  for (const [x, y] of perches) platform(x, x + 9, y, E.STONE);

  // ---- FROSTMERE (470-630): an OPEN snow-rimmed lake (swimmers + fish) ----
  // Snow sits on the shores only, never on the water: ice creep would otherwise
  // freeze the whole lake solid in under a minute and there'd be no water left.
  const sea = surf[498];
  for (let x = 498; x <= 602; x++) if (surf[x] > sea) fillCol(x, sea + 1, surf[x] - 1, E.WATER); // open water
  for (let x = 470; x < 494; x++) { setCell(idx(x, surf[x]), E.ICE); if (Math.random() < 0.5) setCell(idx(x, surf[x] - 1), E.ICE); }
  for (let x = 606; x < 630; x++) { setCell(idx(x, surf[x]), E.ICE); if (Math.random() < 0.5) setCell(idx(x, surf[x] - 1), E.ICE); }
  for (let x = 492; x < 500; x++) fillCol(x, surf[x] - 1, surf[x] + 2, E.SAND); // sandy beach buffers ice from water
  for (let x = 600; x < 608; x++) fillCol(x, surf[x] - 1, surf[x] + 2, E.SAND);
  blob(486, sea - 14, 6, 4, E.ICE); blob(614, sea - 12, 5, 4, E.ICE); // icy bluffs above the shore, clear of the water

  // ---- THE LIFE GARDENS (630-830): open sky full of Game of Life builds ----
  for (let x = 630; x < 830; x++) setCell(idx(x, surf[x]), E.PLANT);
  platform(688, 716, 128, E.STONE); // a viewing terrace
  placePattern(648, 16, GLIDER_GUN, E.LIFE);        // two guns crossing fire
  placePattern(770, 20, GLIDER_GUN, E.LIFE);
  placePattern(700, 58, PRESETS.pulsar.cells, E.LIFE);
  placePattern(660, 96, PRESETS.pentadecathlon.cells, E.LIFE);
  placePattern(806, 52, PRESETS.lwss.cells, E.LIFE);
  placePattern(744, 104, PRESETS.beacon.cells, E.LIFE);
  placePattern(820, 92, PRESETS.acorn.cells, E.LIFE);

  // ---- THE MEADOW (830-900): grass, trees, a little dune ----
  for (let x = 830; x < W; x++) {
    setCell(idx(x, surf[x]), E.PLANT);
    if (Math.random() < 0.4) setCell(idx(x, surf[x] - 1), E.PLANT);
  }
  tree(848, surf[848], 6); tree(878, surf[878], 7);
  for (let x = 860; x < 878; x++) fillCol(x, surf[x] - 3, surf[x], E.SAND);

  // ---- people, living in every region ----
  for (let x = 10; x < 148; x += 12) spawnOn(x, Math.random() < 0.5 ? "wanderer" : "adventurer"); // villagers
  for (let x = 160; x < 316; x += 12) spawnOn(x, "platformer");                                   // the climbs
  for (const [x, y] of perches) spawnPerson(x + 4, y - 2, "daredevil");                            // the updraft
  spawnOn(360, "daredevil"); spawnOn(430, "daredevil");
  spawnOn(516, "swimmer"); spawnOn(542, "swimmer"); spawnOn(566, "swimmer"); spawnOn(588, "swimmer"); spawnOn(500, "wanderer");
  for (let x = 640; x < 824; x += 22) spawnOn(x, Math.random() < 0.5 ? "wanderer" : "adventurer"); // life gardens
  for (let x = 834; x < 896; x += 12) spawnOn(x, Math.random() < 0.5 ? "adventurer" : "wanderer"); // meadow
  spawnOn(196, "digger"); spawnOn(286, "digger"); spawnOn(120, "digger");                          // a few miners

  // ---- critters, the wildlife ----
  for (let x = 40; x < W; x += 70) spawnCritter(x, 24 + Math.random() * 30, "bird");                // birds across the sky
  for (let x = 512; x <= 588; x += 6) {                                                             // fish in the deep of the lake
    let top = -1, bot = -1;
    for (let y = 128; y < H - 4; y++) if (cellAt(x, y) === E.WATER) { if (top < 0) top = y; bot = y; }
    if (top >= 0 && bot - top >= 3) spawnCritter(x, (top + bot) >> 1, "fish");                       // mid-depth, clear of the ice cap
  }
  for (let x = 20; x < 150; x += 24) spawnCritter(x, 60, "frog");                                    // frogs: village
  for (let x = 300; x < 350; x += 16) spawnCritter(x, 60, "frog");                                   //        jungle-ish
  for (let x = 835; x < 895; x += 20) spawnCritter(x, 60, "frog");                                   //        meadow
  for (let n = 0; n < 10; n++) spawnCritter(30 + Math.random() * 120, 70 + Math.random() * 40, "firefly"); // fireflies over the village
  for (let n = 0; n < 8; n++) spawnCritter(650 + Math.random() * 170, 60 + Math.random() * 50, "firefly");  // and the life gardens
}

seedWorld();

// ============================================================
// Logo — a tiny second falling-sand sim that writes SANDFALL,
// each letter built out of a different ingredient. It rains
// into place, holds, collapses, and loops. That's the "engine".
// ============================================================

const GLYPHS = {
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
};
const WORD = "SANDFALL";
const LMAT = ["sand", "water", "plant", "lava", "fire", "acid", "ice", "life"];

const L_BLOCK = 4, L_GAP = 4, L_GW = 5, L_GH = 7, L_PAD = 5;
const logoCanvas = document.getElementById("logo");
const logoTargets = [];
{
  let cursor = 0;
  for (let li = 0; li < WORD.length; li++) {
    const g = GLYPHS[WORD[li]];
    for (let ry = 0; ry < L_GH; ry++) {
      for (let rx = 0; rx < L_GW; rx++) {
        if (g[ry][rx] !== "1") continue;
        for (let by = 0; by < L_BLOCK; by++) {
          for (let bx = 0; bx < L_BLOCK; bx++) {
            logoTargets.push({
              tx: cursor + rx * L_BLOCK + bx,
              ty: L_PAD + ry * L_BLOCK + by,
              mat: LMAT[li], seed: (Math.random() * 255) | 0,
              y: 0, vy: 0, dx: 0, vx: 0, landed: false, delay: 0,
            });
          }
        }
      }
    }
    cursor += L_GW * L_BLOCK + L_GAP;
  }
  var LW = cursor - L_GAP;
  var LH = L_PAD + L_GH * L_BLOCK + 20; // extra room below the word for a little stage
}
logoCanvas.width = LW;
logoCanvas.height = LH;
const logoCtx = logoCanvas.getContext("2d");
const logoImg = logoCtx.createImageData(LW, LH);
const logoPx = logoImg.data;

// A tiny cast: one of every kind of person, each doing their thing on a ground
// strip beneath the word, with the occasional glider drifting past overhead.
// The people and the Life are the heart of the game, so the logo shows them off.
const LOGO_GROUND = LH - 3;
const logoActors = [
  { type: "wanderer", x: 14 }, { type: "adventurer", x: 42 }, { type: "platformer", x: 70 },
  { type: "daredevil", x: 104 }, { type: "digger", x: 134 }, { type: "swimmer", x: 164 },
];
let logoGlider = null;

function logoPut(x, y, r, g, b) {
  x |= 0; y |= 0;
  if (x < 0 || x >= LW || y < 0 || y >= LH) return;
  const p = (y * LW + x) * 4;
  logoPx[p] = r < 0 ? 0 : r > 255 ? 255 : r;
  logoPx[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
  logoPx[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  logoPx[p + 3] = 255;
}

const LOGO_GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];

function drawLogoLife() {
  const gy = LOGO_GROUND, f = logoFrame;
  for (let x = 10; x < LW - 10; x++) logoPut(x, gy + 1, 38, 42, 52); // ground line

  for (const a of logoActors) {
    const c = PTYPES[a.type].color;
    let x = a.x, y = gy, arms = false, sub = null;
    if (a.type === "wanderer") {
      if ((f % 96) < 12) y -= 2;                                   // occasional hop in place
    } else if (a.type === "adventurer") {
      x += Math.round(Math.sin(f * 0.045) * 6);                    // strolls back and forth
    } else if (a.type === "platformer") {
      logoPut(a.x + 5, gy, 122, 126, 138); logoPut(a.x + 6, gy, 122, 126, 138); // a step
      logoPut(a.x + 5, gy - 1, 122, 126, 138);
      const ph = f % 70;
      if (ph < 22) { y -= Math.round(Math.sin(ph / 22 * Math.PI) * 5); x += Math.round(ph / 22 * 5); }
      else { x += 5; y -= 2; }                                     // landed on the step
    } else if (a.type === "daredevil") {
      x += Math.round(Math.cos(f * 0.05) * 6);
      y = gy - 5 - Math.round((Math.sin(f * 0.05) * 0.5 + 0.5) * 10); // loops through the air
      arms = true;
    } else if (a.type === "digger") {
      const ph = f % 40;
      y = gy + (ph < 20 ? Math.round(ph / 20 * 2) : Math.round((40 - ph) / 20 * 2)); // bobs into the dirt
      logoPut(a.x, gy + 2, 150, 118, 84); logoPut(a.x + (f & 1 ? 1 : -1), gy, 150, 118, 84); // kicked earth
    } else if (a.type === "swimmer") {
      for (let dx = -4; dx <= 4; dx++) { logoPut(a.x + dx, gy, 42, 108, 212); logoPut(a.x + dx, gy - 1, 42, 108, 212); }
      y = gy - 1 + Math.round(Math.sin(f * 0.11));                 // bobs in a little pool
    }
    logoPut(x, y - 2, 240, 202, 164);              // head
    logoPut(x, y - 1, c[0], c[1], c[2]);           // torso
    logoPut(x, y, c[0] * 0.55, c[1] * 0.55, c[2] * 0.55); // legs
    if (arms) { logoPut(x - 1, y - 1, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8); logoPut(x + 1, y - 1, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8); }
    else if (Math.abs(x - a.x) > 0.5 && y >= gy - 1) { logoPut(x + (f >> 2 & 1 ? 1 : -1), gy, c[0] * 0.55, c[1] * 0.55, c[2] * 0.55); }
  }

  if (logoGlider) {
    for (const [dx, dy] of LOGO_GLIDER) logoPut(logoGlider.x + dx, logoGlider.y + dy, 124, 255, 216);
  }
}

function resetLogoAssembly() {
  for (const t of logoTargets) {
    t.landed = false;
    t.y = -(Math.random() * LH * 1.6) - 4;
    t.vy = 0; t.dx = 0; t.vx = 0;
    t.delay = t.tx * 0.55 + Math.random() * 16; // writes left-to-right
  }
}
resetLogoAssembly();

let logoFrame = 0, logoPhase = "assemble", logoPhaseT = 0;

function stepLogo() {
  logoFrame++; logoPhaseT++;
  if (logoPhase === "assemble") {
    let all = true;
    for (const t of logoTargets) {
      if (t.landed) continue;
      if (logoPhaseT < t.delay) { all = false; continue; }
      t.vy += 0.12; if (t.vy > 2.2) t.vy = 2.2;
      t.y += t.vy;
      if (t.y >= t.ty) { t.y = t.ty; t.landed = true; }
      else all = false;
    }
    if (all) { logoPhase = "hold"; logoPhaseT = 0; }
  } else if (logoPhase === "hold") {
    if (logoPhaseT > 320) {
      logoPhase = "collapse"; logoPhaseT = 0;
      for (const t of logoTargets) { t.landed = false; t.vy = Math.random() * 0.4; t.vx = (Math.random() - 0.5) * 0.7; }
    }
  } else { // collapse: let the grains fall away, then start over
    let gone = true;
    for (const t of logoTargets) {
      t.vy += 0.14; t.y += t.vy; t.dx += t.vx;
      if (t.y < LH + 8) gone = false;
    }
    if (gone) { resetLogoAssembly(); logoPhase = "assemble"; logoPhaseT = 0; }
  }

  // a glider ambles across the sky above the word every so often
  if (logoGlider) {
    if ((logoFrame & 3) === 0) { logoGlider.x++; if ((logoFrame % 20) === 0) logoGlider.y++; }
    if (logoGlider.x > LW + 2) logoGlider = null;
  } else if (Math.random() < 0.006) {
    logoGlider = { x: -3, y: 1 + (Math.random() * 5 | 0) };
  }
}

function logoColor(mat, s, f) {
  switch (mat) {
    case "sand": { const v = ((s >> 3) & 31) - 15; return [224 + v, 176 + v, 96 + v]; }
    case "water": { const sh = Math.sin((f + s) * 0.11) * 24; return [42 + sh * 0.4, 108 + sh, 214]; }
    case "plant": { const v = ((s >> 2) & 27) - 13; const pulse = Math.sin(f * 0.05 + s) * 12; return [62 + v, 160 + v + pulse, 78 + v]; }
    case "lava": { const fl = (s + f * 2) & 63; return [214 + (fl >> 2), 56 + fl, 18]; }
    case "fire": { const fl = (Math.random() * 44) | 0; return [255, 108 + fl, 20 + (fl >> 1)]; }
    case "acid": { const b = Math.sin(f * 0.2 + s) * 30; return [128, 198 + b, 42]; }
    case "ice": { const v = (s >> 4) & 15; const sp = Math.sin(f * 0.09 + s) * 12; return [168 + v + sp, 216 + v, 240]; }
    case "life": { const pulse = Math.sin(f * 0.09 + s) * 44; return [124 + pulse * 0.5, 255 - Math.abs(pulse) * 0.25, 216]; }
  }
  return [200, 200, 200];
}

function renderLogo() {
  logoPx.fill(0);
  for (const t of logoTargets) {
    const dy = t.landed ? t.ty : Math.round(t.y);
    const dx = t.tx + Math.round(t.dx);
    if (dx < 0 || dx >= LW || dy < 0 || dy >= LH) continue;
    const c = logoColor(t.mat, t.seed, logoFrame);
    const p = (dy * LW + dx) * 4;
    logoPx[p] = c[0] < 0 ? 0 : c[0] > 255 ? 255 : c[0];
    logoPx[p + 1] = c[1] < 0 ? 0 : c[1] > 255 ? 255 : c[1];
    logoPx[p + 2] = c[2] < 0 ? 0 : c[2] > 255 ? 255 : c[2];
    logoPx[p + 3] = 255;
  }
  drawLogoLife();
  logoCtx.putImageData(logoImg, 0, 0);
}

// ---------- main loop ----------

const fpsEl = document.getElementById("fps");
const popEl = document.getElementById("pop-count");
let fpsFrames = 0, fpsLast = performance.now();
let simulationAccumulator = 0;
let logoAccumulator = 0;
let lastTickTime = null;

// A hidden/backgrounded page can pause RAF for an arbitrary amount of time.
// Resetting the clock at lifecycle boundaries discards that gap without
// throttling catch-up during ordinary visible, low-FPS rendering.
function suspendTickClock() { lastTickTime = null; }
document.addEventListener("visibilitychange", suspendTickClock);
window.addEventListener("pagehide", suspendTickClock);
window.addEventListener("pageshow", suspendTickClock);

function tick(timestamp) {
  if (document.hidden) {
    lastTickTime = null;
    requestAnimationFrame(tick);
    return;
  }
  const fallbackNow = performance.now();
  const candidateNow = Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallbackNow;
  const validNow = Number.isFinite(candidateNow) && candidateNow >= 0;
  const now = validNow ? candidateNow : 0;
  const elapsed = !validNow || lastTickTime === null || !Number.isFinite(lastTickTime) || now < lastTickTime
    ? 0
    : now - lastTickTime;
  lastTickTime = validNow ? now : null;

  if (!paused) {
    // Life uses the actual elapsed RAF time, independently of the fixed-step
    // sand accumulator below; any visible backlog remains queued if this
    // frame reaches the defensive work limit.
    advanceLifeElapsed(elapsed);
    simulationAccumulator += elapsed * SIM_SPEEDS[simulationSpeedIndex];
    let worldUpdates = 0;
    while (simulationAccumulator >= SIM_STEP_MS && worldUpdates < MAX_WORLD_CATCH_UP_STEPS) {
      step();
      simulationAccumulator -= SIM_STEP_MS;
      worldUpdates++;
    }
  } else {
    // Do not accumulate time while paused; resuming should continue from the
    // current state rather than replaying the time spent in the pause menu.
    simulationAccumulator = 0;
  }
  // The logo is an independent miniature simulation: it keeps animating while
  // the world is paused, advances on the same fixed 60Hz cadence, and uses
  // the same speed multiplier as the ordinary world. Any visible backlog is
  // retained for later frames rather than discarded.
  logoAccumulator += elapsed * SIM_SPEEDS[simulationSpeedIndex];
  let logoUpdates = 0;
  while (logoAccumulator >= SIM_STEP_MS && logoUpdates < MAX_LOGO_CATCH_UP_STEPS) {
    stepLogo();
    logoAccumulator -= SIM_STEP_MS;
    logoUpdates++;
  }
  emitHeld();
  panCamera();
  render();
  renderLogo();
  fpsFrames++;
  const fpsNow = performance.now();
  if (fpsNow - fpsLast >= 500) {
    fpsEl.textContent = `${Math.round(fpsFrames * 1000 / (fpsNow - fpsLast))} fps`;
    popEl.textContent = `${people.length} people · ${critters.length} critters`;
    fpsFrames = 0;
    fpsLast = fpsNow;
  }
  requestAnimationFrame(tick);
}

tick(performance.now());
