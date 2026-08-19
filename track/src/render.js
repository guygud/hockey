// ============================================================================
// РЕНДЕР
// ----------------------------------------------------------------------------
// Единственный модуль, который рисует. Состояние он только читает — ничего в
// S не пишет, поэтому порядок отрисовки можно менять свободно.
//
// Порядок кадра: арена → лёд → декор → ворота → шайба → клюшки (дальние
// первыми) → частицы и штрихи → капот шайбы → виньетка и вспышки → подсказки.
// ============================================================================

import {
  ARENA,
  BEAT,
  CAM,
  CORRIDOR,
  GOAL,
  HEAT,
  LENS,
  SPEED_LINES,
  STICK,
} from "./tuning.js";
import { imgReady, imgs, konkiSprite } from "./assets.js";
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

const shellRgba = (a) => `rgba(${hexToRgbStr(theme().shell)},${a})`;

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

  // Стеновая панель за воротами, поверх неё — гнутый борт.
  const boardA = 0.85 + 0.15 * pushMix();
  if (imgReady(imgs.borderTop)) {
    ctx.save();
    ctx.globalAlpha = 0.95 * boardA;
    ctx.drawImage(imgs.borderTop, cover.x, horizon - ARENA.wallH * 0.92, cover.w, ARENA.wallH);
    ctx.restore();
  }
  if (imgReady(imgs.board)) {
    ctx.save();
    ctx.globalAlpha = 0.96 * boardA;
    ctx.drawImage(imgs.board, cover.x, horizon - ARENA.boardH * 0.72, cover.w, ARENA.boardH);
    ctx.restore();
  } else if (!imgReady(imgs.borderTop)) {
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

  if (imgReady(imgs.iceColor)) {
    ctx.save();
    ctx.globalAlpha = pal.tint[0];
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(imgs.iceColor, 0, iceY, W, iceH);
    ctx.restore();
  }
  if (imgReady(imgs.iceColor2)) {
    ctx.save();
    ctx.globalAlpha = pal.tint[1];
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(imgs.iceColor2, 0, iceY, W, iceH);
    ctx.restore();
  }

  // Полосы от коньков — главный индикатор скорости на пустом льду.
  const speedBoost = 0.8 + 0.5 * speedMix();
  const start = Math.floor((S.puck.z - rig().back) / CORRIDOR.ribStep) * CORRIDOR.ribStep;
  for (let i = 0; i < 70; i++) {
    const p = project(0, start + i * CORRIDOR.ribStep, true);
    if (!p) continue;
    ctx.strokeStyle = `rgba(255,230,255,${Math.max(0.03, 0.22 - i * 0.004) * speedBoost})`;
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

const byZOffDesc = (a, b) => b.zOff - a.zOff;

function drawSkaters() {
  const sprite = konkiSprite();
  if (!sprite || S.skaters.length === 0) return;
  const ratio = sprite.height / sprite.width;
  skaterQueue.length = 0;
  for (const s of S.skaters) skaterQueue.push(s);
  skaterQueue.sort(byZOffDesc);

  for (const s of skaterQueue) {
    const p = project(s.x, S.puck.z + s.zOff, true);
    if (!p) continue;
    // Ближний план намеренно шире экрана: видно только лезвие, и оно летит.
    const w = s.near ? W * 1.08 : Math.min(W * 0.34, Math.max(88, 230 * p.k));
    if (p.sx + w / 2 < -20 || p.sx - w / 2 > W + 20) continue;
    const h = w * ratio;
    const fade = Math.max(0.25, Math.min(1, (p.sx + w / 2) / 80, (W + w / 2 - p.sx) / 80));
    ctx.save();
    ctx.globalAlpha = (s.near ? 0.96 : 0.92) * fade;
    ctx.translate(p.sx, p.sy);
    ctx.drawImage(sprite, -w / 2, -h * 0.75, w, h);
    ctx.restore();
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
  const p = project(x, z);
  if (!p) return;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(p.sx, p.sy, Math.max(4, rx * p.k), Math.max(2, rx * 0.35 * p.k * (rzScale || 1)), 0, 0, Math.PI * 2);
  ctx.fill();
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
    const w = Math.max(28, 52 * base.k);
    const h = w * (imgs.puck.naturalHeight / imgs.puck.naturalWidth);
    const lifted = projectHeight(px, S.puck.z, 13 + py);
    const sy = lifted ? lifted.sy : base.sy;
    ctx.drawImage(imgs.puck, base.sx - w / 2, sy - h * 0.5, w, h);
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
// Клюшки — стоят на месте, читаются по занятой полосе на льду
// ---------------------------------------------------------------------------

const stickSprite = (foe, side) =>
  side < 0 ? (foe ? imgs.redLeft : imgs.blueLeft) : foe ? imgs.redRight : imgs.blueRight;

function slipProgress(obs) {
  if (!obs.resolved) return 0;
  const from = obs.slipZ != null ? obs.slipZ : obs.z;
  return clamp01((S.puck.z - from) / STICK.slipSpan);
}

function passAlpha(slip, d) {
  return Math.pow(Math.max(0, 1 - slip), 0.9) * clamp01((d - CAM.near) / 70);
}

function drawTiltedStick(img, tipX, tipZ, side, swing, alpha, appearDeg, stopDeg, lenMul = 1, tipH = STICK.tipHeight) {
  if (!imgReady(img)) return null;
  const tip = projectHeight(tipX, tipZ, tipH);
  if (!tip) return null;
  const drawW = Math.max(28, Math.min(W * STICK.maxScreenFrac, STICK.worldLen * lenMul * tip.k));
  const drawH = drawW * (img.naturalHeight / Math.max(1, img.naturalWidth));
  const a = appearDeg * (Math.PI / 180);
  const b = stopDeg * (Math.PI / 180);
  const tiltRad = a + (b - a) * clamp01(swing);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(tip.sx, tip.sy);
  ctx.rotate(side < 0 ? -tiltRad : tiltRad);
  if (side < 0) ctx.drawImage(img, -drawW, -drawH / 2, drawW, drawH);
  else ctx.drawImage(img, 0, -drawH / 2, drawW, drawH);
  ctx.restore();
  return tip;
}

function stickPalette(kind, hot) {
  if (kind === "boost") {
    return {
      shaft: hot ? "#4fc9ff" : "#2a6b8c",
      glow: hot ? "rgba(90,205,255,0.28)" : "rgba(70,160,210,0.16)",
      spark: "190,240,255",
      ice: "90,200,255",
    };
  }
  return {
    shaft: hot ? "#c43a52" : "#8e1c30",
    glow: hot ? "rgba(220,70,90,0.22)" : "rgba(180,50,70,0.14)",
    spark: "255,140,155",
    ice: "255,70,100",
  };
}

function drawTipGlow(p, pal, scale) {
  const r = Math.max(5, 11 * p.k * (scale || 1));
  const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r);
  g.addColorStop(0, pal.glow);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
  ctx.fill();
}

function nearFactor(obs) {
  const d = obs.z - S.puck.z;
  return clamp01(1 - (d - 80) / 520);
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
  ctx.fillStyle = `rgba(${rgb},0.72)`;
  ctx.fill();
  ctx.restore();
}

function drawStickFallback(side, tipZ, tip, pal, alpha, thickness, originX = 0, tipH = 18) {
  const grip = projectHeight(originX + side * CORRIDOR.halfW * 1.45, tipZ, tipH);
  if (!grip) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = pal.shaft;
  ctx.lineWidth = Math.min(STICK.nearWidthCap, Math.max(3, thickness * tip.k));
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(grip.sx, grip.sy);
  ctx.lineTo(tip.sx, tip.sy);
  ctx.stroke();
  ctx.restore();
}

function innerEdge(obs) {
  return obs.x + (obs.x < 0 ? obs.w / 2 : -obs.w / 2);
}

function drawOneStick(side, tipX, tipZ, pal, alpha, foe, swing, appear, stop, tipH) {
  drawShadow(tipX, tipZ, 18, 1.05);
  const tip = projectHeight(tipX, tipZ, tipH);
  if (!tip) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  drawTipGlow(tip, pal, foe ? 0.85 : 0.7);
  ctx.restore();
  const drawn = drawTiltedStick(stickSprite(foe, side), tipX, tipZ, side, swing, alpha, appear, stop, 1, tipH);
  if (!drawn) drawStickFallback(side, tipZ, tip, pal, alpha, 7, 0, tipH);
}

function drawBlock(obs) {
  const slip = slipProgress(obs);
  const side = obs.x < 0 ? -1 : 1;
  const whip = obs.ok ? (2 - slip) * slip * STICK.dodgeWhip * CORRIDOR.halfW * 0.45 : 0;
  const tipX = innerEdge(obs) + side * whip;
  const tipZ = obs.z + STICK.tipZOffset;
  const pal = stickPalette("block", !obs.resolved);
  const tip = projectHeight(tipX, tipZ, STICK.tipHeight);
  if (!tip) return;
  const alpha = passAlpha(slip, tip.d);
  drawIceBand(obs, pal.ice, 0.55);
  drawOneStick(side, tipX, tipZ, pal, alpha, true, 0.92, STICK.angleAppearDeg, STICK.angleStopDeg, STICK.tipHeight);
}

/** Две красные навстречу друг другу — прыжок. Как лобовая пара в dodge-design. */
function drawLow(obs) {
  const swing = 0.92;
  const slip = slipProgress(obs);
  const tipZ = obs.z + STICK.tipZOffset;
  const pal = stickPalette("low", !obs.resolved);
  const sample = projectHeight(obs.x, tipZ, STICK.tipHeight);
  if (!sample) return;
  const alpha = passAlpha(slip, sample.d);
  drawIceBand(obs, pal.ice, 0.6);
  drawShadow(obs.x, obs.z, 32, 0.55);
  const push = obs.ok ? slip * 1.55 : slip * 0.12;
  for (const side of [-1, 1]) {
    const tipX = obs.x + side * (CORRIDOR.halfW * (1.05 - swing * 1.05 + push));
    drawOneStick(side, tipX, tipZ, pal, alpha, true, swing, STICK.crossAppearDeg, STICK.crossStopDeg, STICK.tipHeight);
  }
}

function drawBoost(obs) {
  const slip = slipProgress(obs);
  const tipZ = obs.z + STICK.tipZOffset;
  const pal = stickPalette("boost", !obs.resolved);
  const sample = projectHeight(obs.x, tipZ, STICK.tipHeight);
  if (!sample) return;
  const alpha = passAlpha(slip, sample.d);
  drawIceBand(obs, pal.ice, 0.38);
  const push = obs.ok ? slip * 36 : 0;
  for (const side of [-1, 1]) {
    const tipX = obs.x + side * (obs.w / 2) + side * push;
    drawOneStick(side, tipX, tipZ, pal, alpha, false, 0.9, STICK.teamAppearDeg, STICK.teamStopDeg, STICK.tipHeight);
  }
  if (obs.ok && slip > 0 && slip < 0.85) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgba(${pal.spark},${0.55 * (1 - slip)})`;
    ctx.lineWidth = Math.max(1.5, 2.2 * sample.k);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + slip * 6;
      const r = (6 + slip * 26) * sample.k;
      ctx.moveTo(sample.sx, sample.sy);
      ctx.lineTo(sample.sx + Math.cos(ang) * r, sample.sy + Math.sin(ang) * r * 0.6);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawObstacle(obs) {
  if (obs.kind === "low") drawLow(obs);
  else if (obs.kind === "boost") drawBoost(obs);
  else drawBlock(obs);
}

// ---------------------------------------------------------------------------
// Частицы и штрихи скорости
// ---------------------------------------------------------------------------


function drawParticles() {
  for (const p of S.particles) {
    const pr = project(p.x, p.z);
    if (!pr) continue;
    const a = p.life / p.max;
    ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`;
    ctx.beginPath();
    ctx.arc(pr.sx, pr.sy, Math.max(1, 3 * pr.k * a), 0, Math.PI * 2);
    ctx.fill();
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
  const body = ctx.createLinearGradient(0, top - bulge, 0, H);
  body.addColorStop(0, shellRgba(0.92));
  body.addColorStop(0.45, `rgba(${hexToRgbStr(pal.floor[1])},0.95)`);
  body.addColorStop(1, shellRgba(1));
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
  drawPuckBody();

  const backLimit = S.puck.z - rig().back - 30;
  drawQueue.length = 0;
  for (const o of S.obstacles) {
    if (o.z > backLimit && slipProgress(o) < 1) drawQueue.push(o);
  }
  drawQueue.sort(byZDesc);
  for (const obs of drawQueue) drawObstacle(obs);

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

  if (!S.cinema) drawTapZones();
}

