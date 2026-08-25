// ============================================================================
// ТРАССА
// ----------------------------------------------------------------------------
// Трасса собирается из паттернов заранее, до старта заезда. Каждая связка
// проходит валидатор: между двумя красными должно хватить времени доехать
// из покоя в безопасный интервал. Иначе генератор раздвигает z.
// ============================================================================

import {
  PUCK,
  SPEED,
  STEER,
  TRACK,
  jumpAirTime,
  launchSpeed,
  levelSpec,
  sticksFor,
  tNeeded,
} from "./balance.js";
import { CONES, CORRIDOR, ICE_MARKS } from "./tuning.js";
import { hash01, randomSide } from "./util.js";

const MIN_Z_GAP = 160;

export const creaseZ = (runDist) => runDist - TRACK.creaseBack;

function afterLastZ(v, lastKind) {
  const land = lastKind === "low" ? jumpAirTime() : 0;
  return TRACK.creaseBack + v * (TRACK.goalTime + TRACK.tailTime + land);
}

function tagShoulderMates(list) {
  let n = 0;
  for (const o of list) {
    if (o.kind !== "block") continue;
    n += 1;
    o.mate = n % 3 === 0;
  }
}

function makeObs(spec, z) {
  return {
    z,
    kind: spec.kind,
    x: spec.x,
    w: spec.w,
    resolved: false,
    ok: false,
    slipZ: null,
    easy: spec.kind === "block" && !!spec.easy,
    flip: Math.random() < 0.5 ? -1 : 1,
    face: 0,
  };
}

function nextTight(ctx) {
  ctx.tightAcc += ctx.tightShare;
  if (ctx.tightAcc >= 1) {
    ctx.tightAcc -= 1;
    return true;
  }
  return false;
}

function sideBlock(side, ctx) {
  const tight = nextTight(ctx);
  const gate = tight ? ctx.gateTight : ctx.gateWide;
  const w = ctx.halfW * 2 - gate;
  const x = side < 0 ? -ctx.halfW + w / 2 : ctx.halfW - w / 2;
  return { kind: "block", x, w, easy: !tight };
}

function fullLow(ctx) {
  return { kind: "low", x: 0, w: ctx.halfW * 1.85 };
}

function boostWidth(ctx) {
  return Math.max(64, Math.min(140, ctx.gateTight * 0.72));
}

const PATTERNS = {
  slalom(ctx) {
    const s = randomSide();
    return [
      { items: [sideBlock(s, ctx)] },
      { items: [sideBlock(-s, ctx)] },
      { items: [sideBlock(s, ctx)] },
    ];
  },
  comb(ctx) {
    const s = randomSide();
    return [
      { items: [sideBlock(s, ctx)] },
      { items: [sideBlock(s, ctx)] },
      { items: [sideBlock(s, ctx)] },
    ];
  },
  /** Одна перекрещенная пара — прыжок. */
  cross(ctx) {
    return [{ items: [fullLow(ctx)] }];
  },
  hurdles(ctx) {
    const n = ctx.level >= 4 ? 3 : 2;
    const groups = [];
    for (let i = 0; i < n; i++) groups.push({ items: [fullLow(ctx)] });
    return groups;
  },
  mix(ctx) {
    const s = randomSide();
    return [{ items: [fullLow(ctx)] }, { items: [sideBlock(s, ctx)] }];
  },
  funnel(ctx) {
    const sideW = ctx.halfW - ctx.gateTight / 2;
    return [
      {
        items: [
          { kind: "block", x: -ctx.halfW + sideW / 2, w: sideW, easy: false },
          { kind: "block", x: ctx.halfW - sideW / 2, w: sideW, easy: false },
        ],
      },
    ];
  },
  boostLane(ctx) {
    const s = randomSide();
    const gateX = -s * Math.min(ctx.maxX * 0.45, ctx.halfW - ctx.gateTight * 0.4);
    return [
      { items: [sideBlock(s, ctx)] },
      { items: [{ kind: "boost", x: gateX, w: boostWidth(ctx) }] },
    ];
  },
};

function patternNames(level) {
  const pool = ["slalom", "slalom", "cross"];
  if (level >= 1) pool.push("boostLane");
  if (level >= 4) pool.push("slalom", "cross", "boostLane");
  if (level >= 6) pool.push("comb");
  if (level >= 7) pool.push("funnel", "mix");
  if (level >= 8) pool.push("mix", "comb", "hurdles", "funnel");
  return pool;
}

