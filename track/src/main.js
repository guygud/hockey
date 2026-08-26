// ============================================================================
// ТОЧКА ВХОДА
// ----------------------------------------------------------------------------
// Порядок кадра и привязка к вводу. Рулёжка — удержание, прыжок — нажатие.
// ============================================================================

import { JUMP } from "./balance.js";
import { LENS } from "./tuning.js";
import { S } from "./state.js";
import { canvas, ui } from "./dom.js";
import { resize, W } from "./viewport.js";
import { render } from "./render.js";
import { nudgeLook, tickBeat, updateFx, updateParticles, updateSkaters } from "./fx.js";
import { updateObstacles, updatePuck } from "./drive.js";
import { updateHud } from "./hud.js";
import {
  checkGoalLine,
  resetGame,
  resetRun,
  runAlternative,
  runContinue,
  setPaused,
  showIntro,
  startRun,
  togglePause,
  updateCinema,
} from "./flow.js";

function update(dt) {
  const cine = updateCinema(dt);
  if (cine === "block") return;

  if (S.phase !== "play") {
    updateFx(dt);
    return;
  }

  if (cine === "intro") {
    if (S.cinema && S.cinema.hit) updatePuck(dt);
    updateObstacles();
    updateParticles(dt);
    updateSkaters(dt);
    updateFx(dt);
    updateHud();
    return;
  }

  updatePuck(dt);
  if (S.phase !== "play") {
    updateFx(dt);
    return;
  }

  updateObstacles();
  updateParticles(dt);
  updateSkaters(dt);
  tickBeat(dt);
  updateFx(dt);
  checkGoalLine();
  updateHud();
}

function loop(ts) {
  const dt = Math.min((ts - S.lastTs) / 1000, 0.05);
  S.lastTs = ts;
  const freeze = S.rig && S.rig.hold && !S.rig.pending;
  if (!S.paused && !freeze) update(dt);
  render();
  requestAnimationFrame(loop);
}

function setHeld(code, on) {
  if (!code) return;
  if (code === "left") S.held.left = on;
  else if (code === "right") S.held.right = on;
  else if (code === "brace") {
    S.held.brace = on;
    if (on && !S.paused && S.phase === "play" && !S.cinema) S.jumpBuf = JUMP.buffer;
  }
}

function onPlayPress(code) {
  if (S.paused) return false;
  if (S.cinema && S.cinema.mode !== "intro") return false;
  if (S.phase === "ready") {
    startRun();
    return true;
  }
  if (S.phase !== "play") {
    runContinue();
    return false;
  }
  if (!S.cinema) nudgeLook(code);
  return true;
}

const zoneFromX = (x) => (x < W / 3 ? "left" : x > (W / 3) * 2 ? "right" : "brace");

function codeFromKey(e) {
  if (e.code === "ArrowLeft" || e.code === "KeyA") return "left";
  if (e.code === "ArrowRight" || e.code === "KeyD") return "right";
  if (e.code === "ArrowUp" || e.code === "Space") return "brace";
  return null;
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Escape") {
    e.preventDefault();
    togglePause();
    return;
  }
  const code = codeFromKey(e);
  if (!code) return;
  e.preventDefault();
  if (!onPlayPress(code)) return;
  setHeld(code, true);
});

window.addEventListener("keyup", (e) => {
  const code = codeFromKey(e);
  if (!code) return;
  setHeld(code, false);
});

function bindPointer(el, codeForEvent) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const code = codeForEvent(e);
    S.pointers[e.pointerId] = code;
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (!onPlayPress(code)) return;
    setHeld(code, true);
    if (el.classList && el.classList.contains("touch-btn")) el.classList.add("is-down");
  });
  const release = (e) => {
    const code = S.pointers[e.pointerId];
    delete S.pointers[e.pointerId];
    setHeld(code, false);
    if (el.classList) el.classList.remove("is-down");
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("lostpointercapture", release);
}

bindPointer(canvas, (e) => zoneFromX(e.clientX - canvas.getBoundingClientRect().left));

if (ui.touchControls) {
  for (const btn of ui.touchControls.querySelectorAll("[data-input]")) {
    bindPointer(btn, () => btn.dataset.input);
    btn.addEventListener("click", (e) => e.preventDefault());
  }
}

const narrowUi = window.matchMedia("(max-width: 900px)");
const syncTouchUi = () => document.body.classList.toggle("touch-ui", narrowUi.matches);
syncTouchUi();
if (narrowUi.addEventListener) narrowUi.addEventListener("change", syncTouchUi);
else if (narrowUi.addListener) narrowUi.addListener(syncTouchUi);

function onClick(el, fn) {
  if (!el) return;
  el.addEventListener("click", (e) => {
    e.preventDefault();
    el.blur();
    fn();
  });
}

onClick(ui.restartBtn, () => {
  if (S.pendingContinue) runContinue();
  else {
    showIntro(false);
    resetRun({});
  }
});
onClick(ui.ratingRestart, () => {
  if (S.pendingContinue) runContinue();
});
onClick(ui.startBtn, () => startRun());
onClick(ui.reportAltBtn, runAlternative);
onClick(ui.pauseBtn, togglePause);
onClick(ui.resumeBtn, () => setPaused(false));

window.addEventListener("resize", resize);

const bootParams = new URLSearchParams(window.location.search);
if (bootParams.get("pose") || bootParams.get("rig")) {
  showIntro(false);
  resetRun({});
} else {
  resetGame();
}
if (bootParams.get("rig")) {
  S.rig = { auto: false, hold: false, pending: 0, step: 200, blur: true, vals: {}, autoBtn: null, blurBtn: null, holdBtn: null };
  import("./rig.js").then((m) => m.initRig());
}
resize();
document.documentElement.style.setProperty("--lens-blur", `${LENS.blur}px`);
requestAnimationFrame((ts) => {
  S.lastTs = ts;
  loop(ts);
});
