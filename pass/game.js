(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const livesEl = document.getElementById("lives");
  const goalsEl = document.getElementById("goals");
  const streakEl = document.getElementById("streak");
  const streakFill = document.getElementById("streak-fill");
  const progressFill = document.getElementById("progress-fill");
  const gradeFlash = document.getElementById("grade-flash");
  const statusEl = document.getElementById("status");
  const restartBtn = document.getElementById("restart-btn");
  const introEl = document.getElementById("intro");
  const startBtn = document.getElementById("start-btn");

  const MAX_LIVES = 3;
  const CHARGE_NEEDED = 3;
  const COUNT_IN = 4;
  const COUNT_INTERVAL = 0.8;
  const APPROACH = 1.1;
  const GRADE_FLASH_TIME = 0.4;
  const PUCK_FLY = 0.22;
  const SHOT_TIME = 0.85;
  const TURNOVER_PAUSE = 1.1;
  const GOAL_PAUSE = 1.25;
  const BASE_INTERVAL_SLOW = 0.85;
  const BASE_INTERVAL_FAST = 0.38;
  const BASE_WINDOW_WIDE = 0.17;
  const BASE_WINDOW_NARROW = 0.08;
  const MIN_INTERVAL = 0.26;
  const MIN_WINDOW = 0.055;
  const SPEED_DECAY = 0.95;
  // Ignore presses right after a rollback so a late tap can't burn the next beat.
  const INPUT_LOCK = 0.5;

  // Zigzag chain from own zone up to the slot.
  const LINKS = [
    { x: 0.5, y: 0.9, label: "D" },
    { x: 0.22, y: 0.74, label: "LW" },
    { x: 0.74, y: 0.6, label: "RW" },
    { x: 0.32, y: 0.44, label: "C" },
    { x: 0.66, y: 0.33, label: "RW" },
    { x: 0.5, y: 0.21, label: "F" },
  ];
  const LAST = LINKS.length - 1;

  let W = 0;
  let H = 0;
  let dpr = 1;

  let audioCtx = null;
  // Gameplay clock is performance.now — AudioContext is only for sound.
  // (Suspended AudioContext freezes currentTime and would stall the run.)
  let clockOrigin = 0;

  // ready | countIn | play | shot | turnover | result
  let phase = "ready";
  let lives = MAX_LIVES;
  let goals = 0;
  let streak = 0;
  let maxStreak = 0;
  let turnovers = 0;
  let speedMul = 1;

  let link = 0;
  let charge = 0;
  let winding = false;

  let beatTime = 0;
  let beatJudged = true;
  let countLeft = 0;
  let phaseTimer = 0;
  let beatTimer = 0;
  let inputLockUntil = 0;

  let puckPos = { x: LINKS[0].x, y: LINKS[0].y };
  let puckFrom = { x: LINKS[0].x, y: LINKS[0].y };
  let puckTo = { x: LINKS[0].x, y: LINKS[0].y };
  let puckFly = 0;
  let puckFlying = false;

  let shotT = 0;
  let shotPuck = null;
  let goalFlash = 0;
  let shake = 0;
  let gradeTimer = 0;
  let pauseUntil = 0;

  let sparks = [];
  let flashes = [];

  function lerp(a, b, t) {
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function livesText() {
    return "♥".repeat(lives) + "♡".repeat(Math.max(0, MAX_LIVES - lives));
  }

  function intervalFor(i) {
    const t = i / LAST;
    return Math.max(MIN_INTERVAL, lerp(BASE_INTERVAL_SLOW, BASE_INTERVAL_FAST, t) * speedMul);
  }

  function windowFor(i) {
    const t = i / LAST;
    return Math.max(MIN_WINDOW, lerp(BASE_WINDOW_WIDE, BASE_WINDOW_NARROW, t) * speedMul);
  }

  function progressValue() {
    if (winding) return (LAST + charge / CHARGE_NEEDED) / (LAST + 1);
    return link / (LAST + 1);
  }

  // ---------- AUDIO ----------

  function ensureAudio() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function now() {
    return performance.now() / 1000 - clockOrigin;
  }

  function audioAt(gameTime) {
    if (!audioCtx) return 0;
    return audioCtx.currentTime + Math.max(0, gameTime - now());
  }

  function blip(gameTime, freq, dur, gain, type) {
    if (!audioCtx) return;
    const at = audioAt(gameTime);
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env);
    env.connect(audioCtx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  function tickSound(gameTime, i) {
    const freq = 720 + i * 90;
    blip(gameTime, freq, 0.04, 0.07, "square");
  }

  // ---------- FLOW ----------

  function updateHud() {
    livesEl.textContent = livesText();
    goalsEl.textContent = String(goals);
    streakEl.textContent = String(streak);
    streakFill.style.transform = `scaleX(${clamp(streak / 8, 0, 1)})`;
    progressFill.style.transform = `scaleX(${clamp(progressValue(), 0, 1)})`;
  }

  function showGrade(text, cls) {
    gradeTimer = GRADE_FLASH_TIME;
    gradeFlash.hidden = false;
    gradeFlash.textContent = text;
    gradeFlash.className = cls;
  }

  function pushFlash(nx, ny, text, color) {
    flashes.push({ x: nx, y: ny, text, color, life: 0.55, max: 0.55 });
  }

  function spawnSparks(nx, ny, n, hot) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.05 + Math.random() * 0.12;
      sparks.push({
        x: nx,
        y: ny,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.25,
        max: 0.5,
        hot: !!hot,
      });
    }
  }

  function snapPuckTo(i) {
    puckPos.x = LINKS[i].x;
    puckPos.y = LINKS[i].y;
    puckFrom.x = puckPos.x;
    puckFrom.y = puckPos.y;
    puckTo.x = puckPos.x;
    puckTo.y = puckPos.y;
    puckFlying = false;
    puckFly = 0;
  }

  function flyPuckTo(i) {
    puckFrom.x = puckPos.x;
    puckFrom.y = puckPos.y;
    puckTo.x = LINKS[i].x;
    puckTo.y = LINKS[i].y;
    puckFly = 0;
    puckFlying = true;
  }

  function clearTimers() {
    if (phaseTimer) {
      clearTimeout(phaseTimer);
      phaseTimer = 0;
    }
    if (beatTimer) {
      clearTimeout(beatTimer);
      beatTimer = 0;
    }
  }

  function armBeatDeadline() {
    if (beatTimer) clearTimeout(beatTimer);
    const win = winding ? windowFor(LAST) : windowFor(link);
    const delay = Math.max(0, (beatTime + win - now()) * 1000);
    beatTimer = setTimeout(() => {
      beatTimer = 0;
      if (phase === "play" && !beatJudged) onMiss("late");
    }, delay + 4);
  }

  function scheduleNextBeat(fromTime) {
    const interval = winding ? intervalFor(LAST) : intervalFor(link);
    beatTime = fromTime + interval;
    beatJudged = false;
    const toneLink = winding ? LAST : link;
    tickSound(beatTime, toneLink);
    armBeatDeadline();
  }

  // After a rollback: ignore taps briefly, and don't let the next beat land inside that window.
  function lockInputAfterRollback() {
    inputLockUntil = now() + INPUT_LOCK;
    const interval = winding ? intervalFor(LAST) : intervalFor(link);
    const fromTime = Math.max(beatTime, inputLockUntil - interval);
    scheduleNextBeat(fromTime);
  }

  function startCountIn() {
    clearTimers();
    phase = "countIn";
    link = 0;
    charge = 0;
    winding = false;
    snapPuckTo(0);
    shotPuck = null;
    goalFlash = 0;
    countLeft = COUNT_IN;
    beatJudged = true;
    inputLockUntil = 0;
    pauseUntil = 0;
    statusEl.hidden = true;
    restartBtn.hidden = true;
    gradeFlash.hidden = true;

    // Reset game clock origin so times stay small and readable.
    clockOrigin = performance.now() / 1000;
    const t0 = 0.35;
    for (let i = 0; i < COUNT_IN; i++) {
      blip(t0 + i * COUNT_INTERVAL, i === COUNT_IN - 1 ? 1100 : 880, 0.05, 0.08, "square");
    }
    // End of count-in; enterPlay() will schedule the first real beat with approach time.
    beatTime = t0 + COUNT_IN * COUNT_INTERVAL;
    phaseTimer = setTimeout(() => {
      phaseTimer = 0;
      if (phase === "countIn") enterPlay();
    }, beatTime * 1000 + 4);
    updateHud();
  }

  function enterPlay() {
    phase = "play";
    // First play beat needs a full approach so the ring is readable after count-in.
    beatTime = now() + intervalFor(0);
    beatJudged = false;
    tickSound(beatTime, 0);
    armBeatDeadline();
  }

  function resetGame() {
    lives = MAX_LIVES;
    goals = 0;
    streak = 0;
    maxStreak = 0;
    turnovers = 0;
    speedMul = 1;
    sparks = [];
    flashes = [];
    shake = 0;
    gradeTimer = 0;
    updateHud();
  }

  function startRun() {
    ensureAudio();
    introEl.hidden = true;
    if (phase === "ready" || phase === "result") resetGame();
    startCountIn();
  }

  // ---------- JUDGEMENT ----------

  function onHit(grade) {
    beatJudged = true;
    const holder = LINKS[link];
    const hot = grade === "perfect";

    if (winding) {
      charge += 1;
      spawnSparks(holder.x, holder.y, hot ? 10 : 6, true);
      pushFlash(holder.x, holder.y, hot ? "ИДЕАЛЬНО" : "ХОРОШО", hot ? "#2ecc71" : "#3498db");
      showGrade(hot ? "ИДЕАЛЬНО" : "ХОРОШО", hot ? "grade-perfect" : "grade-good");
      blip(now(), hot ? 1400 : 1100, 0.06, 0.1, "triangle");
      blip(now() + 0.02, hot ? 1800 : 1400, 0.05, 0.06, "triangle");
      updateHud();
      if (charge >= CHARGE_NEEDED) {
        fireShot();
        return;
      }
      scheduleNextBeat(beatTime);
      return;
    }

    // Pass forward.
    const next = Math.min(LAST, link + 1);
    link = next;
    flyPuckTo(link);
    spawnSparks(holder.x, holder.y, hot ? 8 : 5, false);
    pushFlash(holder.x, holder.y, hot ? "ИДЕАЛЬНО" : "ПАСС", hot ? "#2ecc71" : "#3498db");
    showGrade(hot ? "ИДЕАЛЬНО" : "ХОРОШО", hot ? "grade-perfect" : "grade-good");
    blip(now(), hot ? 1250 : 980, 0.05, 0.09, "triangle");

    if (link === LAST) {
      winding = true;
      charge = 0;
    }

    updateHud();
    scheduleNextBeat(beatTime);
  }

  function onMiss(reason) {
    beatJudged = true;
    const holder = LINKS[link];

    if (winding) {
      charge = 0;
      winding = false;
      link = LAST - 1;
      flyPuckTo(link);
      pushFlash(holder.x, holder.y, "НАЗАД", "#e74c3c");
      showGrade("НАЗАД", "grade-miss");
      shake = Math.max(shake, 0.25);
      blip(now(), 180, 0.1, 0.08, "sawtooth");
      updateHud();
      lockInputAfterRollback();
      return;
    }

    if (link === 0) {
      doTurnover(reason);
      return;
    }

    link -= 1;
    flyPuckTo(link);
    pushFlash(holder.x, holder.y, reason === "early" ? "РАНО" : "НАЗАД", "#e74c3c");
    showGrade(reason === "early" ? "РАНО" : "НАЗАД", "grade-miss");
    shake = Math.max(shake, 0.2);
    blip(now(), 200, 0.08, 0.07, "sawtooth");
    updateHud();
    lockInputAfterRollback();
  }

  function doTurnover(reason) {
    phase = "turnover";
    turnovers += 1;
    lives -= 1;
    streak = 0;
    charge = 0;
    winding = false;
    shake = Math.max(shake, 0.45);
    const holder = LINKS[0];
    pushFlash(holder.x, holder.y, "ОБРЕЗ", "#e74c3c");
    showGrade(reason === "early" ? "РАНО" : "ОБРЕЗ", "grade-miss");
    blip(now(), 140, 0.14, 0.1, "sawtooth");
    blip(now() + 0.05, 100, 0.12, 0.08, "sawtooth");
    updateHud();
    pauseUntil = now() + TURNOVER_PAUSE;
  }

  function fireShot() {
    phase = "shot";
    shotT = 0;
    const from = LINKS[LAST];
    const goalX = 0.5 + (Math.random() < 0.5 ? -0.08 : 0.08);
    shotPuck = { x: from.x, y: from.y, tx: goalX, ty: 0.04 };
    goalFlash = 0;
    shake = Math.max(shake, 0.55);
    showGrade("ЩЕЛЧОК!", "grade-shot");
    blip(now(), 220, 0.08, 0.12, "sawtooth");
    blip(now() + 0.05, 880, 0.1, 0.1, "triangle");
    blip(now() + 0.12, 1400, 0.12, 0.08, "triangle");
    spawnSparks(from.x, from.y, 16, true);
  }

  function onGoal() {
    goals += 1;
    streak += 1;
    maxStreak = Math.max(maxStreak, streak);
    speedMul = Math.max(MIN_INTERVAL / BASE_INTERVAL_FAST, speedMul * SPEED_DECAY);
    goalFlash = 1;
    showGrade("ГОЛ!", "grade-shot");
    blip(now(), 660, 0.1, 0.1, "triangle");
    blip(now() + 0.08, 990, 0.12, 0.09, "triangle");
    blip(now() + 0.18, 1320, 0.14, 0.08, "triangle");
    updateHud();
    pauseUntil = now() + GOAL_PAUSE;
  }

  function finish() {
    phase = "result";
    statusEl.hidden = false;
    statusEl.innerHTML =
      `АТАКА ЗАКОНЧЕНА<br><span style="font-size:17px;font-weight:600">` +
      `Голы: ${goals} · серия: ${maxStreak}<br>` +
      `Обрезов: ${turnovers}</span>`;
    restartBtn.hidden = false;
    gradeFlash.hidden = true;
  }

  function press() {
    if (phase === "ready" || phase === "result") {
      startRun();
      return;
    }
    if (phase === "countIn") {
      // Free warm-up taps during count-in.
      const holder = LINKS[0];
      spawnSparks(holder.x, holder.y, 4, false);
      blip(now(), 520, 0.04, 0.03, "sine");
      return;
    }
    if (phase !== "play") return;
    if (beatJudged) return;
    // Late tap after a rollback must not burn the next beat.
    if (now() < inputLockUntil) return;

    const t = now();
    const win = winding ? windowFor(LAST) : windowFor(link);
    const dt = t - beatTime;

    if (Math.abs(dt) <= win) {
      const perfect = Math.abs(dt) <= win * 0.4;
      onHit(perfect ? "perfect" : "good");
      return;
    }

    // Early press burns the beat.
    if (dt < -win) {
      onMiss("early");
      return;
    }

    // Late — already past window; autoMiss will handle, but if somehow here:
    onMiss("late");
  }

  // ---------- UPDATE ----------

  function update(dt) {
    if (gradeTimer > 0) {
      gradeTimer -= dt;
      if (gradeTimer <= 0) {
        gradeFlash.hidden = true;
        gradeFlash.className = "";
      }
    }

    shake = Math.max(0, shake - dt * 1.8);
    goalFlash = Math.max(0, goalFlash - dt * 1.4);

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.94;
      s.vy *= 0.94;
      if (s.life <= 0) sparks.splice(i, 1);
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      flashes[i].life -= dt;
      if (flashes[i].life <= 0) flashes.splice(i, 1);
    }

    if (puckFlying) {
      puckFly = Math.min(1, puckFly + dt / PUCK_FLY);
      const e = puckFly * puckFly * (3 - 2 * puckFly);
      puckPos.x = puckFrom.x + (puckTo.x - puckFrom.x) * e;
      puckPos.y = puckFrom.y + (puckTo.y - puckFrom.y) * e;
      if (puckFly >= 1) puckFlying = false;
    }

    if (phase === "countIn") {
      const t = now();
      countLeft = Math.max(0, Math.ceil((beatTime - t) / COUNT_INTERVAL));
      if (t >= beatTime) enterPlay();
      return;
    }

    if (phase === "shot") {
      shotT += dt;
      const p = Math.min(1, shotT / (SHOT_TIME * 0.55));
      if (shotPuck) {
        const e = p * p * (3 - 2 * p);
        shotPuck.x = LINKS[LAST].x + (shotPuck.tx - LINKS[LAST].x) * e;
        shotPuck.y = LINKS[LAST].y + (shotPuck.ty - LINKS[LAST].y) * e;
      }
      if (shotT >= SHOT_TIME * 0.45 && goalFlash === 0 && pauseUntil === 0) {
        onGoal();
      }
      if (pauseUntil > 0 && now() >= pauseUntil) {
        pauseUntil = 0;
        startCountIn();
      }
      return;
    }

    if (phase === "turnover") {
      if (now() >= pauseUntil) {
        pauseUntil = 0;
        if (lives <= 0) finish();
        else startCountIn();
      }
      return;
    }

    if (phase !== "play") return;

    const t = now();
    if (!beatJudged) {
      const win = winding ? windowFor(LAST) : windowFor(link);
      if (t > beatTime + win) onMiss("late");
    }
  }

  // ---------- RENDER ----------

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rinkRect() {
    const padTop = 90;
    const padBottom = 120;
    const padX = 18;
    const availW = Math.max(120, W - padX * 2);
    const availH = Math.max(160, H - padTop - padBottom);
    const aspect = Math.max(0.7, Math.min(1.35, (availW / availH) * 0.75));
    let h = availH;
    let w = h * aspect;
    if (w > availW) {
      w = availW;
      h = w / aspect;
    }
    return { x: W / 2 - w / 2, y: padTop + (availH - h) / 2, w, h };
  }

  function toScreen(rink, nx, ny) {
    return { x: rink.x + nx * rink.w, y: rink.y + ny * rink.h };
  }

  function playerRadius(rink) {
    return Math.max(14, Math.min(36, rink.w * 0.07));
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawRink(rink) {
    const g = ctx.createLinearGradient(0, rink.y, 0, rink.y + rink.h);
    g.addColorStop(0, "#cfe8f6");
    g.addColorStop(1, "#eaf6fc");
    ctx.fillStyle = g;
    roundRect(rink.x, rink.y, rink.w, rink.h, Math.min(48, rink.w * 0.14));
    ctx.fill();
    ctx.strokeStyle = "rgba(20, 50, 80, 0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = "rgba(60, 120, 200, 0.5)";
    ctx.lineWidth = Math.max(3, rink.w * 0.012);
    ctx.beginPath();
    ctx.moveTo(rink.x, rink.y + rink.h * 0.55);
    ctx.lineTo(rink.x + rink.w, rink.y + rink.h * 0.55);
    ctx.stroke();

    const cx = rink.x + rink.w / 2;
    const creaseR = rink.w * 0.16;
    ctx.fillStyle = "rgba(90, 160, 230, 0.22)";
    ctx.beginPath();
    ctx.arc(cx, rink.y + rink.h * 0.045, creaseR, 0, Math.PI);
    ctx.fill();

    const goalW = rink.w * 0.26;
    ctx.strokeStyle = "#ff3b3b";
    ctx.lineWidth = Math.max(3, rink.w * 0.014);
    ctx.beginPath();
    ctx.moveTo(cx - goalW / 2, rink.y + rink.h * 0.045);
    ctx.lineTo(cx - goalW / 2, rink.y + 2);
    ctx.lineTo(cx + goalW / 2, rink.y + 2);
    ctx.lineTo(cx + goalW / 2, rink.y + rink.h * 0.045);
    ctx.stroke();

    // Goalie.
    const gy = rink.y + rink.h * 0.07;
    ctx.fillStyle = "#1b2a40";
    ctx.beginPath();
    ctx.arc(cx, gy, rink.w * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c8d6e5";
    ctx.fillRect(cx - rink.w * 0.05, gy - rink.w * 0.012, rink.w * 0.1, rink.w * 0.018);

    if (goalFlash > 0) {
      ctx.fillStyle = `rgba(255, 140, 40, ${goalFlash * 0.55})`;
      ctx.beginPath();
      ctx.arc(cx, rink.y + rink.h * 0.04, creaseR * (1 + (1 - goalFlash) * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawChainLines(rink) {
    const r = playerRadius(rink);
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.setLineDash([6, 8]);

    for (let i = 0; i < LINKS.length - 1; i++) {
      const a = toScreen(rink, LINKS[i].x, LINKS[i].y);
      const b = toScreen(rink, LINKS[i + 1].x, LINKS[i + 1].y);
      const isNext = phase === "play" && !winding && i === link;
      const traversed = i < link || winding || phase === "shot";
      ctx.strokeStyle = isNext
        ? "rgba(255, 120, 40, 0.85)"
        : traversed
          ? "rgba(80, 160, 230, 0.55)"
          : "rgba(40, 70, 100, 0.22)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Arrow toward next receiver.
    if (phase === "play" && !winding && link < LAST) {
      const a = toScreen(rink, LINKS[link].x, LINKS[link].y);
      const b = toScreen(rink, LINKS[link + 1].x, LINKS[link + 1].y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const s = r * 0.55;
      ctx.fillStyle = "rgba(255, 120, 40, 0.9)";
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(ang) * s, my + Math.sin(ang) * s);
      ctx.lineTo(mx + Math.cos(ang + 2.5) * s * 0.7, my + Math.sin(ang + 2.5) * s * 0.7);
      ctx.lineTo(mx + Math.cos(ang - 2.5) * s * 0.7, my + Math.sin(ang - 2.5) * s * 0.7);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPlayer(rink, i, t) {
    const linkData = LINKS[i];
    const p = toScreen(rink, linkData.x, linkData.y);
    const r = playerRadius(rink);
    const isHolder = i === link && (phase === "play" || phase === "countIn" || phase === "shot");
    const isReached = i < link || (winding && i <= LAST) || (phase === "shot" && i <= LAST);
    const isForward = i === LAST;
    const isNext = !winding && phase === "play" && i === link + 1;

    // Shadow.
    ctx.fillStyle = "rgba(20, 40, 70, 0.18)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.75, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stick — lifts with charge on forward.
    const chargeLift = isForward && winding ? charge / CHARGE_NEEDED : isForward && phase === "shot" ? 1 : 0;
    const stickAng = -0.7 - chargeLift * 1.1 + (phase === "shot" && isForward ? Math.min(1, shotT / 0.2) * 2.2 : 0);
    const stickLen = r * 1.35;
    ctx.strokeStyle = chargeLift > 0.99 || (phase === "shot" && isForward) ? "#ff9a40" : "#1b2433";
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x + r * 0.35, p.y + r * 0.05);
    ctx.lineTo(p.x + r * 0.35 + Math.cos(stickAng) * stickLen, p.y + r * 0.05 + Math.sin(stickAng) * stickLen);
    ctx.stroke();

    // Body.
    const grad = ctx.createLinearGradient(p.x, p.y - r, p.x, p.y + r);
    if (isForward && (winding || phase === "shot")) {
      grad.addColorStop(0, "#ff9a40");
      grad.addColorStop(1, "#c1450a");
    } else if (isHolder) {
      grad.addColorStop(0, "#3d7fd0");
      grad.addColorStop(1, "#1a3f6e");
    } else if (isReached) {
      grad.addColorStop(0, "#4a8fd4");
      grad.addColorStop(1, "#244f7a");
    } else {
      grad.addColorStop(0, "#2f5f9e");
      grad.addColorStop(1, "#16304f");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (isHolder) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else if (isNext) {
      ctx.strokeStyle = "rgba(255, 140, 60, 0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Label.
    ctx.fillStyle = "#e8f4ff";
    ctx.font = `800 ${Math.round(r * 0.55)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(linkData.label, p.x, p.y);

    // Target ring on holder.
    if (isHolder && (phase === "play" || phase === "countIn")) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.05, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Approach ring.
    if (isHolder && phase === "play" && !beatJudged && t != null) {
      const win = winding ? windowFor(LAST) : windowFor(link);
      const dt = beatTime - t;
      if (dt < APPROACH && dt > -win) {
        const near = clamp(1 - Math.abs(dt) / APPROACH, 0, 1);
        const ringR = r * (1.05 + (1 - near) * 1.6);
        ctx.strokeStyle = winding
          ? `rgba(255, 140, 40, ${0.35 + near * 0.55})`
          : `rgba(100, 210, 255, ${0.3 + near * 0.55})`;
        ctx.lineWidth = 3 + near * 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Charge pips on forward.
    if (isForward && (winding || phase === "shot" || charge > 0)) {
      const shown = phase === "shot" ? CHARGE_NEEDED : charge;
      for (let k = 0; k < CHARGE_NEEDED; k++) {
        const ang = -Math.PI / 2 + (k - 1) * 0.55;
        const px = p.x + Math.cos(ang) * r * 1.55;
        const py = p.y + Math.sin(ang) * r * 1.55;
        ctx.beginPath();
        ctx.arc(px, py, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = k < shown ? "#ff9a40" : "rgba(40, 60, 90, 0.35)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  function drawPuck(rink) {
    if (phase === "shot" && shotPuck) {
      const p = toScreen(rink, shotPuck.x, shotPuck.y);
      const r = playerRadius(rink) * 0.28;
      // Trail.
      ctx.strokeStyle = "rgba(30, 30, 40, 0.35)";
      ctx.lineWidth = r * 1.2;
      ctx.beginPath();
      const from = toScreen(rink, LINKS[LAST].x, LINKS[LAST].y);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = "#1a1a22";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(p.x - r * 0.25, p.y - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const p = toScreen(rink, puckPos.x, puckPos.y);
    const r = playerRadius(rink) * 0.32;
    const offsetY = playerRadius(rink) * 0.55;
    ctx.fillStyle = "#1a1a22";
    ctx.beginPath();
    ctx.arc(p.x, p.y + offsetY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.arc(p.x - r * 0.25, p.y + offsetY - r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSparks(rink) {
    const base = playerRadius(rink);
    for (const s of sparks) {
      const p = toScreen(rink, s.x, s.y);
      ctx.globalAlpha = clamp(s.life / s.max, 0, 1);
      ctx.fillStyle = s.hot ? "#ff9a40" : "#8ef0ff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, base * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFlashes(rink) {
    const r = playerRadius(rink);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of flashes) {
      const p = toScreen(rink, f.x, f.y);
      const a = f.life / f.max;
      const rise = (1 - a) * r * 1.3;
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.fillStyle = f.color;
      ctx.font = `800 ${Math.round(r * 0.5)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(f.text, p.x, p.y - r * 1.5 - rise);
    }
    ctx.globalAlpha = 1;
  }

  function drawCountInOverlay(rink) {
    if (phase !== "countIn") return;
    const cx = rink.x + rink.w / 2;
    const cy = rink.y + rink.h / 2;
    const remaining = Math.max(1, countLeft);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (remaining > COUNT_IN - 1) {
      ctx.fillStyle = "rgba(22, 52, 88, 0.72)";
      ctx.font = `800 ${Math.round(rink.w * 0.055)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText("ЛОВИ ТЕМП", cx, cy);
      ctx.fillStyle = "rgba(40, 84, 128, 0.62)";
      ctx.font = `600 ${Math.round(rink.w * 0.03)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText("можно постучать — без штрафа", cx, cy + rink.w * 0.06);
    } else {
      ctx.fillStyle = "rgba(22, 52, 88, 0.7)";
      ctx.font = `800 ${Math.round(rink.w * 0.16)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(String(remaining), cx, cy);
    }
    ctx.restore();
  }

  function drawBeatPulse(rink, t) {
    if (phase !== "play" || beatJudged) return;
    const win = winding ? windowFor(LAST) : windowFor(link);
    const dt = beatTime - t;
    if (dt > 0.05 || dt < -win) return;
    const pulse = clamp(1 - Math.abs(dt) / win, 0, 1);
    ctx.strokeStyle = `rgba(140, 240, 255, ${0.08 + pulse * 0.2})`;
    ctx.lineWidth = 2 + pulse * 3;
    roundRect(rink.x, rink.y, rink.w, rink.h, Math.min(48, rink.w * 0.14));
    ctx.stroke();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b1d33");
    bg.addColorStop(1, "#050d18");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    const sx = (Math.random() - 0.5) * shake * 14;
    const sy = (Math.random() - 0.5) * shake * 10;
    ctx.translate(sx, sy);

    const rink = rinkRect();
    const t = phase === "play" || phase === "countIn" ? now() : null;

    drawRink(rink);
    drawBeatPulse(rink, t);
    drawChainLines(rink);

    for (let i = 0; i < LINKS.length; i++) drawPlayer(rink, i, t);

    drawPuck(rink);
    drawSparks(rink);
    drawFlashes(rink);
    drawCountInOverlay(rink);

    ctx.restore();
  }

  let lastTs = 0;
  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- INPUT ----------

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Space") {
      e.preventDefault();
      press();
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    press();
  });

  startBtn.addEventListener("click", startRun);
  restartBtn.addEventListener("click", startRun);
  window.addEventListener("resize", resize);

  // Debug hook for local playtests (harmless in production).
  window.__passDebug = {
    press,
    state: () => ({
      phase,
      link,
      charge,
      winding,
      lives,
      goals,
      streak,
      beatTime,
      beatJudged,
      now: now(),
      untilBeat: beatTime - now(),
      interval: winding ? intervalFor(LAST) : intervalFor(link),
      window: winding ? windowFor(LAST) : windowFor(link),
    }),
  };

  updateHud();
  resize();
  requestAnimationFrame((ts) => {
    lastTs = ts;
    loop(ts);
  });
})();
