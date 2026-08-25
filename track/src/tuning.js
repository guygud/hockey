// ============================================================================
// ОЩУЩЕНИЕ И КАДР
// ----------------------------------------------------------------------------
// Всё, что влияет на картинку и «фил», но не на сложность. Правила игры сюда
// не заглядывают: числа сложности живут отдельно, в balance.js.
// ============================================================================

/** Ширина коридора и шаг «конькобежных» полос на льду. */
export const CORRIDOR = { halfW: 200, ribStep: 60 };

/**
 * Рывок шайбы на одно нажатие ←/→. vx перезаписывается, потом гаснет;
 * пружина тянет x к центру. На оценку нажатия не влияет.
 *
 * Скольжение должно чувствоваться телом, поэтому рывок длинный: пик ~120
 * единиц за 0.45 c, назад к центру — неспешно. Ниже — только «фил» рывка:
 * camLag — насколько камера отстаёт от шайбы (0 = приклеена, слайд не виден),
 * hoodSlide/hoodRoll — снос и крен корпуса от этого отставания,
 * bankRoll — крен кадра от боковой скорости, sprayN — крошка из-под лезвий.
 */
export const STRAFE = {
  maxX: 150,
  dashVx: 380,
  friction: 5.2,
  returnK: 3.2,
  camLag: 9,
  /** Скорость доводки прицела боковой красной. Ниже — виднее, как она тянется. */
  chase: 7,
  hoodSlide: 0.85,
  hoodRoll: (7 * Math.PI) / 180,
  bankRoll: (5 * Math.PI) / 180,
  sprayN: 9,
};

/**
 * Глаз сидит низко надо льдом.
 * near короткий, чтобы подставленная клюшка оставалась в кадре, проезжая мимо.
 * far — только пол: реальная дальность растёт вместе с длиной трассы.
 */
export const CAM = { height: 22, focal: 460, near: 6, far: 4400, horizonFrac: 0.42 };

/** Внешняя камера для влёта, гола и остановки. x = 0, чтобы шайба была по центру. */
export const CAM_OUT = { back: 190, height: 86, x: 0 };

/** Влёт: выше и дальше, за правым плечом шайбы. */
export const CAM_INTRO = { back: 330, height: 190, x: 78 };

/** Верх кадра: трибуны над бортом и высота самого борта. */
export const ARENA = { wallH: 160, boardH: 56 };

/** Капот: видимая четверть шайбы у нижней кромки кадра. */
export const HOOD = {
  heightFrac: 0.24,
  heightMax: 260,
  bulge: 0.16,
  bobMax: 42,
  /** Крен от нажатия в другую сторону, радианы (~8°). */
  pressRoll: (8 * Math.PI) / 180,
  /** Рыскание при сбитом прицеле, радианы (~9°). */
  huntRoll: (9 * Math.PI) / 180,
  /** Импульс высоты капота на прыжке. */
  jumpKick: 240,
};

/** Виньетка поверх полного кадра. */
export const LENS = { vignette: 0.5 };

/**
 * Фейковое руление: шайба всё так же катится по центру, доворачивается сцена.
 * turn: 0 = смотрим в ворота, ±1 = максимально уведены в сторону.
 */
export const TURN = {
  yawMax: (15 * Math.PI) / 180, // 15° за один шаг (|turn| = 1)
  maxSteps: 4, // подряд красные складываются: 15°, 30°, 45°, 60°
  driftMax: 22,
  iceShift: 120,
  spring: 22,
  damp: 7,
};

/** Аниме-штрихи скорости: летят из точки схода к краям. */
export const SPEED_LINES = {
  count: 26,
  centerGapFrac: 0.17, // середина кадра остаётся читаемой
  minMom: 0.15,
  lenFrac: 0.26,
  alpha: 0.5,
  rate: 1.5,
};

/** Логотипы на льду: лежат на плоскости и едут с ареной. */
export const ICE_MARKS = {
  step: 520,
  size: 78,
  emojis: ["🏒", "⭐", "❄️", "🔥", "⚡", "💎", "👑", "🎯", "💙", "🧊", "🏆", "✨"],
};

/** Конусы по кромке: шаг по z, чередование сторон. */
export const CONES = {
  step: 400,
  startZ: 400,
  edge: 6,
  worldW: 36,
  maxScreenFrac: 0.16,
  nearFade: 70,
};

/** Декор: свои стоят за бортом. Поворот по своей дистанции, не из тройки врагов. */
export const SKATERS = {
  max: 6,
  spawnGap: 1.05,
  appearChance: 0.88,
  outMin: 52,
  outMax: 118,
  worldW: 250,
  maxScreenFrac: 0.72,
  nearZ: 420,
  pow: 0.65,
};

/** Накал от серии без ошибок: тряска, штрихи, питч звука, виньетка. */
export const HEAT = { full: 6, shake: 0.9, lines: 0.45, pitch: 0.22, vignette: 0.12 };

/** Динамика от скорости: подтягивание фокуса, просадка глаза, покачивание. */
export const DYN = { fovPull: 0.07, dip: 4, bob: 0.8 };

