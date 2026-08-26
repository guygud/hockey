// ============================================================================
// РЕНДЕР
// ----------------------------------------------------------------------------
// Единственный модуль, который рисует. Состояние он только читает — ничего в
// S не пишет, поэтому порядок отрисовки можно менять свободно.
//
// Порядок кадра: арена → лёд → декор → ворота и вратарь → шайба → фигуры (дальние
// первыми) → частицы и штрихи → капот шайбы → виньетка и вспышки → подсказки.
// ============================================================================

import {
  ARENA,
  BEAT,
  CAM,
  CINEMA,
  CONES,
  CORRIDOR,
  FLASHES,
  GOAL,
  GOALIE,
  goalieBodyWorld,
  HEAT,
  ICE_SCUFF,
  LENS,
  PLAYER,
  PLAYER_EASY,
  SKATERS,
  HOOK,
  SPEED_LINES,
} from "./tuning.js";
import { poseOf } from "./pose.js";
import { JUMP, PUCK, TRACK } from "./balance.js";
import { imgReady, imgs } from "./assets.js";
import { canvas, ctx, blurCtx } from "./dom.js";
import {
  arenaCover,
  framePath,
  hoodMetrics,
  hoodTop,
  project,
  projectHeight,
  pushMix,
  rig,
  syncCamera,
} from "./camera.js";
import { S, theme } from "./state.js";
import { hoodJitter, worldJitter } from "./fx.js";
import { clamp01, hash01, hexToRgbStr } from "./util.js";
import { W, H, isTouchUi } from "./viewport.js";

// Буферы сортировки живут между кадрами: рендер не должен мусорить массивами.
const drawQueue = [];
const skaterQueue = [];

// ---------------------------------------------------------------------------
// Арена и лёд
// ---------------------------------------------------------------------------

function drawArenaStrip() {
  const horizon = H * CAM.horizonFrac;
  const pal = theme();
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, pal.strip[0]);
  g.addColorStop(0.55, pal.strip[1]);
  g.addColorStop(1, pal.strip[2]);
  ctx.fillStyle = g;
  const cover = arenaCover();
  ctx.fillRect(cover.x, 0, cover.w, horizon + 2);

  if (!imgReady(imgs.tribune)) return;
  // Толпа читается только в своих пропорциях: на весь оверскан её растягивать
  // нельзя, поэтому кладём плитками по ширине.
  const tileW = horizon * (imgs.tribune.naturalWidth / imgs.tribune.naturalHeight);
  ctx.save();
  ctx.globalAlpha = 0.98 * (0.85 + 0.15 * pushMix());
  for (let x = cover.x; x < cover.x + cover.w; x += tileW) {
    ctx.drawImage(imgs.tribune, x, 0, tileW, horizon);
  }
  ctx.restore();
}

/** Камеры в толпе: слоты flashs.png вспыхивают над бортом. Чёрный фон гасится сложением. */
function drawCrowdFlashes() {
  const img = imgs.flashs;
  if (!imgReady(img)) return;
  const horizon = H * CAM.horizonFrac;
  const slice = img.naturalWidth / 7;
  const size = Math.max(18, horizon * FLASHES.sizeFrac);
  const t = performance.now() / 1000;
  const shift = arenaCover().shift;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < FLASHES.count; i++) {
    const on = FLASHES.on[0] + hash01(i * 5 + 2) * (FLASHES.on[1] - FLASHES.on[0]);
    const gap = FLASHES.gap[0] + hash01(i * 7 + 4) * (FLASHES.gap[1] - FLASHES.gap[0]);
    const period = on + gap;
    const phase = (t + hash01(i * 11 + 8) * 20) % period;
    if (phase > on) continue;
    const a = Math.sin((phase / on) * Math.PI);
    if (a < 0.04) continue;
    // По ширине кадра, не по оверскану: cover уезжает далеко влево, и вспышки пропадали.
    const x = shift + ((i + 0.5) / FLASHES.count) * W + (hash01(i * 13 + 1) - 0.5) * (W / FLASHES.count);
    const y = horizon * (FLASHES.yMin + hash01(i * 17 + 3) * (FLASHES.yMax - FLASHES.yMin));
    const slot = i % 7;
    const s = size * (0.65 + hash01(i * 23 + 9) * 0.7);
    ctx.globalAlpha = 0.55 + 0.45 * a;
    ctx.drawImage(img, slot * slice, 0, slice, img.naturalHeight, x - s / 2, y - s / 2, s, s);
  }
  ctx.restore();
}

/** Борт: дуга по центру кадра, дальше по бокам — её краевой столбец. */
function drawBoards() {
  const horizon = H * CAM.horizonFrac;
  const img = imgs.board;
  const cover = arenaCover();
  if (!imgReady(img)) {
    ctx.strokeStyle = "rgba(250, 180, 255, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, horizon - 2);
    ctx.lineTo(W, horizon - 2);
    ctx.stroke();
    return;
  }

  const w = W * ARENA.boardSpan;
  const h = Math.max(w / ARENA.boardRatio, horizon * ARENA.boardMinFrac);
  const x = cover.shift + (W - w) / 2;
  const y = horizon + ARENA.boardDrop - h * ARENA.boardLipFrac;
  const right = x + w;
  const edge = cover.x + cover.w;

  ctx.save();
  ctx.globalAlpha = 0.96 * (0.85 + 0.15 * pushMix());
  ctx.drawImage(img, x, y, w, h);
  if (x > cover.x) {
    ctx.drawImage(img, 0, 0, 1, img.naturalHeight, cover.x, y, x - cover.x, h);
  }
  if (right < edge) {
    ctx.drawImage(img, img.naturalWidth - 1, 0, 1, img.naturalHeight, right, y, edge - right, h);
  }
  ctx.restore();
}

