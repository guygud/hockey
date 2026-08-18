// ============================================================================
// ПРАВИЛА
// ----------------------------------------------------------------------------
// Ядро игры: как оценивается нажатие, что оно даёт и чего стоит.
//
// Одна клюшка — один ответ. Окно ответа делится на пять зон по времени до
// контакта (t в секундах, положительное = ещё не доехали):
//
//   t > good           РАНО        клюшка остаётся живой, штраф earlyCost
//   good ≥ t > perfect НОРМАЛЬНО   gain good
//   |t| ≤ perfect      ИДЕАЛЬНО    gain perfect, минимум сбитого прицела
//   -perfect > t ≥ -late НА ВОЛОСОК gain good, но прицел сбивается сильно
//   t < -late          ПРОВАЛ      missCost, прицел сбивается сильнее всего
//
// Синие (свои) клюшки в этой схеме не участвуют: они пассивны, проезжают
// сбоку и сами подталкивают.
// ============================================================================

import {
  AIM,
  MOMENTUM,
  TRACK,
  drainFor,
  foeChance,
  frontalChance,
  speedForMom,
  streakMult,
  windowsFor,
} from "./balance.js";
import { FEEL, HEAT } from "./tuning.js";
import { TUTOR } from "./tutorial-script.js";
import { S, mods } from "./state.js";
import { clampTurn, headingAway } from "./camera.js";
import { sfx } from "./audio.js";
import { showGrade, updateHud } from "./hud.js";
import { spawnSparks } from "./fx.js";
import { taughtOne } from "./tutorial.js";
import { startStallCam } from "./flow.js";

// ---------------------------------------------------------------------------
// Скорость и инерция
// ---------------------------------------------------------------------------

/** Скорость шайбы при текущей инерции. В обучении она ограничена сверху. */
export function speedFor(mom) {
  return speedForMom(mom, S.level, S.tutorOn ? TUTOR.speed : 0);
}

export function applyMom(delta) {
  S.mom = Math.max(0, Math.min(1, S.mom + delta));
  S.puck.vz = speedFor(S.mom);
}

/** Расход инерции в секунду. Урок замораживает полосу: там падение только от удара. */
function drainRate() {
  if (S.tutorOn && S.tutorMode !== "practice") return 0;
  return drainFor(S.level, mods(), S.runDist);
}

// ---------------------------------------------------------------------------
// Тайминг
// ---------------------------------------------------------------------------

const clampUnit = (v) => Math.max(0, Math.min(1, v));

/** Секунды до контакта. Отрицательное — момент уже прошёл. */
export function timeToHit(obs) {
  return (obs.z - (S.puck.z + TRACK.hitLine)) / Math.max(S.puck.vz, 1);
}

/** Границы окна для конкретной клюшки: урок расширяет, заезд может сузить. */
export function timingBounds(obs) {
  return windowsFor(S.level, obs && obs.lesson ? TUTOR.winMul : 1, mods().winMul || 1);
}

/**
 * Общая модель тайминга для оценки нажатия и для блика на льду.
 * phase: approach | perfect | late | null (вне диапазона).
 * intensity 0..1 — пик в центре текущей зоны.
 */
export function timingPhase(obs) {
  const t = timeToHit(obs);
  const bounds = timingBounds(obs);
  if (t > bounds.open || t < -bounds.late) return { phase: null, t, intensity: 0, bounds };

  if (Math.abs(t) <= bounds.perfect) {
    return { phase: "perfect", t, intensity: 1 - Math.abs(t) / Math.max(bounds.perfect, 0.001), bounds };
  }
  if (t > 0) {
    // От первого появления в кадре до кромки идеального окна.
    const span = Math.max(bounds.open - bounds.perfect, 0.001);
    return { phase: "approach", t, intensity: clampUnit(1 - (t - bounds.perfect) / span), bounds };
  }
  // Момент прошёл, но мы ещё внутри окна «на волосок».
  const span = Math.max(bounds.late - bounds.perfect, 0.001);
  return { phase: "late", t, intensity: clampUnit(1 - (-t - bounds.perfect) / span), bounds };
}

