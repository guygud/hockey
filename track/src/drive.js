// ============================================================================
// ПРОЕЗД
// ----------------------------------------------------------------------------
// Ядро: шайба рулится удержанием, прыгает и сталкивается с клюшками по
// положению. Оценка нажатия не существует — есть x, y и свип по z.
// ============================================================================

import {
  AIM,
  CLIP,
  GRAZE,
  JUMP,
  MOMENTUM,
  PUCK,
  STEER,
  TRACK,
  drainFor,
  speedForMom,
  streakMult,
} from "./balance.js";
import { CORRIDOR, HOOD } from "./tuning.js";
import { S, mods } from "./state.js";
import { sfx } from "./audio.js";
import { showGrade, updateHud } from "./hud.js";
import { spawnSparks, spawnStrafeSpray } from "./fx.js";
import { startStallCam } from "./flow.js";

export function speedFor(mom) {
  return speedForMom(mom, S.level, 0);
}

export function applyMom(delta) {
  S.mom = Math.max(0, Math.min(1, S.mom + delta));
  S.puck.vz = speedFor(S.mom);
}

function drainRate() {
  return drainFor(S.level, mods(), S.runDist);
}

function bumpAim(delta) {
  S.aim = Math.max(0, Math.min(1, S.aim + delta));
}

function markResolved(obs, ok) {
  obs.resolved = true;
  obs.ok = ok;
  obs.slipZ = S.puck.z;
}

function onJump() {
  S.hoodBobVel += HOOD.jumpKick;
  S.camBoostVel += 420;
  S.glanceY = Math.max(S.glanceY, 18);
  sfx.jump();
}

function resolveHit(obs, clip) {
  if (obs.resolved) return;
  markResolved(obs, false);
  const cost = clip ? MOMENTUM.clipCost : MOMENTUM.hitCost;
  applyMom(-cost);
  if (clip) {
    showGrade("ЗАДЕЛИ", "grade-late");
    S.runStats.clips += 1;
    S.tremble = 0.45;
    S.damageFlash = 0.4;
    S.camZVel -= 25;
    S.hoodBobVel -= 30;
    S.wobble = 0.4;
    bumpAim(AIM.clip);
    spawnSparks(4);
    sfx.whiff();
  } else {
    showGrade("УДАР", "grade-miss");
    S.runStats.hits += 1;
    S.heatStreak = 0;
    S.heatTarget = 0;
    S.tremble = 1;
    S.damageFlash = 1;
    S.camZVel -= 70;
    S.hoodBobVel -= 80;
    S.tilt = (Math.random() < 0.5 ? -1 : 1) * 0.1;
    S.wobble = 1;
    bumpAim(AIM.hit);
    spawnSparks(8);
    sfx.fail();
  }
  updateHud();
}

function resolveClear(obs, graze) {
  if (obs.resolved) return;
  markResolved(obs, true);
  const gain = graze ? MOMENTUM.gain.graze : MOMENTUM.gain.clear;
  applyMom(gain * streakMult(S.streak));
  const jumped = obs.kind === "low";
  if (graze) {
    showGrade("ВПРИТИРКУ", "grade-perfect");
    S.runStats.grazes += 1;
    S.hitFlashPerfect = true;
    S.boostFx = 0.9;
    S.hitFlash = 0.7;
    S.camZVel += 220;
    S.hoodBobVel += 110;
    spawnSparks(12);
    sfx.dodge(true);
  } else if (jumped) {
    showGrade("ПРЫЖОК", "grade-good");
    S.runStats.clears += 1;
    S.hitFlashPerfect = true;
    S.boostFx = 0.55;
    S.hitFlash = 0.45;
    S.camZVel += 160;
    S.hoodBobVel += 80;
    spawnSparks(6);
    sfx.dodge(false);
  } else {
    S.runStats.clears += 1;
    S.boostFx = 0.25;
    S.hitFlash = 0.2;
    S.camZVel += 80;
    sfx.dodge(false);
  }
  S.heatStreak += 1;
  S.heatTarget = Math.min(1, S.heatStreak / 6);
  bumpAim(graze ? AIM.graze : AIM.clear);
  updateHud();
}

function resolveBoost(obs) {
  if (obs.resolved) return;
  markResolved(obs, true);
  applyMom(MOMENTUM.gain.boost * streakMult(S.streak));
  showGrade("ПОДТОЛКНУЛО", "grade-good");
  S.runStats.boosts += 1;
  bumpAim(AIM.boost);
  S.tremble *= 0.25;
  S.wobble *= 0.3;
  S.camZVel += 260;
  S.camBoostVel += 280;
  S.hoodBobVel += 130;
  S.hitFlash = 0.85;
  S.hitFlashPerfect = true;
  S.boostFx = 0.75;
  spawnSparks(20);
  sfx.hit(true);
  updateHud();
}

function overlapsX(hx, obs) {
  return Math.abs(hx - obs.x) < obs.w / 2 + PUCK.radius;
}

function lateralClear(hx, obs) {
  return Math.abs(hx - obs.x) - (obs.w / 2 + PUCK.radius);
}

