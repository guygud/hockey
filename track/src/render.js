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
  CUTOUT,
  GOAL,
  GOALIE,
  HEAT,
  LENS,
  PLAYER,
  PLAYER_EASY,
  SKATERS,
  STRIKER,
  SPEED_LINES,
} from "./tuning.js";
import { JUMP } from "./balance.js";
import { imgReady, imgs } from "./assets.js";
import { ctx } from "./dom.js";
import {
  arenaCover,
  framePath,
  hoodMetrics,
  hoodTop,
  project,
  projectHeight,
  pushMix,
  rig,
  speedMix,
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

  const boardA = 0.85 + 0.15 * pushMix();
  if (imgReady(imgs.tribune)) {
    ctx.save();
    ctx.globalAlpha = 0.98 * boardA;
    ctx.drawImage(imgs.tribune, cover.x, 0, cover.w, horizon);
    ctx.restore();
  }
  if (imgReady(imgs.board)) {
    ctx.save();
    ctx.globalAlpha = 0.96 * boardA;
    ctx.drawImage(imgs.board, cover.x, horizon - ARENA.boardH * 0.55, cover.w, ARENA.boardH);
    ctx.restore();
  } else if (!imgReady(imgs.tribune)) {
    ctx.strokeStyle = "rgba(250, 180, 255, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, horizon - 2);
    ctx.lineTo(W, horizon - 2);
    ctx.stroke();
  }
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

  // Полосы от коньков — главный индикатор скорости на пустом льду.
  const speedBoost = 0.8 + 0.5 * speedMix();
  const start = Math.floor((S.puck.z - rig().back) / CORRIDOR.ribStep) * CORRIDOR.ribStep;
  const lineRgb = theme().lines;
  for (let i = 0; i < 70; i++) {
    const p = project(0, start + i * CORRIDOR.ribStep, true);
    if (!p) continue;
    ctx.strokeStyle = `rgba(${lineRgb},${Math.max(0.03, 0.14 - i * 0.003) * speedBoost})`;
    ctx.lineWidth = Math.max(1, p.k * 1.2);
    ctx.beginPath();
    ctx.moveTo(0, p.sy);
    ctx.lineTo(W, p.sy);
    ctx.stroke();
  }
}

