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
  LIFE: 14,
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
  DISSOLVES[E.OIL] = DISSOLVES[E.ICE] = DISSOLVES[E.LIFE] = 1;
// what the people can stand on / bump into
const SOLID_P = new Uint8Array(16);
SOLID_P[E.WALL] = SOLID_P[E.SAND] = SOLID_P[E.STONE] =
  SOLID_P[E.GLASS] = SOLID_P[E.PLANT] = SOLID_P[E.ICE] = 1;

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
    else if ((t === E.PLANT || t === E.OIL) && Math.random() < 0.4) setCell(j, E.FIRE, 30 + Math.random() * 30);
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
    desc: "hops in place and drifts around a little",
  },
  adventurer: {
    label: "adventurer", color: [226, 150, 66],
    desc: "roams far and fearless, vaults walls and gaps",
  },
  platformer: {
    label: "platformer", color: [86, 210, 112],
    desc: "hunts for ledges and hops up onto them",
  },
  daredevil: {
    label: "daredevil", color: [228, 74, 58],
    desc: "launches into huge arcing leaps, no fear",
  },
  digger: {
    label: "digger", color: [216, 178, 74],
    desc: "tunnels straight through sand and stone",
  },
  swimmer: {
    label: "swimmer", color: [70, 202, 226],
    desc: "seeks out water and paddles at the surface",
  },
};

const MAX_PEOPLE = 400;
const people = [];
const GRAV = 0.05, MAXV = 1.7;

let peopleType = "wanderer";

