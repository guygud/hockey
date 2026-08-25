// ============================================================================
// БАЛАНС
// ----------------------------------------------------------------------------
// Числа сложности для проезда по трассе. Правила читают их отсюда — прямых
// магических констант в drive/track нет.
//
// Длина трассы выводится из расстановки: сколько препятствий × зазор. Генератор
// может раздвинуть отдельные связки, если иначе не успеть объехать.
// ============================================================================

/** Инерция — бюджет ошибок. Стартуем на максимуме. */
export const MOMENTUM = {
  start: 1,
  drain: 0.055,
  drainRamp: 0.55,
  drainRefTime: 8,
  /** Удар в тело клюшки. */
  hitCost: 0.22,
  /** Лезвие только задело край шайбы. */
  clipCost: 0.07,
  /** Чистый проезд мимо красной. */
  gain: {
    clear: 0.08,
    graze: 0.18,
    boost: 0.12,
  },
  streakCap: 5,
  streakStep: 0.1,
};

/** Скорость шайбы в мировых единицах в секунду. */
export const SPEED = {
  min: 273,
  max: 1110,
  kmhScale: 170 / 530,
};

/** Геометрия трассы. */
export const TRACK = {
  creaseBack: 67,
  /** Пустой лёд после последней преграды до створа, секунды хода. */
  goalTime: 1,
  /** Клюшка бьёт здесь, впереди шайбы — иначе контакт случается уже под ногами. */
  hitLine: 100,
  /** Пауза перед первой клюшкой, в секундах. */
  openTime: 1.5,
  tailTime: 0.11,
};

/**
 * Одна строка — один уровень. Индекс 2 (в интерфейсе «3») — эталон ?pose=1,
 * его числа менять только вместе с buildPoseCourse.
 *   gateWide/gateTight — ширина свободного прохода, единицы
 *   tightShare — доля узких створок среди боковых блоков
 *   room — запас времени на переезд, 1.0 = ровно минимум из покоя
 *   cadence — ритм между связками, секунды
 *   jumpRoom — множитель времени полёта для зазора вокруг прыжков
 */
export const LEVELS = [
  { sticks: 6, gateWide: 285, gateTight: 250, tightShare: 0.34, room: 1.75, cadence: 1.3, jumpRoom: 2.6 },
  { sticks: 8, gateWide: 275, gateTight: 200, tightShare: 0.25, room: 1.45, cadence: 1.05, jumpRoom: 2.2 },
  { sticks: 10, gateWide: 267, gateTight: 161, tightShare: 0.5, room: 1.2, cadence: 0.85, jumpRoom: 1.9 },
  { sticks: 12, gateWide: 258, gateTight: 154, tightShare: 0.55, room: 1.15, cadence: 0.82, jumpRoom: 1.8 },
  { sticks: 13, gateWide: 250, gateTight: 147, tightShare: 0.6, room: 1.11, cadence: 0.79, jumpRoom: 1.72 },
  { sticks: 15, gateWide: 242, gateTight: 141, tightShare: 0.65, room: 1.07, cadence: 0.76, jumpRoom: 1.65 },
  { sticks: 16, gateWide: 235, gateTight: 135, tightShare: 0.7, room: 1.04, cadence: 0.73, jumpRoom: 1.58 },
  { sticks: 17, gateWide: 228, gateTight: 129, tightShare: 0.8, room: 1.01, cadence: 0.71, jumpRoom: 1.52 },
  { sticks: 18, gateWide: 222, gateTight: 124, tightShare: 0.9, room: 0.98, cadence: 0.69, jumpRoom: 1.47 },
];

/** Куда упирается бесконечный хвост после последнего уровня. */
export const LEVEL_FLOOR = {
  sticks: 24,
  gateWide: 200,
  gateTight: 112,
  tightShare: 1,
  room: 0.88,
  cadence: 0.62,
  jumpRoom: 1.35,
};

/**
 * Рулёжка удержанием. Пружины к центру нет: отпустил — накат.
 * brake — множитель ускорения, когда жмёшь против текущей vx.
 */
export const STEER = {
  accel: 1600,
  maxVx: 380,
  drag: 2.4,
  brake: 2800,
  airControl: 0.42,
  maxX: 184,
};

/** Прыжок. Полёт ≈ 0.6 с, clear — высота, с которой low уже не бьёт.
 *  laneFrac — доля ширины коридора, где прыжок вообще засчитывается. */
export const JUMP = {
  vy: 210,
  gravity: 700,
  clear: 18,
  buffer: 0.14,
  laneFrac: 0.3,
};

export const jumpAirTime = () => (2 * JUMP.vy) / JUMP.gravity;

/** Радиус шайбы для столкновений. */
export const PUCK = { radius: 16 };

/** Зазор меньше этого (в мировых единицах) считается проездом впритирку. */
export const GRAZE = 14;

/** Насколько глубоко шайба вошла в клюшку: меньше — задели край, больше — полный удар. */
export const CLIP = { pen: 20, height: 8 };

/**
 * Прицел. Растёт от ударов, гасится чистыми проездами и синими воротами.
 * На пятаке aim >= miss означает промах мимо ворот.
 */
export const AIM = {
  hit: 0.36,
  clip: 0.12,
  graze: 0.05,
  clear: -0.1,
  boost: -0.18,
  decay: 0.04,
  miss: 0.5,
  jitter: 16,
  roll: 0.032,
};

export const ENDLESS = {
  step: 8,
  speed: 0.42,
  drain: 0.12,
  gate: 0.08,
  soft: 12,
};

export const MAX_LIVES = 3;