function pickDeck(level) {
  const names = patternNames(level);
  const deck = names.slice().sort(() => Math.random() - 0.5);
  return deck;
}

function invertBands(blocked, maxX) {
  const cuts = blocked
    .map(([a, b]) => [Math.max(-maxX, a), Math.min(maxX, b)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [a, b] of cuts) {
    const last = merged[merged.length - 1];
    if (!last || a > last[1]) merged.push([a, b]);
    else last[1] = Math.max(last[1], b);
  }

  const bands = [];
  let cursor = -maxX;
  for (const [a, b] of merged) {
    if (a - cursor > 4) bands.push({ min: cursor, max: a });
    cursor = Math.max(cursor, b);
  }
  if (maxX - cursor > 4) bands.push({ min: cursor, max: maxX });
  return bands;
}

function occupied(obs, radius) {
  return [obs.x - obs.w / 2 - radius, obs.x + obs.w / 2 + radius];
}

/**
 * Безопасные интервалы x для группы на одной глубине.
 * low считается проходимой прыжком — весь коридор свободен.
 * boost путь не режет.
 */
export function safeBands(items, ctx) {
  const reds = items.filter((o) => o.kind === "block");
  const lows = items.filter((o) => o.kind === "low");
  if (lows.length && !reds.length) return [{ min: -ctx.maxX, max: ctx.maxX }];
  if (!reds.length) return [{ min: -ctx.maxX, max: ctx.maxX }];
  return invertBands(
    reds.map((o) => occupied(o, ctx.radius)),
    ctx.maxX
  );
}

function worstTravel(from, to) {
  if (!from.length || !to.length) return STEER.maxX * 2;
  let worst = 0;
  for (const a of from) {
    for (const x of [a.min, a.max]) {
      let best = Infinity;
      for (const b of to) {
        if (x >= b.min && x <= b.max) {
          best = 0;
          break;
        }
        best = Math.min(best, x < b.min ? b.min - x : x - b.max);
      }
      if (best > worst) worst = best;
    }
  }
  return worst;
}

function groupBlocks(items) {
  return items.some((o) => o.kind === "block" || o.kind === "low");
}

function placeGroup(list, items, ctx, cursor) {
  const bands = safeBands(items, ctx);
  const dx = groupBlocks(items) ? worstTravel(cursor.bands, bands) : 0;
  const needT = groupBlocks(items)
    ? (cursor.air + tNeeded(dx, false)) * ctx.room
    : Math.max(0.35, cursor.air);
  const prefer = items.some((o) => o.kind === "low")
    ? jumpAirTime() * ctx.jumpRoom * ctx.v
    : ctx.cadenceZ;
  const gap = Math.max(MIN_Z_GAP, needT * ctx.v, prefer);
  const z = cursor.z + gap;
  for (const spec of items) list.push(makeObs(spec, z));

  const next = { z, bands: cursor.bands, air: Math.max(0, cursor.air - gap / ctx.v) };
  if (items.some((o) => o.kind === "low")) {
    next.air = jumpAirTime();
  } else if (items.some((o) => o.kind === "block")) {
    next.bands = bands.length ? bands : cursor.bands;
    next.air = 0;
  }
  return next;
}

export function makeCtx(level, mods = {}) {
  const spec = levelSpec(level, mods);
  return {
    level,
    ...spec,
    v: Math.max(launchSpeed(level), SPEED.min),
    halfW: CORRIDOR.halfW,
    maxX: STEER.maxX,
    radius: PUCK.radius,
    cadenceZ: spec.cadence * Math.max(launchSpeed(level), SPEED.min),
    tightAcc: 0,
  };
}

export function buildPoseCourse() {
  const ctx = makeCtx(0, {});
  const third = (ctx.halfW * 2) / 3;
  const twoThirds = (ctx.halfW * 2) * (2 / 3) - 28;
  const gap = ctx.v * 0.85;
  const afterJump = ctx.v * 1.15;
  const leftEasy = { kind: "block", x: -ctx.halfW + third / 2, w: third, easy: true };
  const rightEasy = { kind: "block", x: ctx.halfW - third / 2, w: third, easy: true };
  const leftHard = { kind: "block", x: -ctx.halfW + twoThirds / 2, w: twoThirds, easy: false };
  const rightHard = { kind: "block", x: ctx.halfW - twoThirds / 2, w: twoThirds, easy: false };
  const jumpPair = { kind: "low", x: 0, w: ctx.halfW * 1.85 };
  const boostMid = { kind: "boost", x: 0, w: 118 };

  let z = Math.round(40 + ctx.v * 3.4);
  const placed = [];
  const put = (spec, dz) => {
    z = Math.round(z + dz);
    placed.push(makeObs(spec, z));
  };

  put(leftEasy, 0);
  put(rightEasy, gap);
  put(leftHard, gap);
  put(rightHard, gap);
  put(jumpPair, afterJump);
  put(boostMid, afterJump);
  put(leftEasy, gap);
  put(rightHard, gap);
  put(rightEasy, gap);
  put(jumpPair, afterJump);

  tagShoulderMates(placed);
  return {
    obstacles: placed,
    runDist: Math.round(z + afterLastZ(ctx.v, "low")),
    ctx,
  };
}

export function buildCourse(level, mods = {}, introTime = 0) {
  const ctx = makeCtx(level, mods);
  const list = [];
  const startZ = 40 + introTime * ctx.v + TRACK.openTime * ctx.v;
  let cursor = {
    z: startZ - ctx.v * 0.85,
    bands: [{ min: -ctx.maxX, max: ctx.maxX }],
    air: 0,
  };

  const target = sticksFor(level, mods);
  let deck = pickDeck(level);
  let guard = 0;
  while (list.length < target && guard++ < 80) {
    if (deck.length === 0) deck = pickDeck(level);
    const name = deck.shift();
    const groups = PATTERNS[name](ctx);
    for (const group of groups) {
      cursor = placeGroup(list, group.items, ctx, cursor);
    }
  }

  const last = list.length ? list[list.length - 1] : null;
  const lastZ = last ? last.z : startZ;
  const runDist = Math.round(lastZ + afterLastZ(ctx.v, last && last.kind));
  tagShoulderMates(list);
  return { obstacles: list, runDist, ctx };
}

/**
 * Запас связки: dt / tRequired. 1 = ровно минимум из покоя (без room).
 * boost не участвует. Группы на одной z считаются одним барьером.
 */
export function linkMargins(obstacles, ctx) {
  const groups = [];
  for (const o of obstacles) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.z - o.z) < 0.5) last.items.push(o);
    else groups.push({ z: o.z, items: [o] });
  }

  const margins = [];
  let bands = [{ min: -ctx.maxX, max: ctx.maxX }];
  let air = 0;
  let prevZ = 40;

  for (const g of groups) {
    const blocking = groupBlocks(g.items);
    const dt = (g.z - prevZ) / ctx.v;
    if (blocking) {
      const nextBands = safeBands(g.items, ctx);
      const dx = worstTravel(bands, nextBands);
      const need = air + tNeeded(dx, false);
      const margin = need <= 0.001 ? 99 : dt / need;
      margins.push({ z: g.z, dt, need, dx, margin, kinds: g.items.map((i) => i.kind).join("+") });
      if (g.items.some((o) => o.kind === "low")) {
        air = jumpAirTime();
      } else {
        bands = nextBands.length ? nextBands : bands;
        air = 0;
      }
    } else {
      air = Math.max(0, air - dt);
    }
    prevZ = g.z;
  }
  return margins;
}

export function seedCones(runDist) {
  const list = [];
  const x = CORRIDOR.halfW + CONES.edge;
  const lastZ = Math.max(CONES.startZ, runDist - 80);
  let i = 0;
  for (let z = CONES.startZ; z <= lastZ; z += CONES.step) {
    list.push({ kind: "cone", x: (i % 2 === 0 ? -1 : 1) * x, z });
    i += 1;
  }
  return list;
}

export function seedIceMarks(runDist, emojis) {
  const marks = [];
  const pack = emojis || ICE_MARKS.emojis;
  const startZ = 480;
  const span = Math.max(240, runDist - 70 - startZ);
  const count = Math.max(7, Math.round(span / ICE_MARKS.step));
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