function drawFloor() {
  const horizon = H * CAM.horizonFrac;
  const iceY = horizon - 8;
  const iceH = H - horizon + 24;
  const pal = theme();

  // Подложка на случай, если текстуры ещё не загрузились.
  const g = ctx.createLinearGradient(0, horizon, 0, H);
  g.addColorStop(0, pal.floor[0]);
  g.addColorStop(0.35, pal.floor[1]);
  g.addColorStop(1, pal.floor[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, horizon, W, iceH);

  // Освещение льда — один слой на весь кадр. Сдвиг дал бы шов, поэтому доворот
  // достаётся только воротам, коридору и эмодзи на плоскости.
  if (imgReady(imgs.ice)) ctx.drawImage(imgs.ice, 0, iceY, W, iceH);
}

/**
 * Пятно затёртого льда — один параллелограмм на плоскости. Три точки дают
 * базис «вправо» и «вглубь»; без нарезки по полосам нет швов-гармошки.
 */
function drawScuff(sc, img) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const depth = sc.w * (ih / iw) * sc.stretch;
  const halfW = sc.w * 0.5;
  const halfD = depth * 0.5;
  const cang = Math.cos(sc.rot);
  const sang = Math.sin(sc.rot);

  const c = project(sc.x, sc.z, true);
  const r = project(sc.x + cang * halfW * sc.mir, sc.z + sang * halfW * sc.mir, true);
  const f = project(sc.x - sang * halfD, sc.z + cang * halfD, true);
  if (!c || !r || !f) return;
  if (c.d < ICE_SCUFF.nearFade) return;
  if (sc.z - S.puck.z > ICE_SCUFF.farFade) return;

  const rx = r.sx - c.sx;
  const ry = r.sy - c.sy;
  const fx = f.sx - c.sx;
  const fy = f.sy - c.sy;
  if (Math.hypot(rx, ry) < 2 && Math.hypot(fx, fy) < 2) return;

  ctx.save();
  ctx.translate(c.sx, c.sy);
  // Исходник: (0,0) — левый-дальний угол; базис x — вправо на iw, y — к камере на ih.
  ctx.transform(rx / (iw * 0.5), ry / (iw * 0.5), -fx / (ih * 0.5), -fy / (ih * 0.5), 0, 0);
  ctx.drawImage(img, -iw * 0.5, -ih * 0.5, iw, ih);
  ctx.restore();
}

/** Затёртый лёд: пятна лежат на плоскости и едут вместе с ареной. */
function drawIceScuffs() {
  const img = imgs.scuff;
  if (!imgReady(img) || S.scuffs.length === 0) return;
  const cutoff = S.puck.z - 400;
  const horizon = S.puck.z + ICE_SCUFF.farFade;
  // Пятна засеяны по возрастанию z, поэтому с конца: дальние ложатся первыми.
  for (let i = S.scuffs.length - 1; i >= 0; i--) {
    const sc = S.scuffs[i];
    if (sc.z > horizon) continue;
    if (sc.z < cutoff) break;
    drawScuff(sc, img);
  }
}

const byZOffDesc = (a, b) => b.z - a.z;

function extraProfile() {
  return {
    worldW: SKATERS.worldW,
    bladeX: PLAYER.bladeX,
    bladeY: PLAYER.bladeY,
    feetX: PLAYER.feetX,
    feetY: PLAYER.feetY,
    plant: PLAYER.plant,
    maxScreenFrac: SKATERS.maxScreenFrac,
  };
}

function drawSkaters() {
  if (S.skaters.length === 0) return;
  skaterQueue.length = 0;
  for (const s of S.skaters) skaterQueue.push(s);
  skaterQueue.sort(byZOffDesc);

  for (const s of skaterQueue) {
    const img = s.x < 0 ? imgs.comradeLeft : imgs.comrade;
    if (!imgReady(img)) continue;
    const face = s.face ?? 0;
    drawShadow(s.x, s.z, 18 * (0.3 + 0.7 * face), 1);
    drawFigure(img, s.x, s.z, extraProfile(), 0.96, face, poseOf("ally", s.x));
  }
}

