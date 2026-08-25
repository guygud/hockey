// ============================================================================
// ПОТОК ЗАЕЗДА
// ----------------------------------------------------------------------------
// Жизненный цикл попытки: интро → игра → камера гола/промаха/остановки →
// отчёт → следующая попытка.
//
// Правило структуры: раунд ВСЕГДА заканчивается отчётом, который игрок
// закрывает сам. Никаких авто-рестартов — иначе непонятно, что произошло.
//
// Экономика попыток:
//   гол или потеря жизни → level += 1, попытка сложнее, жизни общие (3 на сет)
//   жизни кончились      → полный сброс на первый уровень
// ============================================================================

import { AIM, MAX_LIVES, MOMENTUM, SPEED, trackLength } from "./balance.js";
import { CINEMA, FEEL, TURN } from "./tuning.js";
import { ROUNDS, ROUND_NEUTRAL } from "./rounds.js";
import { TUTOR } from "./tutorial-script.js";
import { S, emptyStats, mods } from "./state.js";
import { tutorUi, ui } from "./dom.js";
import { ensureAudio, sfx } from "./audio.js";
import { clampTurn } from "./camera.js";
import { invalidateHud, updateHud } from "./hud.js";
import { spawnSparks, updateFx, updateParticles } from "./fx.js";
import { creaseZ, seedIceMarks } from "./spawn.js";
import { speedFor } from "./rules.js";
import { hideTutorCard, tutorSeen } from "./tutorial.js";
import { hideRating, showRating } from "./leaderboard.js";
import { easeInOut } from "./util.js";

const INTRO_TIME = CINEMA.introHold + CINEMA.introDive;

// ---------------------------------------------------------------------------
// Заезды
// ---------------------------------------------------------------------------

/** Тасованная колода, чтобы один и тот же заезд не выпадал два раза подряд. */
function pickRound() {
  if (S.roundDeck.length === 0) {
    S.roundDeck = ROUNDS.slice().sort(() => Math.random() - 0.5);
    const first = S.roundDeck[0];
    if (S.activeRound && first && first.id === S.activeRound.id && S.roundDeck.length > 1) {
      S.roundDeck.push(S.roundDeck.shift());
    }
  }
  return S.roundDeck.shift();
}

// ---------------------------------------------------------------------------
// Пауза и оверлеи
// ---------------------------------------------------------------------------

export function setPaused(on) {
  if (on === S.paused) return;
  if (on) {
    if (S.phase !== "play" || S.cinema || S.tutorPause) return;
    S.paused = true;
    if (ui.pauseOverlay) ui.pauseOverlay.hidden = false;
    document.body.classList.add("paused");
  } else {
    S.paused = false;
    if (ui.pauseOverlay) ui.pauseOverlay.hidden = true;
    document.body.classList.remove("paused");
    S.lastTs = performance.now();
  }
  updateHud();
}

export const togglePause = () => setPaused(!S.paused);

function setCinemaActive(on) {
  document.body.classList.toggle("cinema", !!on);
  if (on) setPaused(false);
  updateHud();
}

/** Интро забирает весь экран: HUD прячется, чтобы не просвечивал. */
export function showIntro(visible) {
  ui.intro.hidden = !visible;
  document.body.classList.toggle("intro-open", visible);
  if (visible) setPaused(false);
}

// ---------------------------------------------------------------------------
// Старт заезда
// ---------------------------------------------------------------------------

/** ?lvl=N в адресе — быстрый прыжок на уровень для отладки баланса. */
function debugStartLevel() {
  try {
    const raw = new URLSearchParams(window.location.search).get("lvl");
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n - 1) : null;
  } catch (err) {
    return null;
  }
}

