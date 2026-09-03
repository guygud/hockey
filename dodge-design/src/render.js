// ============================================================================
// РЕНДЕР
// ----------------------------------------------------------------------------
// Единственный модуль, который рисует. Состояние он только читает — ничего в
// S не пишет, поэтому порядок отрисовки можно менять свободно.
//
// Порядок кадра: арена → лёд → декор → ворота → шайба → клюшки (дальние
// первыми) → частицы и штрихи → капот шайбы → виньетка и вспышки → подсказки.
// ============================================================================

import { TRACK } from "./balance.js";
import {
  ARENA,
  BEAT,
  CAM,
  CORRIDOR,
  CUE_FONT,
  GOAL,
  HEAT,
  LENS,
  SPEED_LINES,
  STICK,
  STRAFE,
} from "./tuning.js";
import { comradeSprite, imgReady, imgs, konkiSprite } from "./assets.js";
import { canvas, ctx, hud } from "./dom.js";
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
import { strikeProgress, timeToHit, timingPhase } from "./rules.js";
import { cueCaption, cueKey, cueTarget, cueWord } from "./tutorial.js";
import { TUTOR } from "./tutorial-script.js";
import { hoodJitter, worldJitter } from "./fx.js";
import { clamp01, hash01, hexToRgbStr, smoothstep } from "./util.js";
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
  if (S.skaters.length === 0) return;
  const nearSprite = konkiSprite();
  if (!nearSprite && !imgs.comradeSmall && !imgs.comradeSmallLeft) return;

  skaterQueue.length = 0;
  for (const s of S.skaters) skaterQueue.push(s);
  skaterQueue.sort(byZOffDesc);

  for (const s of skaterQueue) {
    const sprite = s.near ? nearSprite : comradeSprite(s.vx);
    if (!sprite) continue;
    const p = project(s.x, S.puck.z + s.zOff, true);
    if (!p) continue;

    const ratio = sprite.height / Math.max(1, sprite.width);
    // Ближний план — огромные лезвия; дальний — игрок целиком за бортом.
    const w = s.near
      ? W * 1.08
      : Math.min(W * 0.22, Math.max(56, 140 * p.k));
    if (p.sx + w / 2 < -20 || p.sx - w / 2 > W + 20) continue;
    const h = w * ratio;
    // Коньки: якорь на лезвии. Игрок: ноги на льду.
    const blade = s.near ? 0.75 : 0.96;
    const fade = Math.max(0.25, Math.min(1, (p.sx + w / 2) / 80, (W + w / 2 - p.sx) / 80));
    ctx.save();
    ctx.globalAlpha = (s.near ? 0.96 : 0.92) * fade;
    ctx.translate(p.sx, p.sy);
    ctx.drawImage(sprite, -w / 2, -h * blade, w, h);
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
  const base = project(px, S.puck.z);
  if (!base) return;

  drawShadow(px, S.puck.z, 26, 0.95);
  ctx.save();
  ctx.globalAlpha = Math.min(1, S.outside);
  if (imgReady(imgs.puck)) {
    const w = Math.max(28, 52 * base.k);
    const h = w * (imgs.puck.naturalHeight / imgs.puck.naturalWidth);
    ctx.drawImage(imgs.puck, base.sx - w / 2, base.sy - h * 0.5, w, h);
  } else {
    const top = projectHeight(px, S.puck.z, 13);
    if (top) {
      const rx = Math.max(8, 18 * base.k);
      const ry = Math.max(3, rx * 0.36);
      ctx.fillStyle = "#2a2a30";
      ctx.beginPath();
      ctx.ellipse(base.sx, base.sy, rx, ry, 0, 0, Math.PI * 2);
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
// Клюшки
// ---------------------------------------------------------------------------

const stickSprite = (foe, side) =>
  side < 0 ? (foe ? imgs.redLeft : imgs.blueLeft) : foe ? imgs.redRight : imgs.blueRight;

/**
 * 0 пока не разрешена, потом 1 по мере проезда мимо шайбы. Отсчёт идёт от
 * МОМЕНТА ОТВЕТА, а не от точки контакта: иначе между «я увернулся» и реакцией
 * клюшки была мёртвая пауза, пока шайба доезжала до её глубины.
 */
function slipProgress(obs) {
  if (!obs.resolved) return 0;
  const from = obs.slipZ != null ? obs.slipZ : obs.z - TRACK.hitLine;
  return clamp01((S.puck.z - from) / STICK.slipSpan);
}

/** Растворяем клюшку на проезде и ещё раз у самого глаза, чтобы не мазала. */
function passAlpha(slip, d) {
  return Math.pow(Math.max(0, 1 - slip), 0.9) * clamp01((d - CAM.near) / 70);
}

/** Куда наводится боковая красная: её прицел, а не центр коридора. */
function stickAimX(obs) {
  if (!obs || obs.side === 0 || typeof obs.aimX !== "number") return 0;
  return obs.aimX;
}

/**
 * Замах отсчитывается ОТ точки наводки: на swing = 1 лезвие приходит ровно в
 * прицел, а не в центр коридора. Иначе после рывка клюшка уезжала за кадр
 * вместо того, чтобы тянуться за шайбой.
 */
function stickTipX(side, swing, push, foe, obs) {
  if (foe === false) {
    // 0 = за бортом, 1 = лезвие в кадре у шайбы; после толчка push уносит наружу.
    return side * (CORRIDOR.halfW * (1.55 - swing * 0.95) + push * 36);
  }
  return stickAimX(obs) + side * (CORRIDOR.halfW * (1.05 - swing * 1.05 + push));
}

/**
 * Спрайты уже развёрнуты по сторонам, лезвие смотрит в коридор. Якорь — на
 * ЛЕЗВИИ, ручка тянется к бортам. Угол берётся только из STICK.
 */
function drawTiltedStick(img, tipX, tipZ, side, swing, alpha, appearDeg, stopDeg, lenMul = 1) {
  if (!imgReady(img)) return null;
  const tip = projectHeight(tipX, tipZ, STICK.tipHeight);
  if (!tip) return null;
  const drawW = Math.max(28, Math.min(W * STICK.maxScreenFrac, STICK.worldLen * lenMul * tip.k));
  const drawH = drawW * (img.naturalHeight / Math.max(1, img.naturalWidth));
  const a = appearDeg * (Math.PI / 180);
  const b = stopDeg * (Math.PI / 180);
  const tiltRad = a + (b - a) * clamp01(swing);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(tip.sx, tip.sy);
  // Положительный угол в конфиге = ручка поднята. Знак меняется по стороне.
  ctx.rotate(side < 0 ? -tiltRad : tiltRad);
  // Левые ассеты: лезвие у правого края → рисуем, заканчивая на кончике.
  if (side < 0) ctx.drawImage(img, -drawW, -drawH / 2, drawW, drawH);
  else ctx.drawImage(img, 0, -drawH / 2, drawW, drawH);
  ctx.restore();
  return tip;
}

/**
 * Свои — холодный синий, чужие — горячий красный. Цвет обязан читаться с
 * дальнего конца: кнопку выбирают задолго до контакта.
 */
function stickPalette(obs) {
  const hot = obs.windowOpen && !obs.resolved;
  if (obs.foe) {
    return {
      shaft: hot ? "#c43a52" : "#8e1c30",
      glow: hot ? "rgba(220,70,90,0.22)" : "rgba(180,50,70,0.14)",
      spark: "255,140,155",
    };
  }
  return {
    shaft: hot ? "#4fc9ff" : "#2a6b8c",
    glow: hot ? "rgba(90,205,255,0.28)" : "rgba(70,160,210,0.16)",
    spark: "190,240,255",
  };
}

/** Ореол на лезвии, чтобы тип клюшки читался ещё до того, как ясен цвет. */
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

/**
 * Блик на льду под лезвием — главный носитель тайминга. Та же модель, что и у
 * оценки нажатия: пятно разгорается на подходе, вспыхивает белым в идеальном
 * окне и остывает в красный, когда момент упущен.
 */
function drawIceGlow(x, z, obs) {
  if (obs.resolved && obs.ok) return;
  const tp = timingPhase(obs);
  let phase = tp.phase;
  let intensity = tp.intensity;

  // У пропущенной клюшки остаётся остывающее пятно, пока она проезжает мимо.
  if (!phase && obs.resolved && !obs.ok) {
    const slip = slipProgress(obs);
    if (slip >= 0.55) return;
    phase = "late";
    intensity = Math.max(0, 1 - slip / 0.55) * 0.7;
  }
  if (!phase || intensity <= 0.02) return;

  const p = project(x, z);
  if (!p) return;

  // Клюшка на act-паузе звучит громче всех; в свободной игре пятно тише.
  const actFocus = !!(S.tutorPause && S.tutorPause.mode === "act" && S.tutorPause.obs === obs);
  const dim = actFocus ? 0.85 : 0.45;
  const boost = (actFocus ? 1.55 : obs.lesson ? 1.15 : 1) * dim;
  let radiusMul;
  let coreRgb;
  let midRgb;
  let alpha;

  if (phase === "approach") {
    // Широкое тусклое пятно цвета клюшки — «нормально» уже близко.
    radiusMul = 2.4 - intensity * 0.7;
    coreRgb = obs.foe ? "255,90,120" : "120,210,255";
    midRgb = obs.foe ? "200,40,70" : "60,150,210";
    alpha = (0.16 + intensity * 0.28) * boost;
  } else if (phase === "perfect") {
    const flash = Math.max(0.55, intensity);
    radiusMul = 1.35 - flash * 0.15;
    coreRgb = "255,255,255";
    midRgb = "230,235,245";
    alpha = (0.38 + flash * 0.16) * (actFocus ? 1.35 : 1);
  } else {
    // Остывающий янтарно-красный — момент упущен.
    radiusMul = 1.3 + (1 - intensity) * 1.1;
    coreRgb = "255,120,70";
    midRgb = "180,40,30";
    alpha = (0.22 + intensity * 0.3) * boost;
  }

  const fade = passAlpha(slipProgress(obs), p.d);
  const rx = Math.max(10, 28 * p.k * radiusMul * Math.max(boost, 0.7));
  const ry = Math.max(4, rx * 0.38);

  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha) * fade;
  ctx.translate(p.sx, p.sy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${coreRgb},1)`);
  g.addColorStop(0.35, `rgba(${midRgb},0.55)`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Тихий маркер идеального окна — без белого ядра и без пульса.
  if (phase === "perfect" && imgReady(imgs.signal)) {
    const flash = Math.max(0.55, intensity);
    const size = Math.max(28, rx * 1.6);
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.32 * fade * flash * (actFocus ? 0.7 : 1));
    ctx.drawImage(imgs.signal, p.sx - size / 2, p.sy - size / 2, size, size);
    ctx.restore();
  }
}

/** Запасная отрисовка древка, если PNG клюшки не загрузился. */
function drawStickFallback(side, tipZ, tip, pal, swing, alpha, thickness, originX = 0) {
  const grip = projectHeight(originX + side * CORRIDOR.halfW * 1.45, tipZ, 18);
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

function slapPose(arrive) {
  const t = clamp01((arrive - 0.42) / 0.38);
  return t * t * (3 - 2 * t);
}

function drawStick(obs) {
  const arrive = smoothstep(strikeProgress(obs));
  const slip = slipProgress(obs);
  const pose = obs.foe ? arrive : slip > 0 ? 1 : slapPose(arrive);
  const side = obs.side;
  // Бросок ухода front-loaded: почти весь путь из кадра проходит сразу.
  const whip = (2 - slip) * slip * STICK.dodgeWhip;
  const push = obs.ok ? (obs.foe ? whip : slip * 1.1) : slip * 0.2;
  const tipX = stickTipX(side, arrive, push, obs.foe, obs);
  const tipZ = obs.z + STICK.tipZOffset;
  const aimX = stickAimX(obs);
  // Пока прицел не догнал шайбу, клюшка вытягивается — видно, как она тянется.
  const gap = obs.foe && obs.side !== 0 && !obs.resolved ? Math.abs((S.puck.x || 0) - aimX) : 0;
  const lenMul = 1 + Math.min(0.22, (gap / STRAFE.maxX) * 0.4);

  drawShadow(tipX, tipZ, 12 + pose * 22, 1.1);
  if (obs.foe) {
    const glowX = obs.side !== 0 ? aimX : tipX * 0.38;
    drawIceGlow(glowX, tipZ, obs);
  }

  const tip = projectHeight(tipX, tipZ, STICK.tipHeight);
  if (!tip) return;

  const pal = stickPalette(obs);
  const alpha = passAlpha(slip, tip.d);
  const appearDeg = obs.foe ? STICK.angleAppearDeg : STICK.teamAppearDeg;
  const stopDeg = obs.foe ? STICK.angleStopDeg : STICK.teamStopDeg;

  ctx.save();
  ctx.globalAlpha = alpha;
  drawTipGlow(tip, pal, obs.foe ? 0.8 : 0.7);
  ctx.restore();

  const drawn = drawTiltedStick(
    stickSprite(obs.foe, side), tipX, tipZ, side, pose, alpha, appearDeg, stopDeg, lenMul
  );
  if (!drawn) drawStickFallback(side, tipZ, tip, pal, pose, alpha, 5 + pose * 3, aimX);

  // Синяя, которая только что подтолкнула, разбрасывает искры.
  if (obs.ok && !obs.foe && slip > 0 && slip < 0.85) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgba(${pal.spark},${0.55 * (1 - slip)})`;
    ctx.lineWidth = Math.max(1.5, 2.2 * tip.k);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + slip * 6;
      const r = (6 + slip * 26) * tip.k;
      ctx.moveTo(tip.sx, tip.sy);
      ctx.lineTo(tip.sx + Math.cos(ang) * r, tip.sy + Math.sin(ang) * r * 0.6);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Лобовая пара: две красные с обеих сторон, ответ — SPACE. */
function drawCross(obs) {
  const swing = smoothstep(strikeProgress(obs));
  const slip = slipProgress(obs);
  const tipZ = obs.z + STICK.tipZOffset;
  const push = obs.ok ? slip * 1.5 : slip * 0.35;
  // Камера едет с шайбой: ворота прыжка держим в центре кадра, а не у x = 0.
  const gateX = S.puck.x || 0;

  drawShadow(gateX, obs.z, 28 + swing * 40, 0.55);
  drawIceGlow(gateX, obs.z, obs);

  const pal = stickPalette(obs);
  for (const side of [-1, 1]) {
    const tipX = gateX + stickTipX(side, swing, push);
    const tip = projectHeight(tipX, tipZ, STICK.tipHeight);
    if (!tip) continue;

    const alpha = passAlpha(slip, tip.d);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawTipGlow(tip, pal, 0.9);
    ctx.restore();

    const sprite = stickSprite(true, side);
    const drawn = drawTiltedStick(
      sprite, tipX, tipZ, side, swing, alpha, STICK.crossAppearDeg, STICK.crossStopDeg
    );
    if (!drawn) drawStickFallback(side, tipZ, tip, pal, swing, alpha, 6 + swing * 4, gateX);
  }
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

/**
 * Три колонки над капотом. Они же — зоны тапа, поэтому обучающая подсветка и
 * область нажатия это буквально одно и то же.
 */
function cueZones() {
  const y = H * 0.1;
  const h = Math.max(40, hoodTop() - y);
  const third = W / 3;
  return {
    left: { x: 0, y, w: third, h },
    brace: { x: third, y, w: third, h },
    right: { x: third * 2, y, w: third, h },
  };
}

/** Пульсирующая стрелка от центра экрана к спидометру. */
function drawGripArrow() {
  if (!S.tutorPause || !S.tutorPause.pointGrip || !hud.stats || S.phase !== "play") return;
  const rect = hud.stats.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const tx = rect.left + rect.width * 0.5 - canvasRect.left;
  const ty = rect.bottom - canvasRect.top + 6;
  const sx = W * 0.5;
  const sy = H * 0.48;
  const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 220);

  ctx.save();
  ctx.strokeStyle = `rgba(255, 200, 90, ${0.45 + 0.4 * pulse})`;
  ctx.fillStyle = `rgba(255, 200, 90, ${0.55 + 0.4 * pulse})`;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(sx, sy - (sy - ty) * 0.35, tx, ty + 50, tx, ty + 14);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tx, ty + 2);
  ctx.lineTo(tx - 10, ty + 18);
  ctx.lineTo(tx + 10, ty + 18);
  ctx.closePath();
  ctx.fill();

  ctx.font = `700 11px ${CUE_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(255, 220, 140, ${0.7 + 0.3 * pulse})`;
  ctx.fillText("СКОРОСТЬ", tx, ty + 22);
  ctx.restore();
}

/**
 * Обучающий оверлей. На act-паузе главный герой — блик на льду, поэтому от
 * колонки остаётся только компактный бейдж с кнопкой.
 */
function drawTutorCue() {
  if (!S.tutorOn || S.phase !== "play" || S.tutorMode !== "script") return;
  const obs = cueTarget();
  if (!obs) return;

  const zones = cueZones();
  const target = zones[obs.want];
  if (!target) return;

  const frozen = !!(S.tutorPause && S.tutorPause.mode === "act");
  const near = clamp01(1 - timeToHit(obs) / TUTOR.cueLead);
  const tp = timingPhase(obs);
  const live = frozen ? 1 : obs.windowOpen ? 0.85 : 0.35 + 0.45 * near;
  const rgb = obs.foe ? "255,70,100" : "90,200,255";
  const baseScale = Math.max(0.78, Math.min(1.15, W / 900));
  const scale = baseScale * (frozen ? 0.85 : 1);

  ctx.save();
  ctx.lineJoin = "round";

  // Размечаем все три колонки, чтобы выбор читался как выбор из трёх.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(232,244,255,${frozen ? 0.1 : 0.07 + 0.1 * live})`;
  ctx.setLineDash([6, 9]);
  ctx.beginPath();
  for (const key of ["brace", "right"]) {
    const z = zones[key];
    ctx.moveTo(z.x, z.y);
    ctx.lineTo(z.x, z.y + z.h);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (!frozen) {
    // Тихая заливка колонки на подходе — но не на act-паузе.
    const g = ctx.createLinearGradient(0, target.y + target.h, 0, target.y);
    g.addColorStop(0, `rgba(${rgb},${0.28 * live})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(target.x, target.y, target.w, target.h);
  }

  const cx = target.x + target.w / 2;
  const cy = target.y + target.h * (frozen ? 0.72 : 0.58);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(255,255,255,${frozen ? 0.8 : 0.65 + 0.35 * live})`;
  ctx.font = `800 ${19 * scale}px ${CUE_FONT}`;
  ctx.fillText(cueKey(obs.want), cx, cy);

  ctx.font = `700 ${10.5 * scale}px ${CUE_FONT}`;
  ctx.fillStyle = `rgba(232,244,255,${frozen ? 0.6 : 0.55 + 0.4 * live})`;
  ctx.fillText(cueWord(obs.want), cx, cy + 28 * scale);

  if (!frozen) {
    ctx.font = `700 ${13 * Math.min(baseScale, 1.1)}px ${CUE_FONT}`;
    ctx.fillStyle = `rgba(${rgb},${0.6 + 0.4 * near})`;
    ctx.fillText(cueCaption(obs), W / 2, target.y + 30);
  }

  // Тайминг блика — главный урок, поэтому на паузе он громче бейджа кнопки.
  const dodge = obs.side !== 0;
  let hint = dodge ? "СМОТРИ НА БЛИК — УХОДИ" : "СМОТРИ НА БЛИК НА ЛЬДУ";
  let hintRgb = "200,220,240";
  if (tp.phase === "approach") {
    hint = dodge ? "БЛИК РАЗГОРАЕТСЯ — ГОТОВЬСЯ УХОДИТЬ" : "БЛИК РАЗГОРАЕТСЯ — ГОТОВЬСЯ";
    hintRgb = rgb;
  } else if (tp.phase === "perfect" || frozen) {
    hint = dodge ? "УХОДИ В СТОРОНУ НА БЛИКЕ" : "ПРЫЖОК НА ВСПЫШКЕ";
    hintRgb = "255,255,255";
  } else if (tp.phase === "late") {
    hint = dodge ? "ПОЗДНО — КЛЮШКА ДОГОНЯЕТ" : "ПОЗДНО — БЛИК ОСТЫВАЕТ";
    hintRgb = "255,140,90";
  }
  ctx.font = `800 ${(frozen ? 14 : 10.5) * Math.min(baseScale, 1.1)}px ${CUE_FONT}`;
  ctx.fillStyle = `rgba(${hintRgb},${frozen ? 0.95 : 0.55 + 0.4 * live})`;
  ctx.fillText(hint, W / 2, frozen ? target.y + target.h * 0.38 : target.y + 52);
  ctx.restore();
}

/** Еле заметное деление на колонки, чтобы зоны тапа не были секретом. */
function drawTapZones() {
  if (!isTouchUi() || S.phase !== "play") return;
  if (S.tutorOn && S.tutorMode === "script") return; // там уже своя разметка
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

  // Мир занимает весь кадр; капот рисуется поверх после.
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

  // Разрешённые клюшки остаются в кадре, чтобы было видно, как они проезжают
  // мимо, а не исчезают. Когда глаз снаружи — держим и те, что между камерой
  // и шайбой.
  const backLimit = S.puck.z - rig().back - 30;
  drawQueue.length = 0;
  for (const o of S.obstacles) {
    if (o.z > backLimit && slipProgress(o) < 1) drawQueue.push(o);
  }
  drawQueue.sort(byZDesc);
  for (const obs of drawQueue) {
    if (obs.type === "cross") drawCross(obs);
    else drawStick(obs);
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

  if (!S.cinema) {
    drawTapZones();
    drawTutorCue();
    drawGripArrow();
  }
}
