// ============================================================================
// БАЛАНС
// ----------------------------------------------------------------------------
// Единственное место, где живут числа сложности. Всё остальное в игре читает
// их отсюда через функции ниже — прямых магических констант в правилах нет.
//
// Модель уровня:
//   level 0..MAX_LEVEL — обучающая лесенка, дальше бесконечный хвост.
//   Длина трассы НЕ задаётся вручную: она выводится из "сколько клюшек" ×
//   "какой зазор между ними". Так уровень не может оказаться пустым.
// ============================================================================

/** Инерция — бюджет ошибок, а не ресурс для накопления. Стартуем на максимуме. */
export const MOMENTUM = {
  start: 1,
  /** Базовый расход за секунду на первом уровне. */
  drain: 0.055,
  /** Насколько расход растёт к MAX_LEVEL (+55%). */
  drainRamp: 0.55,
  /** Заезд нормируется на эту длительность: длинная трасса не облагается налогом. */
  drainRefTime: 8,
  /** Удар о чужую клюшку. */
  missCost: 0.38,
  /** Нажал верно, но раньше окна. Клюшка не тратится — это только налог на спам. */
  earlyCost: 0.04,
  /** Нажал в пустоту, когда ни одного окна нет. */
  whiffCost: 0.05,
  /** Награда за успешный ответ. Уворот от чужой — основной двигатель. */
  gain: {
    dodgePerfect: 0.19,
    dodgeGood: 0.06,
    /** Приём своей клюшки вручную (осталось от старой схемы, синие теперь пассивны). */
    passPerfect: 0.2,
    passGood: 0.1,
    /** Синяя просто проезжает мимо и подталкивает. */
    blue: 0.1,
  },
  /** Серия голов множит награду: +10% за гол, не больше +50%. */
  streakCap: 5,
  streakStep: 0.1,
};

/** Скорость шайбы в мировых единицах в секунду. */
export const SPEED = {
  min: 130,
  max: 530,
  /** Показания спидометра: max ≈ 170 км/ч. Бесконечный множитель растёт дальше. */
  kmhScale: 170 / 530,
};

/** Геометрия трассы. */
export const TRACK = {
  /** Точка контакта перед шайбой: клюшка бьёт сюда, а не в саму шайбу. */
  hitLine: 110,
  /** Ворота стоят на runDist, гол засчитывается на пятаке за creaseBack до них. */
  creaseBack: 200,
  /** Пауза перед первой клюшкой — время привыкнуть к движению, в секундах. */
  openTime: 1.05,
  /** Синяя: секунды видимого вылета до толчка (поверх hitLine, иначе сразу за кадром). */
  blueLead: 0.42,
  /** Зазор между клюшками в секундах: L0 → MAX_LEVEL → бесконечный пол. */
  gapStart: 1.28,
  gapEnd: 1.04,
  gapFloor: 0.98,
  /** Короткий хвост после последнего удара, в секундах хода. */
  tailTime: 0.32,
  /** Первый уровень: длина трассы ×N при тех же 4 клюшках. */
  l0LengthMul: 2,
};

/** Сколько и каких клюшек на уровне. */
export const STICKS = {
  /** Штук на уровень, индекс = level. Последнее значение — плато. */
  perLevel: [4, 10, 12, 14, 15, 16, 17, 18, 18],
  /** После плато: +1 клюшка каждые N уровней. */
  every: 5,
  max: 22,
  /** Доля чужих (красных) среди боковых клюшек на L0 и прирост к MAX_LEVEL. */
  foeShare: 0.6,
  foeRamp: 0.2,
  foeMax: 0.86,
  /** Доля лобовых (две красные сразу — прыжок) среди всех клюшек. */
  frontalShare: 0.2,
  /** Гарантированный минимум боковых красных за заезд. */
  minSideReds: 3,
  /**
   * Доля дистанции, к которой должна появиться N-я гарантированная красная.
   * Если рандом не выдал её сам — ставим принудительно. Без этого попадались
   * заезды почти без уворотов.
   */
  sideRedBy: [0.18, 0.38, 0.6],
};

