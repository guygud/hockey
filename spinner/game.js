(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const hintEl = document.getElementById("hint");
  const statusEl = document.getElementById("status");
  const resetBtn = document.getElementById("reset-btn");
  const scoreEl = document.getElementById("score");
  const missesEl = document.getElementById("misses");
  const speedLevelEl = document.getElementById("speed-level");

  const MAX_MISSES = 5;
  const SHOTS_PER_SPEEDUP = 4;
  const SPEEDUP_FACTOR = 0.18;

  const ARENA = {
    w: 720,
    h: 960,
    wall: 18,
    goalHalf: 96,
  };

  const PUCK = { r: 14, friction: 0.988, restitution: 0.72, maxSpeed: 24 };
  const SPINNER = {
    rodLen: 130,
    rodHitR: 6,
    playerW: 34,
    playerH: 22,
    playerR: 14,
    maxPull: Math.PI / 2,
    strikeDuration: 0.14,
  };

  const NEUTRAL = 0;

  // Aim arrow sweeps a 90° sector toward the goal while the stick is pulled.
  const AIM = {
    center: -Math.PI / 2,
    halfSpan: Math.PI / 4,
    speed: 3.2,
    length: 92,
    sectorRadius: 118,
  };

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  // Shift player left so the puck on the right-facing blade starts at field center.
  const pivot = {
    x: ARENA.w / 2 - (SPINNER.rodLen + SPINNER.playerH * 0.45),
    y: ARENA.h - 110,
  };
  const drop = {
    x: ARENA.w / 2,
    y: pivot.y - PUCK.r - 10,
  };

  const defenders = [
    {
      y: 170,
      w: 56,
      h: 56,
      x: 120,
      minX: 90,
      maxX: 300,
      baseSpeed: 65,
      dir: 1,
      stickAngle: Math.PI / 2 + 0.35,
    },
    {
      y: 310,
      w: 56,
      h: 56,
      x: 520,
      minX: 380,
      maxX: 590,
      baseSpeed: 50,
      dir: -1,
      stickAngle: Math.PI / 2 - 0.35,
    },
  ];

  let puck = createPuck();
  let spinner = createSpinner();
  let aim = createAim();
  let phase = "aim";
  let pointerDown = false;
  let lastTs = 0;
  let stopTimer = 0;
  let score = 0;
  let misses = 0;
  let shots = 0;
  let speedLevel = 0;
  let nextRoundAt = 0;
  let outcomeHandled = false;

  function createPuck() {
    return { x: drop.x, y: drop.y, vx: 0, vy: 0 };
  }

  function createSpinner() {
    return {
      angle: NEUTRAL,
      pullStrength: 0,
      hitPuck: false,
      striking: false,
      strikeFrom: NEUTRAL,
      strikeTo: NEUTRAL,
      strikeT: 0,
      strikeDuration: SPINNER.strikeDuration,
      shotAngle: AIM.center,
    };
  }

  function createAim() {
    return { t: 0, angle: AIM.center };
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    missesEl.textContent = String(misses);
    speedLevelEl.textContent = String(speedLevel + 1);
  }

  function defenderSpeed(d) {
    return d.baseSpeed * (1 + speedLevel * SPEEDUP_FACTOR);
  }

  function resetRound() {
    puck = createPuck();
    spinner = createSpinner();
    aim = createAim();
    phase = "aim";
    pointerDown = false;
    stopTimer = 0;
    nextRoundAt = 0;
    outcomeHandled = false;
    statusEl.textContent = "";
    hintEl.hidden = false;
    resetBtn.hidden = true;
    updateHud();
  }

  function resetGame() {
    score = 0;
    misses = 0;
    shots = 0;
    speedLevel = 0;
    for (const d of defenders) {
      d.x = d.minX + (d.maxX - d.minX - d.w) * 0.35;
    }
    resetRound();
  }

  function resolveShot(result) {
    if (outcomeHandled || phase === "gameover") return;
    outcomeHandled = true;

    shots += 1;
    if (result === "goal") {
      score += 1;
      statusEl.textContent = "Гол!";
    } else {
      misses += 1;
      statusEl.textContent = result === "whiff" ? "Промах" : "Мимо";
    }

    if (shots > 0 && shots % SHOTS_PER_SPEEDUP === 0) {
      speedLevel += 1;
      statusEl.textContent += " · быстрее!";
    }

    updateHud();
    hintEl.hidden = true;
    puck.vx = 0;
    puck.vy = 0;

    if (misses >= MAX_MISSES) {
      phase = "gameover";
      statusEl.textContent = `Игра окончена! Голов: ${score}`;
      resetBtn.hidden = false;
      resetBtn.textContent = "Заново";
      return;
    }

    phase = result === "goal" ? "goal" : "miss";
    nextRoundAt = performance.now() + 850;
  }

  function updateAim(dt) {
    if (!pointerDown || phase !== "aim") return;
    aim.t += dt * AIM.speed;
    aim.angle = AIM.center + AIM.halfSpan * Math.sin(aim.t);
  }

  function defenderBody(d) {
    return { x: d.x, y: d.y, w: d.w, h: d.h, r: 12 };
  }

  function defenderStickEnds(d) {
    const body = defenderBody(d);
    const px = body.x + body.w / 2;
    const py = body.y + body.h - 4;
    const len = 64;
    return {
      x1: px,
      y1: py,
      x2: px + Math.cos(d.stickAngle) * len,
      y2: py + Math.sin(d.stickAngle) * len,
    };
  }

  function updateDefenders(dt) {
    for (const d of defenders) {
      d.x += d.dir * defenderSpeed(d) * dt;
      if (d.x <= d.minX) {
        d.x = d.minX;
        d.dir = 1;
      } else if (d.x + d.w >= d.maxX) {
        d.x = d.maxX - d.w;
        d.dir = -1;
      }
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = 16;
    scale = Math.min(
      (rect.width - pad * 2) / ARENA.w,
      (rect.height - pad * 2) / ARENA.h,
    );
    offsetX = (rect.width - ARENA.w * scale) / 2;
    offsetY = (rect.height - ARENA.h * scale) / 2;
  }

  function screenToArena(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (sx - rect.left - offsetX) / scale,
      y: (sy - rect.top - offsetY) / scale,
    };
  }

  function clampAngle(a) {
    const delta = normalizeAngle(a - NEUTRAL);
    const clamped = Math.max(-SPINNER.maxPull, Math.min(SPINNER.maxPull, delta));
    return NEUTRAL + clamped;
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function spinnerTip() {
    return {
      x: pivot.x + Math.cos(spinner.angle) * SPINNER.rodLen,
      y: pivot.y + Math.sin(spinner.angle) * SPINNER.rodLen,
    };
  }

  function playerCenter() {
    const tip = spinnerTip();
    return {
      x: tip.x + Math.cos(spinner.angle) * (SPINNER.playerH * 0.45),
      y: tip.y + Math.sin(spinner.angle) * (SPINNER.playerH * 0.45),
    };
  }

  function distPointSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const dist = Math.hypot(px - x1, py - y1);
      return { dist, cx: x1, cy: y1, t: 0 };
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), cx, cy, t };
  }

  function clampPuckSpeed() {
    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed > PUCK.maxSpeed) {
      const scale = PUCK.maxSpeed / speed;
      puck.vx *= scale;
      puck.vy *= scale;
    }
  }

  function resolveCircleRect(circle, rect) {
    const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
    let dx = circle.x - closestX;
    let dy = circle.y - closestY;
    let distSq = dx * dx + dy * dy;

    if (distSq >= PUCK.r * PUCK.r) return false;

    let nx;
    let ny;
    let overlap;

    if (distSq === 0) {
      const toLeft = circle.x - rect.x;
      const toRight = rect.x + rect.w - circle.x;
      const toTop = circle.y - rect.y;
      const toBottom = rect.y + rect.h - circle.y;
      const min = Math.min(toLeft, toRight, toTop, toBottom);
      if (min === toLeft) {
        nx = -1;
        ny = 0;
        overlap = PUCK.r + toLeft;
      } else if (min === toRight) {
        nx = 1;
        ny = 0;
        overlap = PUCK.r + toRight;
      } else if (min === toTop) {
        nx = 0;
        ny = -1;
        overlap = PUCK.r + toTop;
      } else {
        nx = 0;
        ny = 1;
        overlap = PUCK.r + toBottom;
      }
    } else {
      const dist = Math.sqrt(distSq);
      nx = dx / dist;
      ny = dy / dist;
      overlap = PUCK.r - dist;
    }

    circle.x += nx * overlap;
    circle.y += ny * overlap;

    const vn = circle.vx * nx + circle.vy * ny;
    if (vn < 0) {
      circle.vx -= (1 + PUCK.restitution) * vn * nx;
      circle.vy -= (1 + PUCK.restitution) * vn * ny;
    }
    return true;
  }

  function resolveCircleSegment(circle, x1, y1, x2, y2, segR) {
    const seg = distPointSeg(circle.x, circle.y, x1, y1, x2, y2);
    const hitDist = PUCK.r + segR;
    if (seg.dist >= hitDist) return false;

    const safeDist = seg.dist || 0.001;
    const nx = (circle.x - seg.cx) / safeDist;
    const ny = (circle.y - seg.cy) / safeDist;
    const overlap = hitDist - seg.dist;
    circle.x += nx * overlap;
    circle.y += ny * overlap;

    const vn = circle.vx * nx + circle.vy * ny;
    if (vn < 0) {
      circle.vx -= (1 + PUCK.restitution) * vn * nx;
      circle.vy -= (1 + PUCK.restitution) * vn * ny;
    }
    return true;
  }

  function resolveWalls() {
    const inner = {
      left: ARENA.wall,
      right: ARENA.w - ARENA.wall,
      top: ARENA.wall,
      bottom: ARENA.h - ARENA.wall,
    };
    const goalLeft = ARENA.w / 2 - ARENA.goalHalf;
    const goalRight = ARENA.w / 2 + ARENA.goalHalf;

    if (puck.x - PUCK.r < inner.left) {
      puck.x = inner.left + PUCK.r;
      puck.vx = Math.abs(puck.vx) * PUCK.restitution;
    }
    if (puck.x + PUCK.r > inner.right) {
      puck.x = inner.right - PUCK.r;
      puck.vx = -Math.abs(puck.vx) * PUCK.restitution;
    }
    if (puck.y + PUCK.r > inner.bottom) {
      puck.y = inner.bottom - PUCK.r;
      puck.vy = -Math.abs(puck.vy) * PUCK.restitution;
    }

    const inGoalX = puck.x > goalLeft && puck.x < goalRight;
    if (puck.y - PUCK.r < inner.top && !inGoalX) {
      puck.y = inner.top + PUCK.r;
      puck.vy = Math.abs(puck.vy) * PUCK.restitution;
    }
  }

  function checkGoal() {
    const goalLeft = ARENA.w / 2 - ARENA.goalHalf;
    const goalRight = ARENA.w / 2 + ARENA.goalHalf;
    if (
      puck.y - PUCK.r < ARENA.wall - 4 &&
      puck.x > goalLeft &&
      puck.x < goalRight
    ) {
      resolveShot("goal");
      return true;
    }
    return false;
  }

  function resolvePuckCollisions() {
    for (let i = 0; i < 3; i++) {
      for (const d of defenders) {
        resolveCircleRect(puck, defenderBody(d));
        const stick = defenderStickEnds(d);
        resolveCircleSegment(puck, stick.x1, stick.y1, stick.x2, stick.y2, 5);
      }
      resolveWalls();
    }
    clampPuckSpeed();
  }

  function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
  }

  function stopStick() {
    spinner.striking = false;
    spinner.strikeT = 1;
  }

  function hitSpinner() {
    if (spinner.hitPuck) return false;

    const tip = spinnerTip();
    const player = playerCenter();
    // Hit only with the blade/player end — not the whole rod (avoids weird early contacts).
    const blade = distPointSeg(
      puck.x,
      puck.y,
      tip.x - Math.cos(spinner.angle) * 18,
      tip.y - Math.sin(spinner.angle) * 18,
      tip.x + Math.cos(spinner.angle) * 10,
      tip.y + Math.sin(spinner.angle) * 10,
    );
    const playerDist = Math.hypot(puck.x - player.x, puck.y - player.y);
    const hitBlade = blade.dist < PUCK.r + SPINNER.rodHitR;
    const hitPlayer = playerDist < PUCK.r + SPINNER.playerR;

    if (!hitBlade && !hitPlayer) return false;

    let nx;
    let ny;
    if (hitPlayer) {
      nx = (puck.x - player.x) / Math.max(playerDist, 0.001);
      ny = (puck.y - player.y) / Math.max(playerDist, 0.001);
    } else {
      const safeDist = Math.max(blade.dist, 0.001);
      nx = (puck.x - blade.cx) / safeDist;
      ny = (puck.y - blade.cy) / safeDist;
    }

    const overlap =
      PUCK.r -
      (hitPlayer ? playerDist - SPINNER.playerR : blade.dist - SPINNER.rodHitR);
    if (overlap > 0) {
      puck.x += nx * overlap;
      puck.y += ny * overlap;
    }

    // Puck flies where the aim arrow pointed on release.
    const dx = Math.cos(spinner.shotAngle);
    const dy = Math.sin(spinner.shotAngle);
    const impulse = 12 + spinner.pullStrength * 22;

    puck.vx = dx * impulse;
    puck.vy = dy * impulse;
    clampPuckSpeed();

    spinner.hitPuck = true;
    stopStick();
    phase = "play";
    hintEl.hidden = true;
    return true;
  }

  function updatePuck(dt) {
    puck.vx *= PUCK.friction;
    puck.vy *= PUCK.friction;
    puck.x += puck.vx * dt * 60;
    puck.y += puck.vy * dt * 60;
    resolvePuckCollisions();
    clampPuckSpeed();

    if (checkGoal()) return;

    const speed = Math.hypot(puck.vx, puck.vy);
    if (phase === "play" && speed < 0.08) {
      stopTimer += dt;
      if (stopTimer > 0.6) {
        resolveShot("miss");
      }
    } else {
      stopTimer = 0;
    }
  }

  function updateSpinner(dt) {
    if (!spinner.striking) return;

    const prev = spinner.angle;
    spinner.strikeT = Math.min(1, spinner.strikeT + dt / spinner.strikeDuration);
    const t = easeOutCubic(spinner.strikeT);
    const delta = normalizeAngle(spinner.strikeTo - spinner.strikeFrom);
    const next = spinner.strikeFrom + delta * t;

    // Sweep between previous and current angle so the snap can't tunnel past the puck.
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      spinner.angle = prev + (next - prev) * (i / steps);
      if (hitSpinner()) return;
    }
    spinner.angle = next;

    if (spinner.strikeT >= 1) {
      stopStick();
      spinner.angle = spinner.strikeTo;
      if (!spinner.hitPuck) {
        resolveShot("whiff");
      }
    }
  }

  function update(dt) {
    updateDefenders(dt);
    updateAim(dt);

    if (nextRoundAt && performance.now() >= nextRoundAt) {
      nextRoundAt = 0;
      resetRound();
      return;
    }

    if (phase === "goal" || phase === "miss" || phase === "gameover") return;

    updateSpinner(dt);
    if (phase === "play" || phase === "strike" || spinner.hitPuck) {
      updatePuck(dt);
    }
  }

  function drawArena() {
    ctx.fillStyle = "#c8e6f5";
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);

    ctx.fillStyle = "#0d3d5c";
    ctx.fillRect(0, 0, ARENA.w, ARENA.wall);
    ctx.fillRect(0, 0, ARENA.wall, ARENA.h);
    ctx.fillRect(ARENA.w - ARENA.wall, 0, ARENA.wall, ARENA.h);
    ctx.fillRect(0, ARENA.h - ARENA.wall, ARENA.w, ARENA.wall);

    const goalLeft = ARENA.w / 2 - ARENA.goalHalf;
    const goalRight = ARENA.w / 2 + ARENA.goalHalf;
    ctx.fillStyle = "#c8e6f5";
    ctx.fillRect(goalLeft, 0, goalRight - goalLeft, ARENA.wall);

    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(goalLeft, ARENA.wall);
    ctx.lineTo(goalLeft, ARENA.wall + 28);
    ctx.moveTo(goalRight, ARENA.wall);
    ctx.lineTo(goalRight, ARENA.wall + 28);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.arc(ARENA.w / 2, ARENA.h / 2, 90, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(13, 61, 92, 0.15)";
    ctx.beginPath();
    ctx.arc(drop.x, drop.y, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDefenders() {
    for (const d of defenders) {
      const body = defenderBody(d);

      ctx.fillStyle = "#1a1a2e";
      roundRect(ctx, body.x, body.y, body.w, body.h, body.r);
      ctx.fill();
      ctx.strokeStyle = "#e8f4ff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#e8f4ff";
      ctx.beginPath();
      ctx.arc(body.x + body.w / 2, body.y + body.h / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      const stick = defenderStickEnds(d);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(stick.x1, stick.y1);
      ctx.lineTo(stick.x2, stick.y2);
      ctx.stroke();
    }
  }

  function drawSpinner() {
    const tip = spinnerTip();
    const player = playerCenter();

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    ctx.fillStyle = "#555";
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(spinner.angle);
    ctx.fillStyle = "#c41e3a";
    roundRect(
      ctx,
      -SPINNER.playerW / 2,
      -SPINNER.playerH / 2,
      SPINNER.playerW,
      SPINNER.playerH,
      6,
    );
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawPuck() {
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, PUCK.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawAimArrow() {
    if (!pointerDown || phase !== "aim") return;

    const len = AIM.length;
    const sectorR = AIM.sectorRadius;
    const x1 = puck.x;
    const y1 = puck.y;
    const x2 = x1 + Math.cos(aim.angle) * len;
    const y2 = y1 + Math.sin(aim.angle) * len;
    const head = 20;
    const ang = aim.angle;
    const sectorStart = AIM.center - AIM.halfSpan;
    const sectorEnd = AIM.center + AIM.halfSpan;

    ctx.save();
    ctx.strokeStyle = "#ff6a00";
    ctx.fillStyle = "#ff6a00";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Soft 90° sector guide.
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.arc(x1, y1, sectorR, sectorStart, sectorEnd);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Sector edge lines for readability.
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + Math.cos(sectorStart) * sectorR, y1 + Math.sin(sectorStart) * sectorR);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + Math.cos(sectorEnd) * sectorR, y1 + Math.sin(sectorEnd) * sectorR);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - Math.cos(ang - 0.45) * head,
      y2 - Math.sin(ang - 0.45) * head,
    );
    ctx.lineTo(
      x2 - Math.cos(ang + 0.45) * head,
      y2 - Math.sin(ang + 0.45) * head,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function render() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    drawArena();
    drawDefenders();
    drawPuck();
    drawAimArrow();
    drawSpinner();

    if (phase === "aim" && !pointerDown) {
      ctx.fillStyle = "rgba(13, 61, 92, 0.55)";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Зажми, целься стрелкой, отпусти", pivot.x, pivot.y + 52);
    }

    ctx.restore();
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function canAim() {
    return phase === "aim" && !spinner.hitPuck;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!canAim()) return;
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
    aim.t = 0;
    aim.angle = AIM.center;
    const p = screenToArena(e.clientX, e.clientY);
    spinner.angle = clampAngle(Math.atan2(p.y - pivot.y, p.x - pivot.x));
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointerDown) return;
    const p = screenToArena(e.clientX, e.clientY);
    spinner.angle = clampAngle(Math.atan2(p.y - pivot.y, p.x - pivot.x));
  });

  canvas.addEventListener("pointerup", () => {
    if (!pointerDown) return;
    pointerDown = false;
    if (spinner.hitPuck || spinner.striking) return;

    const pull = normalizeAngle(spinner.angle - NEUTRAL);
    spinner.pullStrength = Math.min(Math.abs(pull) / SPINNER.maxPull, 1);
    if (spinner.pullStrength < 0.08) return;

    spinner.shotAngle = aim.angle;

    // Short snap into the puck; flight direction comes from the arrow.
    const puckAngle = Math.atan2(puck.y - pivot.y, puck.x - pivot.x);
    const towardPuck = normalizeAngle(puckAngle - spinner.angle);
    const snapDir = Math.sign(towardPuck) || -Math.sign(pull) || -1;

    spinner.strikeFrom = spinner.angle;
    spinner.strikeTo = puckAngle + snapDir * 0.12;
    spinner.strikeT = 0;
    spinner.strikeDuration = SPINNER.strikeDuration * (1.15 - spinner.pullStrength * 0.35);
    spinner.striking = true;
    phase = "strike";
  });

  canvas.addEventListener("pointercancel", () => {
    pointerDown = false;
  });

  resetBtn.addEventListener("click", resetGame);
  window.addEventListener("resize", resize);

  resetGame();
  resize();
  requestAnimationFrame((ts) => {
    lastTs = ts;
    loop(ts);
  });
})();