function spawnPerson(x, y, type) {
  if (people.length >= MAX_PEOPLE) return;
  people.push({
    x, y, vx: 0, vy: 0, type,
    dir: Math.random() < 0.5 ? -1 : 1,
    t: (Math.random() * 120) | 0, next: 0, onGround: false, blocked: false,
    seed: (Math.random() * 255) | 0,
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

// horizontal scan for the nearest water, returns -1 / 0 / +1
function waterDir(x, y) {
  for (let d = 1; d <= 110; d++) {
    if (cellAt(x - d, y) === E.WATER || cellAt(x - d, y + 1) === E.WATER) return -1;
    if (cellAt(x + d, y) === E.WATER || cellAt(x + d, y + 1) === E.WATER) return 1;
  }
  return 0;
}

function tryDig(x, y) {
  const c = cellAt(x, y);
  if (c === E.SAND || c === E.PLANT || c === E.STONE || c === E.GLASS) {
    setCell(idx(x, y), E.EMPTY);
    return true;
  }
  return false;
}

// per-type intent: sets p.vx and occasionally launches a jump (p.vy)
function decide(p) {
  const fx = Math.round(p.x), fy = Math.round(p.y);
  switch (p.type) {

    case "wanderer": {
      if (p.onGround && p.t >= p.next) {
        p.next = p.t + 40 + Math.random() * 90;
        const r = Math.random();
        if (r < 0.5) p.vy = -0.5 - Math.random() * 0.2;        // little hop
        else if (r < 0.75) p.dir = -p.dir;                      // turn around
        p.vx = Math.random() < 0.5 ? 0 : 0.12 * p.dir;          // sometimes stroll
      }
      break;
    }

    case "adventurer": {
      p.vx = 0.42 * p.dir;
      if (p.onGround) {
        const wall = solidP(fx + p.dir, fy) || solidP(fx + p.dir, fy - 1);
        const gap = !solidP(fx + p.dir, fy + 1);
        if (wall || (gap && Math.random() < 0.4)) p.vy = -0.92 - Math.random() * 0.3;
        if (p.blocked && Math.random() < 0.5) p.dir = -p.dir;
        if (p.t >= p.next) { p.next = p.t + 130 + Math.random() * 200; if (Math.random() < 0.3) p.dir = -p.dir; }
      }
      break;
    }

    case "platformer": {
      // set intent only on the ground; keep momentum through the arc so leaps carry
      if (p.onGround) {
        p.vx = 0.3 * p.dir;
        if (p.blocked) {
          p.vy = -1.2 - Math.random() * 0.3;                    // hop over what blocks us
          p.vx = 0.5 * p.dir;
          if (Math.random() < 0.25) p.dir = -p.dir;
        } else if (p.t >= p.next) {
          p.next = p.t + 30 + Math.random() * 35;
          // look for a reachable ledge ahead-and-up (solid with clear air over it)
          let jump = 0;
          for (let dy = 2; dy <= 13 && !jump; dy++) {
            for (let dx = 1; dx <= 11; dx++) {
              const lx = fx + p.dir * dx, ly = fy - dy;
              if (solidP(lx, ly) && !solidP(lx, ly - 1) && !solidP(lx, ly - 2)) {
                jump = Math.min(1.7, 0.6 + dy * 0.11);           // jump just hard enough to clear it
                break;
              }
            }
          }
          const gap = !solidP(fx + p.dir, fy + 1);
          if (jump) { p.vy = -jump; p.vx = 0.55 * p.dir; }      // leap up AND forward onto the ledge
          else if (gap) { p.vy = -0.9; p.vx = 0.5 * p.dir; }    // clear the gap
          else if (Math.random() < 0.3) p.vy = -0.6;            // idle bounce
        }
      }
      break;
    }

    case "daredevil": {
      if (p.onGround) {
        if (p.blocked) p.dir = -p.dir;
        if (p.t >= p.next) {
          p.next = p.t + 28 + Math.random() * 40;
          if (Math.random() < 0.15) p.dir = -p.dir;
          p.vy = -1.25 - Math.random() * 0.4;                   // big launch
          p.vx = (0.6 + Math.random() * 0.35) * p.dir;          // and fling forward
        }
      }
      break;
    }

    case "digger": {
      p.vx = 0.22 * p.dir;
      if (p.onGround) {
        // carve a person-height tunnel ahead, faster than the sand caves back in
        const ax = fx + p.dir;
        tryDig(ax, fy); tryDig(ax, fy - 1); tryDig(ax, fy - 2);
        if (p.blocked) {                                        // wall we can't eat (stone shelf edge, etc.)
          tryDig(fx + p.dir * 2, fy); tryDig(fx + p.dir * 2, fy - 1);
          if (Math.random() < 0.06) p.dir = -p.dir;
        }
        if (Math.random() < 0.03) tryDig(fx, fy + 1);           // occasionally burrow down
        if (p.t >= p.next) { p.next = p.t + 120 + Math.random() * 140; if (Math.random() < 0.25) p.dir = -p.dir; }
      }
      break;
    }

    case "swimmer": {
      const wet = cellAt(fx, fy) === E.WATER || cellAt(fx, fy - 1) === E.WATER;
      if (wet) {
        if (p.t >= p.next) { p.next = p.t + 26 + Math.random() * 40; p.dir = Math.random() < 0.5 ? -1 : 1; }
        p.vx = 0.18 * p.dir;                                    // paddle; buoyancy in physics
        // if about to leave the pool, turn back in so swimmers actually swim
        const ahead = cellAt(fx + p.dir, fy) === E.WATER || cellAt(fx + p.dir, fy + 1) === E.WATER;
        if (!ahead && Math.random() < 0.6) p.dir = -p.dir;
      } else {
        const wd = waterDir(fx, fy);
        if (wd !== 0) {
          p.dir = wd; p.vx = 0.28 * p.dir;
          if (p.onGround && p.blocked) p.vy = -0.9;             // hop toward water
        } else {                                               // no water in sight: mill about
          p.vx = 0.14 * p.dir;
          if (p.onGround && p.t >= p.next) { p.next = p.t + 60 + Math.random() * 90; if (Math.random() < 0.4) p.dir = -p.dir; }
        }
      }
      break;
    }
  }
}

function physics(p) {
  const fxNow = Math.round(p.x), fyNow = Math.round(p.y);
  const buoyant = p.type === "swimmer" &&
    (cellAt(fxNow, fyNow) === E.WATER || cellAt(fxNow, fyNow - 1) === E.WATER);

  // vertical
  if (buoyant) { p.vy -= 0.05; p.vy *= 0.86; }
  else p.vy += GRAV;
  if (p.vy > MAXV) p.vy = MAXV;
  if (p.vy < -MAXV) p.vy = -MAXV;
  p.y += p.vy;

  let fx = Math.round(p.x), fy = Math.round(p.y);
  if (p.vy >= 0) {
    if (solidP(fx, fy + 1)) { p.y = fy; p.vy = 0; }       // rest on top of ground
    else if (solidP(fx, fy)) { p.y = fy - 1; p.vy = 0; }  // dropped into ground, back out
  } else if (solidP(fx, fy - 3)) {
    p.vy = 0;                                             // head bonk (figure is 3 tall)
  }
  fy = Math.round(p.y);
  p.onGround = solidP(fx, fy + 1) === 1;

  // horizontal
  if (p.vx !== 0) {
    const nx = p.x + p.vx, nix = Math.round(nx);
    if (solidP(nix, fy) || solidP(nix, fy - 1)) {
      // step up a single-cell ledge if the space above it is clear
      if (p.onGround && solidP(nix, fy) && !solidP(nix, fy - 1) && !solidP(nix, fy - 2)) {
        p.y -= 1; p.x = nx; p.blocked = false;
      } else { p.vx = 0; p.blocked = true; }
    } else { p.x = nx; p.blocked = false; }
  }

  // bounds
  if (p.x < 1) { p.x = 1; p.dir = 1; }
  if (p.x > W - 2) { p.x = W - 2; p.dir = -1; }
  if (p.y < 3) { p.y = 3; if (p.vy < 0) p.vy = 0; }
  if (p.y > H - 1) { p.y = H - 1; p.vy = 0; p.onGround = true; }
}

function updatePeople() {
  for (let k = people.length - 1; k >= 0; k--) {
    const p = people[k];
    p.t++;
    decide(p);
    physics(p);
    // hazards: the world can be unkind
    const c = cellAt(Math.round(p.x), Math.round(p.y));
    if (c === E.FIRE || c === E.LAVA) {
      const i = idx(Math.round(p.x), Math.max(0, Math.round(p.y) - 1));
      if (cells[i] === E.EMPTY) setCell(i, E.SMOKE, 20 + Math.random() * 20);
      people.splice(k, 1);
    } else if (c === E.ACID && Math.random() < 0.25) {
      people.splice(k, 1);
    }
  }
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

function putPx(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const p = (y * W + x) * 4;
  px[p] = r < 0 ? 0 : r > 255 ? 255 : r;
  px[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
  px[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  px[p + 3] = 255;
}

function drawPeople() {
  for (const p of people) {
    const fx = Math.round(p.x), fy = Math.round(p.y);
    const c = PTYPES[p.type].color;
    const j = (p.seed & 7) - 3;                    // tiny per-person tint jitter
    const r = c[0] + j, g = c[1] + j, b = c[2] + j;
    const walking = p.onGround && Math.abs(p.vx) > 0.04;
    const airborne = !p.onGround;

    putPx(fx, fy - 2, 240, 202, 164);              // head (warm skin)
    putPx(fx, fy - 1, r, g, b);                    // torso
    putPx(fx, fy, r * 0.55, g * 0.55, b * 0.55);   // legs (darker)

    if (airborne) {                                // arms up mid-jump
      putPx(fx - 1, fy - 1, r * 0.8, g * 0.8, b * 0.8);
      putPx(fx + 1, fy - 1, r * 0.8, g * 0.8, b * 0.8);
    } else if (walking) {                          // one leg forward, animated
      const step = ((frame >> 2) & 1) ? p.dir : -p.dir;
      putPx(fx + step, fy, r * 0.55, g * 0.55, b * 0.55);
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
