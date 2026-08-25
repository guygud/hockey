// ============================================================================
// РАССТАНОВКА
// ----------------------------------------------------------------------------
// Клюшки не разбросаны по трассе заранее — они появляются по одной, как только
// предыдущая разрешилась. Трасса при этом выведена из «сколько клюшек × зазор»
// (см. trackLength), так что расстановка всегда успевает заполнить лёд до
// пятака, а пустых заездов не бывает.
//
// Два жёстких правила поверх рандома:
//   1. Первая клюшка заезда — всегда одиночная боковая красная.
//      Начинать с прыжка через лобовую пару нечестно.
//   2. За заезд обязаны встретиться minSideReds боковых красных.
//      Если рандом их не выдал к контрольным долям дистанции — ставим сами.
// ============================================================================

import { SPEED, STICKS, TRACK, gapFor, sticksFor } from "./balance.js";
import { CORRIDOR, ICE_MARKS } from "./tuning.js";
import { S, mods } from "./state.js";
import { blueSide } from "./camera.js";
import { pickFoe, pickSide, wantedInput } from "./rules.js";
import { hash01, randomSide } from "./util.js";

/**
 * opts: lesson — ярче блик на льду; free — промах не стоит инерции;
 * demo — столкнётся сама, ввод игнорируется; practice — идёт в зачёт экзамена;
 * final — последняя клюшка заезда.
 */
export function makeObstacle(z, side, foe, opts = {}) {
  return {
    z,
    side,
    foe,
    want: wantedInput(side, foe),
    type: side === 0 ? "cross" : "stick",
    resolved: false,
    ok: false,
    answer: null,
    windowOpen: false,
    aimX: 0,
    /** puck.z в момент разрешения: от него отсчитывается проезд мимо. */
    slipZ: null,
    flip: Math.random() < 0.5 ? -1 : 1,
    lesson: !!opts.lesson,
    free: !!opts.free,
    demo: !!opts.demo,
    practice: !!opts.practice,
    final: !!opts.final,
  };
}

export const resolveSpawnSide = (side) => (side === null || side === undefined ? randomSide() : side);

/** Пятак: сюда доехать — уже гол, остаток пути показывает камера. */
export const creaseZ = () => S.runDist - TRACK.creaseBack;

/** Не выдал ли рандом слишком мало боковых красных к этому моменту. */
function needsForcedRed() {
  const done = S.sideRedSpawned;
  if (done >= STICKS.minSideReds) return false;
  const remain = Math.max(1, sticksFor(S.level) - S.stickCount);
  if (remain <= STICKS.minSideReds - done) return true;
  const by = STICKS.sideRedBy[done];
  return by !== undefined && S.puck.z / Math.max(S.runDist, 1) > by;
}

function nextSpawn() {
  if (needsForcedRed()) return { side: randomSide(), foe: true };
  const side = pickSide();
  const foe = pickFoe(side);
  // Синяя появляется с той стороны, куда нас уже увело: она вернёт нос к воротам.
  if (!foe) return { side: blueSide(), foe: false };
  return { side, foe };
}

/** Дистанция до следующей клюшки. Синяя — короткий вылет, но с запасом до линии удара. */
function spawnDist(spawn) {
  const v = Math.max(S.puck.vz, SPEED.min);
  if (!spawn.foe) return TRACK.hitLine + v * TRACK.blueLead;
  const seconds = S.stickCount === 0 ? TRACK.openTime : gapFor(S.level, mods());
  return v * seconds;
}

/**
 * Одна живая клюшка за раз: коридор, забитый припаркованными клюшками, читается
 * как каша. Заполняем лёд до пятака — остаток коридора получает ещё одну клюшку,
 * а не превращается в пустой проезд.
 */
export function maybeSpawnObstacles() {
  if (S.finalSpawned) return;
  // На удлинённом L0 иначе добьём коридор лишними клюшками.
  if (S.stickCount >= sticksFor(S.level)) {
    S.finalSpawned = true;
    return;
  }
  for (const o of S.obstacles) {
    if (!o.resolved && o.z > S.puck.z - 40) return;
  }

  const spawn = nextSpawn();
  if (S.stickCount === 0) {
    spawn.side = randomSide();
    spawn.foe = true;
  }

  const lastSafeZ = S.runDist - TRACK.creaseBack - 80;
  let nextZ = Math.max(
    S.lastSpawnZ + 80,
    S.puck.z + spawnDist(spawn)
  );

  if (nextZ >= lastSafeZ) {
    const minGap = Math.max(S.puck.vz, SPEED.min) * Math.max(0.7, gapFor(S.level, mods()) * 0.65);
    if (S.lastSpawnZ >= lastSafeZ - minGap) {
      S.finalSpawned = true;
      return;
    }
    nextZ = lastSafeZ;
    pushSpawn(nextZ, spawn, { final: true });
    S.finalSpawned = true;
    return;
  }

  pushSpawn(nextZ, spawn);
}

function pushSpawn(z, spawn, opts) {
  S.obstacles.push(makeObstacle(z, spawn.side, spawn.foe, opts));
  if (spawn.foe && spawn.side !== 0) S.sideRedSpawned += 1;
  S.lastSpawnZ = z;
  S.stickCount += 1;
}

/** Эмодзи, вмороженные в лёд. Расстановка детерминированная, чтобы не мигала. */
export function seedIceMarks() {
  const marks = [];
  const pack = (S.activeRound && S.activeRound.emojis) || ICE_MARKS.emojis;
  const startZ = 480;
  const span = Math.max(240, S.runDist - 70 - startZ);
  const count = Math.max(7, Math.round(span / ICE_MARKS.step));
  // Больше у бортов, чем в центре: 0, ±половина, ±край.
  const lanes = [0, -0.58, 0.58, -0.92, 0.92];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.45 + hash01(i + 19) * 0.1) / count;
    marks.push({
      x: CORRIDOR.halfW * lanes[i % lanes.length] + (hash01(i + 3) - 0.5) * 16,
      z: startZ + span * t,
      size: ICE_MARKS.size * (0.9 + hash01(i + 7) * 0.35),
      emoji: pack[i % pack.length],
    });
  }
  return marks;
}
