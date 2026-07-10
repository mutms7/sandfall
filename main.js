"use strict";

// ============================================================
// Sandfall — a falling-sand alchemy sandbox
// One Uint8 grid, simple local rules, surprising chemistry.
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

const cells = new Uint8Array(N);   // element id per cell
const life = new Uint8Array(N);    // countdown for fire / smoke / steam
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

const NEIGHBORS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const NEIGHBORS8 = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

function idx(x, y) { return y * W + x; }

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
        if (t === E.EMPTY) setCell(i, E.LIFE); // seed patterns into open air only
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

function canvasCoords(ev) {
  const rect = canvas.getBoundingClientRect();
  return [
    Math.floor((ev.clientX - rect.left) / rect.width * W),
    Math.floor((ev.clientY - rect.top) / rect.height * H),
  ];
}

canvas.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  painting = true;
  strokeElement = ev.button === 2 ? ERASER : currentElement;
  [lastX, lastY] = canvasCoords(ev);
  paintLine(lastX, lastY, lastX, lastY, strokeElement);
});

canvas.addEventListener("pointermove", (ev) => {
  if (!painting) return;
  const [x, y] = canvasCoords(ev);
  paintLine(lastX, lastY, x, y, strokeElement);
  lastX = x; lastY = y;
});

const endStroke = () => { painting = false; };
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

// ---------- UI ----------

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
  { e: E.LIFE, label: "life", key: "g" },
  { e: ERASER, label: "erase", key: "e" },
];

const SWATCH = {
  [E.SAND]: "#e0b060", [E.WATER]: "#2a6cd4", [E.WALL]: "#5a5f6a",
  [E.PLANT]: "#3ea04e", [E.FIRE]: "#ff8c28", [E.OIL]: "#684e30",
  [E.LAVA]: "#e04a12", [E.STONE]: "#8a8d94", [E.ACID]: "#80de2a",
  [E.ICE]: "#a8d8f0", [E.LIFE]: "#7cffd8", [ERASER]: "#05060a",
};

const paletteEl = document.getElementById("palette");
const buttons = new Map();

for (const { e, label, key } of PALETTE) {
  const btn = document.createElement("button");
  btn.className = "element-btn";
  btn.innerHTML = `<span class="swatch" style="background:${SWATCH[e]}"></span>${label} <span class="key">${key}</span>`;
  btn.addEventListener("click", () => selectElement(e));
  paletteEl.appendChild(btn);
  buttons.set(e, btn);
}

function selectElement(e) {
  currentElement = e;
  for (const [id, btn] of buttons) btn.classList.toggle("selected", id === e);
}
selectElement(E.SAND);

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
}

document.addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if (ev.key === " ") { ev.preventDefault(); setPaused(!paused); return; }
  if (ev.key === ".") { step(); return; }
  if (ev.key === "c" || ev.key === "C") { clearWorld(); return; }
  if (ev.key === "[") { brushSlider.value = String(Math.max(1, brushRadius - 1)); brushSlider.dispatchEvent(new Event("input")); return; }
  if (ev.key === "]") { brushSlider.value = String(Math.min(16, brushRadius + 1)); brushSlider.dispatchEvent(new Event("input")); return; }
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
  // lava shelf, upper right — poke a hole in it and see what happens
  fillRect(205, 62, 265, 64, E.WALL);
  fillRect(203, 48, 205, 61, E.WALL);
  fillRect(265, 48, 267, 61, E.WALL);
  fillRect(206, 54, 264, 61, E.LAVA);
  // ice ridge, upper left
  fillRect(20, 40, 70, 46, E.ICE, 0.85);
  // a glider gun floating in the open sky, streaming life toward the world below
  placePattern(120, 8, GLIDER_GUN, E.LIFE);
}

seedWorld();

// ---------- main loop ----------

const fpsEl = document.getElementById("fps");
let fpsFrames = 0, fpsLast = performance.now();

function tick() {
  if (!paused) step();
  render();
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast >= 500) {
    fpsEl.textContent = `${Math.round(fpsFrames * 1000 / (now - fpsLast))} fps`;
    fpsFrames = 0;
    fpsLast = now;
  }
  requestAnimationFrame(tick);
}

tick();
