/* The interface is a small layer over the original simulation, with no build step. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const paths = {
    sprout:
      '<path d="M12 21v-9M12 16C5 16 3 12 3 7c6 0 9 3 9 9ZM12 12c0-5 3-8 9-8 0 5-3 8-9 8Z"/>',
    bookmark: '<path d="M6 4h12v17l-6-4-6 4Z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3M12 17h.01"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
    brush:
      '<path d="m13 5 3-3 6 6-3 3-6-6Zm-1 1L6 12l6 6 6-6M5 14c-4 2 1 5-3 8 6 0 9-3 7-5"/>',
    hand: '<path d="M8 13V6a2 2 0 0 1 4 0v6-9a2 2 0 0 1 4 0v10-7a2 2 0 0 1 4 0v10c0 4-3 6-7 6-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2Z"/>',
    eraser: '<path d="m3 14 9-11 9 8-9 11H8Zm4-5 9 8M12 22h9"/>',
    step: '<path d="m5 5 10 7-10 7ZM19 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7"/>',
    refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
    sparkles:
      '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m7 4 14 8-14 8Z"/>',
    trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.sparkles}</svg>`;
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
  $("btn-worlds").setAttribute("aria-label", "My worlds");

  const materialNotes = {
    sand: [
      "Falls into dunes and slips through water. A small pile is a good place to start.",
      "Try lava + sand to make glass.",
    ],
    water: [
      "Finds the low ground, fills a pool, and gives plants room to grow.",
      "Try water + plant to grow a garden.",
    ],
    wall: [
      "An indestructible building material. Make a basin, a bridge, or a little shelter.",
      "Walls hold back liquids, even acid.",
    ],
    plant: [
      "Drinks nearby water and grows into it. A little green can go a long way.",
      "Keep it watered. Keep fire away.",
    ],
    fire: [
      "A brief, bright spark that spreads through plants, oil, and wooden buildings.",
      "Water puts it out and releases steam.",
    ],
    oil: [
      "A slow-moving liquid that floats on water and catches fire very easily.",
      "Pour it over water to see the layers.",
    ],
    lava: [
      "Hot, heavy, and full of possibilities. Melts ice and ignites nearby fuel.",
      "Add water to cool it into stone.",
    ],
    stone: [
      "Solid ground for cliffs, caves, stepping stones, and places to stand.",
      "Acid can carve a passage through it.",
    ],
    acid: [
      "Eats through sand, stone, wood, plants, oil, and ice. Handle with curiosity.",
      "Glass and walls resist it. Water dilutes it.",
    ],
    ice: [
      "A frozen surface that slowly turns neighboring water into more ice.",
      "People slide on it. Heat melts it.",
    ],
    wood: [
      "Build a treehouse, a walkway, or a home. People can stand on it.",
      "Beautifully useful. Very flammable.",
    ],
  };
  const friendlyPeople = {
    wanderer: [
      "Stops to enjoy the view",
      "A small stroll, a little hop, then a moment to watch the world.",
    ],
    adventurer: [
      "Always a little further",
      "Explores in bursts, jumping walls and gaps along the way.",
    ],
    platformer: [
      "Finds the next foothold",
      "Picks a landing and jumps between nearby platforms. Try the climbs.",
    ],
    daredevil: [
      "Takes the scenic flight",
      "Banks and swoops through the air. Give it open sky and a place to land.",
    ],
    digger: [
      "Makes a way underground",
      "Carves tunnels, braces them with wood, and sometimes builds a tower.",
    ],
    swimmer: [
      "Happiest in the water",
      "Looks for a pool and paddles at the surface. Can hold its breath for longer.",
    ],
  };
  const friendlyCritters = {
    bird: [
      "A little life in the sky",
      "Glides through the sky and sometimes dives for a fish.",
    ],
    fish: [
      "At home beneath the surface",
      "Schools in water. Place it in a pool so it can breathe.",
    ],
    frog: [
      "A familiar face by the pond",
      "Hops along shorelines and snacks on nearby fireflies.",
    ],
    firefly: [
      "A flicker in the evening",
      "A wandering glow that follows people. Keep it out of the water.",
    ],
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const groupFor = (e) =>
    e === PEOPLE
      ? "people"
      : e === CRITTERS
        ? "critters"
        : e === E.LIFE
          ? "life"
          : "materials";
  let activeGroup = "materials";
  let lastMaterial = E.SAND;
  let selectedRegion = null;
  let undoAction = null;
  let tutorialState = null;
  let tutorialIndex = 0;
  let tutorialDone = false;
  let tutorialPlacedLife = false;
  let keyboardPoint = { x: 120, y: 75 };

  // Existing palette handles continue to serve keyboard shortcuts.
  for (const e of [PEOPLE, CRITTERS, ERASER]) buttons.get(e).remove();
  for (const [e, button] of buttons) {
    button.title = `${button.getAttribute("aria-label")} (${PALETTE.find((p) => p.e === e).key.toUpperCase()})`;

  }

  function showGroup(group, focus = false) {
    activeGroup = group;
    document.querySelectorAll("[data-group]").forEach((tab) => {
      const selected = tab.dataset.group === group;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(`panel-${tab.dataset.group}`).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }
  function openGroup(group) {
    showGroup(group);
    if (group === "materials") selectElement(lastMaterial);
    else if (group === "people") selectElement(PEOPLE);
    else if (group === "critters") selectElement(CRITTERS);
    else LIFE_MENU.find((item) => item.value === currentLifeChoice).pick();
    syncSelection();
  }
  const tabButtons = [...document.querySelectorAll("[data-group]")];
  tabButtons.forEach((button, i) => {
    button.addEventListener("click", () => openGroup(button.dataset.group));
    button.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (i + 1) % tabButtons.length;
      if (event.key === "ArrowLeft")
        next = (i + tabButtons.length - 1) % tabButtons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabButtons.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      openGroup(tabButtons[next].dataset.group);
      tabButtons[next].focus();
    });
  });

  function specimen(type, color, person) {
    const shapes = person
      ? '<path d="M11 3h4v4h-4zM10 8h6v8h-6zM7 9h3v7H7zM16 9h3v7h-3zM10 16h2v8h-2zM14 16h2v8h-2z"/>'
      : {
          bird: '<path d="M1 9h4v3h4v3h7v-3h4V9h4v6h-5v3H7v-3H1zM14 12h6v3h-6z"/>',
          fish: '<path d="M6 10h12v3h4v6h-4v3H6v-5l-5 4V9l5 4z"/>',
          frog: '<path d="M6 8h4v5h6V8h4v5h2v8H4v-8h2zM1 21h7v3H1zM18 21h7v3h-7z"/>',
          firefly:
            '<path d="M10 12h6v9h-6zM5 9h5v5H5zM16 9h5v5h-5zM11 5h4v4h-4z"/>',
        }[type];
    return `<svg viewBox="0 0 26 28" fill="${color}" aria-hidden="true" shape-rendering="crispEdges">${shapes}</svg>`;
  }
  function buildCreatures(container, menu, person) {
    for (const item of menu) {
      const row = document.createElement("div");
      row.className = "choice-row";
      const button = document.createElement("button");
      button.className = "choice";
      button.dataset.choice = item.value;
      button.dataset.kind = person ? "people" : "critters";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", item.name);
      const detail = (person ? friendlyPeople : friendlyCritters)[
        item.value
      ][0];
      button.innerHTML = `<span class="specimen">${specimen(item.value, item.color, person)}</span><span><strong>${item.name}</strong><small>${detail}</small></span>`;
      button.addEventListener("click", () => {
        item.pick();
        syncSelection();
      });
      const remove = document.createElement("button");
      remove.className = "remove-kind";
      remove.innerHTML = icon("trash");
      remove.setAttribute("aria-label", `Remove all ${item.name}s`);
      remove.title = `Remove all ${item.name}s`;
      remove.addEventListener("click", () => {
        rememberWorld(`Removed ${item.name}s`);
        (person ? killPeopleOfType : killCrittersOfType)(item.value);
      });
      row.append(button, remove);
      container.append(row);
    }
  }
  buildCreatures($("people-options"), PEOPLE_MENU, true);
  buildCreatures($("critter-options"), CRITTER_MENU, false);

  function patternSvg(coords) {
    const maxX = Math.max(...coords.map(([x]) => x)) + 1;
    const maxY = Math.max(...coords.map(([, y]) => y)) + 1;
    return `<svg viewBox="-1 -1 ${maxX + 2} ${maxY + 2}" fill="currentColor" aria-hidden="true" shape-rendering="crispEdges">${coords.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join("")}</svg>`;
  }
  for (const item of LIFE_MENU) {
    const button = document.createElement("button");
    button.className = "pattern";
    button.dataset.pattern = item.value;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `${item.value === "free" ? icon("brush") : patternSvg(PRESETS[item.value].cells)}<span>${cap(item.name)}</span>`;
    button.addEventListener("click", () => {
      item.pick();
      syncSelection();
    });
    $("life-options").append(button);
  }

  function syncSelection() {
    const group = groupFor(currentElement);
    if (currentElement !== ERASER && !panTool) showGroup(group);
    if (group === "materials" && currentElement !== ERASER)
      lastMaterial = currentElement;
    if (currentElement === E.LIFE && !pastePattern) currentLifeChoice = "free";
    let name = PALETTE.find((p) => p.e === currentElement).label;
    let kind = "MATERIAL";
    let description = materialNotes[name]?.[0] || "";
    let interaction = materialNotes[name]?.[1] || "";
    if (currentElement === PEOPLE) {
      name = PTYPES[peopleType].label;
      kind = "PERSON";
      description = friendlyPeople[peopleType][1];
      interaction = "Tap to place one. Drag to add a few.";
    }
    if (currentElement === CRITTERS) {
      name = CTYPES[critterType].label;
      kind = "WILDLIFE";
      description = friendlyCritters[critterType][1];
      interaction = "Every creature needs a place to live.";
    }
    if (currentElement === E.LIFE) {
      name = pastePattern ? PRESETS[currentLifeChoice].label : "Living cells";
      kind = "LIFE";
      description =
        "Tiny cells follow three simple rules. Patterns travel, pulse, grow, and sometimes disappear.";
      interaction = pastePattern
        ? "Tap open sky to place this pattern."
        : "Draw cells in the sky. Pause to build a pattern.";
    }
    if (currentElement === ERASER) {
      name = "Eraser";
      kind = "TOOL";
      description =
        "Clear away materials, people, and wildlife with the same brush.";
      interaction = "Choose any ingredient to start painting again.";
    }
    if (panTool) {
      name = "Explore";
      kind = "TOOL";
      description =
        "Drag the world to see what lies beyond. Nothing gets painted while the hand is selected.";
      interaction = "You can also tap a region on the map.";
    }
    $("mobile-tool-name").textContent = cap(name);
    $("mobile-swatch").style.background =
      panTool || currentElement === ERASER ? "#a4adbd" : SWATCH[currentElement];
    $("selected-name").textContent = name;
    $("selected-kind").textContent = kind;
    $("selected-description").textContent = description;
    $("selected-interaction").textContent = interaction;
    $("selected-swatch").style.background =
      panTool || currentElement === ERASER ? "#a4adbd" : SWATCH[currentElement];
    for (const [id, active] of [
      ["btn-paint", !panTool && currentElement !== ERASER],
      ["btn-pan", panTool],
      ["btn-erase", !panTool && currentElement === ERASER],
    ]) {
      $(id).classList.toggle("active", active);
      $(id).setAttribute("aria-pressed", String(active));
    }
    canvas.classList.toggle("pan-tool", panTool);
    document.querySelectorAll("[data-choice]").forEach((button) => {
      const selected =
        !panTool &&
        (button.dataset.kind === "people"
          ? currentElement === PEOPLE && button.dataset.choice === peopleType
          : currentElement === CRITTERS &&
            button.dataset.choice === critterType);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-pattern]").forEach((button) => {
      const selected =
        !panTool &&
        currentElement === E.LIFE &&
        button.dataset.pattern === currentLifeChoice;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $("brush-preview").style.display = "none";
  }
  function setPan() {
    endStroke();
    panTool = true;
    syncSelection();
  }
  $("btn-pan").addEventListener("click", setPan);
  $("btn-paint").addEventListener("click", () => {
    selectElement(currentElement === ERASER ? lastMaterial : currentElement);
  });
  $("btn-erase").addEventListener("click", () => selectElement(ERASER));
  function syncPlayback() {
    pauseBtn.innerHTML =
      icon(paused ? "play" : "pause") + (paused ? "Play" : "Pause");
    pauseBtn.setAttribute(
      "aria-label",
      paused ? "Play simulation" : "Pause simulation",
    );
    $("run-status").textContent = paused ? "Paused" : "Living";
    $("run-status").classList.toggle("running", !paused);
  }

  // Regions and minimap share one camera. Explicit destinations retain their label
  // even at the world edges, where two destinations can share a camera position.
  const regionNames = [
    "Village",
    "The climbs",
    "The updraft",
    "Frostmere",
    "Life gardens",
    "Meadow",
  ];
  const regionButtons = regionNames.map((name, i) => {
    const button = document.createElement("button");
    button.textContent = name;
    button.addEventListener("click", () => {
      const start = i === 0 ? 0 : REGIONS[i - 1][0];
      cameraX = (start + REGIONS[i][0]) / 2;
      clampCamera();
      selectedRegion = { index: i, cameraX };
      updateViewInfo();
    });
    $("regions").append(button);
    return button;
  });
  let lastRegion = -1;
  function updateRegion(region) {
    if (selectedRegion && selectedRegion.cameraX === cameraX)
      region = selectedRegion.index;
    else selectedRegion = null;
    if (region !== lastRegion) {
      regionButtons.forEach((button, i) => {
        button.classList.toggle("active", i === region);
        button.setAttribute(
          "aria-current",
          i === region ? "location" : "false",
        );
      });
      lastRegion = region;
    }
    const position = Math.round(((cameraX - VIEW_W / 2) / (W - VIEW_W)) * 100);
    if (minimap.getAttribute("aria-valuenow") !== String(position))
      minimap.setAttribute("aria-valuenow", String(position));
    const valueText = `${regionNames[region]}, ${position}% across the world`;
    if (minimap.getAttribute("aria-valuetext") !== valueText)
      minimap.setAttribute("aria-valuetext", valueText);
    return region;
  }
  $("btn-overview").addEventListener("click", () => {
    selectedRegion = null;
    resetCamera();
  });
  function moveMap(event) {
    const rect = minimap.getBoundingClientRect();
    cameraX = ((event.clientX - rect.left) / rect.width) * W;
    selectedRegion = null;
    clampCamera();
    updateViewInfo();
  }
  let draggingMap = false;
  minimap.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    minimap.setPointerCapture(event.pointerId);
    draggingMap = true;
    moveMap(event);
  });
  minimap.addEventListener("pointermove", (event) => {
    if (draggingMap && event.isPrimary) moveMap(event);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    minimap.addEventListener(type, () => {
      draggingMap = false;
    });
  minimap.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    selectedRegion = null;
    if (event.key === "Home") cameraX = 0;
    else if (event.key === "End") cameraX = W;
    else cameraX += event.key === "ArrowLeft" ? -30 : 30;
    clampCamera();
    updateViewInfo();
  });
  const phoneViewport = window.matchMedia("(max-width: 600px)");
  phoneViewport.addEventListener("change", () => {
    VIEW_W = phoneViewport.matches ? 300 : 450;
    canvas.width = VIEW_W;
    canvas.style.setProperty("--view-aspect", VIEW_W / VIEW_H);
    ctx.imageSmoothingEnabled = false;
    clampCamera();
    updateViewInfo();
  });

  // Preview is in screen coordinates, while drawing always uses native cells.
  function showPreview(x, y) {
    const preview = $("brush-preview");
    if (panTool) {
      preview.style.display = "none";
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / VIEW_W;
    preview.style.display = "block";
    preview.style.left = `${x}px`;
    preview.style.top = `${y}px`;
    preview.classList.toggle("stamp-preview", !!pastePattern);
    if (pastePattern) {
      const w = Math.max(...pastePattern.map(([px]) => px)) + 1;
      const h = Math.max(...pastePattern.map(([, py]) => py)) + 1;
      preview.style.width = `${(w + 2) * scale}px`;
      preview.style.height = `${(h + 2) * scale}px`;
      preview.innerHTML = patternSvg(pastePattern);
    } else {
      const diameter =
        currentElement === PEOPLE || currentElement === CRITTERS
          ? 8
          : brushRadius * 2 + 1;
      preview.style.width = preview.style.height = `${diameter * scale}px`;
      preview.innerHTML = "";
    }
  }
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const rect = canvas.getBoundingClientRect();
    showPreview(event.clientX - rect.left, event.clientY - rect.top);
  });
  canvas.addEventListener("pointerleave", () => {
    $("brush-preview").style.display = "none";
  });
  canvas.addEventListener("blur", () => {
    $("brush-preview").style.display = "none";
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      event.stopPropagation();
      const distance = event.shiftKey ? 10 : 3;
      keyboardPoint.x = Math.max(
        0,
        Math.min(
          VIEW_W - 1,
          keyboardPoint.x +
            (event.key === "ArrowLeft"
              ? -distance
              : event.key === "ArrowRight"
                ? distance
                : 0),
        ),
      );
      keyboardPoint.y = Math.max(
        0,
        Math.min(
          H - 1,
          keyboardPoint.y +
            (event.key === "ArrowUp"
              ? -distance
              : event.key === "ArrowDown"
                ? distance
                : 0),
        ),
      );
      const rect = canvas.getBoundingClientRect();
      showPreview(
        (keyboardPoint.x / VIEW_W) * rect.width,
        (keyboardPoint.y / H) * rect.height,
      );
    } else if (event.key === "Enter" && !panTool) {
      event.preventDefault();
      const x = viewRect().x + keyboardPoint.x,
        y = keyboardPoint.y;
      if (pastePattern) stampPattern(x, y, pastePattern);
      else if (currentElement === PEOPLE) spawnPerson(x, y, peopleType);
      else if (currentElement === CRITTERS) spawnCritter(x, y, critterType);
      else {
        stampBrush(x, y, currentElement);
        if (currentElement === ERASER) {
          removePeopleNear(x, y, brushRadius + 1);
          removeCrittersNear(x, y, brushRadius + 1);
        }
      }
      checkTutorial();
    }
  });

  function notice(message, undo = null) {
    undoAction = undo;
    $("notice-text").textContent = message;
    $("notice-undo").hidden = !undo;
    $("notice").hidden = false;
    $("save-undo").hidden = !undo || !message.startsWith("Deleted ");
  }
  function rememberWorld(message) {
    const state = snapshotState("Before change");
    const wasPaused = $("worlds-dialog").open
      ? modalWasPaused.get($("worlds-dialog"))
      : paused;
    notice(message, () => {
      restoreState(state);
      setPaused(wasPaused);
      notice("Your previous world is back.");
    });
  }
  $("notice-undo").addEventListener("click", () => {
    const action = undoAction;
    undoAction = null;
    if (action) action();
  });
  $("save-undo").addEventListener("click", () => {
    const action = undoAction;
    undoAction = null;
    if (action) action();
    $("save-undo").hidden = true;
    $("save-feedback").textContent = "Saved world restored.";
    notice("Saved world restored.");
  });
  $("notice-close").addEventListener("click", () => {
    $("notice").hidden = true;
  });
  $("clear-people").addEventListener("click", () => {
    rememberWorld("Removed all people");
    killAllPeople();
  });
  $("clear-critters").addEventListener("click", () => {
    rememberWorld("Removed all wildlife");
    killAllCritters();
  });

  // Native dialogs supply focus trapping and Escape; pause while reading/saving.
  const modalWasPaused = new Map();
  function openDialog(dialog) {
    endStroke();
    modalWasPaused.set(dialog, paused);
    setPaused(true);
    dialog.showModal();
    if (dialog.id === "worlds-dialog") {
      renderSaves();
      $("save-feedback").textContent = "";
      $("save-undo").hidden = true;
    }
  }
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog
      .querySelector(".dialog-close")
      ?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      setPaused(modalWasPaused.get(dialog) ?? paused);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    });
  }
  const toolsDialog = $("tools-dialog");
  const toolbox = $("toolbox");
  $("btn-library").addEventListener("click", () => {
    toolsDialog.append(toolbox);
    openDialog(toolsDialog);
  });
  $("close-library").addEventListener("click", () => toolsDialog.close());
  toolsDialog.addEventListener("close", () => $("workspace").append(toolbox));
  toolsDialog.addEventListener("click", (event) => {
    const choice = event.target.closest(".element-btn,.choice,.pattern");
    if (
      choice &&
      !(
        choice.classList.contains("element-btn") &&
        Number(choice.dataset.element) === E.LIFE
      )
    )
      toolsDialog.close();
  });
  const drawerViewport = window.matchMedia("(max-width: 860px)");
  drawerViewport.addEventListener("change", () => {
    if (!drawerViewport.matches && toolsDialog.open) toolsDialog.close();
  });
  $("btn-worlds").addEventListener("click", () =>
    openDialog($("worlds-dialog")),
  );
  $("btn-help").addEventListener("click", () => openDialog($("help-dialog")));

  // Four short exercises use the real engine. Original world and editing state
  // are restored on exit, including camera, timing, tool, brush, and pause state.
  const lessons = [
    [
      "Start with a little sand.",
      "Sand is selected. Drag in the open sky to pour a small pile onto the ground. Hold still to keep pouring.",
      "A little gravity at work.",
    ],
    [
      "Give the garden a drink.",
      "Water is selected. Pour it inside the stone bowl. Watch it settle around the plants and help them grow.",
      "Water finds its own level.",
    ],
    [
      "Make room for someone.",
      "A wanderer is selected. Tap above the ground to drop someone into the garden, then watch them find their feet.",
      "A small world has a new resident.",
    ],
    [
      "Let a pattern come to life.",
      "The world is paused and a glider is selected. Tap the open sky to place it, then press Play and watch it travel.",
      "Five cells, a life of their own.",
    ],
  ];
  function practiceGarden() {
    clearWorld();
    fillRect(0, 181, W - 1, H - 1, E.STONE);
    fillRect(0, 177, W - 1, 181, E.SAND);
    tree(265, 177, 28);
    tree(30, 177, 21);
    resetCamera();
    selectedRegion = null;
  }
  function setupLesson() {
    tutorialDone = false;
    tutorialPlacedLife = false;
    endStroke();
    practiceGarden();
    setSimulationSpeed(SIM_SPEEDS.indexOf(1));
    setPaused(false);
    brushSlider.value = "4";
    brushSlider.dispatchEvent(new Event("input"));
    if (tutorialIndex === 0) {
      selectElement(E.SAND);
    }
    if (tutorialIndex === 1) {
      fillRect(72, 115, 76, 176, E.STONE);
      fillRect(220, 115, 224, 176, E.STONE);
      fillRect(72, 168, 224, 176, E.STONE);
      fillRect(112, 165, 130, 167, E.PLANT);
      selectElement(E.WATER);
    }
    if (tutorialIndex === 2) {
      peopleType = "wanderer";
      selectElement(PEOPLE);
    }
    if (tutorialIndex === 3) {
      LIFE_MENU.find((item) => item.value === "glider").pick();
      setPaused(true);
    }
    const [title, description] = lessons[tutorialIndex];
    $("tutorial-progress").textContent =
      `THE PRACTICE GARDEN � ${tutorialIndex + 1} / ${lessons.length}`;
    $("tutorial-title").textContent = title;
    $("tutorial-description").textContent = description;
    $("tutorial-result").textContent = "Your turn";
    $("tutorial-next").disabled = true;
    $("tutorial-next").textContent =
      tutorialIndex === lessons.length - 1 ? "Back to my world" : "Next";
    $("tutorial-skip").textContent =
      tutorialIndex === lessons.length - 1 ? "Finish early" : "Skip step";
    syncSelection();
  }
  function startTutorial() {
    if (tutorialState) {
      $("tutorial").scrollIntoView({ block: "start" });
      return;
    }
    tutorialState = {
      world: snapshotState("Original world"),
      paused,
      speed: simulationSpeedIndex,
      element: currentElement,
      panTool,
      brush: brushRadius,
      peopleType,
      critterType,
      lifeChoice: currentLifeChoice,
      pattern: pastePattern,
      group: activeGroup,
      region: selectedRegion,
      undoAction,
      noticeText: $("notice-text").textContent,
      noticeHidden: $("notice").hidden,
    };
    $("notice").hidden = true;
    undoAction = null;
    tutorialIndex = 0;
    document.body.classList.add("in-tutorial");
    $("tutorial").hidden = false;
    for (const id of ["btn-worlds", "btn-reset", "btn-clear"])
      $(id).disabled = true;
    setupLesson();
    $("tutorial").scrollIntoView({ block: "start" });
    canvas.focus({ preventScroll: true });
  }
  function finishTutorial() {
    if (!tutorialState) return;
    const previous = tutorialState;
    tutorialState = null;
    endStroke();
    restoreState(previous.world);
    setSimulationSpeed(previous.speed);
    setPaused(previous.paused);
    peopleType = previous.peopleType;
    critterType = previous.critterType;
    currentLifeChoice = previous.lifeChoice;
    pastePattern = previous.pattern;
    selectElement(previous.element);
    panTool = previous.panTool;
    brushSlider.value = String(previous.brush);
    brushSlider.dispatchEvent(new Event("input"));
    selectedRegion = previous.region;
    syncSelection();
    showGroup(previous.group);
    $("tutorial").hidden = true;
    document.body.classList.remove("in-tutorial");
    for (const id of ["btn-worlds", "btn-reset", "btn-clear"])
      $(id).disabled = false;
    undoAction = previous.undoAction;
    $("notice-text").textContent = previous.noticeText;
    $("notice").hidden = previous.noticeHidden;
    $("notice-undo").hidden = !undoAction;
    $("btn-tutorial").focus({ preventScroll: true });
    updateViewInfo();
  }
  function checkTutorial() {
    if (!tutorialState || tutorialDone) return;
    let complete = false;
    if (tutorialIndex === 0) {
      let count = 0;
      for (let y = 0; y < 175; y++)
        for (let x = 0; x < 300; x++) if (cells[idx(x, y)] === E.SAND) count++;
      complete = count >= 30;
    }
    if (tutorialIndex === 1) {
      let count = 0;
      for (let y = 110; y < 168; y++)
        for (let x = 77; x < 220; x++)
          if (cells[idx(x, y)] === E.WATER) count++;
      complete = count >= 25;
    }
    if (tutorialIndex === 2) complete = people.length > 0;
    if (tutorialIndex === 3) {
      if (cells.includes(E.LIFE)) tutorialPlacedLife = true;
      complete = tutorialPlacedLife && !paused;
    }
    if (!complete) return;
    tutorialDone = true;
    $("tutorial-next").disabled = false;
    $("tutorial-result").textContent = lessons[tutorialIndex][2];
  }
  function nextLesson() {
    if (tutorialIndex === lessons.length - 1) finishTutorial();
    else {
      tutorialIndex++;
      setupLesson();
      canvas.focus({ preventScroll: true });
    }
  }
  $("tutorial-next").addEventListener("click", nextLesson);
  $("tutorial-skip").addEventListener("click", nextLesson);
  $("tutorial-exit").addEventListener("click", finishTutorial);
  for (const id of ["btn-tutorial", "tutorial-invite"])
    $(id).addEventListener("click", () => {
      if (toolsDialog.open) {
        toolsDialog.addEventListener("close", startTutorial, { once: true });
        toolsDialog.close();
      } else startTutorial();
    });
  $("help-tutorial").addEventListener("click", () => {
    const dialog = $("help-dialog");
    dialog.addEventListener("close", startTutorial, { once: true });
    dialog.close();
  });
  setInterval(checkTutorial, 200);
  window.sandfallUI = {
    syncSelection,
    syncPlayback,
    openGroup,
    setPan,
    updateRegion,
    rememberWorld,
    notice,
  };
  syncSelection();
  syncPlayback();
  updateViewInfo();
})();
