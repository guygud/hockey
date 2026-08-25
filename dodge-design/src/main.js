// ============================================================================
// ТОЧКА ВХОДА
// ----------------------------------------------------------------------------
// Порядок кадра и вся привязка к вводу. Логики здесь нет — только диспетчер:
// кто и в каком порядке получает dt.
// ============================================================================

import { S } from "./state.js";
import { canvas, tutorUi, ui } from "./dom.js";
import { resize, W } from "./viewport.js";
import { render } from "./render.js";
import { nudgeLook, tickBeat, updateFx, updateParticles, updateSkaters } from "./fx.js";
import { dashSide, handleInputs, updateObstacles, updatePuck } from "./rules.js";
import { maybeSpawnObstacles } from "./spawn.js";
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
import {
  endTutor,
  handlePauseInput,
  maybeSpawnPractice,
  scriptTick,
  swallowsInput,
} from "./tutorial.js";

// ---------------------------------------------------------------------------
// Кадр симуляции
// ---------------------------------------------------------------------------

function update(dt) {
  const cine = updateCinema(dt);
  // Концовки владеют кадром целиком: гол, промах и остановка считают себя сами.
  if (cine === "block") return;

  if (S.phase !== "play") {
    S.pendingInputs.length = 0;
    updateFx(dt);
    return;
  }

  // Карточка урока замораживает мир, но вспышки и тряска доигрывают —
  // иначе следующая карточка открывается поверх дрожащего кадра.
  if (S.tutorPause) {
    handlePauseInput();
    updateFx(dt);
    return;
  }

  // Влёт: шайба уже катится, но подсказки и ввод ждут, пока мы окажемся внутри.
  if (cine === "intro") {
    updatePuck(dt);
    updateObstacles(dt);
    updateParticles(dt);
    updateSkaters(dt);
    updateFx(dt);
    updateHud();
    return;
  }

  if (S.tutorOn && S.tutorMode === "script") {
    scriptTick(dt);
    if (S.tutorPause) return;
    if (swallowsInput()) S.pendingInputs.length = 0;
  }

  handleInputs();
  updatePuck(dt);
  // updatePuck мог уронить инерцию в ноль и уехать в камеру остановки.
  if (S.phase !== "play") {
    updateFx(dt);
    return;
  }

  if (S.tutorOn) {
    if (S.tutorMode === "practice") maybeSpawnPractice();
  } else {
    maybeSpawnObstacles();
  }

  updateObstacles(dt);
  updateParticles(dt);
  updateSkaters(dt);
  tickBeat(dt);
  updateFx(dt);
  checkGoalLine();
  updateHud();
}

function loop(ts) {
  // Потолок dt: после вкладки в фоне один кадр не должен телепортировать шайбу.
  const dt = Math.min((ts - S.lastTs) / 1000, 0.05);
  S.lastTs = ts;
  if (!S.paused) update(dt);
  render();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Ввод
// ---------------------------------------------------------------------------

function queueInput(code) {
  if (S.paused) return;
  if (S.phase === "ready") {
    if (code === "brace") startRun();
    return;
  }
  if (S.cinema) return;
  if (S.phase !== "play") {
    // Между раундами любое нажатие подтверждает отчёт — на телефоне не должно
    // быть мёртвых тапов.
    runContinue();
    return;
  }
  // Взгляд дёргается в сторону нажатия; шайба делает рывок на тот же тап.
  nudgeLook(code);
  dashSide(code);
  S.pendingInputs.push(code);
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
  queueInput(code);
});

// Весь экран — три полосы: нажатие попадает в ту колонку, где оно случилось.
// Кнопки HUD лежат над холстом, поэтому двойного срабатывания не будет.
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  queueInput(zoneFromX(e.clientX - canvas.getBoundingClientRect().left));
});

if (ui.touchControls) {
  for (const btn of ui.touchControls.querySelectorAll("[data-input]")) {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      queueInput(btn.dataset.input);
    });
    btn.addEventListener("click", (e) => e.preventDefault());
  }
}

const narrowUi = window.matchMedia("(max-width: 900px)");
const syncTouchUi = () => document.body.classList.toggle("touch-ui", narrowUi.matches);
syncTouchUi();
if (narrowUi.addEventListener) narrowUi.addEventListener("change", syncTouchUi);
else if (narrowUi.addListener) narrowUi.addListener(syncTouchUi);

// Кнопки отчёта и обучения сначала снимают с себя фокус: сфокусированная
// кнопка тоже реагирует на SPACE, которым играют.
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
onClick(tutorUi.hideBtn, endTutor);
onClick(tutorUi.againBtn, () => startRun(true));

window.addEventListener("resize", resize);

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------

resetGame();
resize();
requestAnimationFrame((ts) => {
  S.lastTs = ts;
  loop(ts);
});