/** keepLives / keepStreak: переживают попытку внутри одного сета из трёх жизней. */
export function resetRun(opts = {}) {
  // Продолжение на том же банке жизней означает, что следующая попытка сложнее.
  if (opts.keepLives) {
    S.attempt += 1;
    S.level += 1;
  } else {
    S.attempt = 1;
    S.level = 0;
    S.roundDeck = [];
    S.lives = MAX_LIVES;
  }
  const forced = debugStartLevel();
  if (forced != null && !S.tutorOn) {
    S.level = forced;
    S.attempt = Math.max(S.attempt, forced + 1);
  }

  S.activeRound = S.tutorOn ? ROUND_NEUTRAL : pickRound();
  S.runDist = S.tutorOn ? TUTOR.dist : trackLength(S.level, mods(), INTRO_TIME);
  S.mom = MOMENTUM.start;
  if (!opts.keepStreak) S.streak = 0;
  if (!opts.keepGoals) S.goals = 0;

  S.puck = { x: 0, vx: 0, z: 40, vz: speedFor(MOMENTUM.start) };
  S.obstacles.length = 0;
  S.particles.length = 0;
  S.skaters.length = 0;
  S.iceMarks = seedIceMarks();
  S.skaterTimer = 0;

  S.lastSpawnZ = 280;
  S.finalSpawned = false;
  S.sideRedSpawned = 0;
  S.stickCount = 0;

  resetFeel();

  S.runStats = emptyStats();
  S.tutorMode = S.tutorOn ? "script" : "off";
  S.tutorStage = 0;
  S.tutorTimer = 0;
  S.tutorPause = null;
  S.tutorActObs = null;
  S.tutorWatchObs = null;
  S.tutorPracticeIdx = 0;
  S.tutorTaught = 0;
  S.tutorOk = 0;

  S.pendingInputs.length = 0;
  S.framePresses.length = 0;
  S.pendingContinue = null;
  S.pendingAlt = null;
  S.phase = "play";
  S.cinema = { mode: "intro", t: 0, whoosh: false };
  S.outside = 1;
  setCinemaActive(true);
  setPaused(false);

  tutorUi.hideBtn.hidden = !S.tutorOn;
  hideTutorCard();
  hideRating();
  ui.status.hidden = true;
  ui.status.className = "";
  ui.restartBtn.hidden = true;
  ui.reportAltBtn.hidden = true;
  ui.gradeFlash.hidden = true;
  ui.gradeFlash.className = "";
  invalidateHud();
  updateHud();
}

/** Все пружины и вспышки в ноль. */
function resetFeel() {
  S.camX = 0;
  S.tilt = 0;
  S.turn = 0;
  S.turnVel = 0;
  S.turnTarget = 0;
  S.braceLean = 0;
  S.glanceX = 0;
  S.glanceY = 0;
  S.glanceRoll = 0;
  S.wobble = 0;
  S.tremble = 0;
  S.camBoost = 0;
  S.camBoostVel = 0;
  S.camZ = 0;
  S.camZVel = 0;
  S.hoodBob = 0;
  S.hoodBobVel = 0;
  S.aim = 0;
  S.heat = 0;
  S.heatTarget = 0;
  S.heatStreak = 0;
  S.hitFlash = 0;
  S.hitFlashPerfect = false;
  S.damageFlash = 0;
  S.boostFx = 0;
  S.netFlash = 0;
  S.gradeFlashTimer = 0;
  S.beatT = 0;
  S.beatIdx = 0;
  S.beatPulse = 0;
}

/** Назад на титульный экран: подсказки снова считаются непройденными. */
export function resetGame() {
  S.tutorOn = false;
  resetRun({});
  S.phase = "ready";
  S.cinema = null;
  S.outside = 0;
  setCinemaActive(false);
  showIntro(true);
  tutorUi.againBtn.hidden = !tutorSeen();
}

export function startRun(withTutor) {
  ensureAudio();
  showIntro(false);
  S.tutorOn = withTutor === undefined ? !tutorSeen() : !!withTutor;
  resetRun({});
  S.phase = "play";
}

// ---------------------------------------------------------------------------
// Отчёт
// ---------------------------------------------------------------------------

