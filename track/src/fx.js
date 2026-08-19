// ============================================================================
// ЭФФЕКТЫ И «ФИЛ»
// ----------------------------------------------------------------------------
// Пружины камеры, искры, декоративные конькобежцы, метроном. Ничего из этого
// не влияет на правила — только на то, как заезд ощущается.
// ============================================================================

import { AIM, STEER } from "./balance.js";
import { BEAT, DYN, FEEL, HEAT, HOOD, SKATERS, STRAFE, TURN } from "./tuning.js";
import { setHeatLevel, sfx, swish, tone } from "./audio.js";
import { pushMix, speedMix, clampTurn } from "./camera.js";
import { hideGrade } from "./hud.js";
import { S } from "./state.js";

/** Ледяная крошка из-под шайбы в точке контакта. */
export function spawnSparks(n) {
  for (let i = 0; i < n; i++) {
    S.particles.push({
      x: (S.puck.x || 0) + (Math.random() - 0.5) * 30,
      z: S.puck.z + 8 + (Math.random() - 0.5) * 20,
      life: 0.2 + Math.random() * 0.3,
      max: 0.45,
    });
  }
}

/** Веер крошки из-под лезвий: летит против рывка, как настоящий срез льда. */
export function spawnStrafeSpray(dir) {
  for (let i = 0; i < STRAFE.sprayN; i++) {
    S.particles.push({
      x: (S.puck.x || 0) + dir * (4 + Math.random() * 12),
      z: S.puck.z + 6 + Math.random() * 26,
      vx: -dir * (90 + Math.random() * 190),
      life: 0.22 + Math.random() * 0.26,
      max: 0.5,
    });
  }
}

/** Рывок вбок: крошка, скрежет коньков и снос корпуса в другую сторону. */
export function strafeKick(dir) {
  spawnStrafeSpray(dir);
  S.braceLean += dir * 16;
  S.hoodBobVel -= 40;
  sfx.strafe();
}

export function updateParticles(dt) {
  const list = S.particles;
  let write = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.life -= dt;
    p.z -= 40 * dt;
    if (p.vx) {
      p.x += p.vx * dt;
      p.vx *= Math.exp(-4 * dt);
    }
    if (p.life > 0) list[write++] = p;
  }
  list.length = write;
}

function spawnSkater() {
  if (S.skaters.length >= SKATERS.max || !S.puck) return;
  let nearCount = 0;
  for (const s of S.skaters) if (s.near) nearCount += 1;
  // Держим примерный паритет между ближним и дальним планом.
  const near = nearCount < S.skaters.length - nearCount;
  S.skaters.push({
    x: near ? -46 : -170,
    zOff: near ? 34 + Math.random() * 36 : 150 + Math.random() * 190,
    vx: near ? 340 + Math.random() * 90 : 440 + Math.random() * 180,
    near,
    stride: Math.random() * Math.PI * 2,
  });
}

export function updateSkaters(dt) {
  if (S.phase === "play") {
    S.skaterTimer -= dt;
    if (S.skaterTimer <= 0) {
      spawnSkater();
      S.skaterTimer = SKATERS.spawnGap + Math.random() * 1.1;
    }
  }
  for (let i = S.skaters.length - 1; i >= 0; i--) {
    const s = S.skaters[i];
    s.x += s.vx * dt;
    s.stride += dt * 10;
    if (s.x > (s.near ? 52 : 170)) S.skaters.splice(i, 1);
  }
}

/** Короткий взгляд в сторону нажатия — камера; шайба отдельно делает рывок. */
export function nudgeLook(code) {
  if (code === "left") {
    S.glanceX = -FEEL.glanceX;
    S.glanceY = 0;
    S.glanceRoll = -FEEL.glanceRoll;
  } else if (code === "right") {
    S.glanceX = FEEL.glanceX;
    S.glanceY = 0;
    S.glanceRoll = FEEL.glanceRoll;
  } else {
    // Прыжок: короткий взгляд вверх — картинка уезжает вниз по кадру.
    S.glanceX = 0;
    S.glanceY = FEEL.glanceY;
    S.glanceRoll = 0;
    S.hoodBobVel += HOOD.jumpKick;
  }
}