function penetration(hx, obs) {
  return obs.w / 2 + PUCK.radius - Math.abs(hx - obs.x);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function jumpLaneHalf() {
  return CORRIDOR.halfW * JUMP.laneFrac;
}

function inJumpLane(hx) {
  return Math.abs(hx) <= jumpLaneHalf();
}

function contactOf(obs, hx, hy) {
  if (obs.kind === "low") {
    if (hy >= JUMP.clear && inJumpLane(hx)) {
      const heightClear = hy - JUMP.clear;
      const edge = jumpLaneHalf() - Math.abs(hx);
      return { hit: false, clip: false, graze: heightClear < GRAZE || edge < GRAZE };
    }
    if (overlapsX(hx, obs)) {
      const heightMiss = Math.max(0, JUMP.clear - hy);
      const pen = penetration(hx, obs);
      const lanePen = Math.abs(hx) - jumpLaneHalf();
      return {
        hit: true,
        clip: heightMiss < CLIP.height || pen < CLIP.pen || (lanePen > 0 && lanePen < CLIP.pen),
        graze: false,
      };
    }
    return { hit: false, clip: false, graze: lateralClear(hx, obs) < GRAZE };
  }
  if (overlapsX(hx, obs)) {
    return { hit: true, clip: penetration(hx, obs) < CLIP.pen, graze: false };
  }
  return { hit: false, clip: false, graze: lateralClear(hx, obs) < GRAZE };
}

function sweep(prevZ, prevX, prevY, z, x, y) {
  if (z <= prevZ) return;
  const nose0 = prevZ + TRACK.hitLine;
  const nose1 = z + TRACK.hitLine;
  const hits = [];
  for (const obs of S.obstacles) {
    if (obs.resolved) continue;
    if (nose0 < obs.z && obs.z <= nose1) hits.push(obs);
  }
  hits.sort((a, b) => a.z - b.z);

  let i = 0;
  while (i < hits.length) {
    const z0 = hits[i].z;
    const group = [];
    while (i < hits.length && Math.abs(hits[i].z - z0) < 0.5) group.push(hits[i++]);
    const t = (z0 - nose0) / Math.max(nose1 - nose0, 0.0001);
    const hx = lerp(prevX, x, t);
    const hy = lerp(prevY, y, t);

    for (const obs of group) {
      if (obs.kind === "boost") {
        if (Math.abs(hx - obs.x) <= obs.w / 2) resolveBoost(obs);
        else markResolved(obs, false);
      }
    }

    const reds = group.filter((o) => o.kind === "block" || o.kind === "low");
    if (!reds.length) continue;

    let hit = false;
    let clip = true;
    let graze = false;
    for (const obs of reds) {
      const c = contactOf(obs, hx, hy);
      if (c.hit) {
        hit = true;
        if (!c.clip) clip = false;
      } else if (c.graze) graze = true;
    }

    if (hit) {
      let paid = false;
      for (const obs of reds) {
        if (!paid) {
          resolveHit(obs, clip);
          paid = true;
        } else markResolved(obs, false);
      }
    } else {
      let paid = false;
      for (const obs of reds) {
        if (!paid) {
          resolveClear(obs, graze);
          paid = true;
        } else markResolved(obs, true);
      }
    }
  }
}

function steer(dt) {
  const dir = S.held.left && !S.held.right ? -1 : S.held.right && !S.held.left ? 1 : 0;
  const air = (S.puck.y || 0) > 0.4;
  const control = air ? STEER.airControl : 1;
  let vx = S.puck.vx || 0;

  if (dir) {
    const accel = (dir * vx < 0 ? STEER.brake : STEER.accel) * control;
    vx += dir * accel * dt;
    if (!air && Math.random() < dt * 10) spawnStrafeSpray(dir);
  } else {
    vx *= Math.exp(-STEER.drag * dt);
    if (Math.abs(vx) < 4) vx = 0;
  }

  vx = Math.max(-STEER.maxVx, Math.min(STEER.maxVx, vx));
  let x = (S.puck.x || 0) + vx * dt;
  const maxX = Math.min(STEER.maxX, CORRIDOR.halfW - PUCK.radius);
  if (x > maxX) {
    x = maxX;
    vx = 0;
  } else if (x < -maxX) {
    x = -maxX;
    vx = 0;
  }
  S.puck.x = x;
  S.puck.vx = vx;
}

function jumpPhysics(dt) {
  S.jumpBuf = Math.max(0, S.jumpBuf - dt);
  let y = S.puck.y || 0;
  let vy = S.puck.vy || 0;
  const grounded = y <= 0 && vy <= 0;

  if (grounded) {
    y = 0;
    vy = 0;
    if (S.jumpBuf > 0) {
      vy = JUMP.vy;
      S.jumpBuf = 0;
      onJump();
    }
  } else {
    vy -= JUMP.gravity * dt;
    y += vy * dt;
    if (y <= 0) {
      y = 0;
      vy = 0;
    }
  }

  S.puck.y = y;
  S.puck.vy = vy;
}

export function updatePuck(dt) {
  if (S.poseMode) {
    const prevZ = S.puck.z;
    const prevX = S.puck.x || 0;
    const prevY = S.puck.y || 0;
    jumpPhysics(dt);
    steer(dt);
    S.puck.vz = speedFor(Math.max(0.45, S.mom));
    S.puck.z += S.puck.vz * dt;
    sweep(prevZ, prevX, prevY, S.puck.z, S.puck.x || 0, S.puck.y || 0);
    return;
  }

  applyMom(-drainRate() * dt);

  if (S.mom <= 0) {
    S.mom = 0;
    startStallCam();
    return;
  }

  const prevZ = S.puck.z;
  const prevX = S.puck.x || 0;
  const prevY = S.puck.y || 0;

  jumpPhysics(dt);
  steer(dt);

  S.puck.z += S.puck.vz * dt;
  sweep(prevZ, prevX, prevY, S.puck.z, S.puck.x || 0, S.puck.y || 0);

  if (Math.random() < dt * 14) {
    S.particles.push({
      x: (S.puck.x || 0) + (Math.random() - 0.5) * 8,
      z: S.puck.z - 4,
      life: 0.25 + Math.random() * 0.2,
      max: 0.4,
    });
  }
}

export function updateObstacles() {
  const list = S.obstacles;
  let write = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.z > S.puck.z - 80 || !o.resolved) list[write++] = o;
  }
  list.length = write;
}