export function showReport(opts) {
  ui.gradeFlash.hidden = true;
  ui.status.hidden = false;
  ui.status.className = opts.cls;
  ui.status.innerHTML =
    `<div class="report-title">${opts.title}</div>` +
    (opts.line ? `<div class="report-line">${opts.line}</div>` : "");
  ui.restartBtn.hidden = false;
  ui.restartBtn.textContent = opts.btnLabel;
  S.pendingContinue = opts.action;
  S.pendingAlt = opts.altAction || null;
  ui.reportAltBtn.hidden = !opts.altLabel;
  if (opts.altLabel) ui.reportAltBtn.textContent = opts.altLabel;
  // Небольшая задержка: иначе нажатие, которым игрок доигрывал, закроет отчёт.
  S.confirmAt = performance.now() + FEEL.confirmDelay;
}

export function runContinue() {
  if (!S.pendingContinue || performance.now() < S.confirmAt) return;
  const next = S.pendingContinue;
  S.pendingContinue = null;
  S.pendingAlt = null;
  next();
}

export function runAlternative() {
  if (!S.pendingAlt || performance.now() < S.confirmAt) return;
  const next = S.pendingAlt;
  S.pendingContinue = null;
  S.pendingAlt = null;
  next();
}

// ---------------------------------------------------------------------------
// Концовки
// ---------------------------------------------------------------------------

function beginCinema(mode, extra) {
  S.cinema = { mode, t: 0, ...extra };
  setCinemaActive(true);
  S.pendingInputs.length = 0;
  ui.gradeFlash.hidden = true;
}

export function startGoalCam() {
  if (S.phase !== "play" || S.tutorOn) return;
  S.phase = "goalcam";
  S.streak += 1;
  S.goals += 1;
  sfx.crease();
  // Пол скорости броска: даже вялый финиш должен смотреться как щелчок.
  beginCinema("goal", { flightVz: Math.max(S.puck.vz * 1.25, SPEED.min * 1.8, 420), hitNet: false });
  // Гол засчитан — возвращаем нос на линию ворот.
  S.turnTarget = 0;
  S.turnVel += -S.turn * 9;
  S.camZVel += 180;
  S.hoodBobVel += 90;
  updateHud();
}

export function startMissCam() {
  if (S.phase !== "play" || S.tutorOn) return;
  S.phase = "misscam";
  sfx.fail();
  // Уезжаем в ту сторону, куда уже был сбит прицел.
  const dir = Math.abs(S.turn) > 0.15 ? Math.sign(S.turn) : Math.random() < 0.5 ? 1 : -1;
  S.turnTarget = clampTurn(dir * TURN.maxSteps);
  S.turn = clampTurn(S.turn + dir * 1.4);
  S.glanceX = dir * 30;
  beginCinema("miss", { flightVz: Math.max(S.puck.vz * 1.1, SPEED.min * 1.5, 360), driftDir: dir });
  S.camZVel += 140;
  S.hoodBobVel += 50;
  S.wobble = Math.max(S.wobble, 0.7);
  updateHud();
}

export function startStallCam() {
  if (S.phase !== "play") return;
  S.phase = "stallcam";
  sfx.stall();
  beginCinema("stall");
}

function finishGoalReport() {
  S.phase = "scored";
  showReport({
    title: "Гол!",
    cls: "report-good",
    btnLabel: "Дальше →",
    action: () => resetRun({ keepLives: true, keepStreak: true, keepGoals: true }),
    line: `Серия ${S.streak} · жизни ${S.lives}`,
  });
}

function finishAttemptFail(title) {
  S.lives = Math.max(0, S.lives - 1);

  if (S.lives <= 0) {
    S.phase = "stalled";
    const finalGoals = S.goals;
    S.streak = 0;
    updateHud();
    showRating(finalGoals);
    S.pendingContinue = () => {
      hideRating();
      resetRun({});
    };
    S.pendingAlt = null;
    S.confirmAt = performance.now() + FEEL.confirmDelay;
    return;
  }

  S.phase = "missed";
  updateHud();
  showReport({
    title,
    cls: "report-bad",
    btnLabel: "Ещё попытка →",
    action: () => resetRun({ keepLives: true, keepStreak: true, keepGoals: true }),
    line: `Жизни: ${S.lives}`,
  });
}

