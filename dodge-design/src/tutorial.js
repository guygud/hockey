// ============================================================================
// ОБУЧЕНИЕ — ПРОИГРЫВАНИЕ
// ----------------------------------------------------------------------------
// Урок ведётся сценарием из tutorial-script.js. Мир при этом живёт по обычным
// правилам, просто с другими числами: трасса фиксированной длины, скорость
// ограничена, окно у подсказанной клюшки шире, а расход инерции заморожен.
//
// Заканчивается экзаменом из шести клюшек — его надо сдать на 5 из 6.
// ============================================================================

import { MOMENTUM, SPEED } from "./balance.js";
import { TUTOR, TUTOR_PRACTICE, TUTOR_SCRIPT } from "./tutorial-script.js";
import { S } from "./state.js";
import { tutorUi, ui } from "./dom.js";
import { makeObstacle, resolveSpawnSide } from "./spawn.js";
import { handleInputs, speedFor, timeToHit, timingBounds } from "./rules.js";
import { updateHud } from "./hud.js";
import { setPaused, showReport, startRun } from "./flow.js";

// ---------------------------------------------------------------------------
// «Уже видел» — хранится локально, приватный режим просто никогда не нудит
// ---------------------------------------------------------------------------

export function tutorSeen() {
  try {
    return localStorage.getItem(TUTOR.storageKey) === "1";
  } catch (e) {
    return true;
  }
}

export function markTutorSeen() {
  try {
    localStorage.setItem(TUTOR.storageKey, "1");
  } catch (e) {
    /* приватный режим — просто не запоминаем */
  }
}

// ---------------------------------------------------------------------------
// Словарь подсказок: стрелки везде одинаково (A / D / SPACE тоже работают)
// ---------------------------------------------------------------------------

export function cueKey(kind) {
  if (kind === "left") return "←";
  if (kind === "right") return "→";
  return "↑";
}

export function cueWord(kind) {
  if (kind === "left") return "ВЛЕВО";
  if (kind === "right") return "ВПРАВО";
  return "ПРЫЖОК";
}

export function cueCaption(obs) {
  if (obs.side === 0) return "ДВЕ КРАСНЫЕ — ПРЫЖОК";
  return obs.foe ? "ЧУЖАЯ — УХОДИ В ДРУГУЮ" : "СВОЯ — САМА ПОДТОЛКНЁТ";
}

// ---------------------------------------------------------------------------
// Карточка
// ---------------------------------------------------------------------------

export function hideTutorCard() {
  if (tutorUi.root) tutorUi.root.hidden = true;
  if (tutorUi.card) tutorUi.card.classList.remove("tutor-card--top");
  S.tutorPause = null;
  updateHud();
}

function showTutorCard(step, mode) {
  if (!tutorUi.root) return;
  ui.gradeFlash.hidden = true;
  tutorUi.title.textContent = step.title || "";
  tutorUi.body.textContent = step.body || "";
  const act = mode === "act";
  tutorUi.hint.textContent = act
    ? "Нажми стрелку, как на подсказке"
    : "Нажми любую кнопку";
  // На act-паузе карточка уезжает наверх, чтобы не закрыть блик на льду.
  if (tutorUi.card) tutorUi.card.classList.toggle("tutor-card--top", act);
  tutorUi.root.hidden = false;
}

function openTutorPause(step, mode, obs) {
  S.tutorPause = {
    mode,
    title: step.title,
    body: step.body,
    pointGrip: !!step.pointGrip,
    refill: !!step.refill,
    obs: obs || null,
  };
  showTutorCard(step, mode);
  S.pendingInputs.length = 0;
  setPaused(false);
  updateHud();
}

function advance() {
  S.tutorStage += 1;
  S.tutorTimer = 0;
}

function dismissSay() {
  const pause = S.tutorPause;
  hideTutorCard();
  if (pause && pause.refill) {
    S.mom = MOMENTUM.start;
    S.puck.vz = speedFor(S.mom);
    updateHud();
  }
  advance();
}

// ---------------------------------------------------------------------------
// Спавн клюшек урока
// ---------------------------------------------------------------------------

function spawnLessonStick(spec) {
  const nextZ = Math.max(S.lastSpawnZ + 120, S.puck.z + Math.max(S.puck.vz, SPEED.min) * TUTOR.spawnLead);
  const obs = makeObstacle(nextZ, resolveSpawnSide(spec.side), !!spec.foe, {
    lesson: !spec.practice,
    free: !!spec.practice,
    demo: !!spec.demo,
    practice: !!spec.practice,
  });
  S.obstacles.push(obs);
  S.lastSpawnZ = nextZ;
  return obs;
}

/** Экзамен: следующая клюшка выходит, только когда предыдущая разрешилась. */
export function maybeSpawnPractice() {
  if (S.tutorPracticeIdx >= TUTOR_PRACTICE.length) return;
  for (const o of S.obstacles) {
    if (!o.resolved && o.z > S.puck.z - 40) return;
  }
  const nextZ = Math.max(S.lastSpawnZ + 120, S.puck.z + Math.max(S.puck.vz, SPEED.min) * TUTOR.practiceGap);
  const spec = TUTOR_PRACTICE[S.tutorPracticeIdx];
  S.obstacles.push(
    makeObstacle(nextZ, resolveSpawnSide(spec.side), !!spec.foe, { free: true, practice: true })
  );
  S.lastSpawnZ = nextZ;
  S.tutorPracticeIdx += 1;
}

