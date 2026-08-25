// ============================================================================
// КАМЕРА И ПРОЕКЦИЯ
// ----------------------------------------------------------------------------
// Мир 3D-шный только на бумаге: точка на льду проецируется одним делением на
// глубину. Никакой матрицы, зато читается за минуту.
//
// Доворот (turn) — обман для рыскания прицела. Боковой стрейф настоящий:
// камера едет за шайбой, но с отставанием — иначе рывок вбок не читается.
// ============================================================================

import { CAM, CAM_OUT, DYN, HOOD, TURN } from "./tuning.js";
import { SPEED } from "./balance.js";
import { S } from "./state.js";
import { clamp, clamp01, easeInOut, randomSide } from "./util.js";
import { W, H } from "./viewport.js";
import { ctx } from "./dom.js";

// Параметры камеры пересчитываются один раз за кадр: project() зовётся сотни
// раз, и собирать их заново на каждый вызов было заметной долей кадра.
const rigCache = { back: 0, x: 0, h: 0, focal: CAM.focal, far: CAM.far, yaw: 0, drift: 0, shiftPx: 0 };

export function syncCamera() {
  const e = easeInOut(S.outside);
  const mix = speedMix();
  rigCache.back = S.camZ + CAM_OUT.back * e;
  rigCache.x = S.camX + CAM_OUT.x * e;
  rigCache.h = CAM.height + (CAM_OUT.height - CAM.height) * e + S.camBoost - DYN.dip * mix * (1 - e);
  rigCache.focal = CAM.focal * (1 - DYN.fovPull * mix * (1 - e));
  rigCache.far = Math.max(CAM.far, (S.runDist || 0) + 800);
  const turnMix = S.cinema && S.cinema.mode === "miss" ? 1 : 1 - e;
  rigCache.yaw = S.turn * TURN.yawMax * turnMix;
  rigCache.drift = S.turn * TURN.driftMax * turnMix;
  rigCache.shiftPx = -S.turn * TURN.iceShift * turnMix;
  return rigCache;
}

/** Актуальные параметры камеры этого кадра. */
export const rig = () => rigCache;

/** 0 на минимальной скорости, 1 на максимальной. */
export function speedMix() {
  if (!S.puck) return 0;
  return clamp01((S.puck.vz - SPEED.min) / (SPEED.max - SPEED.min));
}

/** 0 до 70% дистанции, дальше растёт к 1 — финальный накат к воротам. */
export function pushMix() {
  if (!S.puck || !S.runDist) return 0;
  return clamp01((S.puck.z / S.runDist - 0.7) / 0.3);
}

/**
 * Точка льда (x, z) → экран. withTurn применяет доворот сцены.
 * Возвращает null, если точка за ближней или дальней плоскостью.
 */
export function project(x, z, withTurn) {
  const dx = x - rigCache.x - (withTurn ? rigCache.drift : 0);
  const dz = z - S.puck.z + rigCache.back;
  const yaw = withTurn ? rigCache.yaw : 0;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const rx = dx * c - dz * s;
  const d = dx * s + dz * c;
  if (d < CAM.near || d > rigCache.far) return null;
  const k = rigCache.focal / d;
  return { sx: W / 2 + rx * k, sy: H * CAM.horizonFrac + rigCache.h * k, k, d };
}

/** То же, но точка поднята на worldH над льдом. baseY — её тень на льду. */
export function projectHeight(x, z, worldH, withTurn) {
  const p = project(x, z, withTurn);
  if (!p) return null;
  return { sx: p.sx, sy: p.sy - worldH * p.k, baseY: p.sy, k: p.k, d: p.d };
}

// ---------------------------------------------------------------------------
// Доворот
// ---------------------------------------------------------------------------

export const clampTurn = (v) => clamp(v, -TURN.maxSteps, TURN.maxSteps);

/** Красная слева уводит вправо, справа — влево: нос уходит с линии ворот. */
export const headingAway = (side) => (side < 0 ? 1 : -1);

/** Сторона, куда нас уже увело от ворот. Синяя должна появиться там же. */
export function turnedSide() {
  const heading = Math.abs(S.turnTarget) >= Math.abs(S.turn) ? S.turnTarget : S.turn;
  if (heading > 0.2) return 1;
  if (heading < -0.2) return -1;
  return 0;
}

export const blueSide = () => turnedSide() || randomSide();

/** Текстуры льда и бортов шире экрана на весь возможный доворот, иначе виден шов. */
export function arenaCover() {
  const shift = rigCache.shiftPx;
  const pad = Math.max(W * 0.3, TURN.iceShift * TURN.maxSteps + 80);
  return { x: shift - pad, w: W + pad * 2, shift };
}

// ---------------------------------------------------------------------------
// Кадр и капот
// ---------------------------------------------------------------------------

/** Мир занимает весь экран — и внутри шайбы, и на кинематографе. */
export const frameRect = () => ({ x: 0, y: 0, w: W, h: H });

export function framePath() {
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
}

/** Высота капота и его верхняя кромка. Снаружи шайбы капота нет. */
export function hoodMetrics() {
  const vis = 1 - easeInOut(S.outside);
  const h = Math.max(0, (Math.min(HOOD.heightMax, H * HOOD.heightFrac) + S.hoodBob) * vis);
  return { h, top: H - h, bulge: h * HOOD.bulge, vis };
}

export const hoodTop = () => hoodMetrics().top;