/** Ближайшая чужая клюшка с открытым окном — та, на которую сейчас отвечаем. */
function activeWindowObs() {
  let best = null;
  let bestAbs = Infinity;
  for (const obs of S.obstacles) {
    if (obs.resolved || !obs.windowOpen || !obs.foe) continue;
    const a = Math.abs(timeToHit(obs));
    if (a < bestAbs) {
      bestAbs = a;
      best = obs;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Что должен нажать игрок
// ---------------------------------------------------------------------------

/** Уйти в сторону от чужой боковой, прыгнуть через лобовую. Свои ответа не ждут. */
export function wantedInput(side, foe) {
  if (!foe) return null;
  if (side === 0) return "brace";
  return -side < 0 ? "left" : "right";
}

/** Случайная сторона: −1 слева, +1 справа, 0 — лобовая пара. */
export function pickSide() {
  const frontal = frontalChance(mods());
  const r = Math.random();
  if (r < (1 - frontal) * 0.5) return -1;
  if (r < 1 - frontal) return 1;
  return 0;
}

/** Лобовые всегда чужие; боковые делятся, и доля чужих растёт с уровнем. */
export function pickFoe(side) {
  if (side === 0) return true;
  return Math.random() < foeChance(S.level, mods());
}

// ---------------------------------------------------------------------------
// Разрешение клюшки
// ---------------------------------------------------------------------------

/** Верный ответ: grade = perfect | good | late. */
function resolveSuccess(obs, grade) {
  if (obs.resolved) return;
  obs.resolved = true;
  obs.ok = true;

  const perfect = grade === "perfect";
  const late = grade === "late";
  const dodged = obs.foe;
  const gain = dodged
    ? perfect
      ? MOMENTUM.gain.dodgePerfect
      : MOMENTUM.gain.dodgeGood
    : perfect
      ? MOMENTUM.gain.passPerfect
      : MOMENTUM.gain.passGood;
  applyMom(gain * streakMult(S.streak));

  if (dodged) {
    if (perfect) showGrade("ЧИСТО", "grade-perfect");
    else if (late) showGrade("НА ВОЛОСОК", "grade-late");
    else showGrade("УШЁЛ", "grade-good");
  } else {
    if (perfect) showGrade("ИДЕАЛЬНЫЙ ПАС", "grade-perfect");
    else if (late) showGrade("НА ВОЛОСОК", "grade-late");
    else showGrade("ПРИНЯЛ", "grade-good");
  }

  S.runStats[perfect ? "perfect" : late ? "late" : "good"] += 1;
  S.runStats[dodged ? "dodges" : "passes"] += 1;
  S.heatStreak += 1;
  S.heatTarget = Math.min(1, S.heatStreak / HEAT.full);

  // Приём — это контакт: отдача и искры. Уворот — рывок в сторону: кадр
  // швыряет вбок, из «контакта» остаётся только ледяная крошка.
  S.camZVel += (perfect ? 260 : late ? 210 : 165) * (dodged ? 0.5 : 1);
  S.hoodBobVel += perfect ? 130 : late ? 100 : 85;
  S.hitFlash = dodged ? 0.5 : 1;
  S.hitFlashPerfect = perfect;
  S.boostFx = (perfect ? 1 : late ? 0.85 : 0.7) * (dodged ? 0.6 : 1);
  spawnSparks(dodged ? (perfect ? 8 : late ? 10 : 5) : perfect ? 18 : 10);

  if (obs.side === 0) {
    // Лобовая пара: через неё перепрыгивают, а не уходят в сторону.
    S.camBoostVel += perfect ? 520 : late ? 460 : 380;
    S.braceLean = 0;
    S.tilt = 0;
    if (late) {
      S.tremble = Math.max(S.tremble, 0.7);
      S.glanceY = FEEL.glanceY * 1.15;
    }
  } else {
    const dir = -obs.side;
    const swing = late ? 1.7 : 1.35;
    S.braceLean = dir * (perfect ? 40 : late ? 48 : 26) * swing;
    S.tilt = dir * (perfect ? 0.055 : late ? 0.08 : 0.035) * swing;
    // Каждая красная подряд добавляет ещё один шаг доворота от линии ворот.
    S.turnTarget = clampTurn(S.turnTarget + headingAway(obs.side));
    S.aim = Math.min(1, S.aim + (perfect ? AIM.perfect : late ? AIM.late : AIM.good));
    if (late) {
      S.tremble = Math.max(S.tremble, 0.85);
      S.glanceX = dir * FEEL.glanceX * 1.4;
      S.glanceY = FEEL.glanceY * 0.45;
      S.glanceRoll = dir * FEEL.glanceRoll * 1.3;
    }
  }

  if (dodged) sfx.dodge(perfect);
  else sfx.hit(perfect);
  if (obs.practice) taughtOne(true);
  updateHud();
}

/** Своя клюшка проезжает мимо: разгон и успокоение, нажимать ничего не надо. */
function resolveBlueBoost(obs) {
  if (obs.resolved) return;
  obs.resolved = true;
  obs.ok = true;

  applyMom(MOMENTUM.gain.blue * streakMult(S.streak));
  showGrade("ПОДТОЛКНУЛО", "grade-good");
  S.runStats.boosts += 1;
  // Синяя возвращает нос на линию ворот и гасит рыскание.
  S.turnTarget = 0;
  S.turnVel += -S.turn * 10;
  S.aim = Math.max(0, S.aim - AIM.blue);
  S.tremble *= 0.22;
  S.wobble *= 0.28;
  S.camZVel += 260;
  S.camBoostVel += 320;
  S.hoodBobVel += 140;
  S.hitFlash = 0.85;
  S.hitFlashPerfect = true;
  S.boostFx = 0.75;
  spawnSparks(22);
  sfx.hit(true);
  if (obs.practice) taughtOne(true);
  updateHud();
}

/** reason: wrong (не та кнопка) | miss (окно закрылось). */
function resolveFail(obs, reason) {
  if (obs.resolved) return;
  obs.resolved = true;
  obs.ok = false;

  if (!obs.free) applyMom(-MOMENTUM.missCost);
  if (obs.demo) {
    showGrade("УДАР", "grade-miss");
  } else if (reason === "wrong") {
    showGrade("ПОЙМАЛИ", "grade-miss");
    S.runStats.wrong += 1;
  } else {
    showGrade("НЕ УШЁЛ", "grade-miss");
    S.runStats.missed += 1;
  }

  S.heatStreak = 0;
  S.heatTarget = 0;
  S.tremble = 1;
  S.damageFlash = 1;
  S.camZVel -= 60;
  S.hoodBobVel -= 70;
  S.tilt = (Math.random() < 0.5 ? -1 : 1) * 0.1;
  S.wobble = 1;
  S.braceLean = obs.side * -12;
  if (obs.foe && obs.side !== 0) {
    S.turnTarget = clampTurn(S.turnTarget + headingAway(obs.side));
    S.aim = Math.min(1, S.aim + AIM.fail);
  }
  spawnSparks(6);
  sfx.fail();
  if (obs.practice) taughtOne(false);
  updateHud();
}

// ---------------------------------------------------------------------------
// Ввод
// ---------------------------------------------------------------------------

export function handleInputs() {
  S.framePresses = S.pendingInputs.splice(0, S.pendingInputs.length);
  if (S.framePresses.length === 0) return;

  const obs = activeWindowObs();
  // Demo-клюшка должна прилететь сама: ввод игнорируется до столкновения.
  if (obs && (obs.demo || !obs.foe)) return;

  if (!obs) {
    // Рядом синяя — игрок наверняка целился в неё; не наказываем.
    for (const o of S.obstacles) {
      if (!o.foe && !o.resolved && Math.abs(timeToHit(o)) < 1.4) return;
    }
    if (!S.tutorOn) applyMom(-MOMENTUM.whiffCost);
    showGrade("ПУСТО", "grade-whiff");
    S.wobble = 0.4;
    sfx.whiff();
    updateHud();
    return;
  }

  if (obs.answer !== null || obs.resolved) return;

  // Две кнопки в одном кадре — это не ответ, а паника.
  if (S.framePresses.length > 1) {
    obs.answer = "multi";
    resolveFail(obs, "wrong");
    return;
  }

  const pressed = S.framePresses[0];
  const t = timeToHit(obs);
  const b = timingBounds(obs);

  // Верная кнопка, но раньше окна: клюшка живёт дальше, спам стоит инерции.
  if (pressed === obs.want && t > b.good) {
    showGrade("РАНО", "grade-whiff");
    if (!S.tutorOn) applyMom(-MOMENTUM.earlyCost);
    updateHud();
    return;
  }

  if (pressed !== obs.want) {
    obs.answer = pressed;
    resolveFail(obs, "wrong");
    return;
  }

  obs.answer = pressed;
  if (t <= b.perfect && t >= -b.perfect) resolveSuccess(obs, "perfect");
  else if (t <= b.good && t > b.perfect) resolveSuccess(obs, "good");
  else if (t < -b.perfect && t >= -b.late) resolveSuccess(obs, "late");
  else resolveFail(obs, "miss");
}

// ---------------------------------------------------------------------------
// Кадр симуляции
// ---------------------------------------------------------------------------

export function updateObstacles() {
  for (const obs of S.obstacles) {
    if (obs.resolved) continue;
    const t = timeToHit(obs);

    if (!obs.foe) {
      if (t <= 0.08) resolveBlueBoost(obs);
      continue;
    }

    const b = timingBounds(obs);
    if (t < b.open && t > -b.late) obs.windowOpen = true;
    if (obs.windowOpen && obs.answer === null && t < -b.late) resolveFail(obs, "miss");
  }

  // Выбрасываем уехавшие за спину. Фильтр на месте, без новой пачки массивов.
  const list = S.obstacles;
  let write = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.z > S.puck.z - 80 || !o.resolved) list[write++] = o;
  }
  list.length = write;
}

export function updatePuck(dt) {
  applyMom(-drainRate() * dt);

  if (S.mom <= 0) {
    S.mom = 0;
    startStallCam();
    return;
  }

  S.puck.x = 0;
  S.puck.z += S.puck.vz * dt;

  // Редкая крошка из-под шайбы, чтобы движение читалось даже на пустом льду.
  if (Math.random() < dt * 14) {
    S.particles.push({
      x: (Math.random() - 0.5) * 8,
      z: S.puck.z - 4,
      life: 0.25 + Math.random() * 0.2,
      max: 0.4,
    });
  }
}