// ---------------------------------------------------------------------------
// Кинематограф
// ---------------------------------------------------------------------------

/** Общий хвост кадра для всех концовок: физика уже не считается. */
function cinemaTail(dt) {
  updateParticles(dt);
  updateFx(dt);
  updateHud();
}

function endCinema(then) {
  S.cinema = null;
  setCinemaActive(false);
  then();
}

/**
 * "intro" — влёт владеет кадром, но шайба уже катится.
 * "block" — концовка, обычный игровой цикл в этом кадре не запускается.
 * null — играем как обычно.
 */
export function updateCinema(dt) {
  const cin = S.cinema;
  if (!cin) return null;
  cin.t += dt;
  S.pendingInputs.length = 0;

  if (cin.mode === "intro") {
    if (cin.t < CINEMA.introHold) {
      S.outside = 1;
    } else if (cin.t < INTRO_TIME) {
      if (!cin.whoosh) {
        cin.whoosh = true;
        sfx.flyIn();
      }
      S.outside = 1 - easeInOut((cin.t - CINEMA.introHold) / CINEMA.introDive);
    } else {
      S.outside = 0;
      endCinema(() => {});
    }
    return "intro";
  }

  if (cin.mode === "goal") {
    // Резкий выход на внешнюю камеру, затем разгон в сетку.
    S.outside = Math.min(1, easeInOut(cin.t / CINEMA.goalPop) * 1.15);
    S.puck.z += cin.flightVz * CINEMA.goalRush * (0.85 + 1.4 * Math.min(1, cin.t / 0.22)) * dt;

    if (!cin.hitNet && S.puck.z >= S.runDist) {
      cin.hitNet = true;
      cin.hitAt = cin.t;
      sfx.goal();
      S.netFlash = 1;
      S.hitFlash = 1;
      S.hitFlashPerfect = true;
      S.boostFx = 1;
      S.camZVel += 220;
      S.camBoostVel += 260;
      spawnSparks(36);
    }
    // Короткий доезд за линию, чтобы удар успел прочитаться до отчёта.
    if (cin.hitNet && S.puck.z < S.runDist + 70) S.puck.z += cin.flightVz * 0.35 * dt;

    cinemaTail(dt);
    S.netFlash = Math.max(0, S.netFlash - dt * 2.4);
    const reportAt = cin.hitNet ? Math.min(CINEMA.goalReportAt, cin.hitAt + 0.45) : CINEMA.goalReportAt;
    if (cin.t >= reportAt) endCinema(finishGoalReport);
    return "block";
  }

  if (cin.mode === "miss") {
    S.outside = Math.min(1, easeInOut(cin.t / CINEMA.goalPop) * 1.15);
    S.puck.z += cin.flightVz * CINEMA.goalRush * (0.85 + 1.2 * Math.min(1, cin.t / 0.22)) * dt;
    S.puck.x += cin.driftDir * (48 + 90 * Math.min(1, cin.t / 0.35)) * dt;
    cinemaTail(dt);
    if (cin.t >= CINEMA.missDur) endCinema(() => finishAttemptFail("Мимо!"));
    return "block";
  }

  if (cin.mode === "stall") {
    S.outside = easeInOut(Math.min(1, cin.t / CINEMA.stallDur));
    S.puck.vz = Math.max(0, S.puck.vz * Math.pow(0.05, dt));
    S.puck.z += S.puck.vz * dt;
    cinemaTail(dt);
    if (cin.t >= CINEMA.stallDur) endCinema(() => finishAttemptFail("Недоехал!"));
    return "block";
  }

  return null;
}

/** Гол засчитывается на пятаке; сбитый прицел там же решает, промах это или нет. */
export function checkGoalLine() {
  if (S.tutorOn || S.puck.z < creaseZ()) return;
  if (S.aim >= AIM.miss) startMissCam();
  else startGoalCam();
}
