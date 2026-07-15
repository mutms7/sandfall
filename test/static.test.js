"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "main.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("main.js passes the Node parser", () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ["--check", "main.js"], {
      cwd: root,
      stdio: "pipe",
    });
  });
});

test("index.html references the local app assets", () => {
  const stylesheet = htmlSource.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/i);
  const script = htmlSource.match(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/i);
  assert.ok(stylesheet, "stylesheet link is present");
  assert.ok(script, "main script link is present");
  assert.equal(path.basename(new URL(stylesheet[1], "https://sandfall.test/").pathname), "style.css");
  assert.equal(path.basename(new URL(script[1], "https://sandfall.test/").pathname), "main.js");
  assert.ok(fs.existsSync(path.join(root, "style.css")), "style.css exists");
  assert.ok(fs.existsSync(path.join(root, "main.js")), "main.js exists");
});

test("index.html exposes the simulation speed controls", () => {
  assert.match(htmlSource, /class=["']speed-controls["']/i);
  for (const id of ["btn-slower", "speed-label", "btn-faster"]) {
    assert.match(htmlSource, new RegExp(`\\bid=["']${id}["']`), `${id} is present`);
  }
  assert.match(htmlSource, /aria-label=["']Simulation speed["']/i);
});

test("timing contract keeps speed on world ticks and raw elapsed time for Life", () => {
  assert.match(mainSource, /const SIM_STEP_MS = 50\s*;/);
  assert.match(mainSource, /const LIFE_STEP_MS = 100\s*;/);
  assert.match(mainSource, /const SIM_SPEEDS = \[0\.5,\s*1,\s*2,\s*4\];/);

  const tick = mainSource.match(/function tick\(timestamp\) \{([\s\S]*?)\n\}/);
  assert.ok(tick, "tick function is present");
  assert.match(tick[1], /advanceLifeElapsed\(elapsed\);/);
  assert.match(tick[1], /simulationAccumulator\s*\+=\s*elapsed\s*\*\s*SIM_SPEEDS\[simulationSpeedIndex\]/);

  const lifeAdvance = mainSource.match(/function advanceLifeElapsed\(elapsedMs\) \{([\s\S]*?)\n\}/);
  assert.ok(lifeAdvance, "Life elapsed-time function is present");
  assert.match(lifeAdvance[1], /lifeElapsedMs\s*\+=\s*elapsedMs;/);
  assert.doesNotMatch(lifeAdvance[1], /SIM_SPEEDS|simulationSpeedIndex|\*\s*speed/);
});