function drawGoal() {
  const z = S.runDist;
  const half = GOAL.halfW;
  const postL = projectHeight(-half, z, GOAL.postHeight, true);
  const postR = projectHeight(half, z, GOAL.postHeight, true);
  const baseL = project(-half, z, true);
  const baseR = project(half, z, true);
  if (!postL || !postR || !baseL || !baseR) return;

  const gap = S.puck ? z - S.puck.z : 0;
  const near = gap <= 0 ? 1 : Math.pow(clamp01(1 - gap / GOAL.nearZ), GOAL.nearPow);
  if (near < 0.02) return;

  const cx = (baseL.sx + baseR.sx) / 2;
  const glowR = Math.max(30, Math.abs(baseR.sx - baseL.sx) * 0.7);
  const goalW = Math.abs(baseR.sx - baseL.sx) * 1.2;
  const goalH = Math.max(24, Math.abs(baseL.sy - postL.sy) * 1.25);
  const goalY = postL.sy - goalH * 0.08 + goalH * GOAL.yDownFrac;
  const glowY = (postL.sy + baseL.sy) / 2 + goalH * GOAL.yDownFrac * 0.5;

  ctx.save();
  ctx.globalAlpha = near;
  const glow = ctx.createRadialGradient(cx, glowY, 4, cx, glowY, glowR);
  glow.addColorStop(0, "rgba(255, 140, 255, 0.35)");
  glow.addColorStop(0.55, "rgba(180, 80, 255, 0.14)");
  glow.addColorStop(1, "rgba(120, 40, 200, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, glowY, glowR, 0, Math.PI * 2);
  ctx.fill();

  if (imgReady(imgs.gate)) {
    ctx.globalAlpha = near * 0.98;
    ctx.drawImage(imgs.gate, cx - goalW / 2, goalY, goalW, goalH);
    ctx.globalAlpha = near;
  } else {
    ctx.strokeStyle = "#e8a0ff";
    ctx.lineWidth = Math.max(3, postL.k * 6);
    ctx.beginPath();
    ctx.moveTo(baseL.sx, baseL.sy);
    ctx.lineTo(postL.sx, postL.sy);
    ctx.lineTo(postR.sx, postR.sy);
    ctx.lineTo(baseR.sx, baseR.sy);
    ctx.stroke();
  }
  ctx.restore();

  if (S.netFlash > 0) {
    const r = glowR * 1.35;
    const flash = ctx.createRadialGradient(cx, glowY, 2, cx, glowY, r);
    flash.addColorStop(0, `rgba(255,255,255,${0.7 * S.netFlash})`);
    flash.addColorStop(0.35, `rgba(255,180,255,${0.4 * S.netFlash})`);
    flash.addColorStop(1, "rgba(200,80,255,0)");
    ctx.fillStyle = flash;
    ctx.beginPath();
    ctx.arc(cx, glowY, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShadow(x, z, rx, rzScale, dy = 0) {
  const p = project(x, z, true);
  if (!p) return;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(p.sx, p.sy + dy, Math.max(4, rx * p.k), Math.max(2, rx * 0.35 * p.k * (rzScale || 1)), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawStriker() {
  const cin = S.cinema;
  if (!cin || cin.mode !== "intro" || S.outside <= 0.02) return;
  const img = imgs.hook;
  if (!S.puck || !imgReady(img)) return;
  const strike = cin.strike ?? 0;
  const wobble = cin.wobble ?? 0;
  const ang =
    CINEMA.introSwing0 +
    strike * (CINEMA.introSwing1 - CINEMA.introSwing0) +
    wobble * ((CINEMA.introWobbleDeg * Math.PI) / 180);
  const px = cin.plantX ?? S.puck.x ?? 0;
  const pz = cin.plantZ ?? S.puck.z;
  const z = pz - (1 - strike) * CINEMA.introReach;
  const blade = project(px, z, true);
  if (!blade) return;
  const w = Math.max(80, Math.min(W * HOOK.maxScreenFrac, HOOK.worldW * blade.k));
  const h = w * (img.naturalHeight / Math.max(1, img.naturalWidth));
  drawShadow(px, z, 18 * (0.4 + 0.6 * strike), 1);
  ctx.save();
  ctx.globalAlpha = S.outside;
  ctx.translate(blade.sx, blade.sy);
  ctx.rotate(ang);
  ctx.drawImage(img, -HOOK.bladeX * w, -HOOK.bladeY * h, w, h);
  ctx.restore();
}

/** Шайба как объект мира — только когда глаз снаружи неё. */
function drawPuckBody() {
  if (S.outside <= 0.01) return;
  const px = S.puck.x || 0;
  const py = S.puck.y || 0;
  const base = project(px, S.puck.z);
  if (!base) return;

  const shadowScale = 1 / (1 + py * 0.035);
  drawShadow(px, S.puck.z, 26 * shadowScale, 0.95);
  ctx.save();
  ctx.globalAlpha = Math.min(1, S.outside);
  if (imgReady(imgs.puck)) {
    const w = Math.max(48, 115 * base.k);
    const h = w * (imgs.puck.naturalHeight / imgs.puck.naturalWidth);
    const lifted = projectHeight(px, S.puck.z, 13 + py);
    const sy = lifted ? lifted.sy : base.sy;
    ctx.drawImage(imgs.puck, base.sx - w / 2, sy - h * 0.55, w, h);
  } else {
    const top = projectHeight(px, S.puck.z, 13 + py);
    if (top) {
      const rx = Math.max(8, 18 * base.k);
      const ry = Math.max(3, rx * 0.36);
      ctx.fillStyle = "#2a2a30";
      ctx.beginPath();
      ctx.ellipse(base.sx, base.sy, rx * shadowScale, ry * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4a3a6a";
      ctx.beginPath();
      ctx.ellipse(top.sx, top.sy, rx * 0.98, ry * 0.98, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Фигуры хоккеистов — стоят на льду, якорь в крюке
// ---------------------------------------------------------------------------

function slipProgress(obs) {
  if (!obs.resolved) return 0;
  const from = obs.slipZ != null ? obs.slipZ : obs.z;
  return clamp01((S.puck.z - from) / PLAYER.slipSpan);
}

function passAlpha(slip, d) {
  if (S.poseMode) return 1;
  return Math.pow(Math.max(0, 1 - slip), 0.9) * clamp01((d - CAM.near) / 70);
}

function nearFade(obs) {
  if (S.poseMode) return 1;
  const d = obs.z - S.puck.z;
  if (d >= PLAYER.nearFade) return 1;
  return 0.15 + 0.85 * clamp01(d / PLAYER.nearFade);
}

function nearFactor(obs) {
  const d = obs.z - S.puck.z;
  return clamp01(1 - (d - 80) / 520);
}

function iceRgb(kind) {
  return kind === "boost" ? "90,200,255" : "255,70,100";
}

/** Занятая полоса на льду: красная зона объезда / синие ворота. */
function drawIceBand(obs, rgb, alpha) {
  if (obs.resolved && obs.ok) return;
  const x0 = obs.x - obs.w / 2;
  const x1 = obs.x + obs.w / 2;
  const z = obs.z;
  const depth = obs.kind === "low" ? 22 : 14;
  const fl = project(x0, z - depth, true);
  const fr = project(x1, z - depth, true);
  const bl = project(x0, z + depth, true);
  const br = project(x1, z + depth, true);
  if (!fl || !fr || !bl || !br) return;
  const fade = passAlpha(slipProgress(obs), fl.d);
  const near = 0.4 + 0.6 * nearFactor(obs);
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha * fade * near);
  ctx.beginPath();
  ctx.moveTo(fl.sx, fl.sy);
  ctx.lineTo(fr.sx, fr.sy);
  ctx.lineTo(br.sx, br.sy);
  ctx.lineTo(bl.sx, bl.sy);
  ctx.closePath();
  ctx.fillStyle = `rgba(${rgb},${S.poseMode ? 0.55 : 0.72})`;
  ctx.fill();
  ctx.restore();
}

function drawVertArrow(x, z, worldH, worldW, alpha) {
  const base = project(x, z, true);
  const top = projectHeight(x, z, worldH, true);
  if (!base || !top) return;
  const sx = base.sx;
  const by = base.sy;
  const ty = top.sy;
  const hw = worldW * 0.5 * base.k;
  const headY = ty + (by - ty) * 0.55;
  const stem = hw * 0.34;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(sx, ty);
  ctx.lineTo(sx + hw, headY);
  ctx.lineTo(sx + stem, headY);
  ctx.lineTo(sx + stem, by);
  ctx.lineTo(sx - stem, by);
  ctx.lineTo(sx - stem, headY);
  ctx.lineTo(sx - hw, headY);
  ctx.closePath();
  ctx.fillStyle = "rgba(40, 255, 80, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(210, 255, 190, 0.95)";
  ctx.lineWidth = Math.max(2, 2.6 * base.k);
  ctx.stroke();
  ctx.restore();
}

function drawBoostArrows(obs) {
  if (obs.resolved && obs.ok) return;
  const sample = project(obs.x, obs.z, true);
  if (!sample) return;
  const fade = passAlpha(slipProgress(obs), sample.d);
  const near = 0.45 + 0.55 * nearFactor(obs);
  const a = 0.82 * fade * near;
  if (a < 0.04) return;
  const span = obs.w * 0.36;
  const xs = obs.w < 70 ? [obs.x] : [obs.x - span, obs.x, obs.x + span];
  for (const x of xs) {
    drawVertArrow(x, obs.z, 86, 28, a);
  }
}

function innerEdge(obs) {
  return obs.x + (obs.x < 0 ? obs.w / 2 : -obs.w / 2);
}

function enemyImg(side, easy) {
  if (easy) return side < 0 ? imgs.enemyEasyLeft : imgs.enemyEasyRight;
  return side < 0 ? imgs.enemyLeft : imgs.enemy;
}

function comradeImg(side) {
  return side < 0 ? imgs.comradeLeft : imgs.comrade;
}

/** Крюк в левой части кадра спрайта — не путать с суффиксом файла. */
function hookLeftOf(img) {
  return img === imgs.enemy || img === imgs.enemyEasyRight || img === imgs.comrade;
}

function drawFigure(img, tipX, tipZ, profile, alpha, face = 1, pose = null) {
  if (!imgReady(img)) return null;
  const fade = S.poseMode ? 1 : clamp01(face);
  if (fade < 0.02) return null;
  const leftHook = hookLeftOf(img);
  const worldX = tipX + (pose?.x || 0);
  const tip = project(worldX, tipZ, true);
  if (!tip) return null;
  const w = Math.max(36, Math.min(W * profile.maxScreenFrac, profile.worldW * tip.k));
  const h = w * (img.naturalHeight / Math.max(1, img.naturalWidth));
  const bx = leftHook ? profile.bladeX : 1 - profile.bladeX;
  const lift = (pose?.y || 0) * tip.k;
  const rot = ((pose?.rot || 0) * Math.PI) / 180;
  const yaw = ((pose?.yaw || 0) * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = alpha * fade;
  ctx.translate(tip.sx, tip.sy);
  if (yaw) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const sx = Math.abs(c) < 0.05 ? Math.sign(c || 1) * 0.05 : c;
    ctx.transform(sx, s * 0.28, 0, 1, 0, 0);
  }
  if (rot) ctx.rotate(rot);
  ctx.drawImage(img, -bx * w, -profile.bladeY * h + (profile.plant || 0) * h - lift, w, h);
  ctx.restore();
  return tip;
}

function blockTipX(obs) {
  const side = obs.x < 0 ? -1 : 1;
  const whip = obs.ok ? (2 - slipProgress(obs)) * slipProgress(obs) * PLAYER.dodgeWhip * CORRIDOR.halfW * 0.45 : 0;
  const pull = obs.easy ? PLAYER_EASY.boardPull : PLAYER.boardPull;
  return innerEdge(obs) + side * (whip + pull);
}

function drawShoulderMate(obs, tipZ, profile, alpha, face) {
  const side = obs.x < 0 ? -1 : 1;
  const mx = side * (CORRIDOR.halfW + PLAYER.mateOut);
  const mz = tipZ + PLAYER.mateAhead;
  const img = side < 0 ? imgs.comradeLeft : imgs.comrade;
  drawShadow(mx, mz, 20 * (0.3 + 0.7 * face), 1);
  drawFigure(img, mx, mz, profile, alpha * 0.95, face, poseOf("ally", side));
}

function drawBlock(obs) {
  const slip = slipProgress(obs);
  const tipX = blockTipX(obs);
  const tipZ = obs.z + PLAYER.tipZOffset;
  const tip = project(tipX, tipZ, true);
  if (!tip) return;
  const alpha = passAlpha(slip, tip.d) * nearFade(obs);
  const profile = obs.easy ? PLAYER_EASY : PLAYER;
  const side = obs.x < 0 ? -1 : 1;
  const face = obs.face ?? 0;
  drawIceBand(obs, iceRgb("block"), S.poseMode ? 0.7 : 0.28);
  drawShadow(tipX, tipZ, 22 * (0.3 + 0.7 * face), 1.05);
  drawFigure(enemyImg(side, obs.easy), tipX, tipZ, profile, alpha, face, poseOf(obs.easy ? "easy" : "enemy", side));
  if (obs.mate) drawShoulderMate(obs, tipZ, profile, alpha, face);
}

function drawLowBands(obs) {
  const halfLane = CORRIDOR.halfW * JUMP.laneFrac;
  const left = { ...obs, x: (-CORRIDOR.halfW - halfLane) / 2, w: CORRIDOR.halfW - halfLane };
  const right = { ...obs, x: (CORRIDOR.halfW + halfLane) / 2, w: CORRIDOR.halfW - halfLane };
  const mid = { ...obs, x: 0, w: halfLane * 2 };
  drawIceBand(left, iceRgb("low"), S.poseMode ? 0.55 : 0.32);
  drawIceBand(right, iceRgb("low"), S.poseMode ? 0.55 : 0.32);
  drawIceBand(mid, "120,210,255", S.poseMode ? 0.35 : 0.16);
}

/** Две красные навстречу друг другу — прыжок только в центральной полосе. */
function drawLow(obs) {
  const slip = slipProgress(obs);
  const tipZ = obs.z + PLAYER.tipZOffset;
  const sample = project(obs.x, tipZ, true);
  if (!sample) return;
  const alpha = passAlpha(slip, sample.d) * nearFade(obs);
  const face = obs.face ?? 0;
  drawLowBands(obs);
  drawShadow(obs.x, obs.z, 32 * (0.3 + 0.7 * face), 0.55);
  const push = obs.ok ? slip * 1.55 : slip * 0.12;
  for (const side of [-1, 1]) {
    const tipX = obs.x + side * (CORRIDOR.halfW * (PLAYER.jumpSpread + push * 0.35));
    drawFigure(enemyImg(side, false), tipX, tipZ, PLAYER, alpha, face, poseOf("pair", side));
  }
}

function drawBoost(obs) {
  const slip = slipProgress(obs);
  const tipZ = obs.z + PLAYER.tipZOffset;
  const sample = project(obs.x, tipZ, true);
  if (!sample) return;
  const alpha = passAlpha(slip, sample.d) * nearFade(obs);
  const face = obs.face ?? 0;
  drawBoostArrows(obs);
  const push = obs.ok ? slip * 36 : 0;
  for (const side of [-1, 1]) {
    const tipX = obs.x + side * CORRIDOR.halfW * PLAYER.allyEdge + side * push;
    drawShadow(tipX, tipZ, 16 * (0.5 + 0.5 * face), 1);
    drawFigure(comradeImg(side), tipX, tipZ, PLAYER, alpha, face, poseOf("ally", side));
  }
}

function drawCone(cone) {
  if (!imgReady(imgs.conus)) return;
  const p = project(cone.x, cone.z, true);
  if (!p) return;
  const w = Math.max(6, Math.min(W * CONES.maxScreenFrac, CONES.worldW * p.k));
  const flat = w * (imgs.conus.naturalHeight / Math.max(1, imgs.conus.naturalWidth));
  const h = flat * (CONES.heightScale || 1);
  const fade = p.d >= CONES.nearFade ? 1 : 0.12 + 0.88 * clamp01(p.d / CONES.nearFade);
  // Опускаем по нерастянутой высоте: конус тянется вверх, низ остаётся на месте.
  const drop = flat * (CONES.plant || 0);
  ctx.save();
  ctx.globalAlpha = fade;
  drawShadow(cone.x, cone.z, 9, 1, drop);
  ctx.drawImage(imgs.conus, p.sx - w / 2, p.sy - h * (CONES.feetY || 0.9) + drop, w, h);
  ctx.restore();
}

function drawObstacle(obs) {
  if (obs.kind === "low") drawLow(obs);
  else if (obs.kind === "boost") drawBoost(obs);
  else drawBlock(obs);
}

function drawPoseCaption() {
  if (!S.poseMode) return;
  ctx.save();
  ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
  const text = "POSE  ·  хитбоксы";
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(20, 30, 50, 0.72)";
  ctx.fillRect(12, H - 48, tw + 24, 32);
  ctx.fillStyle = "#fff8e0";
  ctx.fillText(text, 24, H - 27);
  ctx.restore();
}

function hbPt(x, z, y) {
  return y > 0.15 ? projectHeight(x, z, y, true) : project(x, z, true);
}

function hbQuad(x0, z0, x1, z1, y, fill, stroke) {
  const a = hbPt(x0, z0, y);
  const b = hbPt(x1, z0, y);
  const c = hbPt(x1, z1, y);
  const d = hbPt(x0, z1, y);
  if (!a || !b || !c || !d) return;
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.lineTo(c.sx, c.sy);
  ctx.lineTo(d.sx, d.sy);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function hbCircle(x, z, r, y, stroke, fill) {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const p = hbPt(x + Math.cos(a) * r, z + Math.sin(a) * r * 0.35, y);
    if (!p) continue;
    if (!started) {
      ctx.moveTo(p.sx, p.sy);
      started = true;
    } else ctx.lineTo(p.sx, p.sy);
  }
  if (!started) return;
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function hbBox(x0, x1, z, y0, y1, stroke) {
  const z0 = z - 8;
  const z1 = z + 8;
  hbQuad(x0, z0, x1, z1, y0, null, stroke);
  if (y1 > y0 + 0.5) {
    hbQuad(x0, z0, x1, z1, y1, null, stroke);
    const corners = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    ctx.beginPath();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    for (const [x, zz] of corners) {
      const lo = hbPt(x, zz, y0);
      const hi = hbPt(x, zz, y1);
      if (!lo || !hi) continue;
      ctx.moveTo(lo.sx, lo.sy);
      ctx.lineTo(hi.sx, hi.sy);
    }
    ctx.stroke();
  }
}

/** Объёмы столкновений. Только ?pose=1: иначе закрывают игру. */
function drawHitboxes() {
  if (!S.poseMode || !S.puck) return;
  const r = PUCK.radius;
  const px = S.puck.x || 0;
  const pz = S.puck.z;
  const py = S.puck.y || 0;
  const noseZ = pz + TRACK.hitLine;
  const lane = CORRIDOR.halfW * JUMP.laneFrac;

  ctx.save();
  ctx.setLineDash([]);

  hbQuad(-lane, pz - 40, lane, S.runDist + 40, 0, "rgba(80,255,120,0.08)", "rgba(80,255,120,0.55)");

  for (const obs of S.obstacles) {
    const x0 = obs.x - obs.w / 2;
    const x1 = obs.x + obs.w / 2;
    if (obs.kind === "boost") {
      hbBox(x0, x1, obs.z, 0, 0, "rgba(80,200,255,0.95)");
      hbQuad(x0, obs.z - 10, x1, obs.z + 10, 0, "rgba(80,200,255,0.18)", null);
    } else if (obs.kind === "low") {
      hbBox(x0, x1, obs.z, 0, JUMP.clear, "rgba(255,170,40,0.95)");
      hbQuad(x0 - r, obs.z - 10, x1 + r, obs.z + 10, 0, "rgba(255,140,0,0.12)", "rgba(255,200,80,0.7)");
    } else {
      hbBox(x0, x1, obs.z, 0, 36, "rgba(255,70,90,0.95)");
      hbQuad(x0 - r, obs.z - 10, x1 + r, obs.z + 10, 0, "rgba(255,40,70,0.14)", "rgba(255,120,140,0.85)");
    }
  }

  const gZ = S.runDist - GOALIE.zBack;
  const body = goalieBodyWorld(S.goalieX || 0, S.goalieDir);
  hbBox(body.left, body.right, gZ, 0, 40, "rgba(255,80,255,0.95)");
  hbQuad(-GOAL.halfW, S.runDist - 6, GOAL.halfW, S.runDist + 6, 0, "rgba(255,230,80,0.12)", "rgba(255,230,80,0.9)");

  hbCircle(px, pz, r, 0, "rgba(40,255,90,0.95)", "rgba(40,255,90,0.2)");
  if (py > 0.2) hbCircle(px, pz, r, py, "rgba(40,255,90,0.95)", "rgba(40,255,90,0.12)");
  hbCircle(px, noseZ, r, py, "rgba(80,255,255,0.95)", "rgba(80,255,255,0.22)");

  const n0 = project(px, pz, true);
  const n1 = project(px, noseZ, true);
  if (n0 && n1) {
    ctx.strokeStyle = "rgba(80,255,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(n0.sx, n0.sy);
    ctx.lineTo(n1.sx, n1.sy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawGoalie() {
  if (!imgReady(imgs.gater)) return;
  const face = S.poseMode ? 1 : S.goalieFace || 0;
  if (face < 0.03) return;
  const netZ = S.runDist;
  const z = netZ - GOALIE.zBack;
  const x = S.goalieX || 0;
  const half = GOAL.halfW;
  const postL = projectHeight(-half, netZ, GOAL.postHeight, true);
  const baseL = project(-half, netZ, true);
  const baseR = project(half, netZ, true);
  if (!postL || !baseL || !baseR) return;

  const goalH = Math.max(24, Math.abs(baseL.sy - postL.sy) * 1.25);
  const goalY = postL.sy - goalH * 0.08 + goalH * GOAL.yDownFrac;
  const iceY = goalY + goalH * 0.97;
  const h = goalH * GOALIE.size;
  const w = h * (imgs.gater.naturalWidth / imgs.gater.naturalHeight) * GOALIE.widthScale;
  const mid = (baseL.sx + baseR.sx) / 2;
  const sx = mid + (x / half) * ((baseR.sx - baseL.sx) / 2);
  const dir = S.goalieDir < 0 ? -1 : 1;

  drawShadow(x, z, 22 * (0.3 + 0.7 * face), 1.15);
  ctx.save();
  ctx.globalAlpha = face;
  ctx.translate(sx, 0);
  ctx.scale(dir, 1);
  ctx.translate(-sx, 0);
  ctx.drawImage(imgs.gater, sx - GOALIE.feetX * w, iceY - GOALIE.feetY * h + (GOALIE.plant || 0) * h, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Частицы и штрихи скорости
// ---------------------------------------------------------------------------

function drawParticles() {
  const flash = imgs.flashs;
  const ready = imgReady(flash);
  const slice = ready ? flash.naturalWidth / 7 : 0;
  for (const p of S.particles) {
    const pr = project(p.x, p.z);
    if (!pr) continue;
    const a = p.life / p.max;
    if (ready) {
      const size = Math.max(8, 22 * pr.k * (0.45 + a));
      const slot = Math.abs(Math.floor(p.x * 2.1 + p.z * 0.07)) % 7;
      ctx.save();
      ctx.globalAlpha = 0.75 * a;
      ctx.drawImage(flash, slot * slice, 0, slice, flash.naturalHeight, pr.sx - size / 2, pr.sy - size / 2, size, size);
      ctx.restore();
    } else {
      ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, Math.max(1, 3 * pr.k * a), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Аниме-штрихи: летят из точки схода к краям, густеют вместе со скоростью. */
function drawSpeedLines() {
  if (S.outside > 0.5) return;
  const drive = clamp01((S.mom - SPEED_LINES.minMom) / (1 - SPEED_LINES.minMom));
  const load = Math.min(
    1,
    drive + S.boostFx * 0.8 + S.heat * HEAT.lines + S.beatPulse * BEAT.pulse * 0.15 + pushMix() * 0.2
  );
  if (load <= 0.02) return;

  const cx = W / 2;
  const cy = H * CAM.horizonFrac;
  const t = performance.now() / 1000;
  const gap = W * SPEED_LINES.centerGapFrac;
  const reach = Math.hypot(W, H) * 0.75;
  const lineRgb = theme().lines;

  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < SPEED_LINES.count; i++) {
    const seed = hash01(i);
    const ang = (i % 2 === 0 ? Math.PI : 0) + (hash01(i + 91) - 0.5) * 0.9;
    const phase = (t * SPEED_LINES.rate * (0.7 + seed * 0.8) * (0.5 + load) + seed) % 1;
    const a = SPEED_LINES.alpha * load * Math.sin(Math.PI * Math.min(1, phase / 0.9));
    if (a <= 0.01) continue;
    const r0 = gap + phase * reach;
    const len = reach * SPEED_LINES.lenFrac * (0.45 + seed * 0.9) * (0.5 + load * 0.7);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang) * 0.45;
    ctx.strokeStyle = `rgba(${lineRgb},${a})`;
    ctx.lineWidth = 1 + 2.2 * load * seed;
    ctx.beginPath();
    ctx.moveTo(cx + dx * r0, cy + dy * r0);
    ctx.lineTo(cx + dx * (r0 + len), cy + dy * (r0 + len));
    ctx.stroke();
  }
  ctx.restore();
}

/** Радиальные полосы от точки схода — и на ходу, и толчком после чистого приёма. */
function drawSpeedStreaks() {
  if (S.outside > 0.5) return;
  const drive = clamp01((S.mom - SPEED_LINES.minMom) / (1 - SPEED_LINES.minMom));
  const t = performance.now() / 1000;
  const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * SPEED_LINES.imgPulse * Math.PI * 2));
  const a = Math.min(1, drive * pulse + S.boostFx);
  if (a <= 0.02) return;
  const cx = W / 2;
  const cy = H * CAM.horizonFrac;
  if (imgReady(imgs.speed)) {
    const w = W * (0.9 + 0.25 * a);
    const h = w * (imgs.speed.naturalHeight / Math.max(1, imgs.speed.naturalWidth));
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.55 * a;
    ctx.drawImage(imgs.speed, cx - w / 2, cy - h * SPEED_LINES.imgY, w, h);
    ctx.restore();
    return;
  }
  ctx.strokeStyle = `rgba(225,248,255,${0.4 * a})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 20; i++) {
    const ang = (i / 20) * Math.PI * 2 + (i % 3) * 0.35;
    const r0 = 70 + (1 - a) * 220;
    const r1 = r0 + 60 + 120 * a;
    ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.55);
    ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.55);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Капот шайбы и вспышки поверх кадра
// ---------------------------------------------------------------------------

function hoodPath(metrics) {
  const { top, bulge } = metrics;
  // Запас за краем экрана: при крене до 15° углы диска не обрезаются.
  const pad = Math.max(W, H) * 0.45;
  ctx.beginPath();
  ctx.moveTo(-pad, top + bulge);
  ctx.quadraticCurveTo(W / 2, top - bulge, W + pad, top + bulge);
  ctx.lineTo(W + pad, H + pad);
  ctx.lineTo(-pad, H + pad);
  ctx.closePath();
}

/** Видимая четверть шайбы у нижней кромки — как капот машины. */
function drawHood() {
  const metrics = hoodMetrics();
  if (metrics.vis <= 0.01) return;
  const { h, top, bulge } = metrics;
  const pal = theme();

  ctx.save();
  hoodPath(metrics);
  const hood = pal.hood || [pal.shell, pal.floor[1]];
  const body = ctx.createLinearGradient(0, top - bulge, 0, H);
  body.addColorStop(0, `rgba(${hexToRgbStr(hood[0])},0.92)`);
  body.addColorStop(0.45, `rgba(${hexToRgbStr(hood[1])},0.95)`);
  body.addColorStop(1, `rgba(${hexToRgbStr(hood[1])},1)`);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.clip();

  const cx = W / 2;
  const cy = top + h * 0.28;
  const shine = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, h) * 0.42);
  shine.addColorStop(0, "rgba(255,230,255,0.28)");
  shine.addColorStop(0.45, "rgba(255,200,255,0.08)");
  shine.addColorStop(1, "rgba(255,200,255,0)");
  ctx.fillStyle = shine;
  ctx.fillRect(-W, top - bulge - h, W * 3, h * 2 + bulge + H);

  if (S.mom < 0.2) {
    const a = 0.1 + (1 - S.mom / 0.2) * 0.28;
    const warnH = Math.min(110, h * 0.55);
    const warnG = ctx.createLinearGradient(0, top, 0, top + warnH);
    warnG.addColorStop(0, `rgba(255,70,50,${a})`);
    warnG.addColorStop(1, "rgba(255,70,50,0)");
    ctx.fillStyle = warnG;
    ctx.fillRect(-W, top - bulge, W * 3, warnH + bulge);
  }
  ctx.restore();

  ctx.save();
  const pad = Math.max(W, H) * 0.45;
  ctx.beginPath();
  ctx.moveTo(-pad, top + bulge);
  ctx.quadraticCurveTo(W / 2, top - bulge, W + pad, top + bulge);
  ctx.strokeStyle = pal.lane[1];
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

function drawHitFlash() {
  if (S.hitFlash <= 0.01) return;
  const a = S.hitFlash * S.hitFlash;
  const bottom = hoodTop();
  const tint = (alpha) =>
    S.hitFlashPerfect ? `rgba(140,255,200,${alpha})` : `rgba(140,210,255,${alpha})`;

  ctx.save();
  const band = Math.min(120, H * 0.18);
  const topG = ctx.createLinearGradient(0, 0, 0, band);
  topG.addColorStop(0, tint(0.5 * a));
  topG.addColorStop(1, tint(0));
  ctx.fillStyle = topG;
  ctx.fillRect(0, 0, W, band);

  const botG = ctx.createLinearGradient(0, bottom - band, 0, bottom);
  botG.addColorStop(0, tint(0));
  botG.addColorStop(1, tint(0.5 * a));
  ctx.fillStyle = botG;
  ctx.fillRect(0, bottom - band, W, band);
  ctx.restore();
}

function drawFrameTint() {
  const cx = W / 2;
  const cy = H / 2;
  const vr = Math.max(W, H) * 0.62;
  const vignette = LENS.vignette + S.heat * HEAT.vignette + pushMix() * 0.1 + S.beatPulse * 0.04;
  const vig = ctx.createRadialGradient(cx, cy, vr * 0.35, cx, cy, vr);
  vig.addColorStop(0, "rgba(10,4,18,0)");
  vig.addColorStop(1, `rgba(10,4,18,${vignette})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

function drawDamageFlash() {
  if (S.damageFlash <= 0) return;
  const a = S.damageFlash * 0.45;
  const cx = W / 2;
  const cy = H / 2;
  const g = ctx.createRadialGradient(cx, cy, H * 0.1, cx, cy, W * 0.55);
  g.addColorStop(0, `rgba(255,40,30,${a * 0.15})`);
  g.addColorStop(0.55, `rgba(180,20,20,${a * 0.35})`);
  g.addColorStop(1, `rgba(80,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (imgReady(imgs.hit)) {
    const size = Math.min(W, H) * (0.55 + 0.35 * S.damageFlash);
    ctx.save();
    ctx.globalAlpha = Math.min(1, S.damageFlash * 0.95);
    ctx.drawImage(imgs.hit, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Подсказки
// ---------------------------------------------------------------------------

function drawTapZones() {
  if (!isTouchUi() || S.phase !== "play") return;
  const third = W / 3;
  const workTop = H * 0.1;
  const bottom = hoodTop();
  const top = workTop + (bottom - workTop) * 0.55;
  ctx.save();
  ctx.strokeStyle = "rgba(232,244,255,0.07)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 10]);
  ctx.beginPath();
  ctx.moveTo(third, top);
  ctx.lineTo(third, bottom);
  ctx.moveTo(third * 2, top);
  ctx.lineTo(third * 2, bottom);
  ctx.stroke();
  ctx.restore();
}

/** Краевой блюр: копия кадра на #game-blur, сам гаусс делает CSS filter. */
function drawLensBlur() {
  if (!LENS.blur || !blurCtx) return;
  blurCtx.drawImage(canvas, 0, 0);
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

const byZDesc = (a, b) => b.z - a.z;

export function render() {
  syncCamera();

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = theme().shell;
  ctx.fillRect(0, 0, W, H);

  const { jx, jy, roll } = worldJitter();

  ctx.save();
  framePath();
  ctx.clip();

  ctx.save();
  ctx.translate(W / 2 + jx, H / 2 + jy);
  ctx.rotate(roll);
  ctx.translate(-W / 2, -H / 2);

  drawArenaStrip();
  drawFloor();
  drawIceScuffs();
  drawBoards();
  drawCrowdFlashes();
  drawSkaters();
  drawGoal();
  drawGoalie();
  drawStriker();
  drawPuckBody();

  const backLimit = S.puck.z - rig().back - 30;
  drawQueue.length = 0;
  for (const o of S.obstacles) {
    if (o.z > backLimit && slipProgress(o) < 1) drawQueue.push(o);
  }
  for (const c of S.cones || []) {
    if (c.z > backLimit) drawQueue.push(c);
  }
  drawQueue.sort(byZDesc);
  for (const item of drawQueue) {
    if (item.kind === "cone") drawCone(item);
    else drawObstacle(item);
  }

  drawHitboxes();
  drawParticles();
  drawSpeedLines();
  drawSpeedStreaks();
  ctx.restore();
  ctx.restore();

  const hj = hoodJitter();
  ctx.save();
  ctx.translate(W / 2 + hj.jx, H + hj.jy);
  ctx.rotate(hj.roll);
  ctx.translate(-W / 2, -H);
  drawHood();
  ctx.restore();

  drawFrameTint();
  drawLensBlur();
  drawHitFlash();
  drawDamageFlash();
  drawPoseCaption();

  if (!S.cinema) drawTapZones();
}