/**
 * Окно ответа в секундах до/после контакта. Пять зон:
 * рано → нормально → идеально → на волосок → провал.
 * С уровнем окно поджимается с обеих сторон.
 */
export const WINDOW = {
  /** За сколько секунд до удара окно вообще открывается. */
  open: 0.68,
  perfect: 0.14,
  good: 0.32,
  /** "На волосок" — доля от good, отсчитывается уже ПОСЛЕ момента удара. */
  lateSpan: 1.7,
  lateFloor: 0.11,
  /** Насколько окно сжимается к MAX_LEVEL (-22%). */
  ramp: 0.22,
  /** Ниже этого идеальное окно не сжимается никогда. */
  perfectFloor: 0.032,
};

/**
 * Прицел шайбы. Растёт от неточных уворотов, гасится синими и временем.
 * На пятаке aim >= miss означает промах мимо ворот.
 */
export const AIM = {
  perfect: 0.08,
  good: 0.22,
  late: 0.38,
  /** Пропущенная чужая клюшка сбивает прицел сильнее всего. */
  fail: 0.34,
  /** Сколько снимает синяя клюшка. */
  blue: 0.2,
  /** Затухание в секунду. */
  decay: 0.04,
  /** Порог промаха мимо ворот. */
  miss: 0.5,
  /** Визуал: амплитуда рыскания в пикселях и крена в радианах при aim = 1. */
  jitter: 16,
  roll: 0.032,
};

/** Хвост после MAX_LEVEL: медленный логарифмический рост. */
export const ENDLESS = {
  /** Шаг удвоения: каждые N уровней сверх плато добавляют один "шаг" роста. */
  step: 8,
  speed: 0.42,
  win: 0.085,
  drain: 0.12,
  /** Мягкое насыщение для доли чужих клюшек. */
  soft: 12,
};

/** Жизни на сет попыток. */
export const MAX_LIVES = 3;

/** Последний уровень обучающей лесенки. */
export const MAX_LEVEL = STICKS.perLevel.length - 1;

// ---------------------------------------------------------------------------
// Производные величины. Все функции чистые: level и модификаторы заезда внутрь,
// число наружу. Ими же можно собрать таблицу баланса для ГДД (см. levelRow).
// ---------------------------------------------------------------------------

/** 0 на первом уровне, 1 на плато и дальше. */
export function levelMix(level) {
  return Math.min(level, MAX_LEVEL) / MAX_LEVEL;
}

/** Сколько уровней сверх плато. */
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

/** Общий множитель скорости в бесконечном хвосте. */
export function speedMul(level) {
  return 1 + ENDLESS.speed * endlessGrow(level);
}

/** Скорость шайбы при данной инерции. cap ограничивает её в обучении. */
export function speedForMom(mom, level, cap) {
  const v = SPEED.min + mom * (SPEED.max - SPEED.min);
  return cap ? Math.min(v, cap) : v * speedMul(level);
}

/** Стартовая скорость заезда — по ней считается длина трассы. */
export function launchSpeed(level) {
  return (SPEED.min + MOMENTUM.start * (SPEED.max - SPEED.min)) * speedMul(level);
}

/** Целевое число клюшек на уровне. */
export function sticksFor(level) {
  const table = STICKS.perLevel;
  if (level < table.length) return table[level];
  const plateau = table[table.length - 1];
  const extra = Math.ceil((level - (table.length - 1)) / STICKS.every);
  return Math.min(STICKS.max, plateau + extra);
}

/** Зазор между клюшками в секундах. Заезды умеют только поджимать его. */
export function gapFor(level, mods = {}) {
  let gap = TRACK.gapStart + (TRACK.gapEnd - TRACK.gapStart) * levelMix(level);
  const over = endlessOver(level);
  if (over > 0) {
    const t = Math.min(1, over / 12);
    gap = TRACK.gapEnd + (TRACK.gapFloor - TRACK.gapEnd) * t;
  }
  return Math.max(TRACK.gapFloor, gap * Math.min(1, mods.gapMul || 1));
}

