"use strict";

// ============================================================
// Sandfall — a falling-sand alchemy sandbox
// One Uint8 grid, simple local rules, surprising chemistry.
// Plus a little population of people who try to live in the mess.
// ============================================================

// ---------- world ----------
const W = 300, H = 200;
const N = W * H;

const E = {
  EMPTY: 0, WALL: 1, SAND: 2, WATER: 3, OIL: 4, FIRE: 5, SMOKE: 6,
  STEAM: 7, PLANT: 8, LAVA: 9, STONE: 10, ACID: 11, ICE: 12, GLASS: 13,
  LIFE: 14, SUPPORT: 15,
};
const ERASER = -1;
const PEOPLE = 100; // a tool sentinel, never stored in the cell grid

const cells = new Uint8Array(N);   // element id per cell
const life = new Uint8Array(N);    // countdown for fire/smoke/steam, age for life
const shade = new Uint8Array(N);   // per-cell color variation, fixed at spawn
const stamp = new Uint32Array(N);  // frame a cell last moved (skip double updates)
const lifeNext = new Uint8Array(N); // scratch buffer for the next GoL generation
let frame = 0;

const LIFE_PERIOD = 6; // frames between Game-of-Life generations (lower = faster)

// lookup tables (arrays beat Sets in the hot loop)
const IS_LIQUID = new Uint8Array(16);
IS_LIQUID[E.WATER] = IS_LIQUID[E.OIL] = IS_LIQUID[E.LAVA] = IS_LIQUID[E.ACID] = 1;
const IS_GAS = new Uint8Array(16);
IS_GAS[E.SMOKE] = IS_GAS[E.STEAM] = 1;
const DENSITY = new Uint8Array(16);
DENSITY[E.OIL] = 2; DENSITY[E.WATER] = 3; DENSITY[E.ACID] = 3; DENSITY[E.LAVA] = 4;
const DISSOLVES = new Uint8Array(16); // what acid can eat
DISSOLVES[E.SAND] = DISSOLVES[E.STONE] = DISSOLVES[E.PLANT] =
  DISSOLVES[E.OIL] = DISSOLVES[E.ICE] = DISSOLVES[E.LIFE] =
  DISSOLVES[E.SUPPORT] = 1;
// what the people can stand on / bump into
const SOLID_P = new Uint8Array(16);
SOLID_P[E.WALL] = SOLID_P[E.SAND] = SOLID_P[E.STONE] =
  SOLID_P[E.GLASS] = SOLID_P[E.PLANT] = SOLID_P[E.ICE] =
  SOLID_P[E.LIFE] = SOLID_P[E.SUPPORT] = 1;

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

function updateStone(x, y, i) {
  // rigid granule: falls straight down, never piles diagonally
  if (y + 1 >= H) return;
  const dn = i + W, b = cells[dn];
  if (b === E.EMPTY || IS_GAS[b] || IS_LIQUID[b]) swapCells(i, dn);
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
    if (t === E.PLANT && Math.random() < 0.10) setCell(j, E.FIRE, 30 + Math.random() * 30);
    else if (t === E.OIL && Math.random() < 0.35) setCell(j, E.FIRE, 25 + Math.random() * 25);
    else if (t === E.SUPPORT && Math.random() < 0.045) setCell(j, E.FIRE, 35 + Math.random() * 35);
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
    else if ((t === E.PLANT || t === E.OIL || t === E.SUPPORT) && Math.random() < 0.4) setCell(j, E.FIRE, 30 + Math.random() * 30);
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
        case E.STONE: updateStone(x, y, i); break;
        case E.ACID: updateAcid(x, y, i); break;
        case E.ICE: updateIce(x, y, i); break;
      }
    }
  }
  if (frame % LIFE_PERIOD === 0) stepLife();
  updatePeople();
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
    label: "digger", color: [216, 178, 74],
    desc: "builds narrow ant shafts with braced branch platforms",
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