/** Метроном заезда. */
export const BEAT = { kick: 0.05, hat: 0.022, pulse: 0.35 };

/**
 * Фигура хоккеиста. Якорь — пиксель крюка, нормированный по размеру спрайта.
 * bladeX/Y заданы для спрайта с крюком слева (enemy.png, enemy_easy_left).
 */
export const PLAYER = {
  worldW: 390,
  bladeX: 0.22,
  bladeY: 0.86,
  feetX: 0.58,
  feetY: 0.97,
  /** Сдвиг к своему борту: конёк не торчит в свободную полосу. */
  boardPull: 49,
  maxScreenFrac: 2.47,
  /** Доля полуширины коридора от центра до крюка прыжковой пары. */
  jumpSpread: 0.364,
  /** Союзники: доля полуширины коридора от оси до крюка, ближе к борту. */
  allyEdge: 0.82,
  /** Напарник за плечом: насколько за бортом и насколько впереди противника. */
  mateOut: 350,
  mateAhead: 220,
  tipZOffset: -1,
  slipSpan: 160,
  dodgeWhip: 2.6,
  nearFade: 80,
};

/** Бьющий на влёте: тот же якорь, что у полевых, но кадр держит рост целиком. */
export const STRIKER = { ...PLAYER, worldW: 210, maxScreenFrac: 0.42 };

/** Компактный враг: крюк у самого края кадра. */
export const PLAYER_EASY = {
  worldW: 372,
  bladeX: 0.07,
  bladeY: 0.87,
  feetX: 0.52,
  feetY: 0.96,
  boardPull: 11,
  maxScreenFrac: 2.54,
};

/** Картонные манекены: дальние стоят ребром, ближние доворачиваются лицом. */
export const CUTOUT = {
  faceCount: 3,
  turnRate: 6.5,
  maxAngle: 1.68,
  minEdge: 0.045,
  backTint: "#eef2f8",
  backEdge: "#c3cede",
  /** Союзники: стоят лицом, приоткрыты на allyOpenDeg, добор на самом проезде. */
  allyOpenDeg: 15,
  allyNearZ: 310,
  allyPow: 0.62,
};

/** Вратарь в створе. Якорь — коньки; клюшка в кадре слева от тела. */
export const GOALIE = {
  size: 1.18,
  feetX: 0.7,
  feetY: 0.97,
  zBack: 18,
  span: 46,
  pace: 0.2,
  /** Сжать спрайт по X. 1 = как в файле. */
  widthScale: 0.8,
  /** С какой дистанции появляется и доворачивается, как полевые. */
  nearZ: 3000,
  nearPow: 0.45,
  /** Непрозрачная часть gater.png, доли ширины кадра. */
  bodyL: 0.04,
  bodyR: 0.85,
  aspect: 366 / 424,
};

/** Ворота. Положительный yDownFrac опускает сетку ниже по экрану. */
export const GOAL = { yDownFrac: 0.3, postHeight: 110 };

/** Мировые края тела вратаря. dir < 0 — спрайт зеркален вокруг коньков. */
export function goalieBodyWorld(x = 0, dir = 1) {
  const worldW = GOAL.postHeight * 1.25 * GOALIE.size * GOALIE.aspect * GOALIE.widthScale;
  const leftOff = (GOALIE.bodyL - GOALIE.feetX) * worldW;
  const rightOff = (GOALIE.bodyR - GOALIE.feetX) * worldW;
  if (dir < 0) return { left: x - rightOff, right: x - leftOff };
  return { left: x + leftOff, right: x + rightOff };
}

/** Тайминги кинематографичных камер, в секундах. */
export const CINEMA = {
  introWindup: 0.42,
  introSnap: 0.08,
  introHold: 0.32,
  introDive: 0.45,
  /** Старт: боком, 20° к нам лицом. Финиш: спина через левое плечо. */
  introOpenDeg: 20,
  introBackDeg: 168,
  introStrikePow: 3.4,
  /** Дополнительный отступ ног от шайбы на замахе; к удару схлопывается. */
  introStandGap: 32,
  /** После щелчка картон гуляет вокруг оси вращения. */
  introWobbleDeg: 16,
  introWobbleHz: 7.2,
  introWobbleDecay: 4.6,
  /** Гол: резкий выход наружу, потом разгон в сетку — без слоу-мо. */
  goalPop: 0.14,
  goalRush: 2.55,
  goalReportAt: 0.95,
  missDur: 0.85,
  saveDur: 0.9,
  stallDur: 1.2,
};

/** Затухания и вспышки интерфейса. */
export const FEEL = {
  gradeFlashTime: 0.55,
  trembleDecay: 1.7,
  /** Пауза перед тем, как отчёт начнёт принимать нажатия, мс. */
  confirmDelay: 450,
  /** Короткий взгляд в сторону нажатия — камера; шайба отдельно делает рывок. */
  glanceX: 20,
  glanceY: 22,
  glanceRoll: 0.034,
  glanceDecay: 7,
};

export const CUE_FONT = '"Segoe UI", system-ui, sans-serif';
