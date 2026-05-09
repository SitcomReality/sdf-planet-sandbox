import { SdfEngine } from "./engine.js";
import { Hud, SHAPES } from "./ui.js";
import nipplejs from "nipplejs";

let engine, hud, audioCtx;
const keys = {};
let lastT = performance.now();
let fpsAcc = 0, fpsT = lastT;
let isPointerLocked = false;
let qMenuOpen = false;
let moveStick = { x: 0, y: 0 };
let lookStick = { x: 0, y: 0 };

const playSound = async (path) => {
  if (!audioCtx) audioCtx = new AudioContext();
  try {
    const res = await fetch(path);
    const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start();
  } catch(e) {}
};

const init = () => {
  const canvas = document.getElementById("gl-canvas");
  engine = new SdfEngine(canvas);
  hud = new Hud(engine);

  engine.callbacks.onLoadingProgress = (label, frac) => hud.updateProgress(label, frac);
  
  // Actually kick off the logic
  setTimeout(() => {
    engine.seedTerrain();
  }, 10);

  // Input Handling
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase(); keys[k] = true;
    if (k >= "1" && k <= "4") hud.selectShape(parseInt(k)-1);
    if (k === " ") e.preventDefault();

    // Q menu handling
    if (k === "q" && !qMenuOpen) {
      qMenuOpen = true;
      if (isPointerLocked) document.exitPointerLock();
      hud.setPlayOverlay(false); // Hide play prompt when menu is up
      hud.setQMenu(true);
    }

    // Improved Escape handling:
    // - If pointer locked, exit pointer lock (show overlay).
    // - If not pointer locked and the overlay is hidden, request pointer lock (resume).
    // - If not pointer locked and the overlay is visible, hide the overlay (close menu) without re-locking.
    if (e.key === "Escape") {
      const overlayVisible = !hud.elements.playOverlay.classList.contains("hidden");
      if (isPointerLocked) {
        document.exitPointerLock();
      } else if (overlayVisible) {
        hud.setPlayOverlay(false);
      } else {
        canvas.requestPointerLock();
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = false;
    
    // Close Q menu when Q is released
    if (k === "q" && qMenuOpen) {
      qMenuOpen = false;
      hud.setQMenu(false);
      if (!hud.elements.playOverlay.classList.contains("hidden") === false) {
        canvas.requestPointerLock();
      }
    }
  });

  canvas.addEventListener("mousedown", (e) => {
    if (!isPointerLocked) {
      canvas.requestPointerLock();
    } else {
      if (e.button === 0) {
        engine.performAction(false);
        playSound("place.mp3");
      } else if (e.button === 2) {
        engine.ghostSubtractMode = true;
        engine.markDirty();
      }
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (isPointerLocked && e.button === 2) {
      engine.performAction(true);
      engine.ghostSubtractMode = false;
      playSound("remove.mp3");
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPointerLocked || qMenuOpen) return;
    if (keys["e"]) {
      if (keys["shift"]) {
        const scaleDelta = 1 - e.movementY * 0.01;
        const minScale = 0.05, maxScale = 3.0;
        engine.shapeSize = engine.shapeSize.map(s => Math.max(minScale, Math.min(maxScale, s * scaleDelta)));
        engine.markDirty();
      } else {
        engine.rotateGhost(e.movementX, e.movementY);
      }
    } else {
      engine.look(e.movementX, e.movementY);
    }
  });

  window.addEventListener("wheel", (e) => {
    if (!isPointerLocked || qMenuOpen) return;
    e.preventDefault();

    // If E is held, scale the ghost/object; otherwise adjust ghost distance
    if (keys["e"]) {
      // scale factor from wheel (invert sign so wheel up increases size)
      const scaleDelta = 1 - e.deltaY * 0.0025;
      const minScale = 0.05, maxScale = 3.0;
      engine.shapeSize = engine.shapeSize.map(s => {
        const ns = s * scaleDelta;
        return Math.max(minScale, Math.min(maxScale, ns));
      });
      engine.markDirty();
    } else {
      engine.ghostDistance = Math.max(0.8, Math.min(15, engine.ghostDistance - e.deltaY * 0.003));
      engine.markDirty();
    }
  }, { passive: false });

  document.addEventListener("pointerlockchange", () => {
    isPointerLocked = document.pointerLockElement === canvas;
    // Don't show play overlay if we're explicitly in the Q menu
    if (!qMenuOpen) {
      hud.setPlayOverlay(!isPointerLocked);
    }
  });

  // Make the entire play overlay clickable to resume
  hud.elements.playOverlay.addEventListener("mousedown", (e) => {
    // If we're clicking the modal or the background, try to lock
    if (!qMenuOpen) {
      canvas.requestPointerLock();
    }
  });

  document.addEventListener("contextmenu", e => e.preventDefault());

  // Mobile Controls
  if ('ontouchstart' in window) {
    const moveZone = document.createElement("div");
    moveZone.style = "position:absolute; bottom:20px; left:20px; width:150px; height:150px; z-index:50;";
    document.body.appendChild(moveZone);
    const lookZone = document.createElement("div");
    lookZone.style = "position:absolute; bottom:20px; right:20px; width:150px; height:150px; z-index:50;";
    document.body.appendChild(lookZone);

    const mJoy = nipplejs.create({ zone: moveZone, mode: 'static', position: {left: '75px', bottom: '75px'}, color: 'white' });
    mJoy.on('move', (e, data) => { moveStick = { x: data.vector.x, y: data.vector.y }; });
    mJoy.on('end', () => { moveStick = { x: 0, y: 0 }; });

    const lJoy = nipplejs.create({ zone: lookZone, mode: 'static', position: {right: '75px', bottom: '75px'}, color: 'white' });
    lJoy.on('move', (e, data) => { lookStick = { x: data.vector.x, y: data.vector.y }; });
    lJoy.on('end', () => { lookStick = { x: 0, y: 0 }; });
    
    // Add mobile tap for placement
    canvas.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) {
            const now = Date.now();
            if (now - (canvas.lastTap || 0) < 300) {
                engine.performAction(false);
                playSound("place.mp3");
            }
            canvas.lastTap = now;
        }
    });
  }

  requestAnimationFrame(tick);
};

const tick = (now) => {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  const f = (keys["w"] ? 1 : 0) - (keys["s"] ? 1 : 0) + moveStick.y;
  const s = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0) + moveStick.x;
  const u = (keys[" "] ? 1 : 0) - (keys["shift"] ? 1 : 0);
  if (f || s || u) engine.move(f, s, u, dt);
  
  if (lookStick.x || lookStick.y) {
      engine.look(lookStick.x * 20, -lookStick.y * 20);
  }

  if (engine.renderIfDirty(now)) fpsAcc++;
  if (now - fpsT > 1000) {
    hud.updateStats(fpsAcc, engine.edits.length);
    fpsAcc = 0; fpsT = now;
  }
  requestAnimationFrame(tick);
};

if (document.readyState === 'complete') init();
else window.addEventListener('load', init);