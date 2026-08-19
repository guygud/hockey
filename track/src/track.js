// ============================================================================
// ТРАССА
// ----------------------------------------------------------------------------
// Трасса собирается из паттернов заранее, до старта заезда. Каждая связка
// проходит валидатор: между двумя красными должно хватить времени доехать
// из покоя в безопасный интервал. Иначе генератор раздвигает z.
// ============================================================================

import {
  PUCK,
  SAFETY,
  SPEED,
  STEER,
  TRACK,
  gapFor,
  gateFor,
  jumpAirTime,
  launchSpeed,
  sticksFor,
  tNeeded,
} from "./balance.js";
import { CORRIDOR, ICE_MARKS } from "./tuning.js";
import { hash01, randomSide } from "./util.js";

const MIN_Z_GAP = 160;

export const creaseZ = (runDist) => runDist - TRACK.creaseBack;

function makeObs(spec, z) {
  return {
    z,
    kind: spec.kind,
    x: spec.x,
    w: spec.w,
    resolved: false,
    ok: false,
    slipZ: null,
    flip: Math.random() < 0.5 ? -1 : 1,
  };
}

function sideBlock(side, ctx) {
  const w = ctx.halfW * 2 - ctx.gate;
  const x = side < 0 ? -ctx.halfW + w / 2 : ctx.halfW - w / 2;
  return { kind: "block", x, w };
}

function fullLow(ctx) {
  return { kind: "low", x: 0, w: ctx.halfW * 1.85 };
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
    const sideW = ctx.halfW - ctx.gate / 2;
    return [
      {
        items: [
          { kind: "block", x: -ctx.halfW + sideW / 2, w: sideW },
          { kind: "block", x: ctx.halfW - sideW / 2, w: sideW },
        ],
      },
    ];
  },
  boostLane(ctx) {
    const s = randomSide();
    const gateX = -s * Math.min(ctx.maxX * 0.45, ctx.halfW - ctx.gate * 0.4);
    return [
      { items: [sideBlock(s, ctx)] },
      { items: [{ kind: "boost", x: gateX, w: Math.max(64, ctx.gate * 0.52) }] },
    ];
  },
};

function patternNames(level) {
  const pool = ["slalom", "comb", "cross", "cross", "boostLane"];
  if (level >= 1) pool.push("funnel", "cross");
  if (level >= 2) pool.push("funnel", "slalom", "hurdles");
  if (level >= 3) pool.push("mix", "mix", "cross");
  if (level >= 6) pool.push("mix", "hurdles");
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

function neededTime(dx, airRemain) {
  return (airRemain + tNeeded(dx, false)) * SAFETY;
}

function placeGroup(list, items, ctx, cursor) {
  const bands = safeBands(items, ctx);
  const dx = groupBlocks(items) ? worstTravel(cursor.bands, bands) : 0;
  const needT = groupBlocks(items) ? neededTime(dx, cursor.air) : Math.max(0.35, cursor.air);
  const prefer = items.some((o) => o.kind === "low")
    ? Math.max(ctx.gapZ * 0.75, jumpAirTime() * SAFETY * ctx.v)
    : ctx.gapZ;
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
  const v = Math.max(launchSpeed(level), SPEED.min);
  return {
    level,
    v,
    halfW: CORRIDOR.halfW,
    maxX: STEER.maxX,
    radius: PUCK.radius,
    gate: gateFor(level, mods),
    gapZ: gapFor(level, mods) * v,
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

  const target = sticksFor(level);
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

  const lastZ = list.length ? list[list.length - 1].z : startZ;
  let runDist = Math.round(lastZ + TRACK.creaseBack + ctx.v * TRACK.tailTime);
  if (level === 0) runDist = Math.round(runDist * TRACK.l0LengthMul);
  return { obstacles: list, runDist, ctx };
}

/**
 * Запас связки: dt / tRequired. 1 = ровно минимум из покоя (без SAFETY).
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