// horizontal scan for the nearest water, returns -1 / 0 / +1
function waterDir(x, y) {
  for (let d = 1; d <= 110; d++) {
    if (cellAt(x - d, y) === E.WATER || cellAt(x - d, y + 1) === E.WATER) return -1;
    if (cellAt(x + d, y) === E.WATER || cellAt(x + d, y + 1) === E.WATER) return 1;
  }
  return 0;
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

function placeSupport(x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return false;
  const c = cellAt(x, y);
  if (c === E.EMPTY || c === E.SAND || c === E.STONE || c === E.GLASS || c === E.PLANT) {
    setCell(idx(x, y), E.SUPPORT);
    return true;
  }
  return false;
}

// A horizontal tunnel gets two continuous wooden platforms: one roof beam and
// one floor beam. They hold loose material in place but remain burnable.
function shoreTunnel(x, y) {
  for (let dx = -1; dx <= 1; dx++) {
    placeSupport(x + dx, y - 3);
    placeSupport(x + dx, y + 1);
  }
}

// A narrow vertical shaft uses side rails, keeping the opening from widening as
// sand settles. A small braced chamber is cut when the shaft meets a branch.
function shoreShaft(x, y) {
  for (let dy = -2; dy <= 1; dy++) {
    placeSupport(x - 1, y + dy);
    placeSupport(x + 1, y + dy);
  }
}

function carveJunction(x, y) {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 0; dy++) tryDig(x + dx, y + dy);
  }
  shoreTunnel(x, y);
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
  if (x < 2 || x >= W - 2 || y < 3 || y >= H - 1) return false;
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
        if (!startDaredevilFlight(p)) p.next = p.t + 55 + Math.random() * 85;
      }
      break;
    }

    case "digger": {
      if (p.digMode === "shaft") {
        if (!p.digStarted) {
          if (!p.onGround) break;
          p.digStarted = true;
          p.digStartY = fy;
          if (!p.digDepth) p.digDepth = 10 + Math.random() * 20;
        }
        p.vx = 0;
        tryDig(fx, fy + 1);
        tryDig(fx, fy + 2);
        shoreShaft(fx, fy);
        if (fy - p.digStartY >= p.digDepth || fy >= H - 8) {
          carveJunction(fx, fy);
          p.digMode = "level";
          p.digStarted = false;
          p.dir = Math.random() < 0.5 ? -1 : 1;
          p.next = p.t + 75 + Math.random() * 115;
        }
      } else {
        const ax = fx + p.dir;
        let earthAhead = false;
        for (let look = 1; look <= 2 && !earthAhead; look++) {
          for (let dy = -3; dy <= 1; dy++) {
            const c = cellAt(fx + p.dir * look, fy + dy);
            if (c === E.SAND || c === E.PLANT || c === E.STONE || c === E.GLASS) { earthAhead = true; break; }
          }
        }
        const existingTunnelAhead = cellAt(ax, fy - 3) === E.SUPPORT && cellAt(ax, fy + 1) === E.SUPPORT;
        const tunnelContinues = cellAt(ax + p.dir, fy - 3) === E.SUPPORT && cellAt(ax + p.dir, fy + 1) === E.SUPPORT;
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
        tryDig(ax, fy); tryDig(ax, fy - 1); tryDig(ax, fy - 2);
        shoreTunnel(ax, fy);
        if (p.blocked) {
          if (Math.random() < 0.12) p.dir = -p.dir;
        }
        if (p.onGround && p.t >= p.next) {
          if (Math.random() < 0.64 && fy < H - 15) {
            carveJunction(fx, fy);
            p.digMode = "shaft";
            p.digStarted = true;
            p.digStartY = fy;
            p.digDepth = 9 + Math.random() * 20;
            tryDig(fx, fy + 1);
          } else {
            p.dir = -p.dir;
            p.next = p.t + 70 + Math.random() * 125;
          }
        }
      }
      break;
    }

    case "swimmer": {
      const wet = cellAt(fx, fy) === E.WATER || cellAt(fx, fy - 1) === E.WATER;
      if (wet) {
        if (p.t >= p.next) { p.next = p.t + 26 + Math.random() * 40; p.dir = Math.random() < 0.5 ? -1 : 1; }
        p.desiredVx = 0.18 * p.dir;
        // if about to leave the pool, turn back in so swimmers actually swim
        const ahead = cellAt(fx + p.dir, fy) === E.WATER || cellAt(fx + p.dir, fy + 1) === E.WATER;
        if (!ahead && Math.random() < 0.6) p.dir = -p.dir;
      } else {
        const wd = waterDir(fx, fy);
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

// ---------- rendering ----------

const canvas = document.getElementById("world");
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext("2d");
const img = ctx.createImageData(W, H);
const px = img.data;

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
COLORS[E.SUPPORT] = [154, 104, 52, 22];

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
  drawDeaths();
  ctx.putImageData(img, 0, 0);
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
      } else if (elem === E.WALL || elem === E.PLANT || elem === E.ICE || elem === E.STONE) {
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
let pastePattern = null;   // active Game-of-Life preset, stamped on left-click
let peopleAccum = 0;       // distance accumulator, so a drag spreads people out

function canvasCoords(ev) {
  const rect = canvas.getBoundingClientRect();
  return [
    Math.floor((ev.clientX - rect.left) / rect.width * W),
    Math.floor((ev.clientY - rect.top) / rect.height * H),
  ];
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
  closeMenu();
  const [x, y] = canvasCoords(ev);
  if (pastePattern && ev.button === 0) { stampPattern(x, y, pastePattern); return; }
  painting = true;
  strokeElement = ev.button === 2 ? ERASER : currentElement;
  lastX = x; lastY = y; peopleAccum = 0;
  if (strokeElement === PEOPLE) spawnPerson(x, y, peopleType);
  else {
    if (strokeElement === ERASER) removePeopleNear(x, y, brushRadius + 1);
    stampBrush(x, y, strokeElement);
  }
});

canvas.addEventListener("pointermove", (ev) => {
  if (!painting) return;
  const [x, y] = canvasCoords(ev);
  if (strokeElement === PEOPLE) {
    peopleAccum += Math.hypot(x - lastX, y - lastY);
    while (peopleAccum >= 5) { peopleAccum -= 5; spawnPerson(x, y, peopleType); }
  } else {
    if (strokeElement === ERASER) removePeopleNear(x, y, brushRadius + 1);
    paintLine(lastX, lastY, x, y, strokeElement);
  }
  lastX = x; lastY = y;
});

const endStroke = () => { painting = false; };
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

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
  { e: E.LIFE, label: "life", key: "g", menu: "life" },
  { e: PEOPLE, label: "people", key: "p", menu: "people" },
  { e: ERASER, label: "erase", key: "e" },
];

