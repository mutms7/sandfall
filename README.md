# Sandfall

A tiny falling-sand alchemy sandbox in a single canvas. No framework, no build step, just HTML/CSS/JS. Paint elements onto a 300x200 grid, drop in a few little people, and watch it all interact via simple local rules.

The title up top isn't an image, it's a second little sim: each letter of **SANDFALL** is drawn out of a different ingredient (sand, water, plant, lava, fire, acid, ice, and life), rained into place, held, then collapsed and rebuilt on a loop.

![genre](https://img.shields.io/badge/genre-falling%20sand-e0b060) ![build](https://img.shields.io/badge/build%20step-none-3ea04e)

## Run it

Open `index.html` in any modern browser. That's it. (The UI fonts load from Google Fonts, with a system fallback if you're offline.)

Or serve it if you prefer:

```
python -m http.server 8123 -d .
```

## Elements

| Element | Behavior |
| --- | --- |
| **sand** | Falls, piles into dunes, sinks through liquids. Lava fuses it into glass. |
| **water** | Flows and levels out. Quenches fire (flashing into steam), dilutes acid, gets drunk by plants, frozen by ice. |
| **wall** | Indestructible. Build basins, shelves, and mazes. |
| **plant** | Static, but grows by converting adjacent water into more plant. Very flammable. |
| **fire** | Flickers upward, short-lived. Spreads to oil and plants, melts ice, dies against water. Leaves smoke. |
| **oil** | Floats on water, spreads slowly. Burns enthusiastically. |
| **lava** | Viscous, glowing, spits sparks. Ignites what it touches, melts ice, turns sand to glass. Cools into stone on contact with water. |
| **stone** | Falls straight down like rubble. Dissolvable by acid, otherwise inert. |
| **acid** | Eats sand, stone, plants, oil, and ice. Water dilutes it. Walls and glass resist it. |
| **ice** | Static. Slowly freezes neighboring water, melts near fire and lava. |
| **life** | Floats in place and evolves by [Conway's Game of Life](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life). Births need empty air, so terrain, water and sand are walls that gliders shatter against. Fragile: fire, lava and acid destroy it. New cells glow bright cyan, aging to deep teal. |
| smoke / steam / glass | Byproducts. Smoke dissipates, steam rises and sometimes condenses back into rain, glass is what lava leaves behind in sand. |

## People

Two tools open a little dropdown menu right off the button itself: **life** and **people**. Click one and the menu appears anchored to it.

The **people** aren't cells, they're small agents that walk the terrain, obey gravity, stand on solid ground, step up small ledges, and get poofed into smoke if they touch fire or lava. Six kinds, each with its own personality:

| Kind | Behavior |
| --- | --- |
| **wanderer** | The everyman. Hops in place and drifts around a little. |
| **adventurer** | Roams far and fearless, vaulting over walls and gaps as it goes. |
| **platformer** | Hunts for ledges within jump range and leaps up onto them, climbing a staircase step by step. |
| **daredevil** | Launches into huge arcing leaps across the screen, no self-preservation. |
| **digger** | Tunnels straight through sand, plant and stone, carving a person-height hole. |
| **swimmer** | Seeks out the nearest water, dives in, and paddles around at the surface. |

Pick a kind from the menu, then **click or drag** on the canvas to drop people (a drag sprinkles a trail of them). Right-drag removes them along with terrain. The live count sits in the corner.

## Controls

- **Left-drag** paints the selected element or drops people, **right-drag** erases
- **1–0** select elements, **g** life, **p** people, **e** the eraser
- Click **life** or **people** for a menu of variants (Game of Life patterns / kinds of person)
- **[** and **]** shrink and grow the brush
- **Space** pauses, **.** advances one frame, **c** clears the world
- With a life **pattern** chosen, **click the canvas** to stamp it (as many times as you like). Picking "free paint" or any element leaves stamp mode.

### Life patterns

Spaceships (glider, lightweight spaceship) that travel, oscillators (toad, beacon, pulsar, pentadecathlon) that loop forever, the endlessly-firing Gosper glider gun, and two methuselahs (R-pentomino, acorn) that erupt into chaos for thousands of generations before settling. Patterns stamp into empty air only, so they won't erase your terrain.

## Things worth trying

- Poke a hole in the lava shelf's floor and let it drip into the water basin below: instant steam plumes and a growing stone stalagmite.
- Drop fire on the oil slick floating in the basin, then watch the steam rise and rain back down.
- Draw a line of water through the garden and watch the plants swallow it.
- Pour acid on the sand dunes. Feel bad about it.
- Watch the glider gun in the sky: its gliders drift down and disintegrate the instant they hit terrain. Drop a wall in their path and build a life-catcher.
- Pause (space), paint your own Game of Life pattern with **g**, then tap **.** to step through generations one at a time.
- Set a plant garden on fire directly beneath the gun and watch the two automata (chemistry and Conway) run side by side.
- Drop a crowd of **wanderers** on the dunes, then pour water beside them and add a couple of **swimmers**. Watch who goes where.
- Set a **digger** loose on a tall sand dune and let it carve tunnels the sand keeps trying to collapse.
- Build a staircase out of **wall** and drop a **platformer** at the bottom, then see if it can climb to the top.
- Spawn **daredevils** near the lava shelf. It does not end well for them, and that's the fun.

## How it works

The world is a flat `Uint8Array`, one element id per cell, updated bottom-up once per frame. The scan direction alternates each row and frame to avoid directional bias, and a per-cell frame stamp prevents anything from moving twice in one tick. Powders fall and slide, liquids disperse sideways with per-element viscosity, gases rise and decay, and everything else is neighborhood reactions with small probabilities. Rendering writes RGBA directly into an `ImageData` at grid resolution and lets CSS scale it up with `image-rendering: pixelated`.

The `life` element is the exception to the in-place scan: Conway's Game of Life demands a *simultaneous* update, so it runs as its own pass every few frames, counting live neighbors from the current grid into a scratch buffer and then applying births and deaths all at once. It reuses the per-cell `life` byte as a cell's age, which drives the color gradient from newborn white-cyan to aged teal.

The **people** are the other exception. They're not cells at all, just a list of little agents with floating-point positions and velocities. Each frame they read the grid for collision (gravity, ground, single-cell step-ups), run a small type-specific decision (roam, hunt a ledge, tunnel, seek water...), and then get painted as three-pixel figures directly over the finished world buffer. So the cellular automaton and the agents share one grid but never step on each other.

The **logo** is a completely separate miniature falling-sand sim. A 5x7 bitmap font marks out which pixels each letter needs; every one of those becomes a grain that rains down into place, colored and shimmering by whichever ingredient that letter is made of. Once the whole word has landed it holds for a few seconds, then the grains let go and fall away, and it rebuilds itself, forever.