// ---------------------------------------------------------------------------
// Такт сценария
// ---------------------------------------------------------------------------

/** True, пока подсказанная клюшка подъезжает к точке заморозки — глотаем тапы. */
export function swallowsInput() {
  if (!S.tutorOn || S.tutorMode !== "script" || S.tutorPause) return false;
  const step = TUTOR_SCRIPT[S.tutorStage];
  return !!step && (step.kind === "act" || step.kind === "watch");
}

export function handlePauseInput() {
  if (S.pendingInputs.length === 0) return;
  const presses = S.pendingInputs.splice(0, S.pendingInputs.length);
  if (!S.tutorPause) return;

  if (S.tutorPause.mode === "say") {
    dismissSay();
    return;
  }

  if (S.tutorPause.mode === "act") {
    const want = S.tutorPause.obs && S.tutorPause.obs.want;
    if (!want || !presses.includes(want)) return;
    // Разрешаем в этом же кадре, пока t ещё заморожено в идеальном окне,
    // и только потом двигаем сценарий — иначе следующий say успеет вклиниться.
    hideTutorCard();
    S.pendingInputs.push(want);
    handleInputs();
    advance();
  }
}

export function scriptTick(dt) {
  if (!S.tutorOn || S.tutorMode !== "script" || S.tutorPause) return;
  const step = TUTOR_SCRIPT[S.tutorStage];
  if (!step) return;

  switch (step.kind) {
    case "say": {
      S.tutorTimer += dt;
      if (S.tutorTimer < (step.delay || 0)) return;
      // Даём клюшке выехать в кадр, прежде чем карточка её закроет.
      if (step.revealT != null) {
        const obs = S.tutorWatchObs || S.tutorActObs;
        if (obs && !obs.resolved && timeToHit(obs) > step.revealT) return;
      }
      openTutorPause(step, "say");
      return;
    }
    case "spawn": {
      const obs = spawnLessonStick(step);
      if (step.demo) S.tutorWatchObs = obs;
      else S.tutorActObs = obs;
      advance();
      return;
    }
    case "watch": {
      if (S.tutorWatchObs && S.tutorWatchObs.resolved) advance();
      return;
    }
    case "act": {
      const obs = S.tutorActObs;
      if (!obs || obs.resolved) {
        advance();
        return;
      }
      // Замираем на пике белой вспышки (около t = 0), а не на кромке окна.
      if (timeToHit(obs) <= timingBounds(obs).perfect * 0.12) openTutorPause(step, "act", obs);
      return;
    }
    case "practice": {
      S.tutorMode = "practice";
      S.tutorPracticeIdx = 0;
      S.tutorTaught = 0;
      S.tutorOk = 0;
      advance();
      return;
    }
  }
}

/** Клюшка, на которую сейчас показывает подсказка (подход + act-пауза). */
export function cueTarget() {
  if (!S.tutorOn || S.tutorMode !== "script") return null;
  const pause = S.tutorPause;
  if (pause && pause.mode === "act" && pause.obs && !pause.obs.resolved) return pause.obs;

  const step = TUTOR_SCRIPT[S.tutorStage];
  if (step && step.kind === "act" && S.tutorActObs && !S.tutorActObs.resolved) {
    const t = timeToHit(S.tutorActObs);
    if (t <= TUTOR.cueLead && t >= -timingBounds(S.tutorActObs).good) return S.tutorActObs;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Экзамен и выход
// ---------------------------------------------------------------------------

/** Вызывается из правил на каждую разрешённую клюшку экзамена. */
export function taughtOne(ok) {
  if (!S.tutorOn || S.tutorMode !== "practice") return;
  S.tutorTaught += 1;
  if (ok) S.tutorOk += 1;
  if (S.tutorTaught < TUTOR_PRACTICE.length) return;

  clearTutorState(false);
  const passed = S.tutorOk >= TUTOR.pass;
  S.phase = passed ? "tutorpass" : "tutorfail";
  updateHud();

  const line = `Верно ${S.tutorOk} из ${TUTOR_PRACTICE.length}`;
  if (passed) {
    showReport({
      title: "Готово!",
      cls: "report-good",
      btnLabel: "В игру →",
      action: () => {
        markTutorSeen();
        startRun(false);
      },
      line,
    });
  } else {
    showReport({
      title: "Ещё раз",
      cls: "report-bad",
      btnLabel: "Пройти обучение ещё раз",
      action: () => startRun(true),
      altLabel: "Дальше без подсказок",
      altAction: () => {
        markTutorSeen();
        startRun(false);
      },
      line,
    });
  }
}

export function clearTutorState(markSeen) {
  S.tutorOn = false;
  S.tutorMode = "off";
  tutorUi.hideBtn.hidden = true;
  hideTutorCard();
  if (markSeen) markTutorSeen();
}

export const endTutor = () => clearTutorState(true);
