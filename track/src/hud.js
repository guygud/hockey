// ============================================================================
// HUD
// ----------------------------------------------------------------------------
// Единственный модуль, который пишет в верхнюю панель. Вызывается каждый кадр,
// поэтому каждая запись в DOM проходит через dirty-проверку: сравнить строку
// дешевле, чем заставить браузер пересчитать лейаут.
// ============================================================================

import { SPEED, speedMul } from "./balance.js";
import { FEEL } from "./tuning.js";
import { hud, ui } from "./dom.js";
import { S } from "./state.js";

const shown = { streak: "", level: "", mul: "", speed: "", lives: -1 };

function setText(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

function renderLives() {
  if (shown.lives === S.lives) return;
  shown.lives = S.lives;
  for (let i = 0; i < hud.hearts.length; i++) {
    const filled = i < S.lives;
    hud.hearts[i].classList.toggle("filled", filled);
    hud.hearts[i].classList.toggle("empty", !filled);
  }
}

export function updateHud() {
  setText(hud.streak, String(S.streak));
  renderLives();
  setText(hud.levelNum, String(S.level + 1));

  if (hud.levelMul) {
    const mul = speedMul(S.level);
    const showMul = mul > 1.01;
    hud.levelMul.hidden = !showMul;
    if (showMul) setText(hud.levelMul, ` · x${mul.toFixed(1)}`);
  }

  if (hud.speed) {
    setText(hud.speed, (Math.max(S.puck ? S.puck.vz : 0, 0) * SPEED.kmhScale).toFixed(1));
  }

  document.body.classList.toggle("heat-hot", S.heat > 0.66);

  if (ui.pauseBtn) {
    const canPause = S.phase === "play" && !S.cinema;
    ui.pauseBtn.hidden = !canPause && !S.paused;
    ui.pauseBtn.disabled = !canPause && !S.paused;
  }
}

/** Крупная вспышка оценки по центру: ЧИСТО / НА ВОЛОСОК / НЕ УШЁЛ. */
export function showGrade(text, cls) {
  S.gradeFlashTimer = FEEL.gradeFlashTime;
  ui.gradeFlash.hidden = false;
  ui.gradeFlash.textContent = text;
  ui.gradeFlash.className = cls;
}

export function hideGrade() {
  ui.gradeFlash.hidden = true;
  ui.gradeFlash.className = "";
}

/** Сбросить кеш dirty-проверок — после resetRun панель надо перерисовать целиком. */
export function invalidateHud() {
  shown.lives = -1;
}