/** Метроном заезда: бочка на каждый четвёртый удар, хэт между ними. */
export function tickBeat(dt) {
  const bpm = S.activeRound && S.activeRound.bpm ? S.activeRound.bpm * (1 + 0.18 * pushMix()) : 0;
  if (bpm <= 0) return;
  const len = 60 / bpm;
  S.beatT += dt;
  while (S.beatT >= len) {
    S.beatT -= len;
    S.beatIdx += 1;
    if (S.beatIdx % 4 === 0) tone(92, 54, 0.12, BEAT.kick, "sine");
    else swish(0.03, BEAT.hat, 6200, 2.2);
    if (pushMix() > 0.2 && S.beatIdx % 2 === 0) tone(140, 110, 0.1, BEAT.kick * 0.7, "triangle");
    S.beatPulse = 1;
  }
}

/**
 * Все затухания и пружины за один кадр. Порядок не важен: величины независимы.
 * Знак camZ: + = камеру отбросило назад (успех), − = вдавило вперёд (провал).
 */
export function updateFx(dt) {
  S.heat += (S.heatTarget - S.heat) * Math.min(1, dt * 6);
  setHeatLevel(S.heat);
  S.beatPulse = Math.max(0, S.beatPulse - dt * 4);

  // Камера догоняет шайбу с отставанием: на рывке видно, как её сносит вбок.
  const px = S.puck ? S.puck.x || 0 : 0;
  S.camX += (px - S.camX) * Math.min(1, STRAFE.camLag * dt);

  S.tilt *= 0.88;
  if (!S.cinema && S.puck) {
    S.turnTarget = clampTurn((S.puck.vx / STEER.maxVx) * 1.4);
  }
  S.turnVel += ((S.turnTarget - S.turn) * TURN.spring - S.turnVel * TURN.damp) * dt;
  S.turn = clampTurn(S.turn + S.turnVel * dt);

  S.braceLean *= Math.pow(0.08, dt);
  if (Math.abs(S.braceLean) < 0.2) S.braceLean = 0;

  const glanceFade = Math.exp(-FEEL.glanceDecay * dt);
  S.glanceX *= glanceFade;
  S.glanceY *= glanceFade;
  S.glanceRoll *= glanceFade;
  if (Math.abs(S.glanceX) < 0.15) S.glanceX = 0;
  if (Math.abs(S.glanceY) < 0.15) S.glanceY = 0;
  if (Math.abs(S.glanceRoll) < 0.0005) S.glanceRoll = 0;

  S.wobble = Math.max(0, S.wobble - dt * 2.5);
  S.aim = Math.max(0, S.aim - AIM.decay * dt);

  // Пружина прыжка: глаз подлетает над лобовой клюшкой и садится обратно.
  S.camBoostVel += (-S.camBoost * 22 - S.camBoostVel * 5) * dt;
  S.camBoost += S.camBoostVel * dt;
  if (Math.abs(S.camBoost) < 0.05 && Math.abs(S.camBoostVel) < 0.5) {
    S.camBoost = 0;
    S.camBoostVel = 0;
  }

  S.hitFlash = Math.max(0, S.hitFlash - dt * 3.2);
  S.boostFx = Math.max(0, S.boostFx - dt * 1.6);

  S.camZVel += (-S.camZ * 26 - S.camZVel * 7.5) * dt;
  S.camZ += S.camZVel * dt;
  if (Math.abs(S.camZ) < 0.05 && Math.abs(S.camZVel) < 0.5) {
    S.camZ = 0;
    S.camZVel = 0;
  }

  // Капот качается на чистых приёмах и проседает на ошибках.
  S.hoodBobVel += (-S.hoodBob * 22 - S.hoodBobVel * 6.5) * dt;
  S.hoodBob += S.hoodBobVel * dt;
  S.hoodBob = Math.max(-HOOD.bobMax * 0.6, Math.min(HOOD.bobMax, S.hoodBob));
  if (Math.abs(S.hoodBob) < 0.05 && Math.abs(S.hoodBobVel) < 0.5) {
    S.hoodBob = 0;
    S.hoodBobVel = 0;
  }

  S.tremble = Math.max(0, S.tremble - dt * FEEL.trembleDecay);
  S.damageFlash = Math.max(0, S.damageFlash - dt * 2.2);

  if (S.gradeFlashTimer > 0) {
    S.gradeFlashTimer -= dt;
    if (S.gradeFlashTimer <= 0) hideGrade();
  }
}

