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
  min: 130,
  max: 530,
  kmhScale: 170 / 530,
};

/** Геометрия трассы. */
export const TRACK = {
  creaseBack: 200,
  /** Клюшка бьёт здесь, впереди шайбы — иначе контакт случается уже под ногами. */
  hitLine: 100,
  /** Пауза перед первой клюшкой, в секундах. */
  openTime: 1.5,
  gapStart: 1.9,
  gapEnd: 1.55,
  gapFloor: 1.35,
  tailTime: 0.32,
  l0LengthMul: 1.35,
};

/** Сколько препятствий на уровне. */
export const STICKS = {
  perLevel: [6, 10, 12, 14, 16, 17, 18, 18, 18],
  every: 5,
  max: 24,
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

/** Прыжок. Полёт ≈ 0.6 с, clear — высота, с которой low уже не бьёт. */
export const JUMP = {
  vy: 210,
  gravity: 700,
  clear: 18,
  buffer: 0.14,
};

export const jumpAirTime = () => (2 * JUMP.vy) / JUMP.gravity;

/** Радиус шайбы для столкновений. */
export const PUCK = { radius: 16 };

/** Ширина свободного прохода между клюшками. */
export const GATE = {
  start: 168,
  end: 108,
  floor: 96,
};

/** Зазор меньше этого (в мировых единицах) считается проездом впритирку. */
export const GRAZE = 14;

/** Насколько глубоко шайба вошла в клюшку: меньше — задели край, больше — полный удар. */
export const CLIP = { pen: 20, height: 8 };

/** Запас времени на объезд: 1.2 = на 20% больше, чем минимум из rest. */
export const SAFETY = 1.2;

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

export const MAX_LEVEL = STICKS.perLevel.length - 1;

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

export function sticksFor(level) {
  const table = STICKS.perLevel;
  if (level < table.length) return table[level];
  const plateau = table[table.length - 1];
  const extra = Math.ceil((level - (table.length - 1)) / STICKS.every);
  return Math.min(STICKS.max, plateau + extra);
}

export function gapFor(level, mods = {}) {
  let gap = TRACK.gapStart + (TRACK.gapEnd - TRACK.gapStart) * levelMix(level);
  const over = endlessOver(level);
  if (over > 0) {
    const t = Math.min(1, over / 12);
    gap = TRACK.gapEnd + (TRACK.gapFloor - TRACK.gapEnd) * t;
  }
  return Math.max(TRACK.gapFloor, gap * Math.min(1, mods.gapMul || 1));
}

export function gateFor(level, mods = {}) {
  let g = GATE.start + (GATE.end - GATE.start) * levelMix(level);
  const over = endlessOver(level);
  if (over > 0) {
    const t = Math.min(1, over / 12);
    g = GATE.end + (GATE.floor - GATE.end) * t;
  }
  g *= mods.gateMul || 1;
  return Math.max(GATE.floor, g);
}

/**
 * Оценка длины трассы по числу клюшек. Генератор берёт её как ориентир и
 * ставит фактический runDist по последнему препятствию.
 */
export function trackLength(level, mods = {}, introTime = 0) {
  const n = sticksFor(level);
  const v = launchSpeed(level);
  const step = gapFor(level, mods) * v;
  const last = 40 + introTime * v + TRACK.openTime * v + Math.max(0, n - 1) * step;
  const dist = Math.round(last + TRACK.creaseBack + v * TRACK.tailTime);
  return level === 0 ? Math.round(dist * TRACK.l0LengthMul) : dist;
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
  const v = launchSpeed(level);
  const dist = trackLength(level, mods);
  return {
    level: level + 1,
    sticks: sticksFor(level),
    gapSec: +gapFor(level, mods).toFixed(2),
    gate: Math.round(gateFor(level, mods)),
    speed: Math.round(v),
    kmh: +(v * SPEED.kmhScale).toFixed(1),
    distance: dist,
    durationSec: +(dist / v).toFixed(1),
    drainPerSec: +drainFor(level, mods, dist).toFixed(3),
  };
}
