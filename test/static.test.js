"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "main.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("app scripts pass the Node parser", () => {
  assert.doesNotThrow(() => {
    for (const file of ["main.js", "ui.js"]) {
      execFileSync(process.execPath, ["--check", file], {
        cwd: root,
        stdio: "pipe",
      });
    }
  });
});

test("index.html references the local app assets", () => {
  const stylesheet = htmlSource.match(
    /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/i,
  );
  const script = htmlSource.match(
    /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/i,
  );
  assert.ok(stylesheet, "stylesheet link is present");
  assert.ok(script, "main script link is present");
  assert.equal(
    path.basename(new URL(stylesheet[1], "https://sandfall.test/").pathname),
    "style.css",
  );
  assert.equal(
    path.basename(new URL(script[1], "https://sandfall.test/").pathname),
    "main.js",
  );
  assert.ok(fs.existsSync(path.join(root, "style.css")), "style.css exists");
  assert.ok(fs.existsSync(path.join(root, "main.js")), "main.js exists");
});

test("index.html exposes the simulation speed controls", () => {
  assert.match(htmlSource, /class=["']speed-controls["']/i);
  for (const id of ["btn-slower", "speed-label", "btn-faster"]) {
    assert.match(
      htmlSource,
      new RegExp(`\\bid=["']${id}["']`),
      `${id} is present`,
    );
  }
  assert.match(htmlSource, /aria-label=["']Simulation speed["']/i);
});