/** Эмодзи вморожены в лёд: четыре угла на плоскости, едут и крутятся с ареной. */
function drawIceMarks() {
  const marks = S.iceMarks;
  if (marks.length === 0) return;
  const fontPx = 32;
  const half = fontPx * 0.5;
  const cutoff = S.puck.z - 50;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${fontPx}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
  // Метки засеяны по возрастанию z, поэтому идём с конца: дальние рисуются первыми.
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (mark.z <= cutoff) break;
    const c = project(mark.x, mark.z, true);
    const r = project(mark.x + mark.size, mark.z, true);
    const f = project(mark.x, mark.z + mark.size, true);
    if (!c || !r || !f) continue;
    const sx = r.sx - c.sx;
    const sy = r.sy - c.sy;
    const fx = f.sx - c.sx;
    const fy = f.sy - c.sy;
    if (Math.hypot(sx, sy) < 2 && Math.hypot(fx, fy) < 2) continue;
    ctx.save();
    ctx.globalAlpha = 0.38 + clamp01(1 - (mark.z - S.puck.z) / 900) * 0.22;
    ctx.translate(c.sx, c.sy);
    ctx.transform(sx / half, sy / half, fx / half, fy / half, 0, 0);
    ctx.fillText(mark.emoji, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

const byZOffDesc = (a, b) => b.z - a.z;

function extraProfile() {
  return {
    worldW: SKATERS.worldW,
    bladeX: PLAYER.bladeX,
    bladeY: PLAYER.bladeY,
    feetX: PLAYER.feetX,
    feetY: PLAYER.feetY,
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
    drawFigure(img, s.x, s.z, extraProfile(), 0.96, face);
  }
}

function drawLane() {
  const nearZ = S.puck.z - rig().back + CAM.near + 2;
  const farZ = S.puck.z + rig().far * 0.9;
  const farL = project(-CORRIDOR.halfW, farZ, true);
  const farR = project(CORRIDOR.halfW, farZ, true);
  const nearL = project(-CORRIDOR.halfW, nearZ, true);
  const nearR = project(CORRIDOR.halfW, nearZ, true);
  if (!farL || !farR || !nearL || !nearR) return;

  const pal = theme();
  ctx.fillStyle = pal.lane[0];
  ctx.beginPath();
  ctx.moveTo(farL.sx, farL.sy);
  ctx.lineTo(farR.sx, farR.sy);
  ctx.lineTo(nearR.sx, nearR.sy);
  ctx.lineTo(nearL.sx, nearL.sy);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = pal.lane[1];
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(farL.sx, farL.sy);
  ctx.lineTo(nearL.sx, nearL.sy);
  ctx.moveTo(farR.sx, farR.sy);
  ctx.lineTo(nearR.sx, nearR.sy);
  ctx.stroke();
}

function drawGoal() {
  const z = S.runDist;
  const half = 100;
  const postL = projectHeight(-half, z, GOAL.postHeight, true);
  const postR = projectHeight(half, z, GOAL.postHeight, true);
  const baseL = project(-half, z, true);
  const baseR = project(half, z, true);
  if (!postL || !postR || !baseL || !baseR) return;

  const cx = (baseL.sx + baseR.sx) / 2;
  const glowR = Math.max(30, Math.abs(baseR.sx - baseL.sx) * 0.7);
  const goalW = Math.abs(baseR.sx - baseL.sx) * 1.2;
  const goalH = Math.max(24, Math.abs(baseL.sy - postL.sy) * 1.25);
  const goalY = postL.sy - goalH * 0.08 + goalH * GOAL.yDownFrac;
  const glowY = (postL.sy + baseL.sy) / 2 + goalH * GOAL.yDownFrac * 0.5;

  const glow = ctx.createRadialGradient(cx, glowY, 4, cx, glowY, glowR);
  glow.addColorStop(0, "rgba(255, 140, 255, 0.35)");
  glow.addColorStop(0.55, "rgba(180, 80, 255, 0.14)");
  glow.addColorStop(1, "rgba(120, 40, 200, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, glowY, glowR, 0, Math.PI * 2);
  ctx.fill();

  if (imgReady(imgs.gate)) {
    ctx.save();
    ctx.globalAlpha = 0.98;
    ctx.drawImage(imgs.gate, cx - goalW / 2, goalY, goalW, goalH);
    ctx.restore();
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

function drawShadow(x, z, rx, rzScale) {
  const p = project(x, z, true);
  if (!p) return;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(p.sx, p.sy, Math.max(4, rx * p.k), Math.max(2, rx * 0.35 * p.k * (rzScale || 1)), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawStriker() {
  const cin = S.cinema;
  if (!cin || cin.mode !== "intro" || S.outside <= 0.02) return;
  const img = imgs.comrade;
  if (!S.puck || !imgReady(img)) return;
  const strike = cin.strike ?? 0;
  const wobble = cin.wobble ?? 0;
  const yaw0 = ((90 - CINEMA.introOpenDeg) * Math.PI) / 180;
  const yaw1 = (CINEMA.introBackDeg * Math.PI) / 180;
  const wobbleRad = (CINEMA.introWobbleDeg * Math.PI) / 180;
  const yaw = yaw0 + strike * (yaw1 - yaw0) + wobble * wobbleRad;
  const c = Math.cos(yaw);
  const mag = Math.max(CUTOUT.minEdge, Math.abs(c));
  const scale = (c < 0 ? -1 : 1) * mag;
  const px = cin.plantX ?? S.puck.x ?? 0;
  const pz = cin.plantZ ?? S.puck.z;
  const reach = STRIKER.worldW * (STRIKER.feetX - STRIKER.bladeX);
  const feetX = px - reach - (1 - strike) * CINEMA.introStandGap;
  const feet = project(feetX, pz, true);
  if (!feet) return;
  const w = Math.max(36, Math.min(W * STRIKER.maxScreenFrac, STRIKER.worldW * feet.k));
  const h = w * (img.naturalHeight / Math.max(1, img.naturalWidth));
  const dx = feet.sx - STRIKER.feetX * w;
  const dy = feet.sy - STRIKER.feetY * h;
  drawShadow(feetX, pz, 14 * (0.35 + 0.45 * strike), 1);
  ctx.save();
  ctx.globalAlpha = S.outside;
  ctx.translate(feet.sx, 0);
  ctx.scale(scale, 1);
  ctx.translate(-feet.sx, 0);
  ctx.drawImage(img, dx, dy, w, h);
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

const backPlates = new WeakMap();

function tintedSprite(img, color) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function backPlate(img) {
  let plate = backPlates.get(img);
  if (plate) return plate;
  const fill = tintedSprite(img, CUTOUT.backTint);
  const edge = tintedSprite(img, CUTOUT.backEdge);
  plate = document.createElement("canvas");
  plate.width = img.naturalWidth;
  plate.height = img.naturalHeight;
  const g = plate.getContext("2d");
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    g.drawImage(edge, dx, dy);
  }
  g.drawImage(fill, 0, 0);
  backPlates.set(img, plate);
  return plate;
}

function drawFigure(img, tipX, tipZ, profile, alpha, face = 1, maxAngle = CUTOUT.maxAngle, hingeHook = false) {
  if (!imgReady(img)) return null;
  const tip = project(tipX, tipZ, true);
  if (!tip) return null;
  const w = Math.max(36, Math.min(W * profile.maxScreenFrac, profile.worldW * tip.k));
  const h = w * (img.naturalHeight / Math.max(1, img.naturalWidth));
  const leftHook = hookLeftOf(img);
  const bx = leftHook ? profile.bladeX : 1 - profile.bladeX;
  const fx = leftHook ? profile.feetX : 1 - profile.feetX;
  const dx = tip.sx - bx * w;
  const dy = tip.sy - profile.bladeY * h;
  const pivot = dx + (hingeHook ? bx : fx) * w;
  const t = Math.max(0, Math.min(1, face));
  const c = Math.cos((1 - t) * maxAngle);
  const mag = Math.max(CUTOUT.minEdge, Math.abs(c));
  const scale = (c < 0 ? -1 : 1) * mag;
  const sprite = c <= 0 ? backPlate(img) : img;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(pivot, 0);
  ctx.scale(scale, 1);
  ctx.translate(-pivot, 0);
  ctx.drawImage(sprite, dx, dy, w, h);
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
  drawFigure(img, mx, mz, profile, alpha * 0.95, face);
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
  drawFigure(enemyImg(side, obs.easy), tipX, tipZ, profile, alpha, face);
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
    drawFigure(enemyImg(side, false), tipX, tipZ, PLAYER, alpha, face);
  }
}

function drawBoost(obs) {
  const slip = slipProgress(obs);
  const tipZ = obs.z + PLAYER.tipZOffset;
  const sample = project(obs.x, tipZ, true);
  if (!sample) return;
  const alpha = passAlpha(slip, sample.d) * nearFade(obs);
  const face = obs.face ?? 0;
  const allyMax = ((90 - CUTOUT.allyOpenDeg) * Math.PI) / 180;
  drawBoostArrows(obs);
  const push = obs.ok ? slip * 36 : 0;
  for (const side of [-1, 1]) {
    const tipX = obs.x + side * CORRIDOR.halfW * PLAYER.allyEdge + side * push;
    drawShadow(tipX, tipZ, 16 * (0.5 + 0.5 * face), 1);
    drawFigure(comradeImg(side), tipX, tipZ, PLAYER, alpha, face, allyMax, true);
  }
}

function drawCone(cone) {
  if (!imgReady(imgs.conus)) return;
  const p = project(cone.x, cone.z, true);
  if (!p) return;
  const w = Math.max(6, Math.min(W * CONES.maxScreenFrac, CONES.worldW * p.k));
  const h = w * (imgs.conus.naturalHeight / Math.max(1, imgs.conus.naturalWidth));
  const fade = p.d >= CONES.nearFade ? 1 : 0.12 + 0.88 * clamp01(p.d / CONES.nearFade);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.drawImage(imgs.conus, p.sx - w / 2, p.sy - h * 0.96, w, h);
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
  const text = "POSE  ·  тестовый заезд";
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(20, 30, 50, 0.72)";
  ctx.fillRect(12, H - 48, tw + 24, 32);
  ctx.fillStyle = "#fff8e0";
  ctx.fillText(text, 24, H - 27);
  ctx.restore();
}

function drawGoalie() {
  if (!imgReady(imgs.gater)) return;
  const face = S.goalieFace || 0;
  if (face < 0.03) return;
  const netZ = S.runDist;
  const z = netZ - GOALIE.zBack;
  const x = S.goalieX || 0;
  const half = 100;
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
  const c = Math.cos((1 - face) * CUTOUT.maxAngle);
  const mag = Math.max(CUTOUT.minEdge, Math.abs(c));
  const yaw = (c < 0 ? -1 : 1) * mag;
  const sprite = c <= 0 ? backPlate(imgs.gater) : imgs.gater;
  const alpha = 0.2 + 0.78 * face;

  drawShadow(x, z, 22 * (0.3 + 0.7 * face), 1.15);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, 0);
  ctx.scale(dir * yaw, 1);
  ctx.translate(-sx, 0);
  ctx.drawImage(sprite, sx - GOALIE.feetX * w, iceY - GOALIE.feetY * h, w, h);
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

/** Радиальные полосы от точки схода — толчок после чистого приёма. */
function drawSpeedStreaks() {
  const a = S.boostFx;
  if (a <= 0.02) return;
  const cx = W / 2;
  const cy = H * CAM.horizonFrac;
  if (imgReady(imgs.speed)) {
    const w = W * (0.85 + 0.4 * a);
    const h = w * (imgs.speed.naturalHeight / Math.max(1, imgs.speed.naturalWidth));
    ctx.save();
    ctx.globalAlpha = 0.28 + 0.55 * a;
    ctx.drawImage(imgs.speed, cx - w / 2, cy - h * 0.12, w, h);
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
  drawIceMarks();
  drawLane();
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
  drawHitFlash();
  drawDamageFlash();
  drawPoseCaption();

  if (!S.cinema) drawTapZones();
}

