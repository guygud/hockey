(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const streakEl = document.getElementById("streak");
  const livesEl = document.getElementById("lives");
  const gripFill = document.getElementById("grip-fill");
  const gripValue = document.getElementById("grip-value");
  const progressFill = document.getElementById("progress-fill");
  const braceFlash = document.getElementById("brace-flash");
  const statusEl = document.getElementById("status");
  const restartBtn = document.getElementById("restart-btn");
  const introEl = document.getElementById("intro");
  const startBtn = document.getElementById("start-btn");

  const CORRIDOR = { halfW: 200, wallH: 150, ribStep: 60, ceilH: 180 };
  // far covers the whole short track so the net is visible from the first frame.
  const CAM = { height: 34, focal: 460, near: 12, far: 2800, horizonFrac: 0.42 };
  const RUN_DIST = 2500;
  const MAX_LIVES = 3;
  const SPEED_MIN = 130;
  const SPEED_MAX = 530;
  const MOM_START = 0.55;
  const MOM_DRAIN = 0.055;
  const HIT_LINE = 110;
  const WINDOW_OPEN = 0.9;
  const PERFECT = 0.08;
  const GOOD = 0.2;
  const INTERVAL_START = 1.15;
  const INTERVAL_END = 0.7;
  const GRADE_FLASH_TIME = 0.55;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let lastTs = 0;

  // Edge-triggered input buffer for the current frame.
  let pendingInputs = [];
  let framePresses = [];

  let puck;
  let obstacles;
  let particles;
  let mom;
  let streak;
  let lives;
  let goals;
  let phase; // ready | play | scored | missed | stalled
  let runDist;
  let shake;
  let tilt;
  let braceLean;
  let wobble;
  let camBoost;
  let pushZ;
  let lastSpawnZ;
  let finalSpawned;
  let gradeFlashTimer;
  let gradeFlashText;
  let gradeFlashClass;

  function createPuck() {
    return {
      x: 0,
      z: 40,
      vz: SPEED_MIN + MOM_START * (SPEED_MAX - SPEED_MIN),
    };
  }

  function pickSide() {
    const r = Math.random();
    if (r < 0.4) return -1;
    if (r < 0.8) return 1;
    return 0;
  }

  function makeObstacle(z, side) {
    return {
      z,
      side,
      type: side === 0 ? "cross" : "stick",
      resolved: false,
      answer: null,
      windowOpen: false,
    };
  }

  function spawnInterval() {
    const t = Math.max(0, Math.min(1, puck.z / runDist));
    return INTERVAL_START + (INTERVAL_END - INTERVAL_START) * t;
  }

  function maybeSpawnObstacles() {
    // One strike at a time — no corridor full of parked sticks.
    if (obstacles.some((o) => !o.resolved && o.z > puck.z - 40)) return;
    if (finalSpawned) return;

    const finalZ = runDist - 200;
    const lead = Math.max(puck.vz, SPEED_MIN) * spawnInterval();
    const nextZ = Math.max(lastSpawnZ + 80, puck.z + lead);

    if (nextZ >= finalZ - 40 || puck.z + lead >= finalZ) {
      obstacles.push(makeObstacle(finalZ, 0));
      lastSpawnZ = finalZ;
      finalSpawned = true;
      return;
    }

    obstacles.push(makeObstacle(nextZ, pickSide()));
    lastSpawnZ = nextZ;
  }

  function livesText() {
    return "♥".repeat(Math.max(0, lives)) + "♡".repeat(Math.max(0, MAX_LIVES - lives));
  }

  // keepLives / keepStreak: survive between attempts inside the same 3-life set.
  function resetRun(opts = {}) {
    const keepLives = !!opts.keepLives;
    const keepStreak = !!opts.keepStreak;

    runDist = RUN_DIST;
    mom = MOM_START;
    if (!keepStreak) streak = 0;
    if (!keepLives) lives = MAX_LIVES;
    puck = createPuck();
    obstacles = [];
    particles = [];
    shake = 0;
    tilt = 0;
    braceLean = 0;
    wobble = 0;
    camBoost = 0;
    pushZ = 0;
    lastSpawnZ = 280;
    finalSpawned = false;
    gradeFlashTimer = 0;
    gradeFlashText = "";
    gradeFlashClass = "";
    pendingInputs = [];
    framePresses = [];
    phase = "play";
    if (!opts.keepGoals) goals = 0;
    statusEl.hidden = true;
    restartBtn.hidden = true;
    braceFlash.hidden = true;
    braceFlash.className = "";
    maybeSpawnObstacles();
    updateHud();
  }

  function resetGame() {
    resetRun({ keepLives: false, keepStreak: false, keepGoals: false });
    phase = "ready";
    introEl.hidden = false;
  }

  function startRun() {
    introEl.hidden = true;
    resetRun({ keepLives: false, keepStreak: false, keepGoals: false });
    phase = "play";
  }

  function updateHud() {
    streakEl.textContent = String(streak);
    livesEl.textContent = livesText();
    const g = Math.max(0, Math.min(1, mom));
    gripFill.style.transform = `scaleX(${g})`;
    gripValue.textContent = String(Math.round(g * 100));
    const prog = Math.max(0, Math.min(1, puck.z / runDist));
    progressFill.style.transform = `scaleX(${prog})`;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function project(x, z) {
    const d = z - puck.z + pushZ;
    if (d < CAM.near || d > CAM.far) return null;
    const k = CAM.focal / d;
    return {
      sx: W / 2 + x * k,
      sy: H * CAM.horizonFrac + (CAM.height + camBoost) * k,
      k,
      d,
    };
  }

  function projectHeight(x, z, worldH) {
    const p = project(x, z);
    if (!p) return null;
    return {
      sx: p.sx,
      sy: p.sy - worldH * p.k,
      baseY: p.sy,
      k: p.k,
      d: p.d,
    };
  }

  function streakMult() {
    return 1 + Math.min(streak, 5) * 0.1;
  }

  function showGrade(text, cls) {
    gradeFlashText = text;
    gradeFlashClass = cls;
    gradeFlashTimer = GRADE_FLASH_TIME;
    braceFlash.hidden = false;
    braceFlash.textContent = text;
    braceFlash.className = cls;
  }

  function spawnSparks(n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 30,
        z: puck.z + HIT_LINE + (Math.random() - 0.5) * 20,
        life: 0.2 + Math.random() * 0.3,
        max: 0.45,
      });
    }
  }

  function applyMom(delta) {
    mom = Math.max(0, Math.min(1, mom + delta));
    puck.vz = SPEED_MIN + mom * (SPEED_MAX - SPEED_MIN);
  }

  function resolveSuccess(obs, grade) {
    if (obs.resolved) return;
    obs.resolved = true;
    // Goal streak only boosts hit rewards — it does not grow on stick hits.
    const mult = streakMult();
    if (grade === "perfect") {
      applyMom(0.26 * mult);
      showGrade("ИДЕАЛЬНО", "grade-perfect");
      braceLean = obs.side * 28;
      pushZ = 18;
      spawnSparks(14);
      if (obs.side === 0) camBoost = 22;
      shake = 0.12;
    } else {
      applyMom(0.14 * mult);
      showGrade("ХОРОШО", "grade-good");
      braceLean = obs.side * 20;
      pushZ = 10;
      spawnSparks(8);
      if (obs.side === 0) camBoost = 14;
      shake = 0.08;
    }
    updateHud();
  }

  function resolveFail(obs, reason) {
    if (obs.resolved) return;
    obs.resolved = true;

    // Stick mistakes only cost momentum — lives are for failed runs to the net.
    if (reason === "wrong") {
      applyMom(-0.26);
      showGrade("НЕ ТУДА", "grade-miss");
    } else {
      applyMom(-0.32);
      showGrade("ПРОПУСК", "grade-miss");
    }

    shake = 0.45;
    tilt = (Math.random() < 0.5 ? -1 : 1) * 0.1;
    wobble = 1;
    braceLean = obs.side * -12;
    spawnSparks(6);
    updateHud();
  }

  function activeWindowObs() {
    let best = null;
    let bestAbs = Infinity;
    for (const obs of obstacles) {
      if (obs.resolved || !obs.windowOpen) continue;
      const t = timeToHit(obs);
      const a = Math.abs(t);
      if (a < bestAbs) {
        bestAbs = a;
        best = obs;
      }
    }
    return best;
  }

  function timeToHit(obs) {
    return (obs.z - (puck.z + HIT_LINE)) / Math.max(puck.vz, 1);
  }

  function sideFromInput(code) {
    if (code === "left") return -1;
    if (code === "right") return 1;
    if (code === "brace") return 0;
    return null;
  }

  function handleInputs() {
    framePresses = pendingInputs.splice(0, pendingInputs.length);
    if (framePresses.length === 0) return;

    const obs = activeWindowObs();
    if (!obs) {
      // Whiff outside any window — no life / streak cost.
      applyMom(-0.05);
      showGrade("ПУСТО", "grade-whiff");
      wobble = 0.4;
      updateHud();
      return;
    }

    if (obs.answer !== null || obs.resolved) return;

    if (framePresses.length > 1) {
      obs.answer = "multi";
      resolveFail(obs, "wrong");
      return;
    }

    const pressed = sideFromInput(framePresses[0]);
    const t = timeToHit(obs);
    const absT = Math.abs(t);

    // Too early with the right side: don't burn a life, wait for the hit window.
    if (pressed === obs.side && t > GOOD) {
      showGrade("РАНО", "grade-whiff");
      return;
    }

    if (pressed !== obs.side) {
      obs.answer = pressed;
      resolveFail(obs, "wrong");
      return;
    }

    obs.answer = pressed;
    if (absT <= PERFECT) {
      resolveSuccess(obs, "perfect");
    } else if (absT <= GOOD) {
      resolveSuccess(obs, "good");
    } else {
      // Past the hit window with the right side — counts as a miss.
      resolveFail(obs, "miss");
    }
  }

  function updateObstacles() {
    for (const obs of obstacles) {
      if (obs.resolved) continue;
      const t = timeToHit(obs);

      if (t < WINDOW_OPEN && t > -GOOD) {
        obs.windowOpen = true;
      }

      if (obs.windowOpen && obs.answer === null && t < -GOOD) {
        resolveFail(obs, "miss");
      }
    }

    // Drop far-behind obstacles.
    obstacles = obstacles.filter((o) => o.z > puck.z - 80 || !o.resolved);
  }

  function updatePuck(dt) {
    applyMom(-MOM_DRAIN * dt);

    if (mom <= 0) {
      mom = 0;
      puck.vz = 0;
      onStalled();
      return;
    }

    puck.x = 0;
    puck.z += puck.vz * dt;

    if (Math.random() < dt * 14) {
      particles.push({
        x: (Math.random() - 0.5) * 8,
        z: puck.z - 4,
        life: 0.25 + Math.random() * 0.2,
        max: 0.4,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].life -= dt;
      particles[i].z -= 40 * dt;
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
  }

  function updateFx(dt) {
    if (shake > 0) shake = Math.max(0, shake - dt * 1.8);
    tilt *= 0.88;
    braceLean *= Math.pow(0.08, dt);
    if (Math.abs(braceLean) < 0.2) braceLean = 0;
    wobble = Math.max(0, wobble - dt * 2.5);
    camBoost = Math.max(0, camBoost - dt * 40);
    pushZ = Math.max(0, pushZ - dt * 50);

    if (gradeFlashTimer > 0) {
      gradeFlashTimer -= dt;
      if (gradeFlashTimer <= 0) {
        braceFlash.hidden = true;
        braceFlash.className = "";
      }
    }
  }

  function onScored() {
    phase = "scored";
    streak += 1;
    goals += 1;
    statusEl.hidden = false;
    statusEl.innerHTML =
      `ГОЛ!<br><span style="font-size:18px;font-weight:600">Серия ${streak}</span>`;
    braceFlash.hidden = true;
    updateHud();
    setTimeout(() => {
      if (phase !== "scored") return;
      // Same life bank: keep hearts and the goal streak.
      resetRun({ keepLives: true, keepStreak: true, keepGoals: true });
    }, 1400);
  }

  function onStalled() {
    if (phase !== "play") return;

    lives = Math.max(0, lives - 1);
    const pct = Math.round(Math.min(1, puck.z / runDist) * 100);
    braceFlash.hidden = true;
    updateHud();

    if (lives <= 0) {
      // Three failed runs → streak dies with the life bank.
      phase = "stalled";
      streak = 0;
      statusEl.hidden = false;
      statusEl.innerHTML =
        `НЕ ДОЛЕТЕЛ<br><span style="font-size:18px;font-weight:600">Жизни кончились · серия сброшена · ${pct}%</span>`;
      restartBtn.hidden = false;
      updateHud();
      return;
    }

    phase = "missed";
    statusEl.hidden = false;
    statusEl.innerHTML =
      `НЕ ДОЛЕТЕЛ<br><span style="font-size:18px;font-weight:600">Осталось жизней: ${lives} · серия ${streak}</span>`;
    setTimeout(() => {
      if (phase !== "missed") return;
      resetRun({ keepLives: true, keepStreak: true, keepGoals: true });
    }, 1200);
  }

  function update(dt) {
    if (phase !== "play") {
      pendingInputs.length = 0;
      updateFx(dt);
      return;
    }

    handleInputs();
    updatePuck(dt);
    if (phase !== "play") {
      updateFx(dt);
      return;
    }

    maybeSpawnObstacles();
    updateObstacles();
    updateParticles(dt);
    updateFx(dt);

    if (puck.z >= runDist) {
      onScored();
    }

    updateHud();
  }

  // ---------- RENDER ----------

  function drawCeiling() {
    const horizon = H * CAM.horizonFrac;
    const grad = ctx.createLinearGradient(0, 0, 0, horizon);
    grad.addColorStop(0, "#0a1524");
    grad.addColorStop(1, "#152a42");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, horizon);

    const start = Math.floor(puck.z / CORRIDOR.ribStep) * CORRIDOR.ribStep;
    for (let i = 0; i < 40; i++) {
      const z = start + i * CORRIDOR.ribStep;
      const p = projectHeight(0, z, CORRIDOR.ceilH);
      if (!p || p.sy > horizon) continue;
      ctx.strokeStyle = `rgba(120,170,210,${Math.max(0.05, 0.35 - i * 0.008)})`;
      ctx.lineWidth = Math.max(1, 2 * p.k);
      ctx.beginPath();
      const left = projectHeight(-CORRIDOR.halfW, z, CORRIDOR.ceilH);
      const right = projectHeight(CORRIDOR.halfW, z, CORRIDOR.ceilH);
      if (!left || !right) continue;
      ctx.moveTo(left.sx, left.sy);
      ctx.lineTo(right.sx, right.sy);
      ctx.stroke();
    }
  }

  function drawFloor() {
    const horizon = H * CAM.horizonFrac;

    const farL = project(-CORRIDOR.halfW, puck.z + CAM.far * 0.85);
    const farR = project(CORRIDOR.halfW, puck.z + CAM.far * 0.85);
    const nearL = project(-CORRIDOR.halfW, puck.z + CAM.near + 2);
    const nearR = project(CORRIDOR.halfW, puck.z + CAM.near + 2);

    ctx.beginPath();
    if (farL && farR && nearL && nearR) {
      ctx.moveTo(farL.sx, farL.sy);
      ctx.lineTo(farR.sx, farR.sy);
      ctx.lineTo(nearR.sx, nearR.sy);
      ctx.lineTo(nearL.sx, nearL.sy);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, horizon, 0, H);
      g.addColorStop(0, "#7eafca");
      g.addColorStop(0.4, "#b4d6e8");
      g.addColorStop(1, "#dff0f8");
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      ctx.fillStyle = "#b4d6e8";
      ctx.fillRect(0, horizon, W, H - horizon);
    }

    // Floor rungs (world-locked).
    const start = Math.floor(puck.z / CORRIDOR.ribStep) * CORRIDOR.ribStep;
    for (let i = 0; i < 45; i++) {
      const z = start + i * CORRIDOR.ribStep;
      const a = project(-CORRIDOR.halfW, z);
      const b = project(CORRIDOR.halfW, z);
      if (!a || !b) continue;
      const alpha = Math.max(0.04, 0.4 - i * 0.009);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = Math.max(1, a.k * 1.5);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
  }

  function drawWalls() {
    const start = Math.floor(puck.z / CORRIDOR.ribStep) * CORRIDOR.ribStep;

    for (const side of [-1, 1]) {
      const x = side * CORRIDOR.halfW;

      for (let i = 0; i < 36; i++) {
        const z0 = start + i * CORRIDOR.ribStep;
        const z1 = z0 + CORRIDOR.ribStep;
        const b0 = project(x, z0);
        const t0 = projectHeight(x, z0, CORRIDOR.wallH);
        const b1 = project(x, z1);
        const t1 = projectHeight(x, z1, CORRIDOR.wallH);
        if (!b0 || !t0 || !b1 || !t1) continue;

        ctx.beginPath();
        ctx.moveTo(b0.sx, b0.sy);
        ctx.lineTo(t0.sx, t0.sy);
        ctx.lineTo(t1.sx, t1.sy);
        ctx.lineTo(b1.sx, b1.sy);
        ctx.closePath();
        const shade = 0.22 + (i % 2) * 0.04;
        ctx.fillStyle = side < 0
          ? `rgba(30,55,80,${0.85 - i * 0.012})`
          : `rgba(25,48,72,${0.85 - i * 0.012})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(180,210,235,${shade})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (let i = 0; i < 40; i++) {
        const z = start + i * CORRIDOR.ribStep;
        const b = project(x, z);
        const t = projectHeight(x, z, CORRIDOR.wallH);
        if (!b || !t) continue;
        ctx.strokeStyle = `rgba(220,235,255,${Math.max(0.08, 0.55 - i * 0.012)})`;
        ctx.lineWidth = Math.max(1.5, 3 * b.k);
        ctx.beginPath();
        ctx.moveTo(b.sx, b.sy);
        ctx.lineTo(t.sx, t.sy);
        ctx.stroke();
      }
    }
  }

  function drawGoal() {
    const z = runDist;
    const half = 100;
    const posts = [
      projectHeight(-half, z, 110),
      projectHeight(half, z, 110),
    ];
    const bases = [project(-half, z), project(half, z)];
    if (!posts[0] || !posts[1] || !bases[0] || !bases[1]) return;

    // Soft fill so the net reads even when far.
    ctx.fillStyle = "rgba(255, 45, 45, 0.22)";
    ctx.beginPath();
    ctx.moveTo(bases[0].sx, bases[0].sy);
    ctx.lineTo(posts[0].sx, posts[0].sy);
    ctx.lineTo(posts[1].sx, posts[1].sy);
    ctx.lineTo(bases[1].sx, bases[1].sy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#ff3b3b";
    ctx.lineWidth = Math.max(3, posts[0].k * 6);
    ctx.beginPath();
    ctx.moveTo(bases[0].sx, bases[0].sy);
    ctx.lineTo(posts[0].sx, posts[0].sy);
    ctx.lineTo(posts[1].sx, posts[1].sy);
    ctx.lineTo(bases[1].sx, bases[1].sy);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,90,90,0.4)";
    ctx.lineWidth = Math.max(1, posts[0].k);
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      const bx = bases[0].sx + (bases[1].sx - bases[0].sx) * t;
      const by = bases[0].sy + (bases[1].sy - bases[0].sy) * t;
      const tx = posts[0].sx + (posts[1].sx - posts[0].sx) * t;
      const ty = posts[0].sy + (posts[1].sy - posts[0].sy) * t;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
  }

  // 0 far away, 1 at the contact moment — drives swing / dive animation.
  function strikeProgress(obs) {
    const dz = obs.z - puck.z;
    const span = Math.max(puck.vz, SPEED_MIN) * 1.35;
    const raw = 1 - (dz - HIT_LINE) / span;
    return Math.max(0, Math.min(1, raw));
  }

  function drawShadow(x, z, rx, rzScale) {
    const p = project(x, z);
    if (!p) return;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, Math.max(4, rx * p.k), Math.max(2, rx * 0.35 * p.k * (rzScale || 1)), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawStick(obs) {
    const p = strikeProgress(obs);
    // Ease-in so the blade snaps across late — feels like a slap flying at you.
    const swing = p * p * (3 - 2 * p);
    const side = obs.side;
    const tipX = side * (CORRIDOR.halfW * (1 - swing * 0.92));
    const gripX = side * (CORRIDOR.halfW * (0.95 - swing * 0.25));
    const tipZ = obs.z - swing * 40;
    const gripZ = obs.z + 8;

    drawShadow(tipX, tipZ, 10 + swing * 26, 1.1);

    const grip = projectHeight(gripX, gripZ, 48 - swing * 18);
    const tip = project(tipX, tipZ);
    const bladeEnd = project(tipX - side * (8 + swing * 18), tipZ + 4);
    if (!grip || !tip || !bladeEnd) return;

    const hot = obs.windowOpen && !obs.resolved;
    ctx.strokeStyle = hot ? "#ff7a18" : "#1a2030";
    ctx.lineWidth = Math.max(3, (5 + swing * 3) * tip.k);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(grip.sx, grip.sy);
    ctx.lineTo(tip.sx, tip.sy);
    ctx.stroke();

    // Blade flares as it comes through the middle.
    ctx.lineWidth = Math.max(4, (7 + swing * 6) * tip.k);
    ctx.strokeStyle = hot ? "#ff9a40" : "#111820";
    ctx.beginPath();
    ctx.moveTo(tip.sx, tip.sy);
    ctx.lineTo(bladeEnd.sx, bladeEnd.sy);
    ctx.stroke();

    // Motion streaks when the swing is live.
    if (swing > 0.35 && !obs.resolved) {
      ctx.strokeStyle = `rgba(255,140,60,${0.15 + swing * 0.35})`;
      ctx.lineWidth = Math.max(2, 3 * tip.k);
      for (let i = 1; i <= 3; i++) {
        const back = swing - i * 0.08;
        if (back < 0) continue;
        const bx = side * (CORRIDOR.halfW * (1 - back * 0.92));
        const bz = obs.z - back * 40;
        const bp = project(bx, bz);
        if (!bp) continue;
        ctx.beginPath();
        ctx.moveTo(bp.sx, bp.sy);
        ctx.lineTo(tip.sx, tip.sy);
        ctx.stroke();
      }
    }
  }

  function drawCross(obs) {
    const p = strikeProgress(obs);
    const dive = p * p * (3 - 2 * p);
    // Starts high, then drops into the strike plane.
    const lift = (1 - dive) * 70;
    const z = obs.z - dive * 20;
    const half = CORRIDOR.halfW - 24;

    drawShadow(0, z, 40 + dive * 120, 0.45);

    const left = projectHeight(-half, z, lift);
    const right = projectHeight(half, z, lift);
    const leftBase = project(-half, z);
    const rightBase = project(half, z);
    if (!left || !right || !leftBase || !rightBase) return;

    const hot = obs.windowOpen && !obs.resolved;
    const barH = Math.max(4, (10 + dive * 10) * leftBase.k);
    ctx.fillStyle = hot ? "rgba(255,106,0,0.55)" : "rgba(20,20,30,0.8)";
    ctx.strokeStyle = hot ? "#ff7a18" : "#222";
    ctx.lineWidth = Math.max(3, 6 * leftBase.k);

    ctx.beginPath();
    ctx.moveTo(left.sx, left.sy);
    ctx.lineTo(right.sx, right.sy);
    ctx.lineTo(rightBase.sx, rightBase.sy + barH * 0.2);
    ctx.lineTo(leftBase.sx, leftBase.sy + barH * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawParticles() {
    for (const p of particles) {
      const pr = project(p.x, p.z);
      if (!pr) continue;
      const a = p.life / p.max;
      ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, Math.max(1, 3 * pr.k * a), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.15, W / 2, H * 0.55, H * 0.9);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPuckRim() {
    // Sit above the HUD / touch buttons so the rim stays readable.
    const lean = braceLean + Math.sin(performance.now() / 40) * wobble * 8;
    const cy = document.body.classList.contains("touch-ui") ? H - 196 : H - 118;
    const rx = 58;
    const ry = 14;

    ctx.fillStyle = "rgba(8, 12, 18, 0.92)";
    ctx.beginPath();
    ctx.ellipse(W / 2 + lean, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = mom < 0.2
      ? "rgba(255,90,70,0.95)"
      : "rgba(160,245,255,0.85)";
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Inner ring for a clearer "puck edge" read.
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(W / 2 + lean, cy, rx - 10, ry - 3, 0, 0, Math.PI * 2);
    ctx.stroke();

    const spinPhase = performance.now() / 1000 * (puck.vz * 0.02);
    ctx.strokeStyle = "rgba(220,250,255,0.75)";
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 6; i++) {
      const a = spinPhase + (i / 6) * Math.PI * 2;
      const px = W / 2 + lean + Math.cos(a) * (rx - 8);
      const py = cy + Math.sin(a) * (ry - 2);
      ctx.beginPath();
      ctx.moveTo(px, py - 4);
      ctx.lineTo(px, py + 4);
      ctx.stroke();
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    const sx = (Math.random() - 0.5) * shake * 18;
    const sy = (Math.random() - 0.5) * shake * 10;
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.rotate(tilt);
    ctx.translate(-W / 2, -H / 2);

    drawCeiling();
    drawFloor();
    drawWalls();
    drawGoal();

    const sorted = [...obstacles]
      .filter((o) => !o.resolved && o.z > puck.z - 30)
      .sort((a, b) => b.z - a.z);

    for (const obs of sorted) {
      if (obs.type === "cross") drawCross(obs);
      else drawStick(obs);
    }

    drawParticles();
    drawVignette();
    drawPuckRim();

    ctx.restore();
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- INPUT ----------

  function queueInput(code) {
    if (phase === "ready") {
      if (code === "brace") startRun();
      return;
    }
    if (phase !== "play") return;
    pendingInputs.push(code);
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyA" || e.code === "ArrowLeft") {
      queueInput("left");
    } else if (e.code === "KeyD" || e.code === "ArrowRight") {
      queueInput("right");
    } else if (e.code === "Space") {
      e.preventDefault();
      queueInput("brace");
    }
  });

  const touchControls = document.getElementById("touch-controls");
  const narrowUi = window.matchMedia("(max-width: 900px)");

  function syncTouchUi() {
    document.body.classList.toggle("touch-ui", narrowUi.matches);
  }
  syncTouchUi();
  if (narrowUi.addEventListener) narrowUi.addEventListener("change", syncTouchUi);
  else if (narrowUi.addListener) narrowUi.addListener(syncTouchUi);

  if (touchControls) {
    for (const btn of touchControls.querySelectorAll("[data-input]")) {
      const fire = (e) => {
        e.preventDefault();
        queueInput(btn.dataset.input);
      };
      btn.addEventListener("pointerdown", fire);
      btn.addEventListener("click", (e) => e.preventDefault());
    }
  }

  restartBtn.addEventListener("click", () => {
    introEl.hidden = true;
    resetRun({ keepLives: false, keepStreak: false, keepGoals: false });
    phase = "play";
  });
  startBtn.addEventListener("click", startRun);
  window.addEventListener("resize", resize);

  resetGame();
  resize();
  requestAnimationFrame((ts) => {
    lastTs = ts;
    loop(ts);
  });
})();