const SWATCH = {
  [E.SAND]: "#e0b060", [E.WATER]: "#2a6cd4", [E.WALL]: "#5a5f6a",
  [E.PLANT]: "#3ea04e", [E.FIRE]: "#ff8c28", [E.OIL]: "#684e30",
  [E.LAVA]: "#e04a12", [E.STONE]: "#8a8d94", [E.ACID]: "#80de2a",
  [E.ICE]: "#a8d8f0", [E.LIFE]: "#7cffd8", [PEOPLE]: "#cfd6e2",
  [ERASER]: "#05060a",
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
  const items = kind === "life" ? LIFE_MENU : PEOPLE_MENU;
  const pop = document.createElement("div");
  pop.className = "popover";
  pop.innerHTML = `<div class="popover-head">${kind === "life" ? "game of life" : "kind of person"}</div>`;
  const chosenVal = kind === "life" ? currentLifeChoice : peopleType;
  for (const item of items) {
    const it = document.createElement("button");
    it.className = "popover-item" + (item.value === chosenVal ? " chosen" : "");
    it.innerHTML =
      `<span class="dot" style="background:${item.color}"></span>` +
      `<span class="p-text"><span class="p-name">${item.name}</span>` +
      (item.desc ? `<span class="p-desc">${item.desc}</span>` : "") + `</span>`;
    it.addEventListener("click", () => { item.pick(); closeMenu(); });
    pop.appendChild(it);
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
function setPaused(p) {
  paused = p;
  pauseBtn.classList.toggle("active", paused);
  pauseBtn.innerHTML = paused ? "&#9654; resume" : "&#10074;&#10074; pause";
}
pauseBtn.addEventListener("click", () => setPaused(!paused));
document.getElementById("btn-step").addEventListener("click", () => { step(); });
document.getElementById("btn-clear").addEventListener("click", clearWorld);

function clearWorld() {
  cells.fill(E.EMPTY);
  life.fill(0);
  stamp.fill(0);
  people.length = 0;
  deaths.length = 0;
}

document.addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if (ev.key === " ") { ev.preventDefault(); setPaused(!paused); return; }
  if (ev.key === ".") { step(); return; }
  if (ev.key === "c" || ev.key === "C") { clearWorld(); return; }
  if (ev.key === "[") { brushSlider.value = String(Math.max(1, brushRadius - 1)); brushSlider.dispatchEvent(new Event("input")); return; }
  if (ev.key === "]") { brushSlider.value = String(Math.min(16, brushRadius + 1)); brushSlider.dispatchEvent(new Event("input")); return; }
  if (ev.key === "Escape") { closeMenu(); return; }
  const entry = PALETTE.find((p) => p.key === ev.key.toLowerCase());
  if (entry) selectElement(entry.e);
});

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

