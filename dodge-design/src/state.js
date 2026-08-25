// ============================================================================
// СОСТОЯНИЕ ЗАЕЗДА
// ----------------------------------------------------------------------------
// Одна изменяемая структура на всю игру. Модули симуляции пишут в неё, рендер
// только читает. Всё, что переживает заезд (уровень, жизни, серия), помечено
// отдельно — resetRunState его не трогает.
// ============================================================================

import { MAX_LIVES, MOMENTUM } from "./balance.js";
import { ROUND_NEUTRAL } from "./rounds.js";

/** Фазы: ready | play | scored | missed | stalled | tutorpass | tutorfail | goalcam | misscam | stallcam */
export const S = {
  // --- прогресс, переживает отдельные попытки ---
  phase: "ready",
  level: 0,
  attempt: 1,
  goals: 0,
  lives: MAX_LIVES,
  streak: 0,

  // --- текущий заезд ---
  mom: MOMENTUM.start,
  runDist: 0,
  activeRound: null,
  roundDeck: [],
  runStats: emptyStats(),

  // --- мир ---
  puck: null,
  obstacles: [],
  particles: [],
  iceMarks: [],
  skaters: [],
  skaterTimer: 0,

  // --- бухгалтерия спавна ---
  lastSpawnZ: 0,
  finalSpawned: false,
  sideRedSpawned: 0,
  stickCount: 0,

  // --- камера и «фил» ---
  // outside: 0 = глаз внутри шайбы, 1 = внешняя камера. Ведёт кинематограф.
  outside: 0,
  /** Камера отстаёт от puck.x: на рывке шайба уезжает из-под глаза. */
  camX: 0,
  tilt: 0,
  turn: 0,
  turnVel: 0,
  turnTarget: 0,
  braceLean: 0,
  glanceX: 0,
  glanceY: 0,
  glanceRoll: 0,
  wobble: 0,
  tremble: 0,
  camBoost: 0,
  camBoostVel: 0,
  camZ: 0,
  camZVel: 0,
  hoodBob: 0,
  hoodBobVel: 0,

  // --- вспышки и накал ---
  aim: 0,
  heat: 0,
  heatTarget: 0,
  heatStreak: 0,
  hitFlash: 0,
  hitFlashPerfect: false,
  damageFlash: 0,
  boostFx: 0,
  netFlash: 0,
  gradeFlashTimer: 0,
  beatT: 0,
  beatIdx: 0,
  beatPulse: 0,

  // --- кинематограф: { mode, t, ... } | null ---
  cinema: null,

  // --- ввод: буфер нажатий текущего кадра ---
  pendingInputs: [],
  framePresses: [],

  // --- поток раундов ---
  paused: false,
  /** Метка предыдущего кадра. Сбрасывается при снятии паузы, иначе dt улетит. */
  lastTs: 0,
  pendingContinue: null,
  pendingAlt: null,
  confirmAt: 0,

  // --- обучение ---
  tutorOn: false,
  tutorMode: "off", // off | script | practice
  tutorStage: 0,
  tutorTimer: 0,
  tutorPause: null, // { mode, title, body, pointGrip?, obs? }
  tutorActObs: null,
  tutorWatchObs: null,
  tutorPracticeIdx: 0,
  tutorTaught: 0,
  tutorOk: 0,
};

export function emptyStats() {
  return { perfect: 0, good: 0, late: 0, wrong: 0, missed: 0, passes: 0, dodges: 0, boosts: 0 };
}

/** Модификаторы текущего заезда. */
export function mods() {
  return (S.activeRound && S.activeRound.mods) || {};
}

/** Палитра текущего заезда. */
export function theme() {
  return (S.activeRound && S.activeRound.theme) || ROUND_NEUTRAL.theme;
}
