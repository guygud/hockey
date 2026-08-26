// ============================================================================
// СОСТОЯНИЕ ЗАЕЗДА
// ----------------------------------------------------------------------------
// Одна изменяемая структура на всю игру. Модули симуляции пишут в неё, рендер
// только читает. Всё, что переживает заезд (уровень, жизни, серия), помечено
// отдельно — resetRun его не трогает.
// ============================================================================

import { MAX_LIVES, MOMENTUM } from "./balance.js";
import { ROUND_NEUTRAL } from "./rounds.js";

/** Фазы: ready | play | scored | missed | stalled | goalcam | misscam | stallcam */
export const S = {
  phase: "ready",
  level: 0,
  attempt: 1,
  goals: 0,
  lives: MAX_LIVES,
  streak: 0,

  mom: MOMENTUM.start,
  runDist: 0,
  activeRound: null,
  roundDeck: [],
  runStats: emptyStats(),

  puck: null,
  obstacles: [],
  particles: [],
  scuffs: [],
  cones: [],
  skaters: [],
  skaterTimer: 0,

  outside: 0,
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

  cinema: null,
  poseMode: false,
  goalieX: 0,
  goalieT: 0,
  goalieTarget: 0,
  goalieHold: 0,
  goalieDir: 1,
  goalieFace: 0,

  held: { left: false, right: false, brace: false },
  jumpBuf: 0,
  pointers: {},

  paused: false,
  lastTs: 0,
  pendingContinue: null,
  pendingAlt: null,
  confirmAt: 0,
};

export function emptyStats() {
  return { clears: 0, grazes: 0, clips: 0, hits: 0, boosts: 0 };
}

export function mods() {
  return (S.activeRound && S.activeRound.mods) || {};
}

export function theme() {
  return (S.activeRound && S.activeRound.theme) || ROUND_NEUTRAL.theme;
}
