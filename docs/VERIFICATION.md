# Verification

The redesign was checked in the browser at 320, 390, 768, 1024, and 1440 CSS pixels wide. Phone and tablet layouts use the ingredient drawer. No horizontal page overflow was found at the tested sizes; the narrow-phone brush controls were adjusted during review.

Browser interactions checked:

- All four tutorial exercises, including their completion conditions.
- Tutorial exit restores the prior world, material selection, and pause state.
- Phone ingredient selection closes the drawer and returns focus to its trigger.
- Material, people, and Life pattern selection, including Gosper glider gun previews.
- Dragging the world with the hand tool and selecting named regions.
- Minimap keyboard Home and End reach 0% and 100%.
- Saving a world, persistence across reload, deleting it, and undoing deletion.
- Clearing the world and restoring it with Undo.
- No browser console errors in the inspected session.

`npm test`: 14 checks passed. These cover both script parsers, required app assets and controls, simulation timing, snapshot isolation and restoration, storage round-trips and failure feedback, save capacity, terrain-preserving stamps, glider evolution, and a static assembled logo under reduced motion.

The browser checks used emulated viewport sizes on this computer, not physical iOS or Android devices. The demo is served locally; it has not been deployed publicly.

Playback regression checks exercise 0.25× through 4× at 30, 60, and 144 display frames per second. They verify proportional world updates, Life generations, and held-brush emission, plus bounded work after a long frame and no backlog after changing speed or resuming. Normal speed is 60 world ticks and 10 Life generations per second, while water flows and pours at 30 ticks per second. A regression test verifies water runs at half the cadence of sand, fire, oil, people, and wildlife.