// seed the two sub-labels with their defaults
subLabels.get(E.LIFE).textContent = "free paint";
subLabels.get(PEOPLE).textContent = PTYPES[peopleType].label;

selectElement(E.SAND);

function seedWorld() {
  // sand dunes, bottom-left
  for (let x = 0; x < 150; x++) {
    const h = 22 + Math.sin(x * 0.045) * 14 + Math.sin(x * 0.11 + 2) * 6;
    fillRect(x, H - 1 - Math.round(h), x, H - 1, E.SAND);
  }
  // walled water basin, bottom-right, with an oil slick on top
  fillRect(185, 152, 187, H - 1, E.WALL);
  fillRect(188, 168, W - 1, H - 1, E.WATER);
  fillRect(215, 163, 260, 167, E.OIL, 0.9);
  // garden ledge with plants
  fillRect(35, 108, 105, 110, E.WALL);
  fillRect(42, 100, 98, 107, E.PLANT, 0.35);
  fillRect(50, 94, 90, 99, E.PLANT, 0.15);
  // a few floating platforms for the platformer folks to find
  fillRect(120, 130, 150, 132, E.WALL);
  fillRect(150, 112, 178, 114, E.WALL);
  fillRect(96, 150, 120, 152, E.WALL);
  // lava shelf, upper right — poke a hole in it and see what happens
  fillRect(205, 62, 265, 64, E.WALL);
  fillRect(203, 48, 205, 61, E.WALL);
  fillRect(265, 48, 267, 61, E.WALL);
  fillRect(206, 54, 264, 61, E.LAVA);
  // ice ridge, upper left
  fillRect(20, 40, 70, 46, E.ICE, 0.85);
  // a glider gun floating in the open sky, streaming life toward the world below
  placePattern(120, 8, GLIDER_GUN, E.LIFE);
  // a small welcoming crowd on the dunes
  for (let n = 0; n < 8; n++) spawnPerson(10 + n * 15, 150, "wanderer");
  spawnPerson(60, 150, "adventurer");
  spawnPerson(30, 150, "platformer");
  spawnPerson(90, 150, "daredevil");
  spawnPerson(122, 150, "digger");
  spawnPerson(198, 158, "swimmer");
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
  var LH = L_PAD * 2 + L_GH * L_BLOCK;
}
logoCanvas.width = LW;
logoCanvas.height = LH;
const logoCtx = logoCanvas.getContext("2d");
const logoImg = logoCtx.createImageData(LW, LH);
const logoPx = logoImg.data;

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
  logoCtx.putImageData(logoImg, 0, 0);
}

// ---------- main loop ----------

const fpsEl = document.getElementById("fps");
const popEl = document.getElementById("pop-count");
let fpsFrames = 0, fpsLast = performance.now();

function tick() {
  if (!paused) step();
  render();
  stepLogo();
  renderLogo();
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast >= 500) {
    fpsEl.textContent = `${Math.round(fpsFrames * 1000 / (now - fpsLast))} fps`;
    popEl.textContent = `${people.length} people`;
    fpsFrames = 0;
    fpsLast = now;
  }
  requestAnimationFrame(tick);
}

tick();
