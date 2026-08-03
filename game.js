(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const hintEl = document.getElementById("hint");
  const statusEl = document.getElementById("status");
  const resetBtn = document.getElementById("reset-btn");

  const ARENA = {
    w: 720,
    h: 960,
    wall: 18,
    goalHalf: 72,
    goalDepth: 8,
  };

  const PUCK = { r: 14, friction: 0.988, restitution: 0.75 };
  const SPINNER = {
    rodLen: 130,
    playerW: 34,
    playerH: 22,
    playerR: 12,
    maxPull: Math.PI / 2,
    kick: 14,
    damping: 0.92,
    minHitSpeed: 0.35,
  };

  const NEUTRAL = -Math.PI / 2;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  const pivot = { x: ARENA.w / 2, y: ARENA.h - 110 };
  const drop = { x: ARENA.w / 2, y: pivot.y - SPINNER.rodLen - 28 };

  const defenders = [
    {
      body: { x: 178, y: 210, w: 72, h: 72, r: 12 },
      stick: { x: 228, y: 278, w: 10, h: 78, r: 4 },
      stickAngle: Math.PI / 4,
    },
    {
      body: { x: 470, y: 210, w: 72, h: 72, r: 12 },
      stick: { x: 482, y: 278, w: 10, h: 78, r: 4 },
      stickAngle: (3 * Math.PI) / 4,
    },
  ];

  let puck = createPuck();
  let spinner = createSpinner();
  let phase = "aim";
  let pointerDown = false;
  let lastTs = 0;
  let stopTimer = 0;

  function createPuck() {
    return { x: drop.x, y: drop.y, vx: 0, vy: 0 };
  }

  function createSpinner() {
    return {
      angle: NEUTRAL,
      angularVel: 0,
      hitPuck: false,
    };
  }

  function resetRound() {
    puck = createPuck();
    spinner = createSpinner();
    phase = "aim";
    pointerDown = false;
    stopTimer = 0;
    statusEl.textContent = "";
    hintEl.hidden = false;
    resetBtn.hidden = true;
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
    const x = (sx - rect.left - offsetX) / scale;
    const y = (sy - rect.top - offsetY) / scale;
    return { x, y };
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
    const px = tip.x + Math.cos(spinner.angle) * (SPINNER.playerH * 0.45);
    const py = tip.y + Math.sin(spinner.angle) * (SPINNER.playerH * 0.45);
    return { x: px, y: py };
  }

  function distPointSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return {
      dist: Math.hypot(px - cx, py - cy),
      cx,
      cy,
      t,
    };
  }

  function resolveCircleRect(circle, rect) {
    const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
    const dx = circle.x - closestX;
    const dy = circle.y - closestY;
    const distSq = dx * dx + dy * dy;
    if (distSq >= PUCK.r * PUCK.r || distSq === 0) return false;

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = PUCK.r - dist;
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
    if (puck.y - PUCK.r < inner.top) {
      if (!inGoalX) {
        puck.y = inner.top + PUCK.r;
        puck.vy = Math.abs(puck.vy) * PUCK.restitution;
      }
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
      phase = "goal";
      statusEl.textContent = "Гол!";
      hintEl.hidden = true;
      resetBtn.hidden = false;
      puck.vx = 0;
      puck.vy = 0;
      return true;
    }
    return false;
  }

  function hitSpinner(dt) {
    const tip = spinnerTip();
    const player = playerCenter();
    const seg = distPointSeg(puck.x, puck.y, pivot.x, pivot.y, tip.x, tip.y);
    const playerDist = Math.hypot(puck.x - player.x, puck.y - player.y);
    const hitRod = seg.dist < PUCK.r + 5;
    const hitPlayer = playerDist < PUCK.r + SPINNER.playerR;

    if (!hitRod && !hitPlayer) return;

    let cx;
    let cy;
    let nx;
    let ny;

    if (hitPlayer) {
      nx = (puck.x - player.x) / playerDist;
      ny = (puck.y - player.y) / playerDist;
      cx = player.x + nx * SPINNER.playerR;
      cy = player.y + ny * SPINNER.playerR;
    } else {
      nx = (puck.x - seg.cx) / seg.dist;
      ny = (puck.y - seg.cy) / seg.dist;
      cx = seg.cx;
      cy = seg.cy;
    }

    const overlap = PUCK.r - (hitPlayer ? playerDist : seg.dist) + 5;
    if (overlap > 0) {
      puck.x += nx * overlap;
      puck.y += ny * overlap;
    }

    const tangentialX = -ny;
    const tangentialY = nx;
    const bladeSpeed =
      Math.abs(spinner.angularVel) * SPINNER.rodLen +
      (hitPlayer ? Math.abs(spinner.angularVel) * 40 : 0);

    const impulse = bladeSpeed * 1.15 + 2.2;
    puck.vx += nx * impulse * 0.35 + tangentialX * impulse * 0.65;
    puck.vy += ny * impulse * 0.35 + tangentialY * impulse * 0.65;

    spinner.hitPuck = true;
    phase = "play";
    hintEl.hidden = true;
  }

  function updatePuck(dt) {
    puck.vx *= PUCK.friction;
    puck.vy *= PUCK.friction;
    puck.x += puck.vx * dt * 60;
    puck.y += puck.vy * dt * 60;

    for (const d of defenders) {
      resolveCircleRect(puck, d.body);
      resolveCircleRect(puck, d.stick);
    }
    resolveWalls();

    const speed = Math.hypot(puck.vx, puck.vy);
    if (phase === "play" && speed < 0.08) {
      stopTimer += dt;
      if (stopTimer > 0.6) {
        phase = "miss";
        statusEl.textContent = "Мимо";
        resetBtn.hidden = false;
      }
    } else {
      stopTimer = 0;
    }

    checkGoal();
  }

  function updateSpinner(dt) {
    if (phase === "aim" && pointerDown) return;

    if (phase === "strike" || (phase === "aim" && !pointerDown && spinner.angularVel !== 0)) {
      spinner.angle += spinner.angularVel * dt * 60;
      spinner.angularVel *= SPINNER.damping;

      if (!spinner.hitPuck) {
        hitSpinner(dt);
      }

      if (Math.abs(spinner.angularVel) < SPINNER.minHitSpeed) {
        spinner.angularVel = 0;
        spinner.angle += (NEUTRAL - spinner.angle) * 0.18;
        if (Math.abs(spinner.angle - NEUTRAL) < 0.01) {
          spinner.angle = NEUTRAL;
        }
        if (phase === "strike" && !spinner.hitPuck) {
          phase = "miss";
          statusEl.textContent = "Промах";
          resetBtn.hidden = false;
          hintEl.hidden = true;
        }
      }
    }
  }

  function update(dt) {
    if (phase === "goal" || phase === "miss") return;

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
      const body = d.body;

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

      const stickPivotX = body.x + body.w / 2;
      const stickPivotY = body.y + body.h - 4;
      const stickLen = 82;

      ctx.strokeStyle = "#333";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(stickPivotX, stickPivotY);
      ctx.lineTo(
        stickPivotX + Math.cos(d.stickAngle) * stickLen,
        stickPivotY + Math.sin(d.stickAngle) * stickLen,
      );
      ctx.stroke();

      ctx.fillStyle = "rgba(26, 26, 46, 0.35)";
      roundRect(ctx, d.stick.x, d.stick.y, d.stick.w, d.stick.h, d.stick.r);
      ctx.fill();
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
    drawSpinner();

    if (phase === "aim" && !pointerDown) {
      ctx.fillStyle = "rgba(13, 61, 92, 0.55)";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Зажми и оттяни", pivot.x, pivot.y + 52);
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
    if (!canAim() || spinner.hitPuck) return;
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
    const p = screenToArena(e.clientX, e.clientY);
    spinner.angle = clampAngle(Math.atan2(p.y - pivot.y, p.x - pivot.x));
    spinner.angularVel = 0;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointerDown) return;
    const p = screenToArena(e.clientX, e.clientY);
    spinner.angle = clampAngle(Math.atan2(p.y - pivot.y, p.x - pivot.x));
  });

  canvas.addEventListener("pointerup", () => {
    if (!pointerDown) return;
    pointerDown = false;
    if (spinner.hitPuck) return;

    const pull = normalizeAngle(spinner.angle - NEUTRAL);
    spinner.angularVel = -pull * SPINNER.kick;
    phase = "strike";
  });

  canvas.addEventListener("pointercancel", () => {
    pointerDown = false;
  });

  resetBtn.addEventListener("click", resetRound);
  window.addEventListener("resize", resize);

  resize();
  requestAnimationFrame((ts) => {
    lastTs = ts;
    loop(ts);
  });
})();
