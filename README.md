# Sandfall

A tiny falling-sand alchemy sandbox in a single canvas. Pure HTML/CSS/JS, zero dependencies, no build step. Paint elements onto a 300x200 grid and watch them interact via simple local rules.

![genre](https://img.shields.io/badge/genre-falling%20sand-e0b060) ![deps](https://img.shields.io/badge/dependencies-0-3ea04e)

## Run it

Open `index.html` in any modern browser. That's it.

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
| smoke / steam / glass | Byproducts. Smoke dissipates, steam rises and sometimes condenses back into rain, glass is what lava leaves behind in sand. |

## Controls

- **Left-drag** paints the selected element, **right-drag** erases
- **1–0** select elements, **e** selects the eraser
- **[** and **]** shrink and grow the brush
- **Space** pauses, **.** advances one frame, **c** clears the world

## Things worth trying

- Poke a hole in the lava shelf's floor and let it drip into the water basin below: instant steam plumes and a growing stone stalagmite.
- Drop fire on the oil slick floating in the basin, then watch the steam rise and rain back down.
- Draw a line of water through the garden and watch the plants swallow it.
- Pour acid on the sand dunes. Feel bad about it.

## How it works

The world is a flat `Uint8Array`, one element id per cell, updated bottom-up once per frame. The scan direction alternates each row and frame to avoid directional bias, and a per-cell frame stamp prevents anything from moving twice in one tick. Powders fall and slide, liquids disperse sideways with per-element viscosity, gases rise and decay, and everything else is neighborhood reactions with small probabilities. Rendering writes RGBA directly into an `ImageData` at grid resolution and lets CSS scale it up with `image-rendering: pixelated`.
