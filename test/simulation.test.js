"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Run the actual simulation with only the browser drawing surface stubbed out.
// Tests exercise world state, not a second implementation of the simulation.
function sandbox({ storageFailure = false, reducedMotion = false } = {}) {
  class Element {
    constructor() {
      this.value = "4";
      this.dataset = {};
      this.textContent = "";
      this.style = { setProperty() {} };
      this.classList = {
        add() {},
        remove() {},
        toggle() {},
        contains() {
          return false;
        },
      };
    }
    addEventListener() {}
    setAttribute() {}
    appendChild() {}
    querySelector() {
      return new Element();
    }
    getContext() {
      return {
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        clearRect() {},
        drawImage() {},
        putImageData() {},
        strokeRect() {},
      };
    }
  }
  const elements = new Map();
  const storage = new Map();
  const context = vm.createContext({
    document: {
      body: new Element(),
      hidden: false,
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      },
      createElement() {
        return new Element();
      },
      addEventListener() {},
      querySelector() {
        return null;
      },
    },
    window: {
      innerWidth: 1440,
      addEventListener() {},
      matchMedia() {
        return { matches: reducedMotion };
      },
    },
    HTMLElement: Element,
    structuredClone,
    performance: { now: () => 1000 },
    requestAnimationFrame() {},
    localStorage: {
      setItem: (key, value) => {
        if (storageFailure) throw new Error("Storage unavailable");
        storage.set(key, value);
      },
      getItem: (key) => storage.get(key),
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8"),
    context,
  );
  return (script) => vm.runInContext(script, context);
}

test("world snapshots restore material, creatures, timing and camera independently", () => {
  const run = sandbox();
  const result = run(`
    clearWorld();
    setCell(idx(20, 30), E.WATER, 7);
    shade[idx(20, 30)] = 123;
    spawnPerson(40, 50, 'swimmer');
    spawnCritter(80, 90, 'fish');
    cameraX = 600; frame = 42; lifeElapsedMs = 35;
    const before = snapshotState('Before');
    people[0].health = 1;
    clearWorld(); cameraX = 225; frame = 0;
    restoreState(before);
    [cells[idx(20,30)] === E.WATER, life[idx(20,30)], shade[idx(20,30)], people.length, people[0].health === before.people[0].health, critters[0].type, cameraX, frame, lifeElapsedMs];
  `);
  assert.deepEqual(Array.from(result), [
    true,
    7,
    123,
    1,
    true,
    "fish",
    600,
    42,
    35,
  ]);
  assert.equal(run("people[0] === before.people[0]"), false);
  assert.equal(run("critters[0] === before.critters[0]"), false);
});

test("a glider moves one cell diagonally in four Life generations", () => {
  const run = sandbox();
  assert.equal(
    run(`
    clearWorld();
    placePattern(100, 50, PRESETS.glider.cells, E.LIFE);
    for (let i = 0; i < 4; i++) stepLife();
    PRESETS.glider.cells.every(([x,y]) => cellAt(101+x,51+y) === E.LIFE)
      && cells.reduce((n,e) => n + (e === E.LIFE),0) === 5;
  `),
    true,
  );
});

test("speed scales world, Life and held pouring together at every display refresh rate", () => {
  const run = sandbox();
  run(`
    render = () => {}; renderLogo = () => {}; stepLogo = () => {};
    var worldCount = 0, lifeCount = 0, pourCount = 0;
    step = () => worldCount++;
    stepLife = () => lifeCount++;
    emitHeld = () => pourCount++;
  `);
  for (const hz of [30, 60, 144]) {
    for (const speed of [0.25, 0.5, 1, 2, 4]) {
      const counts = run(`
        worldCount = lifeCount = pourCount = 0; lifeElapsedMs = 0;
        setSimulationSpeed(SIM_SPEEDS.indexOf(${speed}));
        tick(1000);
        for(let n = 1; n <= ${hz * 4}; n++) tick(1000 + n * 1000 / ${hz});
        [worldCount, lifeCount, pourCount];
      `);
      assert.deepEqual(
        Array.from(counts),
        [240 * speed, 40 * speed, 240 * speed],
        `${hz} Hz at ${speed}x`,
      );
    }
  }
});

test("a throttled frame and a speed change cannot leave a fast-forward backlog", () => {
  const run = sandbox();
  assert.equal(
    run(`
    render = () => {}; renderLogo = () => {}; stepLogo = () => {};
    var count = 0; step = () => count++;
    setSimulationSpeed(SIM_SPEEDS.indexOf(4)); tick(1000); tick(101000);
    const bounded = count === 24 && simulationAccumulator < SIM_STEP_MS;
    setSimulationSpeed(SIM_SPEEDS.indexOf(0.25)); count = 0;
    tick(101100);
    for(let n=1;n<=10;n++) tick(101100+n*100);
    bounded && count === 15 && simulationAccumulator < SIM_STEP_MS;
  `),
    true,
  );
});

test("pause and resume discard time spent paused", () => {
  const run = sandbox();
  assert.equal(
    run(`
    render = () => {}; renderLogo = () => {}; stepLogo = () => {};
    var count = 0; step = () => count++;
    setPaused(true); tick(1000); tick(101000);
    const held = count === 0;
    setPaused(false); tick(101100); tick(101200);
    held && count === 6;
  `),
    true,
  );
});

test("the ninth save does not silently replace an earlier world", () => {
  const run = sandbox();
  assert.equal(
    run(`
    for(let i=0;i<9;i++) { saveNameInput.value = 'World ' + i; saveCurrentState(); }
    saveStates.length === 8 && saveStates[0].name === 'World 0' && saveStates[7].name === 'World 7';
  `),
    true,
  );
});

test("saved worlds round-trip through browser storage, including camera and wildlife", () => {
  const run = sandbox();
  assert.equal(
    run(`
    clearWorld(); cameraX=610; lifeElapsedMs=17;
    setCell(idx(150,150), E.WOOD);
    spawnCritter(110,120,'bird');
    saveNameInput.value = 'A saved moment'; saveCurrentState();
    saveStates.length=0; loadPersistedSaves();
    clearWorld(); cameraX=225; restoreState(saveStates[0]);
    cells[idx(150,150)] === E.WOOD && critters[0].type === 'bird' && cameraX === 610 && lifeElapsedMs === 17;
  `),
    true,
  );
});

test("Life stamps preserve terrain and a cleared world removes all residents", () => {
  const run = sandbox();
  assert.equal(
    run(`
    clearWorld();
    fillRect(0,0,250,180,E.STONE);
    stampPattern(50,50,PRESETS.glider.cells);
    const terrainSurvived = cellAt(50,50) === E.STONE && !cells.includes(E.LIFE);
    spawnPerson(200,50,'wanderer'); spawnCritter(210,50,'bird');
    clearWorld();
    terrainSurvived && people.length === 0 && critters.length === 0 && cells.every(e => e === E.EMPTY);
  `),
    true,
  );
});

test("storage failure keeps the save in memory and explains its lifetime", () => {
  const run = sandbox({ storageFailure: true });
  assert.equal(
    run(`
    saveNameInput.value='Session world'; saveCurrentState();
    saveStates.length === 1 && document.getElementById('save-feedback').textContent.includes('session only');
  `),
    true,
  );
});

test("reduced motion holds the decorative logo fully assembled", () => {
  const run = sandbox({ reducedMotion: true });
  assert.equal(
    run(`
    const initialLogoFrame = logoFrame;
    tick(1100); tick(1200);
    logoFrame === initialLogoFrame && logoTargets.every(target => target.landed && target.y === target.ty);
  `),
    true,
  );
});

test("water flows and pours at half the cadence of other materials and residents", () => {
  const run = sandbox();
  const counts = run(`
    clearWorld(); frame = 0;
    setCell(idx(10,10), E.WATER); setCell(idx(20,10), E.SAND);
    setCell(idx(30,10), E.FIRE); setCell(idx(40,10), E.OIL);
    var counts = {water:0,sand:0,fire:0,oil:0,people:0,wildlife:0,pour:0};
    updateLiquid = (x,y,i,e) => { if(e===E.WATER) counts.water++; else counts.oil++; };
    updatePowder = () => counts.sand++;
    updateFire = () => counts.fire++;
    updatePeople = () => counts.people++;
    updateCritters = () => counts.wildlife++;
    stampBrush = () => counts.pour++;
    painting = true; strokeElement = E.WATER;
    for(let i=0;i<4;i++) { emitHeld(); step(); }
    JSON.stringify(counts);
  `);
  assert.deepEqual(JSON.parse(counts), {
    water: 2,
    sand: 4,
    fire: 4,
    oil: 4,
    people: 4,
    wildlife: 4,
    pour: 2,
  });
  assert.equal(
    run(`
    counts.pour = 0; strokeElement = E.SAND;
    for(let i=0;i<4;i++) { emitHeld(); step(); }
    counts.pour;
  `),
    4,
  );
});