/**
 * Длина трассы выводится из расстановки, а не задаётся руками.
 * Реальный шаг между клюшками — это зазор минус hitLine: следующую ставим
 * от точки удара, а не от лезвия предыдущей.
 * Первый уровень — исключение: длина × TRACK.l0LengthMul, клюшек по-прежнему 4.
 */
export function trackLength(level, mods = {}, introTime = 0) {
  const n = sticksFor(level);
  const v = launchSpeed(level);
  const step = Math.max(90, gapFor(level, mods) * v - TRACK.hitLine);
  const lastStick = 40 + introTime * v + TRACK.openTime * v + Math.max(0, n - 1) * step;
  const dist = Math.round(lastStick - TRACK.hitLine + TRACK.creaseBack + v * TRACK.tailTime);
  return level === 0 ? dist * TRACK.l0LengthMul : dist;
}

function endlessWinMul(level) {
  return 1 / (1 + ENDLESS.win * endlessOver(level));
}

/**
 * Границы окна ответа в секундах. mul — расширение для подсказанной клюшки
 * в обучении, roundMul — модификатор заезда.
 */
export function windowsFor(level, mul = 1, roundMul = 1) {
  const squeeze = (1 - WINDOW.ramp * levelMix(level)) * endlessWinMul(level);
  const perfect = Math.max(WINDOW.perfectFloor, WINDOW.perfect * squeeze);
  const good = WINDOW.good * squeeze;
  const late = Math.max(WINDOW.lateFloor, good * WINDOW.lateSpan);
  return {
    open: WINDOW.open,
    perfect: perfect * mul * roundMul,
    good: good * mul * roundMul,
    late: late * mul * roundMul,
  };
}

/**
 * Расход инерции в секунду. runDist нормирует его: длинная трасса не должна
 * съедать больше только потому, что она длинная.
 */
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

/** Вероятность, что боковая клюшка окажется чужой. */
export function foeChance(level, mods = {}) {
  const share = (STICKS.foeShare + STICKS.foeRamp * levelMix(level)) * (mods.foeMul || 1);
  return Math.min(STICKS.foeMax, share + (STICKS.foeMax - 0.75) * endlessSoft(level));
}

/** Вероятность лобовой пары (прыжок). */
export function frontalChance(mods = {}) {
  return STICKS.frontalShare * (mods.crossMul || 1);
}

/** Множитель награды от серии голов. */
export function streakMult(streak) {
  return 1 + Math.min(streak, MOMENTUM.streakCap) * MOMENTUM.streakStep;
}

/** Ярлык сложности в HUD. null до 10-го уровня. */
export function tierName(level) {
  const n = level + 1;
  if (n < 10) return null;
  if (n < 20) return "ПЕРЕГРУЗКА";
  if (n < 35) return "ХАОС";
  return "ЗАПРЕДЕЛ";
}

/**
 * Строка таблицы баланса для уровня — то, что удобно вставлять в ГДД.
 * Ничего не решает в рантайме, но всегда совпадает с живыми числами.
 */
export function levelRow(level, mods = {}) {
  const v = launchSpeed(level);
  const dist = trackLength(level, mods);
  const w = windowsFor(level);
  return {
    level: level + 1,
    sticks: sticksFor(level),
    gapSec: +gapFor(level, mods).toFixed(2),
    speed: Math.round(v),
    kmh: +(v * SPEED.kmhScale).toFixed(1),
    distance: dist,
    durationSec: +(dist / v).toFixed(1),
    perfectMs: Math.round(w.perfect * 2000),
    goodMs: Math.round(w.good * 2000),
    lateMs: Math.round(w.late * 1000),
    foePct: Math.round(foeChance(level, mods) * 100),
    drainPerSec: +drainFor(level, mods, dist).toFixed(3),
  };
}