export const MAX_LEVEL = LEVELS.length - 1;

export function levelMix(level) {
  return Math.min(level, MAX_LEVEL) / MAX_LEVEL;
}

export function endlessOver(level) {
  return Math.max(0, level - MAX_LEVEL);
}

function endlessGrow(level) {
  return Math.log2(1 + endlessOver(level) / ENDLESS.step);
}

function endlessSoft(level) {
  const over = endlessOver(level);
  return over / (over + ENDLESS.soft);
}

export function speedMul(level) {
  return 1 + ENDLESS.speed * endlessGrow(level);
}

export function speedForMom(mom, level, cap) {
  const v = SPEED.min + mom * (SPEED.max - SPEED.min);
  return cap ? Math.min(v, cap) : v * speedMul(level);
}

export function launchSpeed(level) {
  return (SPEED.min + MOMENTUM.start * (SPEED.max - SPEED.min)) * speedMul(level);
}

export function levelSpec(level, mods = {}) {
  const base = LEVELS[Math.min(level, MAX_LEVEL)];
  const over = endlessOver(level);
  const t = over > 0 ? over / (over + ENDLESS.soft) : 0;
  const to = LEVEL_FLOOR;
  const mixNum = (a, b) => a + (b - a) * t;
  return {
    sticks: Math.round(mixNum(base.sticks, to.sticks)),
    gateWide: mixNum(base.gateWide, to.gateWide) * (mods.gateMul || 1),
    gateTight: mixNum(base.gateTight, to.gateTight) * (mods.gateMul || 1),
    tightShare: mixNum(base.tightShare, to.tightShare),
    room: mixNum(base.room, to.room) * (mods.roomMul || 1),
    cadence: mixNum(base.cadence, to.cadence) * (mods.gapMul || 1),
    jumpRoom: mixNum(base.jumpRoom, to.jumpRoom),
  };
}

export const sticksFor = (level, mods = {}) => levelSpec(level, mods).sticks;

/**
 * Прогон после последнего препятствия до створа.
 * Щели изо льда нет: сетка стоит сразу за последними. Если последняя —
 * прыжок, оставляем время приземления, чтобы не влетать во вратаря в воздухе.
 */
export function goalTailZ(level, v, lastKind = null) {
  const land = lastKind === "low" ? jumpAirTime() : 0;
  return TRACK.creaseBack + v * (TRACK.goalTime + TRACK.tailTime + land);
}

/**
 * Оценка длины трассы по числу клюшек. Генератор берёт её как ориентир и
 * ставит фактический runDist по последнему препятствию.
 */
export function trackLength(level, mods = {}, introTime = 0) {
  const spec = levelSpec(level, mods);
  const v = launchSpeed(level);
  const step = spec.cadence * v;
  const last = 40 + introTime * v + TRACK.openTime * v + Math.max(0, spec.sticks - 1) * step;
  return Math.round(last + goalTailZ(level, v));
}

export function drainFor(level, mods = {}, runDist = 0) {
  const base =
    MOMENTUM.drain *
    (1 + MOMENTUM.drainRamp * levelMix(level)) *
    (mods.drainMul || 1) *
    (1 + ENDLESS.drain * endlessSoft(level));
  if (!runDist) return base;
  const duration = runDist / Math.max(launchSpeed(level), 1);
  return base * (MOMENTUM.drainRefTime / Math.max(duration, 0.001));
}

export function streakMult(streak) {
  return 1 + Math.min(streak, MOMENTUM.streakCap) * MOMENTUM.streakStep;
}

/**
 * Максимальное боковое смещение за t секунд из vx = 0 при полном удержании.
 * air=true — в прыжке, ускорение слабее.
 */
export function reachDx(t, air = false) {
  if (t <= 0) return 0;
  const a = STEER.accel * (air ? STEER.airControl : 1);
  const vmax = STEER.maxVx;
  const tRamp = vmax / Math.max(a, 1);
  if (t <= tRamp) return 0.5 * a * t * t;
  return 0.5 * a * tRamp * tRamp + vmax * (t - tRamp);
}

/** Минимальное время, чтобы сместиться на dx из покоя. */
export function tNeeded(dx, air = false) {
  const d = Math.abs(dx);
  if (d < 1) return 0;
  const a = STEER.accel * (air ? STEER.airControl : 1);
  const vmax = STEER.maxVx;
  const tRamp = vmax / Math.max(a, 1);
  const dRamp = 0.5 * a * tRamp * tRamp;
  if (d <= dRamp) return Math.sqrt((2 * d) / a);
  return tRamp + (d - dRamp) / vmax;
}

export function tierName(level) {
  const n = level + 1;
  if (n < 10) return null;
  if (n < 20) return "ПЕРЕГРУЗКА";
  if (n < 35) return "ХАОС";
  return "ЗАПРЕДЕЛ";
}

export function levelRow(level, mods = {}) {
  const spec = levelSpec(level, mods);
  const v = launchSpeed(level);
  const dist = trackLength(level, mods);
  return {
    level: level + 1,
    sticks: spec.sticks,
    gateWide: Math.round(spec.gateWide),
    gateTight: Math.round(spec.gateTight),
    tightShare: +spec.tightShare.toFixed(2),
    room: +spec.room.toFixed(2),
    cadence: +spec.cadence.toFixed(2),
    speed: Math.round(v),
    kmh: +(v * SPEED.kmhScale).toFixed(1),
    distance: dist,
    durationSec: +(dist / v).toFixed(1),
    drainPerSec: +drainFor(level, mods, dist).toFixed(3),
  };
}
