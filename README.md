# Sandfall

A tiny falling-sand alchemy sandbox in a single canvas. No framework, no build step, just HTML/CSS/JS. Paint elements onto a wide 900x200 world, drop in little people, and watch it all interact via simple local rules. The world is a side-scrolling strip of regions, a village, a platforming climb, an open flying updraft, a frozen lake, a Game of Life garden, and a meadow, that you roam through with WASD (every pixel drawn at full size, no zoom, so Game of Life stays crisp).

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
| **stone** | Solid natural rock. Static, so it forms stable cliffs, caves, and platforms. Dissolvable by acid; lava cooling in water leaves it behind. |
| **acid** | Eats sand, stone, plants, oil, wood, and ice. Water dilutes it. Walls and glass resist it. |
| **ice** | Static. Slowly freezes neighboring water, melts near fire and lava. |
| **wood** | A placeable building material: static, solid to stand on, and the stuff trees and village huts are made of. The most flammable thing in the world, fire races along a beam and up a trunk. Acid dissolves it. |
| **life** | Floats in place and evolves by [Conway's Game of Life](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life). Births need empty air, so terrain, water and sand are walls that gliders shatter against. Fragile: fire, lava and acid destroy it. New cells glow bright cyan, aging to deep teal. |
| tunnel supports | Diggers leave wooden roof and floor bracing behind them. It stops loose sand and stone from collapsing into a tunnel, but fire and acid can destroy it. |
| smoke / steam / glass | Byproducts. Smoke dissipates, steam rises and sometimes condenses back into rain, glass is what lava leaves behind in sand. |

## People

Two tools open a little dropdown menu right off the button itself: **life** and **people**. Click one and the menu appears anchored to it.

The **people** aren't cells, they're small agents that walk the terrain, obey gravity, stand on solids (including Game of Life cells), track moving material beneath their feet, and manage health and oxygen. Deep water eventually drowns them, being completely buried suffocates them, and long drops hurt. Fatal falls slump a figure over, lava and fire burn it away, and drowning leaves a fading blue ghost.

| Kind | Behavior |
| --- | --- |
| **wanderer** | The everyman. Alternates between a little walk or hop and standing around to watch the world. |
| **adventurer** | Roams in bursts, vaulting walls and gaps, then pauses before setting off again. |
| **platformer** | Chooses a genuinely lateral landing, solves a compact ballistic arc, and varies between several arc shapes. Recent platforms stay in memory so it does not bounce in the same two-stop loop. Its reach and launch power are roughly half the original long-jump version. |
| **daredevil** | No longer jumps. It plans a safe coarse-grid route to a distant landing, then follows it with powered lift, partial gravity, changing speed, banking, and swooping. It replans around new obstacles; an actual high-speed impact is fatal. |
| **builder** | Sometimes begins with a broad vertical shaft, braces its sides, then cuts wide horizontal branches. Other times it makes stepped diagonal tunnels, and occasionally it stays put to raise a tall, cross-braced support pillar like a mine shaft. Branches get continuous wooden platforms above and below. |
| **swimmer** | Seeks out water and paddles at the surface. It can hold its breath much longer than everyone else, but can still drown. |

Ice has almost no stopping friction: a person can finish walking and keep sliding in the same direction until terrain, friction, or a new decision changes the motion. Ordinary ground brings them to a stop.

There are a few quieter cross-system surprises too: people flee nearby fire, plants make enclosed pockets breathable, hard landings kick loose sand aside, and moving footsteps on Life platforms can leave a rare newborn cell. Life platforms also cushion fall damage and carry a rider as their pattern shifts.

Pick a kind from the menu, then **click or drag** on the canvas to drop people (a drag sprinkles a trail of them). Right-drag removes them along with terrain. The live count sits in the corner.

## Controls

- **Left-drag** paints the selected element or drops people, **right-drag** erases
- **WASD** roams the map; **wheel** and **middle-drag** (or **Shift + left-drag**) also pan; **F** or **home** jumps back to the start
- **1–0** select elements, **o** wood, **g** life, **p** people, **e** the eraser
- Click **life** or **people** for a menu of variants (Game of Life patterns / kinds of person)
- **[** and **]** shrink and grow the brush
- **Space** pauses, **.** advances one frame, **c** clears the world
- With a life **pattern** chosen, **click the canvas** to stamp it (as many times as you like). Picking "free paint" or any element leaves stamp mode.

### Life patterns

Spaceships (glider, lightweight spaceship) that travel, oscillators (toad, beacon, pulsar, pentadecathlon) that loop forever, the endlessly-firing Gosper glider gun, and two methuselahs (R-pentomino, acorn) that erupt into chaos for thousands of generations before settling. Patterns stamp into empty air only, so they won't erase your terrain.

## Things worth trying

- Roam the whole strip with **WASD** (or the minimap): **the village**, **the climbs**, **the updraft**, **frostmere**, **the life gardens**, and **the meadow**. The region name shows in the corner as you go.
- Sit in the **life gardens** and watch two Gosper guns cross fire over a pulsar, a pentadecathlon, and a drifting spaceship. Drop a wall to catch the gliders, or paint your own pattern into the open air.
- Set a **village** hut on fire and watch the flame climb the timber. Wood is the most flammable thing in the world.
- Take a torch to a tree: fire runs right up the trunk and into the canopy.
- On the **frozen lake** in frostmere, break the ice cap and let a few **swimmers** paddle in the open water below.
- Drop a **platformer** at the bottom of **the climbs** and watch it pick its way up the staggered ledges.
- Hang around **the updraft** and watch the **daredevils** bank and swoop between the floating perches. Add a wall mid-flight to test their replanning, or their impact tolerance.
- Pause (space), paint your own Game of Life pattern with **g**, then tap **.** to step through generations one at a time.
- Pour acid onto a stone cliff and carve your own cave. Feel a little bad about it.
- Build something out of **wood** (`o`) and then decide whether it should survive the afternoon.

## How it works

The world is a flat `Uint8Array`, one element id per cell, updated bottom-up once per frame. The scan direction alternates each row and frame to avoid directional bias, and a per-cell frame stamp prevents anything from moving twice in one tick. Powders fall and slide, liquids disperse sideways with per-element viscosity, gases rise and decay, and everything else is neighborhood reactions with small probabilities. Rendering writes RGBA directly into a full-world `ImageData`, then blits the visible slice **1:1** into a fixed camera window (no scaling, so no cell is ever dropped, which keeps Game of Life exact) and draws a small minimap with the camera rectangle so the 900x200 world stays easy to navigate.

The `life` element is the exception to the in-place scan: Conway's Game of Life demands a *simultaneous* update, so it runs as its own pass every few frames, counting live neighbors from the current grid into a scratch buffer and then applying births and deaths all at once. It reuses the per-cell `life` byte as a cell's age, which drives the color gradient from newborn white-cyan to aged teal.

The **people** are the other exception. They're not cells at all, just a list of little agents with floating-point positions, velocities, oxygen, health, support tracking, and role-specific state. Each frame they read the grid, make a decision, run swept collision so jumps and flights cannot skip thin platforms, react to hazards, and get painted directly over the finished world buffer. Platformers rank nearby destinations with recent-platform memory and select among multiple compact ballistic solutions. Daredevils run a coarse A* search, retain short waypoints, and use inertial steering plus gravity to curve through the safe corridor; the same swept check turns fast impacts into deaths. Builders alternate broad supported shafts, wider branches, stepped diagonal paths, and occasional cross-braced pillars; ordinary shaft framing stops once it leaves material so only pillar projects rise into open air. Short-lived death records render the cause-specific animations after an agent is removed.

The **logo** is a completely separate miniature falling-sand sim. A 5x7 bitmap font marks out which pixels each letter needs; every one of those becomes a grain that rains down into place, colored and shimmering by whichever ingredient that letter is made of. Once the whole word has landed it holds for a few seconds, then the grains let go and fall away, and it rebuilds itself, forever.
