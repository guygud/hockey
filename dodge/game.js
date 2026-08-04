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
  const tutorEl = document.getElementById("tutor");
  const tutorStepEl = document.getElementById("tutor-step");
  const tutorTextEl = document.getElementById("tutor-text");
  const tutorNextBtn = document.getElementById("tutor-next");
  const tutorSkipBtn = document.getElementById("tutor-skip");
  const tutorAgainBtn = document.getElementById("tutor-again");

  const CORRIDOR = { halfW: 200, ribStep: 60 };
  // Eye sits low over the ice; far covers the short track so the net is visible.
  // near is short so a braced stick stays in frame while it slides past the eye.
  // far reaches past RUN_DIST so the net is in frame from the first metre.
  const CAM = { height: 22, focal: 460, near: 6, far: 4400, horizonFrac: 0.42 };
  // Viewing slit through the puck body — a full-width band, no side frame.
  const SLIT = {
    topAboveHorizon: 140,
    bottomFrac: 0.86,
    bottomFracTouch: 0.8,
    openMax: 14,
  };
  const RUN_DIST = 4000;
  const MAX_LIVES = 3;
  const SPEED_MIN = 130;
  const SPEED_MAX = 530;
  // You launch at top speed. Inertia is a mistake budget, not a resource to grow:
  // any mistake takes half the bar, so two of them end the attempt.
  const MOM_START = 1;
  const MOM_DRAIN = 0.055;
  const MISS_COST = 0.5;
  // A team pass shoves you forward; a dodge only keeps you alive. A clean dodge
  // barely outruns the drain, so speed comes from leaning into your own sticks.
  const GAIN_PERFECT = 0.2;
  const GAIN_GOOD = 0.1;
  const GAIN_DODGE_PERFECT = 0.09;
  const GAIN_DODGE_GOOD = 0.035;
  const FOE_SHARE = 0.45;
  const FOE_RAMP = 0.3;
  const HIT_LINE = 110;
  const WINDOW_OPEN = 0.9;
  const PERFECT = 0.08;
  const GOOD = 0.2;
  const INTERVAL_START = 1.6;
  const INTERVAL_END = 1.05;
  // Every attempt in the same life bank ramps up, then plateaus at MAX_LEVEL.
  const MAX_LEVEL = 8;
  const DRAIN_RAMP = 0.55;
  const GAP_RAMP = 0.3;
  const WINDOW_RAMP = 0.22;
  const GRADE_FLASH_TIME = 0.55;
  const TREMBLE_DECAY = 1.7;
  // How far past the hit line a resolved stick keeps sliding by.
  const SLIP_SPAN = 160;
  const NEAR_W_CAP = 56;
  const CONFIRM_DELAY = 450;

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
  let tilt;
  let braceLean;
  let wobble;
  let camBoost;
  let camBoostVel;
  let camZ;
  let camZVel;
  let slitOpen;
  let slitOpenVel;
  let tremble;
  let damageFlash;
  let hitFlash;
  let hitFlashPerfect;
  let boostFx;
  let lastSpawnZ;
  let finalSpawned;
  let gradeFlashTimer;
  let gradeFlashText;
  let gradeFlashClass;
  let runStats;
  let attempt = 1;
  let level = 0;
  let pendingContinue = null;
  let confirmAt = 0;
  let tutorOn = false;
  let tutorPaused = false;
  let tutorStep = 0;
  let tutorSpawns = 0;

  // ---------- AUDIO ----------

  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(freqFrom, freqTo, dur, gain, type) {
    const ac = ensureAudio();
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Short filtered noise burst — the scrape of a stick sliding off the puck.
  function swish(dur, gain, freq, q) {
    const ac = ensureAudio();
    if (!ac) return;
    const t = ac.currentTime;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = q || 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start(t);
  }

  function sfxHit(perfect) {
    if (perfect) {
      tone(760, 1500, 0.1, 0.16, "square");
      tone(380, 620, 0.16, 0.1, "triangle");
      swish(0.22, 0.16, 2600, 0.9);
    } else {
      tone(480, 800, 0.09, 0.11, "square");
      swish(0.18, 0.11, 1800, 0.9);
    }
  }

  // A dodge is air, not contact: the blade goes by without a click.
  function sfxDodge(perfect) {
    swish(perfect ? 0.3 : 0.24, perfect ? 0.16 : 0.11, perfect ? 1500 : 1100, 0.55);
    tone(300, 190, 0.16, perfect ? 0.07 : 0.05, "sine");
  }

  function sfxFail() {
    tone(180, 60, 0.26, 0.2, "sawtooth");
    swish(0.3, 0.14, 320, 0.7);
  }

  function sfxWhiff() {
    swish(0.1, 0.06, 900, 1.6);
  }

  function sfxGoal() {
    tone(520, 780, 0.12, 0.14, "square");
    setTimeout(() => tone(780, 1170, 0.18, 0.14, "square"), 110);
  }

  function sfxStall() {
    tone(300, 90, 0.5, 0.16, "triangle");
  }

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

  // Frontal sticks are always hostile; side sticks split between team and foe,
  // and the foe share grows with the difficulty level.
  function pickFoe(side) {
    if (side === 0) return true;
    return Math.random() < FOE_SHARE + FOE_RAMP * levelMix();
  }

  // While teaching, force team stick, then foe stick, then frontal foe.
  function nextSpawn() {
    if (!tutorOn) {
      const side = pickSide();
      return { side, foe: pickFoe(side) };
    }
    tutorSpawns += 1;
    const anySide = () => (Math.random() < 0.5 ? -1 : 1);
    if (tutorSpawns === 1) return { side: anySide(), foe: false };
    if (tutorSpawns === 2) return { side: anySide(), foe: true };
    if (tutorSpawns === 3) return { side: 0, foe: true };
    const side = pickSide();
    return { side, foe: pickFoe(side) };
  }

  // What the player must press: take a team pass on its own side, swerve away
  // from a foe, hop a frontal one.
  function wantedInput(side, foe) {
    if (side === 0) return "brace";
    const away = foe ? -side : side;
    return away < 0 ? "left" : "right";
  }

  function makeObstacle(z, side, foe) {
    return {
      z,
      side,
      foe,
      want: wantedInput(side, foe),
      type: side === 0 ? "cross" : "stick",
      resolved: false,
      ok: false,
      free: false,
      flip: Math.random() < 0.5 ? -1 : 1,
      answer: null,
      windowOpen: false,
    };
  }

  // 0 on the first attempt, 1 once the ramp plateaus.
  function levelMix() {
    return Math.min(level, MAX_LEVEL) / MAX_LEVEL;
  }

  function drainRate() {
    return MOM_DRAIN * (1 + DRAIN_RAMP * levelMix());
  }

  function perfectWin() {
    return PERFECT * (1 - WINDOW_RAMP * levelMix());
  }

  function goodWin() {
    return GOOD * (1 - WINDOW_RAMP * levelMix());
  }

  function spawnInterval() {
    const t = Math.max(0, Math.min(1, puck.z / runDist));
    const base = INTERVAL_START + (INTERVAL_END - INTERVAL_START) * t;
    return base * (1 - GAP_RAMP * levelMix());
  }

  function maybeSpawnObstacles() {
    // One strike at a time — no corridor full of parked sticks.
    if (obstacles.some((o) => !o.resolved && o.z > puck.z - 40)) return;
    if (finalSpawned) return;

    const finalZ = runDist - 200;
    // The very first stick of a tutorial run comes late, so there is time to roll.
    const gap = tutorOn && tutorSpawns === 0 ? 2.4 : spawnInterval();
    const lead = Math.max(puck.vz, SPEED_MIN) * gap;
    const nextZ = Math.max(lastSpawnZ + 80, puck.z + lead);

    if (nextZ >= finalZ - 40 || puck.z + lead >= finalZ) {
      obstacles.push(makeObstacle(finalZ, 0, true));
      lastSpawnZ = finalZ;
      finalSpawned = true;
      return;
    }

    const spawn = nextSpawn();
    obstacles.push(makeObstacle(nextZ, spawn.side, spawn.foe));
    lastSpawnZ = nextZ;
  }

  function livesText() {
    return "♥".repeat(Math.max(0, lives)) + "♡".repeat(Math.max(0, MAX_LIVES - lives));
  }

  // keepLives / keepStreak: survive between attempts inside the same 3-life set.
  function resetRun(opts = {}) {
    const keepLives = !!opts.keepLives;
    const keepStreak = !!opts.keepStreak;

    // Continuing the same life bank means the next attempt is a notch harder.
    if (keepLives) {
      attempt += 1;
      level += 1;
    } else {
      attempt = 1;
      level = 0;
    }

    runDist = RUN_DIST;
    mom = MOM_START;
    if (!keepStreak) streak = 0;
    if (!keepLives) lives = MAX_LIVES;
    puck = createPuck();
    obstacles = [];
    particles = [];
    tilt = 0;
    braceLean = 0;
    wobble = 0;
    camBoost = 0;
    camBoostVel = 0;
    camZ = 0;
    camZVel = 0;
    slitOpen = 0;
    slitOpenVel = 0;
    tremble = 0;
    damageFlash = 0;
    hitFlash = 0;
    hitFlashPerfect = false;
    boostFx = 0;
    runStats = { perfect: 0, good: 0, wrong: 0, missed: 0, passes: 0, dodges: 0 };
    tutorSpawns = 0;
    lastSpawnZ = 280;
    finalSpawned = false;
    gradeFlashTimer = 0;
    gradeFlashText = "";
    gradeFlashClass = "";
    pendingInputs = [];
    framePresses = [];
    phase = "play";
    if (!opts.keepGoals) goals = 0;
    pendingContinue = null;
    tutorPaused = false;
    tutorEl.hidden = true;
    statusEl.hidden = true;
    statusEl.className = "";
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
    tutorAgainBtn.hidden = !tutorSeen();
  }

  function startRun(withTutor) {
    ensureAudio();
    introEl.hidden = true;
    tutorOn = withTutor === undefined ? !tutorSeen() : !!withTutor;
    tutorStep = 0;
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
    const d = z - puck.z + camZ;
    if (d < CAM.near || d > CAM.far) return null;
    const k = CAM.focal / d;
    return {
      sx: W / 2 + x * k,
      sy: H * CAM.horizonFrac + (CAM.height + camBoost) * k,
      k,
      d,
    };
  }

  function isTouchUi() {
    return document.body.classList.contains("touch-ui");
  }

  function slitRect() {
    const open = slitOpen;
    const top = H * CAM.horizonFrac - SLIT.topAboveHorizon - open * 0.35;
    const bottomFrac = isTouchUi() ? SLIT.bottomFracTouch : SLIT.bottomFrac;
    const bottom = H * bottomFrac + open * 0.65;
    return {
      x: 0,
      y: Math.max(0, top),
      w: W,
      h: Math.max(40, bottom - top),
    };
  }

  function slitPath(slit) {
    ctx.beginPath();
    ctx.rect(slit.x, slit.y, slit.w, slit.h);
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
    obs.ok = true;
    const perfect = grade === "perfect";
    // Goal streak only boosts hit rewards — it does not grow on stick hits.
    const mult = streakMult();
    const dodged = obs.foe;

    const gain = dodged
      ? (perfect ? GAIN_DODGE_PERFECT : GAIN_DODGE_GOOD)
      : (perfect ? GAIN_PERFECT : GAIN_GOOD);
    applyMom(gain * mult);

    if (dodged) {
      showGrade(perfect ? "ЧИСТО УШЁЛ" : "УШЁЛ", perfect ? "grade-perfect" : "grade-good");
    } else {
      showGrade(perfect ? "ИДЕАЛЬНЫЙ ПАС" : "ПРИНЯЛ", perfect ? "grade-perfect" : "grade-good");
    }
    runStats[perfect ? "perfect" : "good"] += 1;
    runStats[dodged ? "dodges" : "passes"] += 1;

    // A pass is contact: recoil and sparks. A dodge is a swerve: it throws the
    // view sideways instead, with only ice spray to show for it.
    camZVel += (perfect ? 260 : 165) * (dodged ? 0.5 : 1);
    slitOpenVel += perfect ? 130 : 85;
    hitFlash = dodged ? 0.5 : 1;
    hitFlashPerfect = perfect;
    boostFx = (perfect ? 1 : 0.7) * (dodged ? 0.6 : 1);
    spawnSparks(dodged ? (perfect ? 8 : 5) : perfect ? 18 : 10);

    if (obs.side === 0) {
      // Frontal stick: you hop over it instead of leaning aside.
      camBoostVel += perfect ? 420 : 290;
      braceLean = 0;
      tilt = 0;
    } else {
      // Lean into a pass, away from a foe — the view swings where you moved.
      const dir = dodged ? -obs.side : obs.side;
      const swing = dodged ? 1.35 : 1;
      braceLean = dir * (perfect ? 40 : 26) * swing;
      tilt = dir * (perfect ? 0.055 : 0.035) * swing;
    }

    if (dodged) sfxDodge(perfect);
    else sfxHit(perfect);
    updateHud();
  }

  function resolveFail(obs, reason) {
    if (obs.resolved) return;
    obs.resolved = true;
    obs.ok = false;

    // Any mistake costs the same half bar — the rule stays readable at speed.
    if (!obs.free) applyMom(-MISS_COST);
    if (reason === "wrong") {
      showGrade(obs.foe ? "ПОЙМАЛИ" : "НЕ ТУДА", "grade-miss");
      runStats.wrong += 1;
    } else {
      showGrade(obs.foe ? "НЕ УШЁЛ" : "ПРОПУСК", "grade-miss");
      runStats.missed += 1;
    }

    tremble = 1;
    damageFlash = 1;
    camZVel -= 60;
    slitOpenVel -= 70;
    tilt = (Math.random() < 0.5 ? -1 : 1) * 0.1;
    wobble = 1;
    braceLean = obs.side * -12;
    spawnSparks(6);
    sfxFail();
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

  function handleInputs() {
    framePresses = pendingInputs.splice(0, pendingInputs.length);
    if (framePresses.length === 0) return;

    const obs = activeWindowObs();
    if (!obs) {
      // Whiff outside any window — no life / streak cost, and free while learning.
      if (!tutorOn) applyMom(-0.05);
      showGrade("ПУСТО", "grade-whiff");
      wobble = 0.4;
      sfxWhiff();
      updateHud();
      return;
    }

    if (obs.answer !== null || obs.resolved) return;

    if (framePresses.length > 1) {
      obs.answer = "multi";
      resolveFail(obs, "wrong");
      return;
    }

    const pressed = framePresses[0];
    const t = timeToHit(obs);
    const absT = Math.abs(t);

    // Too early with the right move: don't punish it, wait for the window.
    if (pressed === obs.want && t > goodWin()) {
      showGrade("РАНО", "grade-whiff");
      return;
    }

    if (pressed !== obs.want) {
      obs.answer = pressed;
      resolveFail(obs, "wrong");
      return;
    }

    obs.answer = pressed;
    if (absT <= perfectWin()) {
      resolveSuccess(obs, "perfect");
    } else if (absT <= goodWin()) {
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

      const late = -goodWin();
      if (t < WINDOW_OPEN && t > late) {
        obs.windowOpen = true;
      }

      if (obs.windowOpen && obs.answer === null && t < late) {
        resolveFail(obs, "miss");
      }
    }

    // Drop far-behind obstacles.
    obstacles = obstacles.filter((o) => o.z > puck.z - 80 || !o.resolved);
  }

  function updatePuck(dt) {
    applyMom(-drainRate() * dt);

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
    tilt *= 0.88;
    braceLean *= Math.pow(0.08, dt);
    if (Math.abs(braceLean) < 0.2) braceLean = 0;
    wobble = Math.max(0, wobble - dt * 2.5);

    // Hop spring: eye lifts over a frontal stick, then settles back down.
    camBoostVel += (-camBoost * 30 - camBoostVel * 6) * dt;
    camBoost += camBoostVel * dt;
    if (Math.abs(camBoost) < 0.05 && Math.abs(camBoostVel) < 0.5) {
      camBoost = 0;
      camBoostVel = 0;
    }

    hitFlash = Math.max(0, hitFlash - dt * 3.2);
    boostFx = Math.max(0, boostFx - dt * 1.6);

    // Camera spring: +camZ = pulled back (success), -camZ = shoved forward (fail).
    camZVel += (-camZ * 26 - camZVel * 7.5) * dt;
    camZ += camZVel * dt;
    if (Math.abs(camZ) < 0.05 && Math.abs(camZVel) < 0.5) {
      camZ = 0;
      camZVel = 0;
    }

    // Slit opens on clean hits, cinches shut on mistakes.
    slitOpenVel += (-slitOpen * 22 - slitOpenVel * 6.5) * dt;
    slitOpen += slitOpenVel * dt;
    slitOpen = Math.max(-SLIT.openMax * 0.6, Math.min(SLIT.openMax, slitOpen));
    if (Math.abs(slitOpen) < 0.05 && Math.abs(slitOpenVel) < 0.5) {
      slitOpen = 0;
      slitOpenVel = 0;
    }

    tremble = Math.max(0, tremble - dt * TREMBLE_DECAY);
    damageFlash = Math.max(0, damageFlash - dt * 2.2);

    if (gradeFlashTimer > 0) {
      gradeFlashTimer -= dt;
      if (gradeFlashTimer <= 0) {
        braceFlash.hidden = true;
        braceFlash.className = "";
      }
    }
  }

  function reportRows() {
    const pct = Math.round(Math.min(1, puck.z / runDist) * 100);
    const hits = runStats.perfect + runStats.good;
    const total = hits + runStats.wrong + runStats.missed;
    return [
      ["Дистанция", `${pct}%`],
      ["Верных ходов", `${hits} из ${total}`],
      ["Пасы · увороты", `${runStats.passes} · ${runStats.dodges}`],
      ["Идеально", String(runStats.perfect)],
      ["Не туда / пропустил", `${runStats.wrong} / ${runStats.missed}`],
      ["Жизни · серия", `${lives} · ${streak}`],
      ["Попытка · сложность", `${attempt} · ${Math.round(levelMix() * 100)}%`],
    ];
  }

  function nextAttemptNote() {
    if (level >= MAX_LEVEL) return "Сложность на максимуме: держись.";
    return "Следующая попытка: чужих клюшек больше, окно уже, инерция тает быстрее.";
  }

  // Round always ends on a report the player dismisses — never auto-restarts.
  function showReport(title, cls, btnLabel, action, note) {
    braceFlash.hidden = true;
    statusEl.hidden = false;
    statusEl.className = cls;
    statusEl.innerHTML =
      `<div class="report-title">${title}</div>` +
      `<div class="report-rows">` +
      reportRows()
        .map(([k, v]) => `<div class="report-row"><span>${k}</span><b>${v}</b></div>`)
        .join("") +
      `</div>` +
      (note ? `<div class="report-note">${note}</div>` : "");
    restartBtn.hidden = false;
    restartBtn.textContent = btnLabel;
    pendingContinue = action;
    confirmAt = performance.now() + CONFIRM_DELAY;
  }

  function runContinue() {
    if (!pendingContinue) return;
    if (performance.now() < confirmAt) return;
    const next = pendingContinue;
    pendingContinue = null;
    next();
  }

  function onScored() {
    phase = "scored";
    streak += 1;
    goals += 1;
    sfxGoal();
    updateHud();
    showReport(
      `ГОЛ! Серия ${streak}`,
      "report-good",
      "Следующая атака →",
      () => {
        // Same life bank: keep hearts and the goal streak.
        resetRun({ keepLives: true, keepStreak: true, keepGoals: true });
      },
      nextAttemptNote()
    );
  }

  function onStalled() {
    if (phase !== "play") return;

    lives = Math.max(0, lives - 1);
    sfxStall();

    if (lives <= 0) {
      // Three failed runs → streak dies with the life bank.
      phase = "stalled";
      const finalGoals = goals;
      streak = 0;
      updateHud();
      showReport(
        `ЖИЗНИ КОНЧИЛИСЬ · голов ${finalGoals}`,
        "report-bad",
        "Начать заново",
        () => resetRun({ keepLives: false, keepStreak: false, keepGoals: false }),
        "Сложность сбросится на первую попытку."
      );
      return;
    }

    phase = "missed";
    updateHud();
    showReport(
      "ИНЕРЦИЯ КОНЧИЛАСЬ",
      "report-bad",
      "Ещё попытка →",
      () => resetRun({ keepLives: true, keepStreak: true, keepGoals: true }),
      nextAttemptNote()
    );
  }

  // ---------- TUTORIAL ----------

  const TUTOR_KEY = "dodgeTutorDone";

  function tutorSeen() {
    try {
      return localStorage.getItem(TUTOR_KEY) === "1";
    } catch (e) {
      // Private mode / blocked storage: never nag, just skip.
      return true;
    }
  }

  function markTutorSeen() {
    try {
      localStorage.setItem(TUTOR_KEY, "1");
    } catch (e) {
      /* nothing to do */
    }
  }

  function keyName(kind) {
    const touch = isTouchUi();
    if (kind === "left") return touch ? "кнопка ВЛЕВО" : "A";
    if (kind === "right") return touch ? "кнопка ВПРАВО" : "D";
    return touch ? "кнопка ПРЫЖОК" : "SPACE";
  }

  function sideWord(side) {
    return side < 0 ? "слева" : "справа";
  }

  const TUTOR_STEPS = [
    {
      id: "inertia",
      find: () => (puck.z < 120 ? true : null),
      text: () =>
        "Ты внутри шайбы и уже летишь на максимальной скорости. Полоса " +
        "<b>ИНЕРЦИЯ</b> внизу — запас ошибок: любая ошибка снимает половину, " +
        "поэтому <b>две ошибки</b> — и попытка кончена. Каждый верный ход " +
        "возвращает часть полосы.",
    },
    {
      id: "team",
      find: () =>
        obstacles.find(
          (o) => !o.resolved && o.side !== 0 && !o.foe && timeToHit(o) < 0.85 && timeToHit(o) > 0.25
        ) || null,
      text: (obs) =>
        `<b class="ink-team">Синяя</b> клюшка — своя, это пас. Идёт <b>${sideWord(obs.side)}</b>: ` +
        `подставься той же стороной — <b>${keyName(obs.side < 0 ? "left" : "right")}</b> — ` +
        "в момент, когда она тебя достаёт. Свои клюшки — твой разгон: " +
        "точный приём возвращает инерции больше всего.",
    },
    {
      id: "foe",
      find: () =>
        obstacles.find(
          (o) => !o.resolved && o.side !== 0 && o.foe && timeToHit(o) < 0.85 && timeToHit(o) > 0.25
        ) || null,
      text: (obs) =>
        `<b class="ink-foe">Красная</b> клюшка — чужая: подставишься — потеряешь шайбу. ` +
        `Она <b>${sideWord(obs.side)}</b>, значит уходи в <b>другую</b> сторону — ` +
        `<b>${keyName(obs.side < 0 ? "right" : "left")}</b>. Уворот только спасает: ` +
        "инерции он почти не возвращает, поэтому чужие клюшки тебя тормозят.",
    },
    {
      id: "front",
      find: () =>
        obstacles.find(
          (o) => !o.resolved && o.side === 0 && timeToHit(o) < 1 && timeToHit(o) > 0.3
        ) || null,
      text: () =>
        "Поперёк дорожки ложатся только <b class=\"ink-foe\">чужие</b> — в сторону от такой " +
        `не уйти. Жми <b>${keyName("brace")}</b>: подпрыгнешь и перелетишь её.`,
    },
  ];

  function showTutorCard(step, target) {
    tutorPaused = true;
    pendingInputs.length = 0;
    tutorStepEl.textContent = `ШАГ ${tutorStep + 1} ИЗ ${TUTOR_STEPS.length}`;
    tutorTextEl.innerHTML = step.text(target);
    tutorEl.hidden = false;
  }

  function checkTutor() {
    if (!tutorOn || tutorPaused) return;
    const step = TUTOR_STEPS[tutorStep];
    if (!step) return;
    const target = step.find();
    if (!target) return;
    // The lesson obstacle never drains inertia, so a first fumble is free.
    if (target !== true) target.free = true;
    showTutorCard(step, target);
  }

  function closeTutorCard() {
    tutorEl.hidden = true;
    tutorPaused = false;
    pendingInputs.length = 0;
  }

  function tutorNext() {
    closeTutorCard();
    tutorStep += 1;
    if (tutorStep >= TUTOR_STEPS.length) endTutor();
  }

  function endTutor() {
    tutorOn = false;
    tutorPaused = false;
    tutorEl.hidden = true;
    markTutorSeen();
  }

  function update(dt) {
    if (tutorPaused) {
      pendingInputs.length = 0;
      return;
    }

    if (phase !== "play") {
      pendingInputs.length = 0;
      updateFx(dt);
      return;
    }

    checkTutor();
    if (tutorPaused) return;

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

  function drawArenaStrip() {
    // Narrow band of arena above the horizon — sky is cut by the slit frame.
    const horizon = H * CAM.horizonFrac;
    const top = horizon - SLIT.topAboveHorizon - 60;
    const g = ctx.createLinearGradient(0, top, 0, horizon);
    g.addColorStop(0, "#05090f");
    g.addColorStop(0.5, "#0b1522");
    g.addColorStop(1, "#1a3048");
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, horizon - top + 2);

    // Dim stands silhouette so the far end is not an empty void.
    ctx.strokeStyle = "rgba(90, 130, 165, 0.16)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = horizon - (SLIT.topAboveHorizon * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function drawFloor() {
    const horizon = H * CAM.horizonFrac;

    // Ice fills the whole frame; the lane is only where the puck can travel.
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, "#2f5470");
    g.addColorStop(0.3, "#4d7893");
    g.addColorStop(1, "#6f97ae");
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, H - horizon);

    // A rung is a line of constant depth, so it spans the frame at a single height.
    const start = Math.floor(puck.z / CORRIDOR.ribStep) * CORRIDOR.ribStep;
    for (let i = 0; i < 60; i++) {
      const z = start + i * CORRIDOR.ribStep;
      const p = project(0, z);
      if (!p) continue;
      const alpha = Math.max(0.05, 0.42 - i * 0.008);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = Math.max(1.2, p.k * 1.6);
      ctx.beginPath();
      ctx.moveTo(0, p.sy);
      ctx.lineTo(W, p.sy);
      ctx.stroke();
    }
  }

  function drawLane() {
    const farZ = puck.z + CAM.far * 0.9;
    const nearZ = puck.z + CAM.near + 2;
    const farL = project(-CORRIDOR.halfW, farZ);
    const farR = project(CORRIDOR.halfW, farZ);
    const nearL = project(-CORRIDOR.halfW, nearZ);
    const nearR = project(CORRIDOR.halfW, nearZ);
    if (!farL || !farR || !nearL || !nearR) return;

    // Lit strip: ice runs everywhere, but this is the road the puck is on.
    ctx.fillStyle = "rgba(216, 240, 255, 0.1)";
    ctx.beginPath();
    ctx.moveTo(farL.sx, farL.sy);
    ctx.lineTo(farR.sx, farR.sy);
    ctx.lineTo(nearR.sx, nearR.sy);
    ctx.lineTo(nearL.sx, nearL.sy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(195, 228, 250, 0.42)";
    ctx.lineWidth = 2;
    for (const [a, b] of [[farL, nearL], [farR, nearR]]) {
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
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

    // Soft red halo so the net reads through the slit from the first frame.
    const cx = (bases[0].sx + bases[1].sx) / 2;
    const cy = (posts[0].sy + bases[0].sy) / 2;
    const glowR = Math.max(30, Math.abs(bases[1].sx - bases[0].sx) * 0.7);
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, glowR);
    glow.addColorStop(0, "rgba(255, 60, 60, 0.35)");
    glow.addColorStop(0.55, "rgba(255, 40, 40, 0.12)");
    glow.addColorStop(1, "rgba(255, 40, 40, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

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

  // Dissolve a stick as it slides by, and again right at the eye so it never smears.
  function passAlpha(slip, d) {
    const bySlip = Math.pow(Math.max(0, 1 - slip), 0.9);
    const byDist = Math.min(1, Math.max(0, (d - CAM.near) / 70));
    return bySlip * byDist;
  }

  // 0 until resolved, then 1 as the stick finishes sliding past the puck.
  function slipProgress(obs) {
    if (!obs.resolved) return 0;
    return Math.max(0, Math.min(1, (puck.z + HIT_LINE - obs.z) / SLIP_SPAN));
  }

  // Team sticks are cold blue, foes are hot red — readable from the far end,
  // because the choice of button has to be made long before contact.
  function stickPalette(obs) {
    const hot = obs.windowOpen && !obs.resolved;
    if (obs.foe) {
      return {
        shaft: hot ? "#ff2e4d" : "#8e1c30",
        blade: hot ? "#ff8098" : "#bd3149",
        glow: hot ? "rgba(255,60,90,0.5)" : "rgba(220,50,80,0.28)",
        trail: hot ? "rgba(255,70,100,0.5)" : "rgba(200,50,80,0.28)",
        spark: "255,140,155",
      };
    }
    return {
      shaft: hot ? "#4fc9ff" : "#2a6b8c",
      blade: hot ? "#c7edff" : "#4a90b4",
      glow: hot ? "rgba(90,205,255,0.45)" : "rgba(70,160,210,0.22)",
      trail: hot ? "rgba(130,215,255,0.5)" : "rgba(100,180,230,0.28)",
      spark: "190,240,255",
    };
  }

  // Halo on the blade so the type reads even before the colour is obvious.
  function drawTipGlow(p, pal, scale) {
    const r = Math.max(6, 16 * p.k * (scale || 1));
    const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r);
    g.addColorStop(0, pal.glow);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawStick(obs) {
    const p = strikeProgress(obs);
    // Ease-in so the blade snaps across late — feels like a slap flying at you.
    const swing = p * p * (3 - 2 * p);
    const side = obs.side;
    // A taken pass skids back out to its side; a dodged foe swings through where
    // you were and carries on across; a stick that got you drags over the middle.
    const slip = slipProgress(obs);
    const push = obs.ok ? (obs.foe ? -slip * 1.6 : slip * 1.1) : slip * 0.35;
    const tipX = side * (CORRIDOR.halfW * (1 - swing * 0.92 + push));
    const gripX = side * (CORRIDOR.halfW * (0.95 - swing * 0.25 + push * 0.5));
    const tipZ = obs.z - swing * 40;
    const gripZ = obs.z + 8;

    drawShadow(tipX, tipZ, 10 + swing * 26, 1.1);

    const grip = projectHeight(gripX, gripZ, 48 - swing * 18);
    const tip = project(tipX, tipZ);
    const bladeEnd = project(tipX - side * (8 + swing * 18), tipZ + 4);
    if (!grip || !tip || !bladeEnd) return;

    const pal = stickPalette(obs);
    ctx.save();
    ctx.globalAlpha = passAlpha(slip, tip.d);
    drawTipGlow(tip, pal, 1);
    ctx.strokeStyle = pal.shaft;
    ctx.lineWidth = Math.min(NEAR_W_CAP, Math.max(3, (5 + swing * 3) * tip.k));
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(grip.sx, grip.sy);
    ctx.lineTo(tip.sx, tip.sy);
    ctx.stroke();

    // Blade flares as it comes through the middle.
    ctx.lineWidth = Math.min(NEAR_W_CAP, Math.max(4, (7 + swing * 6) * tip.k));
    ctx.strokeStyle = pal.blade;
    ctx.beginPath();
    ctx.moveTo(tip.sx, tip.sy);
    ctx.lineTo(bladeEnd.sx, bladeEnd.sy);
    ctx.stroke();

    // Scrape sparks only where a blade actually touched the shell.
    if (obs.ok && !obs.foe && slip > 0 && slip < 0.7) {
      ctx.strokeStyle = `rgba(${pal.spark},${0.5 * (1 - slip)})`;
      ctx.lineWidth = Math.max(1.5, 2 * tip.k);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + slip * 6;
        const r = (6 + slip * 22) * tip.k;
        ctx.beginPath();
        ctx.moveTo(tip.sx, tip.sy);
        ctx.lineTo(tip.sx + Math.cos(a) * r, tip.sy + Math.sin(a) * r * 0.6);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Motion streaks when the swing is live.
    if (swing > 0.35 && !obs.resolved) {
      ctx.strokeStyle = pal.trail;
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

  // Frontal obstacle: a stick laid across the lane, blade turned at one end.
  function drawCross(obs) {
    const p = strikeProgress(obs);
    const dive = p * p * (3 - 2 * p);
    const slip = slipProgress(obs);
    // Drops in from above the slit, then sinks under the eye once you hop it.
    const lift = (1 - dive) * 150 - (obs.ok ? slip * 130 : 0);
    const z = obs.z - dive * 20;
    const f = obs.flip;
    const half = CORRIDOR.halfW - 18;

    drawShadow(0, z, 40 + dive * 120, 0.45);

    const gripEnd = projectHeight(-half * f, z + 10, lift + 16);
    const heel = projectHeight(half * f * 0.82, z, lift);
    const toe = projectHeight(half * f + f * 14, z - 26, lift - 10);
    if (!gripEnd || !heel || !toe) return;

    const pal = stickPalette(obs);
    ctx.save();
    ctx.globalAlpha = passAlpha(slip, heel.d);
    ctx.lineCap = "round";
    drawTipGlow(heel, pal, 1.6);

    // Shaft across the lane.
    ctx.strokeStyle = pal.shaft;
    ctx.lineWidth = Math.min(NEAR_W_CAP, Math.max(3, (6 + dive * 3) * heel.k));
    ctx.beginPath();
    ctx.moveTo(gripEnd.sx, gripEnd.sy);
    ctx.lineTo(heel.sx, heel.sy);
    ctx.stroke();

    // Blade angled toward us.
    ctx.strokeStyle = pal.blade;
    ctx.lineWidth = Math.min(NEAR_W_CAP, Math.max(4, (8 + dive * 6) * heel.k));
    ctx.beginPath();
    ctx.moveTo(heel.sx, heel.sy);
    ctx.lineTo(toe.sx, toe.sy);
    ctx.stroke();

    // Grip knob so the far end reads as a stick, not a bar.
    ctx.fillStyle = pal.blade;
    ctx.beginPath();
    ctx.arc(gripEnd.sx, gripEnd.sy, Math.max(2.5, 5 * gripEnd.k), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

  // Radial streaks from the vanishing point — the shove of a clean brace.
  function drawSpeedStreaks() {
    if (boostFx <= 0.02) return;
    const cx = W / 2;
    const cy = H * CAM.horizonFrac;
    const a = boostFx;
    ctx.strokeStyle = `rgba(225,248,255,${0.4 * a})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2 + (i % 3) * 0.35;
      const r0 = 70 + (1 - a) * 220;
      const r1 = r0 + 60 + 120 * a;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.55);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.55);
      ctx.stroke();
    }
  }

  function drawHitFlash(slit) {
    if (hitFlash <= 0.01) return;
    const a = hitFlash * hitFlash;
    const bottom = slit.y + slit.h;
    const tint = (alpha) => hitFlashPerfect
      ? `rgba(140,255,200,${alpha})`
      : `rgba(140,210,255,${alpha})`;

    // Light bleeds in from both letterbox edges — glow, not a lit frame.
    const band = Math.min(120, slit.h * 0.34);
    const topG = ctx.createLinearGradient(0, slit.y, 0, slit.y + band);
    topG.addColorStop(0, tint(0.5 * a));
    topG.addColorStop(1, tint(0));
    ctx.fillStyle = topG;
    ctx.fillRect(0, slit.y, W, band);

    const botG = ctx.createLinearGradient(0, bottom - band, 0, bottom);
    botG.addColorStop(0, tint(0));
    botG.addColorStop(1, tint(0.5 * a));
    ctx.fillStyle = botG;
    ctx.fillRect(0, bottom - band, W, band);
  }

  function drawSlitBody(slit) {
    // Letterbox: solid shell above and below, no rim anywhere.
    const bottom = slit.y + slit.h;
    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, W, slit.y);
    ctx.fillRect(0, bottom, W, H - bottom);

    // Cinematic falloff — the shell dissolves into the view instead of framing it.
    const topFade = Math.min(90, slit.h * 0.28);
    const topG = ctx.createLinearGradient(0, slit.y, 0, slit.y + topFade);
    topG.addColorStop(0, "rgba(5,8,14,0.96)");
    topG.addColorStop(0.35, "rgba(5,8,14,0.5)");
    topG.addColorStop(1, "rgba(5,8,14,0)");
    ctx.fillStyle = topG;
    ctx.fillRect(0, slit.y, W, topFade);

    const botFade = Math.min(130, slit.h * 0.34);
    const botG = ctx.createLinearGradient(0, bottom - botFade, 0, bottom);
    botG.addColorStop(0, "rgba(5,8,14,0)");
    botG.addColorStop(0.5, "rgba(5,8,14,0.34)");
    botG.addColorStop(1, "rgba(5,8,14,0.97)");
    ctx.fillStyle = botG;
    ctx.fillRect(0, bottom - botFade, W, botFade);

    // Low inertia bleeds red up from the lower edge instead of lighting a frame.
    if (mom < 0.2) {
      const a = 0.1 + (1 - mom / 0.2) * 0.28;
      const warnH = Math.min(110, slit.h * 0.3);
      const warnG = ctx.createLinearGradient(0, bottom - warnH, 0, bottom);
      warnG.addColorStop(0, "rgba(255,70,50,0)");
      warnG.addColorStop(1, `rgba(255,70,50,${a})`);
      ctx.fillStyle = warnG;
      ctx.fillRect(0, bottom - warnH, W, warnH);
    }
  }

  function drawDamageFlash(slit) {
    if (damageFlash <= 0) return;
    const a = damageFlash * 0.45;
    const g = ctx.createRadialGradient(
      slit.x + slit.w / 2,
      slit.y + slit.h / 2,
      slit.h * 0.1,
      slit.x + slit.w / 2,
      slit.y + slit.h / 2,
      slit.w * 0.55
    );
    g.addColorStop(0, `rgba(255,40,30,${a * 0.15})`);
    g.addColorStop(0.55, `rgba(180,20,20,${a * 0.35})`);
    g.addColorStop(1, `rgba(80,0,0,${a})`);
    slitPath(slit);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // Looking from inside the puck: leaning and trembling move the view, not a disc.
  function worldJitter() {
    const t = performance.now() / 1000;
    let jx = -braceLean * 0.5 + Math.sin(t * 25) * wobble * 4;
    let jy = 0;
    let roll = tilt;

    if (tremble > 0) {
      const e = tremble * tremble;
      jx += (Math.sin(t * 61) + Math.sin(t * 97) * 0.5) * 7 * e;
      jy += (Math.cos(t * 73) + Math.sin(t * 113) * 0.5) * 5 * e;
      roll += Math.sin(t * 44) * 0.03 * e;
    }
    return { jx, jy, roll };
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // Shell fill behind everything.
    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, W, H);

    const slit = slitRect();
    const { jx, jy, roll } = worldJitter();

    // World lives inside the band; the letterbox stays still.
    ctx.save();
    slitPath(slit);
    ctx.clip();

    ctx.save();
    ctx.translate(W / 2 + jx, H / 2 + jy);
    ctx.rotate(roll);
    ctx.translate(-W / 2, -H / 2);

    drawArenaStrip();
    drawFloor();
    drawLane();
    drawGoal();

    // Resolved sticks stay in frame so they visibly slide past, not blink out.
    const sorted = [...obstacles]
      .filter((o) => o.z > puck.z - 30 && slipProgress(o) < 1)
      .sort((a, b) => b.z - a.z);

    for (const obs of sorted) {
      if (obs.type === "cross") drawCross(obs);
      else drawStick(obs);
    }

    drawParticles();
    drawSpeedStreaks();
    ctx.restore();
    ctx.restore();

    drawSlitBody(slit);
    drawHitFlash(slit);
    drawDamageFlash(slit);
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
    if (tutorPaused) {
      if (code === "brace") tutorNext();
      return;
    }
    if (phase === "ready") {
      if (code === "brace") startRun();
      return;
    }
    if (phase !== "play") {
      // Between rounds the same button confirms the report.
      if (code === "brace") runContinue();
      return;
    }
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
    if (pendingContinue) {
      runContinue();
      return;
    }
    introEl.hidden = true;
    resetRun({ keepLives: false, keepStreak: false, keepGoals: false });
  });

  startBtn.addEventListener("click", () => startRun());

  // Blur first: a focused button would also react to the SPACE we use in play.
  tutorNextBtn.addEventListener("click", () => {
    tutorNextBtn.blur();
    tutorNext();
  });
  tutorSkipBtn.addEventListener("click", () => {
    tutorSkipBtn.blur();
    endTutor();
  });
  tutorAgainBtn.addEventListener("click", () => {
    tutorAgainBtn.blur();
    startRun(true);
  });
  window.addEventListener("resize", resize);

  resetGame();
  resize();
  requestAnimationFrame((ts) => {
    lastTs = ts;
    loop(ts);
  });
})();