/**
 * Смотрим изнутри шайбы: крен и тряска двигают всю картинку, а не диск.
 * Возвращает смещение в пикселях и крен в радианах.
 */
export function worldJitter() {
  const t = performance.now() / 1000;
  let jx = -S.braceLean * 0.5 + S.glanceX + Math.sin(t * 25) * S.wobble * 4;
  let jy = S.glanceY;
  let roll = S.tilt + S.glanceRoll;

  // Кадр закладывает вираж по боковой скорости — как на коньках.
  if (S.puck && S.puck.vx) {
    roll += -(S.puck.vx / STEER.maxVx) * STRAFE.bankRoll;
  }

  // Накал, скорость и сбитый прицел качают кадр только на ходу.
  if (S.phase === "play" && !S.cinema) {
    const sm = speedMix();
    const ht = S.heat;
    const a = S.aim;
    jx += Math.sin(t * 37) * ht * HEAT.shake;
    jy += Math.cos(t * 43) * ht * HEAT.shake * 0.6;
    jy += Math.sin(t * (6 + 6 * sm)) * DYN.bob * sm;
    jx += Math.sin(t * 11.3) * a * AIM.jitter + Math.sin(t * 23.1) * a * AIM.jitter * 0.4;
    jy += Math.cos(t * 9.1) * a * AIM.jitter * 0.28;
    roll += Math.sin(t * 7.4) * a * AIM.roll;
  }

  if (S.tremble > 0) {
    const e = S.tremble * S.tremble;
    jx += (Math.sin(t * 61) + Math.sin(t * 97) * 0.5) * 7 * e;
    jy += (Math.cos(t * 73) + Math.sin(t * 113) * 0.5) * 5 * e;
    roll += Math.sin(t * 44) * 0.03 * e;
  }

  return { jx, jy, roll };
}

/**
 * Капот — корпус шайбы под глазом. Ось у нижней кромки кадра.
 * Нажатие отворачивает диск в другую сторону; прыжок сильнее проседает;
 * сбитый прицел даёт плавное рыскание до ~9°.
 */
export function hoodJitter() {
  const t = performance.now() / 1000;
  let jx = 0;
  let jy = 0;
  let roll = 0;

  const press = FEEL.glanceX ? S.glanceX / FEEL.glanceX : 0;
  jx += -press * 22;
  roll += -press * HOOD.pressRoll;

  // Отставание камеры = насколько диск уехал из-под глаза. Это и есть скольжение.
  if (S.puck) {
    const lag = (S.puck.x || 0) - S.camX;
    jx += lag * STRAFE.hoodSlide;
    roll += (lag / STEER.maxX) * STRAFE.hoodRoll;
  }

  jy += S.glanceY * 2.6;
  jy += Math.max(-52, Math.min(52, S.camBoost)) * 0.45;

  const hunt = S.phase === "play" && !S.cinema ? Math.max(0, Math.min(1, S.aim)) : 0;
  if (hunt > 0.01) {
    jx += Math.sin(t * 11) * 7 * hunt;
    jy += Math.cos(t * 8.5) * 4 * hunt;
    roll += Math.sin(t * 9.2) * HOOD.huntRoll * hunt;
  }

  const hitShake = Math.max(S.tremble, S.wobble * 0.5);
  if (hitShake > 0.04) {
    jx += Math.sin(t * 28) * 3 * hitShake;
    jy += Math.cos(t * 23) * 2 * hitShake;
  }

  return { jx, jy, roll };
}
