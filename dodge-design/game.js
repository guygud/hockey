(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const streakEl = document.getElementById("streak");
  const livesBoxEl = document.getElementById("lives-box");
  const heartEls = livesBoxEl
    ? Array.from(livesBoxEl.querySelectorAll(".heart"))
    : [];
  const braceFlash = document.getElementById("brace-flash");
  const statusEl = document.getElementById("status");
  const restartBtn = document.getElementById("restart-btn");
  const reportAltBtn = document.getElementById("report-alt");
  const introEl = document.getElementById("intro");
  const startBtn = document.getElementById("start-btn");
  const tutorHideBtn = document.getElementById("tutor-hide");
  const tutorAgainBtn = document.getElementById("tutor-again");
  const pauseBtn = document.getElementById("pause-btn");
  const pauseOverlay = document.getElementById("pause-overlay");
  const resumeBtn = document.getElementById("resume-btn");

  const CORRIDOR = { halfW: 200, ribStep: 60 };
  // Eye sits low over the ice; far covers the short track so the net is visible.
  // near is short so a braced stick stays in frame while it slides past the eye.
  // far reaches past RUN_DIST so the net is in frame from the first metre.
  const CAM = { height: 22, focal: 460, near: 6, far: 4400, horizonFrac: 0.42 };
  // Outside chase cam — used for the fly-in / goal / stall cinematics.
  // Keep x at 0 so the puck sits dead-centre in the fly-in / goal frames.
  const CAM_OUT = { back: 190, height: 86, x: 0 };
  // Viewing slit through the puck body — a full-width band, no side frame.
  const SLIT = {
    topAboveHorizon: 140,
    bottomFrac: 0.86,
    bottomFracTouch: 0.8,
    openMax: 14,
  };
  // Иллюминатор: кромки окна выгибаются дугой, корпус читается как стенка шайбы.
  const LENS = { bulgeFrac: 0.18, bulgeMax: 110, vignette: 0.5 };
  const MIN_SIDE_REDS = 2;
  const SPEED_LINES = {
    count: 26,
    centerGapFrac: 0.17, // середина кадра остаётся читаемой
    minMom: 0.15,
    lenFrac: 0.26,
    alpha: 0.5,
    rate: 1.5,
  };
  // Фейковое руление: шайба всё так же катится по центру, доворачивается сцена.
  // turn: 0 = смотрим в ворота, ±1 = максимально уведены в сторону.
  const TURN = {
    yawMax: (15 * Math.PI) / 180, // 15° за один шаг (|turn| = 1)
    maxSteps: 4, // подряд красные складываются: 15°, 30°, 45°, 60°
    rollMax: 0.02,
    driftMax: 22,
    iceShift: 120,
    spring: 22,
    damp: 7,
  };
  const RUN_DIST = 4000;
  // Goal counts at the crease; last stick stays well before it.
  const CREASE_BACK = 200;
  const FINAL_STICK_BACK = 420;
  const INTRO_HOLD = 0.3;
  const INTRO_DIVE = 0.45;
  // Goal cam: snap outside, then rush the puck into the twine — no slow-mo crawl.
  const GOAL_POP = 0.14;
  const GOAL_RUSH = 2.55;
  const GOAL_REPORT_AT = 0.95;
  const STALL_CAM_DUR = 1.2;
  const MAX_LIVES = 3;
  const SPEED_MIN = 130;
  const SPEED_MAX = 530;
  // Display scale: SPEED_MAX ≈ world-record slapshot (~170 km/h).
  const SPEED_KMH_SCALE = 170 / SPEED_MAX;

  // ---- Stick look (tweak these) ----
  // Angles are degrees on screen. 0 = horizontal.
  // Positive value = handle raised above the blade (toward the top of the screen).
  // swing goes 0 (just appeared) → 1 (at the strike / "stopped").
  const STICK = {
    angleAppearDeg: -45, // tilt when the stick first shows up
    angleStopDeg: -32, // tilt when it reaches the strike pose
    crossAppearDeg: -28, // same for the dual-red SPACE obstacle
    crossStopDeg: -18,
    worldLen: 270, // sprite length in world units (scales with distance)
    maxScreenFrac: 1.82, // cap: never wider than this fraction of the view
    tipHeight: -10, // blade height above the ice
    tipZOffset: -1, // blade depth offset from obstacle.z
  };
  // Goal net. Positive yDownFrac = lower on screen (fraction of goal height).
  const GOAL = {
    yDownFrac: 0.3,
    postHeight: 110,
  };
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
  // Shared by side sticks and frontal crosses — same clock, same windows.
  const WINDOW_OPEN = 1.05;
  const PERFECT = 0.14;
  const GOOD = 0.32;
  const INTERVAL_START = 1.6;
  const INTERVAL_END = 1.05;
  // Every attempt in the same life bank ramps up, then plateaus at MAX_LEVEL.
  const MAX_LEVEL = 8;
  const DRAIN_RAMP = 0.55;
  const GAP_RAMP = 0.3;
  const WINDOW_RAMP = 0.22;
  // Scripted onboarding: long track, slow pace, wide windows, then a 6-stick exam.
  const TUTOR_DIST = 8000;
  const TUTOR_CUE_LEAD = 1.9;
  const TUTOR_WIN_MUL = 1.9;
  const TUTOR_SPEED = 300;
  const TUTOR_PRACTICE_GAP = 2.8;
  const TUTOR_PASS = 5;
  const TUTOR_SPAWN_LEAD = 2.4;
  const GRADE_FLASH_TIME = 0.55;
  const TREMBLE_DECAY = 1.7;
  // How far past the hit line a resolved stick keeps sliding by.
  const SLIP_SPAN = 160;
  const NEAR_W_CAP = 56;
  const CONFIRM_DELAY = 450;
  // Brief look glance on press — view only, puck keeps skating straight.
  const GLANCE_X = 20;
  const GLANCE_ROLL = 0.034;
  const GLANCE_Y = 12;
  const GLANCE_DECAY = 11;

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
  let phase; // ready | play | scored | missed | stalled | goalcam | stallcam
  let runDist;
  let tilt;
  let turn;
  let turnVel;
  let turnTarget;
  let braceLean;
  let glanceX;
  let glanceY;
  let glanceRoll;
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
  // 0 = eye inside the puck, 1 = chase cam outside. Cinema drives this.
  let outside;
  let cinema; // { mode, t, ... } | null
  let netFlash;
  let lastSpawnZ;
  let finalSpawned;
  let sideRedSpawned;
  let gradeFlashTimer;
  let gradeFlashText;
  let gradeFlashClass;
  let runStats;
  let attempt = 1;
  let level = 0;
  let pendingContinue = null;
  let confirmAt = 0;
  let tutorOn = false;
  let tutorStage = 0;
  let tutorTimer = 0;
  let tutorMode = "off"; // off | script | practice
  let tutorPause = null; // { mode, title, body, pointGrip?, obs? }
  let tutorActObs = null;
  let tutorWatchObs = null;
  let tutorPracticeIdx = 0;
  let tutorTaught = 0;
  let tutorOk = 0;
  let pendingAlt = null;
  let paused = false;

  const tutorEl = document.getElementById("tutor");
  const tutorTitleEl = document.getElementById("tutor-title");
  const tutorBodyEl = document.getElementById("tutor-body");
  const tutorHintEl = document.getElementById("tutor-hint");
  const tutorCardEl = tutorEl ? tutorEl.querySelector(".tutor-card") : null;
  const hudStatsEl = document.querySelector(".hud-stats");
  const levelNumEl = document.getElementById("level-num");
  const speedEl = document.getElementById("speed");

  // Neon art pack — paths are relative to dodge/index.html.
  const ASSET_SRC = {
    blueLeft: "../assets/blue-left.png",
    blueRight: "../assets/blue-right.png",
    redLeft: "../assets/red-left.png",
    redRight: "../assets/red_right.png",
    puck: "../assets/puck.png",
    ice: "../assets/ice.png",
    iceColor: "../assets/ice-color.png",
    iceColor2: "../assets/ice-color2.png",
    gate: "../assets/gate.svg",
    board: "../assets/board.svg",
    borderTop: "../assets/border-top.png",
    signal: "../assets/signal.svg",
    hit: "../assets/hit.png",
  };
  const imgs = {};
  for (const [key, src] of Object.entries(ASSET_SRC)) {
    const img = new Image();
    img.src = src;
    imgs[key] = img;
  }
  function imgReady(img) {
    return !!(img && img.complete && img.naturalWidth > 0);
  }

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

  function sfxFlyIn() {
    swish(0.42, 0.14, 900, 0.55);
    tone(220, 520, 0.28, 0.06, "sine");
  }

  function sfxCrease() {
    tone(660, 880, 0.08, 0.07, "sine");
  }

  function createPuck() {
    return { x: 0, z: 40, vz: speedFor(MOM_START) };
  }

  // 1 on the first attempt, ~0.7 on the second, then off. Softens the onboarding
  // runs hard so the player learns colours before the real pacing kicks in.
  function earlyEase() {
    if (level <= 0) return 1;
    if (level <= 1) return 0.7;
    return 0;
  }

  function pickSide() {
    const ease = earlyEase();
    // Almost no frontal sticks on L0, few on L1 — side passes/dodges first.
    const frontal = 0.2 * (1 - 0.9 * ease);
    const r = Math.random();
    if (r < (1 - frontal) * 0.5) return -1;
    if (r < 1 - frontal) return 1;
    return 0;
  }

  // Frontal sticks are always hostile; side sticks split between team and foe,
  // and the foe share grows with the difficulty level.
  function pickFoe(side) {
    if (side === 0) return true;
    const share = (FOE_SHARE + FOE_RAMP * levelMix()) * (1 - 0.85 * earlyEase());
    return Math.random() < share;
  }

  // Practice exam after the scripted lesson: two of each answer, generous gaps.
  const TUTOR_PRACTICE = [
    { side: null, foe: false },
    { side: null, foe: true },
    { side: 0, foe: true },
    { side: null, foe: false },
    { side: null, foe: true },
    { side: 0, foe: true },
  ];

  // Step kinds: say (pause + any key), spawn, watch (demo collision), act
  // (freeze at perfect timing + required key), practice (free play exam).
  const TUTOR_SCRIPT = [
    {
      kind: "say",
      delay: 0.8,
      title: "СКОРОСТЬ",
      body: "Чтобы докатиться до ворот, скорость не должна падать до нуля. Следи за числом км/ч сверху.",
      pointGrip: true,
    },
    { kind: "spawn", side: null, foe: true, demo: true },
    {
      kind: "say",
      title: "ЧУЖАЯ КЛЮШКА",
      body: "Если просто ударишься о клюшку — потеряешь скорость.",
      revealT: 1.55,
    },
    { kind: "watch" },
    { kind: "spawn", side: null, foe: false },
    {
      kind: "say",
      title: "СВОЯ КЛЮШКА",
      body: "Чтобы набрать скорость, бейся о клюшки своей команды.",
      revealT: 1.55,
    },
    {
      kind: "act",
      title: "ИДЕАЛЬНЫЙ ОТСКОК",
      body: "Жди вспышку блика на льду — потом жми в сторону своей клюшки.",
    },
    { kind: "spawn", side: 0, foe: true },
    {
      kind: "act",
      title: "ПРЫЖОК",
      body: "Две красные с двух сторон — на вспышке блика прыгай.",
    },
    { kind: "spawn", side: null, foe: true },
    {
      kind: "act",
      title: "УВОРОТ",
      body: "На вспышке блика — уходи в другую сторону.",
    },
    {
      kind: "say",
      title: "ТЕПЕРЬ САМ",
      body: "Дальше без пауз. Две свои, две чужие сбоку и два двойных красных — с запасом времени.",
      refill: true,
    },
    { kind: "practice" },
  ];

  function nextSpawn() {
    const need = Math.max(0, MIN_SIDE_REDS - sideRedSpawned);
    if (need > 0) {
      const finalZ = runDist - FINAL_STICK_BACK;
      const minApproach = Math.max(400, Math.max(puck.vz, SPEED_MIN) * 1.3);
      const lead = Math.max(puck.vz, SPEED_MIN) * spawnInterval();
      const nextZ = Math.max(lastSpawnZ + 80, puck.z + lead);
      const room = finalZ - minApproach - nextZ;
      const slotsAfter = Math.max(0, Math.floor(room / Math.max(80, lead)));
      const slotsIncluding = slotsAfter + 1;
      const progress = puck.z / Math.max(runDist, 1);
      const late = (sideRedSpawned === 0 && progress > 0.25)
        || (sideRedSpawned === 1 && progress > 0.55);
      if (late || slotsIncluding <= need) {
        return { side: resolveSpawnSide(null), foe: true };
      }
    }
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

  function makeObstacle(z, side, foe, opts = {}) {
    return {
      z,
      side,
      foe,
      want: wantedInput(side, foe),
      type: side === 0 ? "cross" : "stick",
      resolved: false,
      ok: false,
      // lesson: brighter ice glow. free: fumble costs no inertia.
      // demo: auto-collision, inputs ignored. practice: counts toward the exam.
      lesson: !!opts.lesson,
      free: !!opts.free,
      demo: !!opts.demo,
      practice: !!opts.practice,
      flip: Math.random() < 0.5 ? -1 : 1,
      answer: null,
      windowOpen: false,
      final: !!opts.final,
    };
  }

  // 0 on the first attempt, 1 once the ramp plateaus.
  function levelMix() {
    return Math.min(level, MAX_LEVEL) / MAX_LEVEL;
  }

  function drainRate() {
    // Scripted lesson freezes the bar so the demo hit is the only visible drop.
    if (tutorOn && tutorMode !== "practice") return 0;
    const ease = earlyEase();
    return MOM_DRAIN * (1 + DRAIN_RAMP * levelMix()) * (1 - 0.8 * ease);
  }

  function perfectWin() {
    return PERFECT * (1 - WINDOW_RAMP * levelMix()) * (1 + 1.35 * earlyEase());
  }

  function goodWin() {
    return GOOD * (1 - WINDOW_RAMP * levelMix()) * (1 + 1.15 * earlyEase());
  }

  // A coached stick is forgiving: the same rules, just a wider moment to hit.
  function winMul(obs) {
    return obs && obs.lesson ? TUTOR_WIN_MUL : 1;
  }

  // Shared timing model for input grading and the ice-glow under a stick.
  function timingBounds(obs) {
    const mul = winMul(obs);
    const ease = earlyEase();
    return {
      open: WINDOW_OPEN * (1 + 0.45 * ease),
      perfect: perfectWin() * mul,
      good: goodWin() * mul,
    };
  }

  // phase: approach (good window ahead), perfect, late, or null if out of range.
  // intensity 0..1 peaks at the centre of the current phase.
  function timingPhase(obs) {
    const t = timeToHit(obs);
    const b = timingBounds(obs);
    if (t > b.open || t < -b.good) {
      return { phase: null, t, intensity: 0, bounds: b };
    }
    if (Math.abs(t) <= b.perfect) {
      return {
        phase: "perfect",
        t,
        intensity: 1 - Math.abs(t) / Math.max(b.perfect, 0.001),
        bounds: b,
      };
    }
    if (t > 0) {
      // From first visible approach down to the perfect rim.
      const span = Math.max(b.open - b.perfect, 0.001);
      const intensity = Math.max(0, Math.min(1, 1 - (t - b.perfect) / span));
      return { phase: "approach", t, intensity, bounds: b };
    }
    // Past the perfect rim, still inside the good window — late.
    const span = Math.max(b.good - b.perfect, 0.001);
    const intensity = Math.max(0, Math.min(1, 1 - (-t - b.perfect) / span));
    return { phase: "late", t, intensity, bounds: b };
  }

  function spawnInterval() {
    if (tutorOn && tutorMode === "practice") return TUTOR_PRACTICE_GAP;
    const t = Math.max(0, Math.min(1, puck.z / runDist));
    const base = INTERVAL_START + (INTERVAL_END - INTERVAL_START) * t;
    return base * (1 - GAP_RAMP * levelMix()) * (1 + 1.1 * earlyEase());
  }

  function resolveSpawnSide(side) {
    if (side === null || side === undefined) return Math.random() < 0.5 ? -1 : 1;
    return side;
  }

  function tutorSpawnStick(spec) {
    const lead = Math.max(puck.vz, SPEED_MIN) * TUTOR_SPAWN_LEAD;
    const nextZ = Math.max(lastSpawnZ + 120, puck.z + lead);
    const side = resolveSpawnSide(spec.side);
    const obs = makeObstacle(nextZ, side, !!spec.foe, {
      lesson: !spec.practice,
      free: !!spec.practice,
      demo: !!spec.demo,
      practice: !!spec.practice,
    });
    obstacles.push(obs);
    lastSpawnZ = nextZ;
    return obs;
  }

  function maybeSpawnPractice() {
    if (tutorPracticeIdx >= TUTOR_PRACTICE.length) return;
    if (obstacles.some((o) => !o.resolved && o.z > puck.z - 40)) return;
    const lead = Math.max(puck.vz, SPEED_MIN) * TUTOR_PRACTICE_GAP;
    const nextZ = Math.max(lastSpawnZ + 120, puck.z + lead);
    const spec = TUTOR_PRACTICE[tutorPracticeIdx];
    obstacles.push(
      makeObstacle(nextZ, resolveSpawnSide(spec.side), !!spec.foe, {
        lesson: false,
        free: true,
        practice: true,
      })
    );
    lastSpawnZ = nextZ;
    tutorPracticeIdx += 1;
  }

  function maybeSpawnObstacles() {
    // Tutorial owns its own spawns — no random sticks and no final goalie bar.
    if (tutorOn) {
      if (tutorMode === "practice") maybeSpawnPractice();
      return;
    }

    // One strike at a time — no corridor full of parked sticks.
    if (obstacles.some((o) => !o.resolved && o.z > puck.z - 40)) return;
    if (finalSpawned) return;

    const finalZ = runDist - FINAL_STICK_BACK;
    const lead = Math.max(puck.vz, SPEED_MIN) * spawnInterval();
    const nextZ = Math.max(lastSpawnZ + 80, puck.z + lead);
    // Keep the corridor before the crease clear — the last stick must land
    // before the goal cam kicks in.
    const minApproach = Math.max(400, Math.max(puck.vz, SPEED_MIN) * 1.3);

    if (nextZ >= finalZ - minApproach) {
      if (sideRedSpawned < MIN_SIDE_REDS) {
        const redZ = Math.min(finalZ - 80, Math.max(lastSpawnZ + 80, nextZ));
        if (redZ < runDist - CREASE_BACK) {
          obstacles.push(makeObstacle(redZ, resolveSpawnSide(null), true));
          sideRedSpawned += 1;
          lastSpawnZ = redZ;
          return;
        }
      }
      // Последняя — всегда свой пас: приняв его, выкатываемся ровно на ворота.
      obstacles.push(makeObstacle(finalZ, resolveSpawnSide(null), false, { final: true }));
      lastSpawnZ = finalZ;
      finalSpawned = true;
      return;
    }

    const spawn = nextSpawn();
    obstacles.push(makeObstacle(nextZ, spawn.side, spawn.foe));
    if (spawn.foe && spawn.side !== 0) sideRedSpawned += 1;
    lastSpawnZ = nextZ;
  }

  function renderLives() {
    for (let i = 0; i < heartEls.length; i++) {
      const filled = i < lives;
      heartEls[i].classList.toggle("filled", filled);
      heartEls[i].classList.toggle("empty", !filled);
    }
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

    runDist = tutorOn ? TUTOR_DIST : RUN_DIST;
    mom = MOM_START;
    if (!keepStreak) streak = 0;
    if (!keepLives) lives = MAX_LIVES;
    puck = createPuck();
    obstacles = [];
    particles = [];
    tilt = 0;
    turn = 0;
    turnVel = 0;
    turnTarget = 0;
    braceLean = 0;
    glanceX = 0;
    glanceY = 0;
    glanceRoll = 0;
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
    netFlash = 0;
    outside = 1;
    cinema = { mode: "intro", t: 0, whoosh: false };
    setCinemaActive(true);
    runStats = { perfect: 0, good: 0, wrong: 0, missed: 0, passes: 0, dodges: 0 };
    tutorStage = 0;
    tutorTimer = 0;
    tutorMode = tutorOn ? "script" : "off";
    tutorPause = null;
    tutorActObs = null;
    tutorWatchObs = null;
    tutorPracticeIdx = 0;
    tutorTaught = 0;
    tutorOk = 0;
    lastSpawnZ = 280;
    finalSpawned = false;
    sideRedSpawned = 0;
    gradeFlashTimer = 0;
    gradeFlashText = "";
    gradeFlashClass = "";
    pendingInputs = [];
    framePresses = [];
    phase = "play";
    if (!opts.keepGoals) goals = 0;
    pendingContinue = null;
    pendingAlt = null;
    setPaused(false);
    tutorHideBtn.hidden = !tutorOn;
    hideTutorCard();
    statusEl.hidden = true;
    statusEl.className = "";
    restartBtn.hidden = true;
    reportAltBtn.hidden = true;
    braceFlash.hidden = true;
    braceFlash.className = "";
    maybeSpawnObstacles();
    updateHud();
  }

  // The intro owns the whole screen: the HUD hides so it cannot show through.
  function showIntro(visible) {
    introEl.hidden = !visible;
    document.body.classList.toggle("intro-open", visible);
    if (visible) setPaused(false);
  }

  function resetGame() {
    // Back to the intro: hints stay unfinished, so the next run coaches again.
    tutorOn = false;
    resetRun({ keepLives: false, keepStreak: false, keepGoals: false });
    phase = "ready";
    cinema = null;
    outside = 0;
    setCinemaActive(false);
    showIntro(true);
    tutorAgainBtn.hidden = !tutorSeen();
  }

  function startRun(withTutor) {
    ensureAudio();
    showIntro(false);
    tutorOn = withTutor === undefined ? !tutorSeen() : !!withTutor;
    resetRun({ keepLives: false, keepStreak: false, keepGoals: false });
    phase = "play";
  }

  function updateHud() {
    if (streakEl) streakEl.textContent = String(streak);
    renderLives();
    if (levelNumEl) levelNumEl.textContent = String(level + 1);
    if (speedEl) {
      speedEl.textContent = (Math.max(puck.vz, 0) * SPEED_KMH_SCALE).toFixed(1);
    }
    if (pauseBtn) {
      const canPause = phase === "play" && !cinema && !tutorPause;
      pauseBtn.hidden = !canPause && !paused;
      pauseBtn.disabled = !canPause && !paused;
    }
  }

  function setPaused(on) {
    if (on === paused) return;
    if (on) {
      if (phase !== "play" || cinema || tutorPause) return;
      paused = true;
      if (pauseOverlay) pauseOverlay.hidden = false;
      document.body.classList.add("paused");
    } else {
      paused = false;
      if (pauseOverlay) pauseOverlay.hidden = true;
      document.body.classList.remove("paused");
      lastTs = performance.now();
    }
    updateHud();
  }

  function togglePause() {
    setPaused(!paused);
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

  function easeInOut(t) {
    const u = Math.max(0, Math.min(1, t));
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  }

  function setCinemaActive(on) {
    document.body.classList.toggle("cinema", !!on);
    if (on) setPaused(false);
    updateHud();
  }

  // outside 0 = eye inside the puck, 1 = chase cam over the ice.
  function camRig() {
    const e = easeInOut(outside);
    return {
      back: camZ + CAM_OUT.back * e,
      x: CAM_OUT.x * e,
      h: CAM.height + (CAM_OUT.height - CAM.height) * e + camBoost,
    };
  }

  function clampTurn(v) {
    return Math.max(-TURN.maxSteps, Math.min(TURN.maxSteps, v));
  }
  // Во время кинематографичных камер доворот гасится, чтобы влёт и гол были по центру.
  function turnMix() {
    return 1 - easeInOut(outside);
  }
  function turnYaw() {
    return turn * TURN.yawMax * turnMix();
  }
  function turnDrift() {
    return turn * TURN.driftMax * turnMix();
  }
  function turnShiftPx() {
    return -turn * TURN.iceShift * turnMix();
  }
  function headingAway(side) {
    // Красная слева уводит вправо, справа — влево: нос уходит с линии ворот.
    return side < 0 ? 1 : -1;
  }

  function project(x, z, withTurn) {
    const rig = camRig();
    const yaw = withTurn ? turnYaw() : 0;
    const dx = x - rig.x - (withTurn ? turnDrift() : 0);
    const dz = z - puck.z + rig.back;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const rx = dx * c - dz * s;
    const d = dx * s + dz * c;
    if (d < CAM.near || d > CAM.far) return null;
    const k = CAM.focal / d;
    return {
      sx: W / 2 + rx * k,
      sy: H * CAM.horizonFrac + rig.h * k,
      k,
      d,
    };
  }

  function isTouchUi() {
    return document.body.classList.contains("touch-ui");
  }

  function slitRect() {
    const open = slitOpen;
    const e = easeInOut(outside);
    // Inside: the puck slit. Outside: a wide cinematic frame that opens up.
    const inTop = H * CAM.horizonFrac - SLIT.topAboveHorizon - open * 0.35;
    const bottomFrac = isTouchUi() ? SLIT.bottomFracTouch : SLIT.bottomFrac;
    const inBottom = H * bottomFrac + open * 0.65;
    const outTop = H * 0.08;
    const outBottom = H * 0.92;
    const top = inTop + (outTop - inTop) * e;
    const bottom = inBottom + (outBottom - inBottom) * e;
    return {
      x: 0,
      y: Math.max(0, top),
      w: W,
      h: Math.max(40, bottom - top),
    };
  }

  function lensBulge(slit) {
    // На кинематографичных камерах (outside = 1) дуга разглаживается в леттербокс.
    return Math.min(LENS.bulgeMax, slit.h * LENS.bulgeFrac) * (1 - easeInOut(outside));
  }

  function lensOutline(slit) {
    const b = lensBulge(slit);
    const top = slit.y;
    const bottom = slit.y + slit.h;
    if (b <= 0.5) {
      ctx.rect(slit.x, slit.y, slit.w, slit.h);
      return;
    }
    ctx.moveTo(0, top);
    ctx.quadraticCurveTo(W / 2, top + b, W, top);
    ctx.lineTo(W, bottom);
    ctx.quadraticCurveTo(W / 2, bottom - b, 0, bottom);
    ctx.closePath();
  }

  function slitPath(slit) {
    ctx.beginPath();
    lensOutline(slit);
  }

  function projectHeight(x, z, worldH, withTurn) {
    const p = project(x, z, withTurn);
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

  function speedFor(m) {
    let v = SPEED_MIN + m * (SPEED_MAX - SPEED_MIN);
    if (tutorOn) v = Math.min(v, TUTOR_SPEED);
    const ease = earlyEase();
    if (ease > 0) {
      // L0 ~340, L1 ~390 — readable pace before the full launch speed.
      const cap = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * (0.45 + 0.2 * (1 - ease));
      v = Math.min(v, cap);
    }
    return v;
  }

  function applyMom(delta) {
    mom = Math.max(0, Math.min(1, mom + delta));
    puck.vz = speedFor(mom);
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
      if (dodged) {
        // Каждая красная подряд добавляет ещё 15° от линии ворот.
        turnTarget = clampTurn(turnTarget + headingAway(obs.side));
      } else {
        // Свой пас возвращает нос на линию ворот.
        turnTarget = 0;
      }
    }
    if (obs.final) turnTarget = 0;

    if (dodged) sfxDodge(perfect);
    else sfxHit(perfect);
    if (obs.practice) tutorTaughtOne(true);
    updateHud();
  }

  function resolveFail(obs, reason) {
    if (obs.resolved) return;
    obs.resolved = true;
    obs.ok = false;

    // Any mistake costs the same half bar — the rule stays readable at speed.
    if (!obs.free) applyMom(-MISS_COST);
    if (obs.demo) {
      showGrade("УДАР — СКОРОСТЬ ПАДАЕТ", "grade-miss");
    } else if (reason === "wrong") {
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
    if (obs.foe && obs.side !== 0) {
      turnTarget = clampTurn(turnTarget + headingAway(obs.side));
    }
    if (obs.final) turnTarget = 0;
    spawnSparks(6);
    sfxFail();
    if (obs.practice) tutorTaughtOne(false);
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
    // Demo stick must land by itself — inputs are ignored until the collision.
    if (obs && obs.demo) return;

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
    const b = timingBounds(obs);

    // Too early with the right move: don't punish it, wait for the window.
    if (pressed === obs.want && t > b.good) {
      showGrade("РАНО", "grade-whiff");
      return;
    }

    if (pressed !== obs.want) {
      obs.answer = pressed;
      resolveFail(obs, "wrong");
      return;
    }

    obs.answer = pressed;
    if (absT <= b.perfect) {
      resolveSuccess(obs, "perfect");
    } else if (absT <= b.good) {
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
      const b = timingBounds(obs);
      const late = -b.good;

      if (t < b.open && t > late) {
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
      startStallCam();
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

  function nudgeLook(code) {
    if (code === "left") {
      glanceX = -GLANCE_X;
      glanceY = 0;
      glanceRoll = -GLANCE_ROLL;
    } else if (code === "right") {
      glanceX = GLANCE_X;
      glanceY = 0;
      glanceRoll = GLANCE_ROLL;
    } else {
      // Jump: a short look up — content shifts down in the frame.
      glanceX = 0;
      glanceY = GLANCE_Y;
      glanceRoll = 0;
    }
  }

  function updateFx(dt) {
    tilt *= 0.88;
    turnVel += ((turnTarget - turn) * TURN.spring - turnVel * TURN.damp) * dt;
    turn += turnVel * dt;
    turn = clampTurn(turn);
    braceLean *= Math.pow(0.08, dt);
    if (Math.abs(braceLean) < 0.2) braceLean = 0;
    const glanceFade = Math.exp(-GLANCE_DECAY * dt);
    glanceX *= glanceFade;
    glanceY *= glanceFade;
    glanceRoll *= glanceFade;
    if (Math.abs(glanceX) < 0.15) glanceX = 0;
    if (Math.abs(glanceY) < 0.15) glanceY = 0;
    if (Math.abs(glanceRoll) < 0.0005) glanceRoll = 0;
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
    if (level <= 0) return "Первые два заезда — учебные: больше своих, шире окно, спокойный темп.";
    if (level <= 1) return "Ещё один мягкий заезд — дальше темп и чужие клюшки подтянутся.";
    return "Следующая попытка: чужих клюшек больше, окно уже, инерция тает быстрее.";
  }

  // Round always ends on a report the player dismisses — never auto-restarts.
  function showReport(opts) {
    const rows = opts.rows || reportRows();
    braceFlash.hidden = true;
    statusEl.hidden = false;
    statusEl.className = opts.cls;
    statusEl.innerHTML =
      `<div class="report-title">${opts.title}</div>` +
      `<div class="report-rows">` +
      rows
        .map(([k, v]) => `<div class="report-row"><span>${k}</span><b>${v}</b></div>`)
        .join("") +
      `</div>` +
      (opts.note ? `<div class="report-note">${opts.note}</div>` : "");
    restartBtn.hidden = false;
    restartBtn.textContent = opts.btnLabel;
    pendingContinue = opts.action;
    pendingAlt = opts.altAction || null;
    reportAltBtn.hidden = !opts.altLabel;
    if (opts.altLabel) reportAltBtn.textContent = opts.altLabel;
    confirmAt = performance.now() + CONFIRM_DELAY;
  }

  function runContinue() {
    if (!pendingContinue) return;
    if (performance.now() < confirmAt) return;
    const next = pendingContinue;
    pendingContinue = null;
    pendingAlt = null;
    next();
  }

  function runAlternative() {
    if (!pendingAlt) return;
    if (performance.now() < confirmAt) return;
    const next = pendingAlt;
    pendingContinue = null;
    pendingAlt = null;
    next();
  }

  function creaseZ() {
    return runDist - CREASE_BACK;
  }

  function startGoalCam() {
    if (phase !== "play" || tutorOn) return;
    phase = "goalcam";
    streak += 1;
    goals += 1;
    sfxCrease();
    // Floor the rush speed so a soft finish still looks like a slapshot.
    cinema = {
      mode: "goal",
      t: 0,
      flightVz: Math.max(puck.vz * 1.25, SPEED_MIN * 1.8, 420),
      hitNet: false,
    };
    setCinemaActive(true);
    pendingInputs.length = 0;
    braceFlash.hidden = true;
    // Kick the eye out immediately so the puck is already in frame.
    camZVel += 180;
    slitOpenVel += 90;
    updateHud();
  }

  function finishGoalReport() {
    phase = "scored";
    showReport({
      title: `ГОЛ! Серия ${streak}`,
      cls: "report-good",
      btnLabel: "Следующая атака →",
      action: () => resetRun({ keepLives: true, keepStreak: true, keepGoals: true }),
      note: nextAttemptNote(),
    });
  }

  function startStallCam() {
    if (phase !== "play") return;
    phase = "stallcam";
    sfxStall();
    cinema = { mode: "stall", t: 0 };
    setCinemaActive(true);
    pendingInputs.length = 0;
    braceFlash.hidden = true;
  }

  function finishStalled() {
    lives = Math.max(0, lives - 1);

    if (lives <= 0) {
      phase = "stalled";
      const finalGoals = goals;
      streak = 0;
      updateHud();
      showReport({
        title: `ЖИЗНИ КОНЧИЛИСЬ · голов ${finalGoals}`,
        cls: "report-bad",
        btnLabel: "Начать заново",
        action: () => resetRun({ keepLives: false, keepStreak: false, keepGoals: false }),
        note: "Сложность сбросится на первую попытку.",
      });
      return;
    }

    phase = "missed";
    updateHud();
    showReport({
      title: "ИНЕРЦИЯ КОНЧИЛАСЬ",
      cls: "report-bad",
      btnLabel: "Ещё попытка →",
      action: () => resetRun({ keepLives: true, keepStreak: true, keepGoals: true }),
      note: nextAttemptNote(),
    });
  }

  // Returns "intro" while the fly-in owns the frame, "block" for end cinematics,
  // or null when the normal play loop should run.
  function updateCinema(dt) {
    if (!cinema) return null;
    cinema.t += dt;
    pendingInputs.length = 0;

    if (cinema.mode === "intro") {
      if (cinema.t < INTRO_HOLD) {
        outside = 1;
      } else if (cinema.t < INTRO_HOLD + INTRO_DIVE) {
        if (!cinema.whoosh) {
          cinema.whoosh = true;
          sfxFlyIn();
        }
        outside = 1 - easeInOut((cinema.t - INTRO_HOLD) / INTRO_DIVE);
      } else {
        outside = 0;
        cinema = null;
        setCinemaActive(false);
      }
      return "intro";
    }

    if (cinema.mode === "goal") {
      // Hard pop to the chase cam, then accelerate into the net.
      outside = Math.min(1, easeInOut(cinema.t / GOAL_POP) * 1.15);
      const accel = 0.85 + 1.4 * Math.min(1, cinema.t / 0.22);
      puck.z += cinema.flightVz * GOAL_RUSH * accel * dt;
      if (!cinema.hitNet && puck.z >= runDist) {
        cinema.hitNet = true;
        cinema.hitAt = cinema.t;
        sfxGoal();
        netFlash = 1;
        hitFlash = 1;
        hitFlashPerfect = true;
        boostFx = 1;
        camZVel += 220;
        camBoostVel += 260;
        spawnSparks(36);
      }
      // Tiny settle past the line so the impact reads before the report.
      if (cinema.hitNet && puck.z < runDist + 70) {
        puck.z += cinema.flightVz * 0.35 * dt;
      }
      updateParticles(dt);
      updateFx(dt);
      netFlash = Math.max(0, netFlash - dt * 2.4);
      updateHud();
      const reportAt = cinema.hitNet
        ? Math.min(GOAL_REPORT_AT, (cinema.hitAt || 0) + 0.45)
        : GOAL_REPORT_AT;
      if (cinema.t >= reportAt) {
        cinema = null;
        setCinemaActive(false);
        finishGoalReport();
      }
      return "block";
    }

    if (cinema.mode === "stall") {
      outside = easeInOut(Math.min(1, cinema.t / STALL_CAM_DUR));
      puck.vz = Math.max(0, puck.vz * Math.pow(0.05, dt));
      puck.z += puck.vz * dt;
      updateParticles(dt);
      updateFx(dt);
      updateHud();
      if (cinema.t >= STALL_CAM_DUR) {
        cinema = null;
        setCinemaActive(false);
        finishStalled();
      }
      return "block";
    }

    return null;
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

  // One vocabulary everywhere: A / D / SPACE (arrows and taps still work).
  function cueKey(kind) {
    if (kind === "left") return "A";
    if (kind === "right") return "D";
    return "SPACE";
  }

  function cueWord(kind) {
    if (kind === "left") return "ВЛЕВО";
    if (kind === "right") return "ВПРАВО";
    return "ПРЫЖОК";
  }

  function cueCaption(obs) {
    if (obs.side === 0) return "ДВЕ КРАСНЫЕ — ПРЫЖОК";
    return obs.foe ? "ЧУЖАЯ — УХОДИ В ДРУГУЮ" : "СВОЯ — ПОДСТАВЬСЯ";
  }

  function hideTutorCard() {
    if (tutorEl) tutorEl.hidden = true;
    if (tutorCardEl) tutorCardEl.classList.remove("tutor-card--top");
    tutorPause = null;
    updateHud();
  }

  function showTutorCard(step, opts = {}) {
    if (!tutorEl) return;
    braceFlash.hidden = true;
    tutorTitleEl.textContent = step.title || "";
    tutorBodyEl.textContent = step.body || "";
    if (opts.mode === "act") {
      tutorHintEl.textContent = "Нажми A, D или SPACE — как на подсказке";
      if (tutorCardEl) tutorCardEl.classList.add("tutor-card--top");
    } else {
      tutorHintEl.textContent = "Нажми любую кнопку (A / D / SPACE)";
      if (tutorCardEl) tutorCardEl.classList.remove("tutor-card--top");
    }
    tutorEl.hidden = false;
  }

  function openTutorSay(step) {
    tutorPause = {
      mode: "say",
      title: step.title,
      body: step.body,
      pointGrip: !!step.pointGrip,
      refill: !!step.refill,
    };
    showTutorCard(step, { mode: "say" });
    pendingInputs.length = 0;
    setPaused(false);
    updateHud();
  }

  function openTutorAct(step, obs) {
    tutorPause = {
      mode: "act",
      title: step.title,
      body: step.body,
      obs,
    };
    showTutorCard(step, { mode: "act" });
    pendingInputs.length = 0;
    setPaused(false);
    updateHud();
  }

  function tutorAdvance() {
    tutorStage += 1;
    tutorTimer = 0;
  }

  function dismissTutorSay() {
    const pause = tutorPause;
    hideTutorCard();
    if (pause && pause.refill) {
      mom = MOM_START;
      puck.vz = speedFor(mom);
      updateHud();
    }
    tutorAdvance();
  }

  // True while a coached stick is approaching its freeze point — swallow taps.
  function tutorSwallowInputs() {
    if (!tutorOn || tutorMode !== "script" || tutorPause) return false;
    const step = TUTOR_SCRIPT[tutorStage];
    if (!step) return false;
    if (step.kind === "act") return true;
    if (step.kind === "watch") return true;
    if (step.kind === "say" && (step.delay || 0) > 0 && tutorTimer < step.delay) return false;
    return false;
  }

  function tutorPauseInput() {
    if (pendingInputs.length === 0) return;
    const presses = pendingInputs.splice(0, pendingInputs.length);
    if (!tutorPause) return;

    if (tutorPause.mode === "say") {
      dismissTutorSay();
      return;
    }

    if (tutorPause.mode === "act") {
      const want = tutorPause.obs && tutorPause.obs.want;
      if (!want || !presses.includes(want)) return;
      // Resolve on this frame while t is still frozen in the perfect window,
      // then advance — otherwise the next say-step would re-pause first.
      hideTutorCard();
      pendingInputs.push(want);
      handleInputs();
      tutorAdvance();
    }
  }

  function tutorScriptTick(dt) {
    if (!tutorOn || tutorMode !== "script" || tutorPause) return;
    const step = TUTOR_SCRIPT[tutorStage];
    if (!step) return;

    if (step.kind === "say") {
      tutorTimer += dt;
      if (tutorTimer < (step.delay || 0)) return;
      // Let the stick roll into view before the card covers it.
      if (step.revealT != null) {
        const obs = tutorWatchObs || tutorActObs;
        if (obs && !obs.resolved && timeToHit(obs) > step.revealT) return;
      }
      openTutorSay(step);
      return;
    }

    if (step.kind === "spawn") {
      const obs = tutorSpawnStick(step);
      if (step.demo) tutorWatchObs = obs;
      else tutorActObs = obs;
      tutorAdvance();
      return;
    }

    if (step.kind === "watch") {
      if (tutorWatchObs && tutorWatchObs.resolved) tutorAdvance();
      return;
    }

    if (step.kind === "act") {
      const obs = tutorActObs;
      if (!obs || obs.resolved) {
        tutorAdvance();
        return;
      }
      // Freeze on the white flash peak (near t=0), not on the rim of the window.
      if (timeToHit(obs) <= timingBounds(obs).perfect * 0.12) openTutorAct(step, obs);
      return;
    }

    if (step.kind === "practice") {
      tutorMode = "practice";
      tutorPracticeIdx = 0;
      tutorTaught = 0;
      tutorOk = 0;
      tutorAdvance();
    }
  }

  // Cue target during the scripted lesson (approach + act pause).
  function tutorTarget() {
    if (!tutorOn || tutorMode !== "script") return null;
    if (tutorPause && tutorPause.mode === "act" && tutorPause.obs && !tutorPause.obs.resolved) {
      return tutorPause.obs;
    }
    const step = TUTOR_SCRIPT[tutorStage];
    if (step && step.kind === "act" && tutorActObs && !tutorActObs.resolved) {
      const t = timeToHit(tutorActObs);
      if (t <= TUTOR_CUE_LEAD && t >= -timingBounds(tutorActObs).good) return tutorActObs;
    }
    return null;
  }

  function tutorTaughtOne(ok) {
    if (!tutorOn || tutorMode !== "practice") return;
    tutorTaught += 1;
    if (ok) tutorOk += 1;
    if (tutorTaught < TUTOR_PRACTICE.length) return;
    if (tutorOk >= TUTOR_PASS) {
      offerTutorPass();
    } else {
      offerTutorRetry();
    }
  }

  function offerTutorPass() {
    clearTutorState(false);
    phase = "tutorpass";
    updateHud();
    showReport({
      title: "ОБУЧЕНИЕ ПРОЙДЕНО",
      cls: "report-good",
      btnLabel: "В игру →",
      action: () => {
        markTutorSeen();
        startRun(false);
      },
      note: "Дальше — обычная трасса. Полоса инерции снова стартует полной.",
      rows: [
        ["Верных ходов", `${tutorOk} из ${TUTOR_PRACTICE.length}`],
        ["Свои клюшки", "подставься той же стороной"],
        ["Чужие клюшки", "уходи в другую сторону"],
        ["Две красные сразу", "прыжок"],
      ],
    });
  }

  function offerTutorRetry() {
    clearTutorState(false);
    phase = "tutorfail";
    updateHud();
    showReport({
      title: "ОБУЧЕНИЕ НЕ СОШЛОСЬ",
      cls: "report-bad",
      btnLabel: "Пройти обучение ещё раз",
      action: () => startRun(true),
      altLabel: "Дальше без подсказок",
      altAction: () => {
        markTutorSeen();
        startRun(false);
      },
      note: "Допустима одна ошибка из шести. Инерция и жизни на месте.",
      rows: [
        ["Верных ходов", `${tutorOk} из ${TUTOR_PRACTICE.length}`],
        ["Свои клюшки", "подставься той же стороной"],
        ["Чужие клюшки", "уходи в другую сторону"],
        ["Две красные сразу", "прыжок"],
      ],
    });
  }

  function clearTutorState(markSeen) {
    tutorOn = false;
    tutorMode = "off";
    tutorHideBtn.hidden = true;
    hideTutorCard();
    if (markSeen) markTutorSeen();
  }

  function endTutor() {
    clearTutorState(true);
  }

  function update(dt) {
    const cine = updateCinema(dt);
    if (cine === "block") return;

    if (phase !== "play") {
      pendingInputs.length = 0;
      updateFx(dt);
      return;
    }

    if (tutorPause) {
      tutorPauseInput();
      // World is frozen, but flashes/shake still settle so the next card is clean.
      updateFx(dt);
      return;
    }

    // Fly-in: puck keeps rolling, but coaching and input wait until we're inside.
    if (cine === "intro") {
      updatePuck(dt);
      maybeSpawnObstacles();
      updateObstacles();
      updateParticles(dt);
      updateFx(dt);
      updateHud();
      return;
    }

    if (tutorOn && tutorMode === "script") {
      tutorScriptTick(dt);
      if (tutorPause) return;
      if (tutorSwallowInputs()) pendingInputs.length = 0;
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

    // Goal counts at the crease — the fly-out shows the rest into the net.
    if (!tutorOn && puck.z >= creaseZ()) {
      startGoalCam();
    }

    updateHud();
  }

  // ---------- RENDER ----------

  function drawArenaStrip() {
    const horizon = H * CAM.horizonFrac;
    const top = horizon - SLIT.topAboveHorizon - 60;
    const stripH = horizon - top + 2;
    const g = ctx.createLinearGradient(0, top, 0, horizon);
    g.addColorStop(0, "#12081f");
    g.addColorStop(0.45, "#2a1050");
    g.addColorStop(1, "#6b3aa8");
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, stripH);

    // Panel wall behind the net, then the curved board rail on top.
    const shift = turnShiftPx();
    if (imgReady(imgs.borderTop)) {
      const wallH = Math.max(40, Math.min(110, SLIT.topAboveHorizon * 0.7));
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(imgs.borderTop, shift - W * 0.08, horizon - wallH * 0.92, W * 1.16, wallH);
      ctx.restore();
    }
    if (imgReady(imgs.board)) {
      const boardH = Math.max(28, Math.min(90, SLIT.topAboveHorizon * 0.55));
      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.drawImage(imgs.board, shift - W * 0.12, horizon - boardH * 0.72, W * 1.24, boardH);
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
    const rig = camRig();
    const iceY = horizon - 8;
    const iceH = H - horizon + 24;

    // Fallback underpaint if textures have not loaded yet.
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, "#5a2d8a");
    g.addColorStop(0.35, "#7a45b0");
    g.addColorStop(1, "#3d1866");
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, H - horizon);

    const iceX = turnShiftPx() - W * 0.08;
    const iceW = W * 1.16;
    if (imgReady(imgs.ice)) {
      ctx.save();
      ctx.globalAlpha = 0.97;
      ctx.drawImage(imgs.ice, iceX, iceY, iceW, iceH);
      ctx.restore();
    }

    // Extra purple tint / banding marks on the ice.
    if (imgReady(imgs.iceColor)) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(imgs.iceColor, iceX, iceY, iceW, iceH);
      ctx.restore();
    }
    if (imgReady(imgs.iceColor2)) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(imgs.iceColor2, iceX, iceY, iceW, iceH);
      ctx.restore();
    }

    // Soft skate-line ribs for speed.
    const eyeZ = puck.z - rig.back;
    const start = Math.floor(eyeZ / CORRIDOR.ribStep) * CORRIDOR.ribStep;
    for (let i = 0; i < 70; i++) {
      const z = start + i * CORRIDOR.ribStep;
      const p = project(0, z, true);
      if (!p) continue;
      const alpha = Math.max(0.03, 0.22 - i * 0.004);
      ctx.strokeStyle = `rgba(255,230,255,${alpha})`;
      ctx.lineWidth = Math.max(1, p.k * 1.2);
      ctx.beginPath();
      ctx.moveTo(0, p.sy);
      ctx.lineTo(W, p.sy);
      ctx.stroke();
    }
  }

  function drawLane() {
    const rig = camRig();
    const farZ = puck.z + CAM.far * 0.9;
    const nearZ = puck.z - rig.back + CAM.near + 2;
    const farL = project(-CORRIDOR.halfW, farZ, true);
    const farR = project(CORRIDOR.halfW, farZ, true);
    const nearL = project(-CORRIDOR.halfW, nearZ, true);
    const nearR = project(CORRIDOR.halfW, nearZ, true);
    if (!farL || !farR || !nearL || !nearR) return;

    ctx.fillStyle = "rgba(255, 210, 255, 0.07)";
    ctx.beginPath();
    ctx.moveTo(farL.sx, farL.sy);
    ctx.lineTo(farR.sx, farR.sy);
    ctx.lineTo(nearR.sx, nearR.sy);
    ctx.lineTo(nearL.sx, nearL.sy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 220, 120, 0.55)";
    ctx.lineWidth = 2.5;
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
      projectHeight(-half, z, GOAL.postHeight, true),
      projectHeight(half, z, GOAL.postHeight, true),
    ];
    const bases = [project(-half, z, true), project(half, z, true)];
    if (!posts[0] || !posts[1] || !bases[0] || !bases[1]) return;

    const cx = (bases[0].sx + bases[1].sx) / 2;
    const cy = (posts[0].sy + bases[0].sy) / 2;
    const glowR = Math.max(30, Math.abs(bases[1].sx - bases[0].sx) * 0.7);
    const goalW = Math.abs(bases[1].sx - bases[0].sx) * 1.2;
    const goalH = Math.max(24, Math.abs(bases[0].sy - posts[0].sy) * 1.25);
    const goalY = posts[0].sy - goalH * 0.08 + goalH * GOAL.yDownFrac;

    const glow = ctx.createRadialGradient(cx, cy + goalH * GOAL.yDownFrac * 0.5, 4, cx, cy + goalH * GOAL.yDownFrac * 0.5, glowR);
    glow.addColorStop(0, "rgba(255, 140, 255, 0.35)");
    glow.addColorStop(0.55, "rgba(180, 80, 255, 0.14)");
    glow.addColorStop(1, "rgba(120, 40, 200, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy + goalH * GOAL.yDownFrac * 0.5, glowR, 0, Math.PI * 2);
    ctx.fill();

    if (imgReady(imgs.gate)) {
      ctx.save();
      ctx.globalAlpha = 0.98;
      ctx.drawImage(imgs.gate, cx - goalW / 2, goalY, goalW, goalH);
      ctx.restore();
    } else {
      ctx.strokeStyle = "#e8a0ff";
      ctx.lineWidth = Math.max(3, posts[0].k * 6);
      ctx.beginPath();
      ctx.moveTo(bases[0].sx, bases[0].sy);
      ctx.lineTo(posts[0].sx, posts[0].sy);
      ctx.lineTo(posts[1].sx, posts[1].sy);
      ctx.lineTo(bases[1].sx, bases[1].sy);
      ctx.stroke();
    }

    if (netFlash > 0) {
      const flashCy = cy + goalH * GOAL.yDownFrac * 0.5;
      const flash = ctx.createRadialGradient(cx, flashCy, 2, cx, flashCy, glowR * 1.35);
      flash.addColorStop(0, `rgba(255,255,255,${0.7 * netFlash})`);
      flash.addColorStop(0.35, `rgba(255,180,255,${0.4 * netFlash})`);
      flash.addColorStop(1, "rgba(200,80,255,0)");
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(cx, flashCy, glowR * 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The puck as a world object — only when the eye is outside it.
  function drawPuckBody() {
    if (outside <= 0.01) return;
    const base = project(0, puck.z);
    if (!base) return;

    const a = Math.min(1, outside);
    drawShadow(0, puck.z, 26, 0.95);

    ctx.save();
    ctx.globalAlpha = a;
    if (imgReady(imgs.puck)) {
      const w = Math.max(28, 52 * base.k);
      const h = w * (imgs.puck.naturalHeight / imgs.puck.naturalWidth);
      ctx.drawImage(imgs.puck, base.sx - w / 2, base.sy - h * 0.5, w, h);
    } else {
      const top = projectHeight(0, puck.z, 13);
      if (!top) {
        ctx.restore();
        return;
      }
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
    ctx.restore();
  }

  function stickSprite(foe, side) {
    if (side < 0) return foe ? imgs.redLeft : imgs.blueLeft;
    return foe ? imgs.redRight : imgs.blueRight;
  }

  // Lerp appear→stop angles by swing (0 = just appeared, 1 = strike pose).
  function stickTiltRad(swing, appearDeg, stopDeg) {
    const a = appearDeg * (Math.PI / 180);
    const b = stopDeg * (Math.PI / 180);
    const t = Math.max(0, Math.min(1, swing));
    return a + (b - a) * t;
  }

  // Side-specific PNGs (blade already faces the lane). Anchor at the BLADE tip;
  // handle trails toward the boards. Angle comes only from STICK config.
  function drawTiltedStick(img, tipX, tipZ, side, swing, alpha, appearDeg, stopDeg) {
    if (!imgReady(img)) return null;
    const tip = projectHeight(tipX, tipZ, STICK.tipHeight);
    if (!tip) return null;
    const rawW = STICK.worldLen * tip.k;
    const drawW = Math.max(28, Math.min(W * STICK.maxScreenFrac, rawW));
    const drawH = drawW * (img.naturalHeight / Math.max(1, img.naturalWidth));
    const tilt = stickTiltRad(swing, appearDeg, stopDeg);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(tip.sx, tip.sy);
    // Positive config angle = handle raised. Sign flips per side so both lift up.
    ctx.rotate(side < 0 ? -tilt : tilt);
    // Left assets: blade on the right edge → draw ending at tip.
    // Right assets: blade on the left edge → draw starting at tip.
    if (side < 0) ctx.drawImage(img, -drawW, -drawH / 2, drawW, drawH);
    else ctx.drawImage(img, 0, -drawH / 2, drawW, drawH);
    ctx.restore();
    return tip;
  }

  function stickTipX(side, swing, push) {
    return side * (CORRIDOR.halfW * (1.05 - swing * 1.05 + push));
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

  // Ice light under the blade: same timing model as grading. One spot that
  // widens on approach, snaps white at the perfect moment, then cools red late.
  function drawIceGlow(x, z, obs) {
    if (obs.resolved && obs.ok) return;
    const tp = timingPhase(obs);
    let phase = tp.phase;
    let intensity = tp.intensity;
    // A missed stick keeps a cooling late blotch while it slides past.
    if (!phase && obs.resolved && !obs.ok) {
      const slip = slipProgress(obs);
      if (slip >= 0.55) return;
      phase = "late";
      intensity = Math.max(0, 1 - slip / 0.55) * 0.7;
    }
    if (!phase || intensity <= 0.02) return;

    const p = project(x, z);
    if (!p) return;

    // Act-pause / coached sticks read louder; free play still needs a clear pool.
    const actFocus =
      tutorPause && tutorPause.mode === "act" && tutorPause.obs === obs;
    const lessonBoost = actFocus ? 2.1 : obs.lesson ? 1.55 : 1.2;
    let radiusMul;
    let coreRgb;
    let midRgb;
    let alpha;

    if (phase === "approach") {
      // Wide, dim stick-coloured pool — "good" is coming.
      radiusMul = 2.4 - intensity * 0.7;
      coreRgb = obs.foe ? "255,90,120" : "120,210,255";
      midRgb = obs.foe ? "200,40,70" : "60,150,210";
      alpha = (0.16 + intensity * 0.28) * lessonBoost;
    } else if (phase === "perfect") {
      // Whole perfect window stays a hard white flash — without a floor the rim
      // starts at intensity 0 and the free-play flash vanishes in one frame.
      const flash = Math.max(0.88, intensity);
      radiusMul = 1.35 - flash * 0.15;
      coreRgb = "255,255,255";
      midRgb = "255,255,255";
      alpha = (0.72 + flash * 0.28) * (actFocus ? lessonBoost : Math.max(lessonBoost, 1.65));
    } else {
      // Cooling amber-red — the moment has slipped.
      radiusMul = 1.3 + (1 - intensity) * 1.1;
      coreRgb = "255,120,70";
      midRgb = "180,40,30";
      alpha = (0.22 + intensity * 0.3) * lessonBoost;
    }

    const fade = passAlpha(slipProgress(obs), p.d);
    const rx = Math.max(10, 28 * p.k * radiusMul * lessonBoost);
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

    if (phase === "perfect" && !actFocus && !imgReady(imgs.signal)) {
      const coreR = rx * 0.42;
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(0.45, "rgba(255,255,255,0.75)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = Math.min(1, 0.95 * fade);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, coreR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Perfect window: yellow starburst (drawn outside the ellipse scale).
    if (phase === "perfect" && imgReady(imgs.signal)) {
      const flash = Math.max(0.88, intensity);
      const size = Math.max(48, rx * 2.6);
      const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 90);
      ctx.save();
      ctx.globalAlpha = Math.min(1, (0.78 + flash * 0.22) * fade * pulse * (actFocus ? 1.05 : 1));
      ctx.drawImage(imgs.signal, p.sx - size / 2, p.sy - size / 2, size, size);
      ctx.restore();
    }
  }

  function drawStick(obs) {
    const p = strikeProgress(obs);
    const swing = p * p * (3 - 2 * p);
    const side = obs.side;
    const slip = slipProgress(obs);
    const push = obs.ok ? (obs.foe ? -slip * 1.6 : slip * 1.1) : slip * 0.35;
    const tipX = stickTipX(side, swing, push);
    const tipZ = obs.z + STICK.tipZOffset;

    drawShadow(tipX, tipZ, 12 + swing * 22, 1.1);
    drawIceGlow(tipX * 0.38, tipZ, obs);

    const tip = projectHeight(tipX, tipZ, STICK.tipHeight);
    if (!tip) return;

    const pal = stickPalette(obs);
    const alpha = passAlpha(slip, tip.d);
    const sprite = stickSprite(obs.foe, side);

    ctx.save();
    ctx.globalAlpha = alpha;
    drawTipGlow(tip, pal, 1.15);
    ctx.restore();

    if (!drawTiltedStick(sprite, tipX, tipZ, side, swing, alpha, STICK.angleAppearDeg, STICK.angleStopDeg)) {
      const gripX = side * (CORRIDOR.halfW * 1.45);
      const grip = projectHeight(gripX, tipZ, 18);
      if (grip) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = pal.shaft;
        ctx.lineWidth = Math.min(NEAR_W_CAP, Math.max(3, (5 + swing * 3) * tip.k));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(grip.sx, grip.sy);
        ctx.lineTo(tip.sx, tip.sy);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (obs.ok && !obs.foe && slip > 0 && slip < 0.7) {
      ctx.save();
      ctx.globalAlpha = alpha;
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
      ctx.restore();
    }
  }

  // "Cross" is a pinch: two red sticks flying in from both sides. SPACE hops.
  function drawCross(obs) {
    const p = strikeProgress(obs);
    const swing = p * p * (3 - 2 * p);
    const slip = slipProgress(obs);
    const z = obs.z;

    drawShadow(0, z, 28 + swing * 40, 0.55);
    drawIceGlow(0, z, obs);

    const pal = stickPalette(obs);
    for (const side of [-1, 1]) {
      const push = obs.ok ? slip * 1.5 : slip * 0.35;
      const tipX = stickTipX(side, swing, push);
      const tipZ = z + STICK.tipZOffset;
      const tip = projectHeight(tipX, tipZ, STICK.tipHeight);
      if (!tip) continue;

      const alpha = passAlpha(slip, tip.d);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawTipGlow(tip, pal, 1.3);
      ctx.restore();

      const sprite = stickSprite(true, side);
      if (!drawTiltedStick(sprite, tipX, tipZ, side, swing, alpha, STICK.crossAppearDeg, STICK.crossStopDeg)) {
        const gripX = side * (CORRIDOR.halfW * 1.45);
        const grip = projectHeight(gripX, tipZ, 18);
        if (grip) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = pal.shaft;
          ctx.lineWidth = Math.min(NEAR_W_CAP, Math.max(3, (6 + swing * 4) * tip.k));
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(grip.sx, grip.sy);
          ctx.lineTo(tip.sx, tip.sy);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
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

  function hash01(i) {
    const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  // Аниме-штрихи: летят из точки схода к краям, густеют вместе со скоростью.
  function drawSpeedLines() {
    if (outside > 0.5) return;
    const drive = Math.max(0, Math.min(1, (mom - SPEED_LINES.minMom) / (1 - SPEED_LINES.minMom)));
    const load = Math.min(1, drive + boostFx * 0.8);
    if (load <= 0.02) return;

    const cx = W / 2;
    const cy = H * CAM.horizonFrac;
    const t = performance.now() / 1000;
    const gap = W * SPEED_LINES.centerGapFrac;
    const reach = Math.hypot(W, H) * 0.75;

    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < SPEED_LINES.count; i++) {
      const seed = hash01(i);
      const ang = (i % 2 === 0 ? Math.PI : 0) + (hash01(i + 91) - 0.5) * 0.9;
      const phase = (t * SPEED_LINES.rate * (0.7 + seed * 0.8) * (0.5 + load) + seed) % 1;
      const r0 = gap + phase * reach;
      const len = reach * SPEED_LINES.lenFrac * (0.45 + seed * 0.9) * (0.5 + load * 0.7);
      const a = SPEED_LINES.alpha * load * Math.sin(Math.PI * Math.min(1, phase / 0.9));
      if (a <= 0.01) continue;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang) * 0.45;
      ctx.strokeStyle = `rgba(235,215,255,${a})`;
      ctx.lineWidth = 1 + 2.2 * load * seed;
      ctx.beginPath();
      ctx.moveTo(cx + dx * r0, cy + dy * r0);
      ctx.lineTo(cx + dx * (r0 + len), cy + dy * (r0 + len));
      ctx.stroke();
    }
    ctx.restore();
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

    ctx.save();
    slitPath(slit);
    ctx.clip();

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
    ctx.restore();
  }

  function drawSlitBody(slit) {
    const bottom = slit.y + slit.h;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    lensOutline(slit);
    ctx.fillStyle = "#14081f";
    ctx.fill("evenodd");

    ctx.save();
    slitPath(slit);
    ctx.clip();

    // Cinematic falloff — the shell dissolves into the view instead of framing it.
    const topFade = Math.min(90, slit.h * 0.28);
    const topG = ctx.createLinearGradient(0, slit.y, 0, slit.y + topFade);
    topG.addColorStop(0, "rgba(20,8,31,0.96)");
    topG.addColorStop(0.35, "rgba(20,8,31,0.5)");
    topG.addColorStop(1, "rgba(20,8,31,0)");
    ctx.fillStyle = topG;
    ctx.fillRect(0, slit.y, W, topFade);

    const botFade = Math.min(130, slit.h * 0.34);
    const botG = ctx.createLinearGradient(0, bottom - botFade, 0, bottom);
    botG.addColorStop(0, "rgba(20,8,31,0)");
    botG.addColorStop(0.5, "rgba(20,8,31,0.34)");
    botG.addColorStop(1, "rgba(20,8,31,0.97)");
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

    const cx = W / 2;
    const cy = slit.y + slit.h / 2;
    const vr = Math.max(W, slit.h) * 0.62;
    const vig = ctx.createRadialGradient(cx, cy, vr * 0.35, cx, cy, vr);
    vig.addColorStop(0, "rgba(10,4,18,0)");
    vig.addColorStop(1, `rgba(10,4,18,${LENS.vignette})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  const CUE_FONT = '"Segoe UI", system-ui, sans-serif';

  // Three columns of the screen. They are the tap zones, so the coaching
  // highlight and the touch target are the same thing.
  function cueZones(slit) {
    const inset = Math.min(24, slit.h * 0.07);
    const y = slit.y + inset;
    const h = slit.h - inset * 2;
    const third = W / 3;
    return {
      left: { x: 0, y, w: third, h },
      brace: { x: third, y, w: third, h },
      right: { x: third * 2, y, w: third, h },
    };
  }

  // Pulsing pointer from mid-screen up to the speed readout.
  function drawGripArrow() {
    if (!tutorPause || !tutorPause.pointGrip || !hudStatsEl || phase !== "play") return;
    const rect = hudStatsEl.getBoundingClientRect();
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

    ctx.font = `700 13px ${CUE_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = `rgba(255, 220, 140, ${0.7 + 0.3 * pulse})`;
    ctx.fillText("СКОРОСТЬ", tx, ty + 22);
    ctx.restore();
  }

  // Coaching overlay. On act-pause the ice glow is the star — only a compact
  // key badge remains in the column. Approaching sticks keep a quieter fill.
  function drawTutorCue(slit) {
    if (!tutorOn || phase !== "play" || tutorMode !== "script") return;
    const obs = tutorTarget();
    if (!obs) return;

    const zones = cueZones(slit);
    const target = zones[obs.want];
    if (!target) return;

    const paused = !!(tutorPause && tutorPause.mode === "act");
    const t = timeToHit(obs);
    const near = Math.max(0, Math.min(1, 1 - t / TUTOR_CUE_LEAD));
    const tp = timingPhase(obs);
    const live = paused ? 1 : obs.windowOpen ? 0.85 : 0.35 + 0.45 * near;
    const rgb = obs.foe ? "255,70,100" : "90,200,255";
    const baseScale = Math.max(0.78, Math.min(1.15, W / 900));
    const scale = baseScale * (paused ? 0.85 : 1);

    ctx.save();
    ctx.lineJoin = "round";

    // All three columns marked, so the pick reads as a choice of three.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(232,244,255,${paused ? 0.1 : 0.07 + 0.1 * live})`;
    ctx.setLineDash([6, 9]);
    for (const key of ["brace", "right"]) {
      const z = zones[key];
      ctx.beginPath();
      ctx.moveTo(z.x, z.y);
      ctx.lineTo(z.x, z.y + z.h);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (!paused) {
      // Quiet column wash while approaching — not on act-pause.
      const g = ctx.createLinearGradient(0, target.y + target.h, 0, target.y);
      g.addColorStop(0, `rgba(${rgb},${0.28 * live})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(target.x, target.y, target.w, target.h);
    }

    const cx = target.x + target.w / 2;
    // Compact badge low in the column so the ice flash stays the focus.
    const cy = paused ? target.y + target.h * 0.72 : target.y + target.h * 0.58;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(255,255,255,${paused ? 0.8 : 0.65 + 0.35 * live})`;
    ctx.font = `800 ${22 * scale}px ${CUE_FONT}`;
    ctx.fillText(cueKey(obs.want), cx, cy);

    const below = cy + 28 * scale;
    ctx.font = `700 ${12 * scale}px ${CUE_FONT}`;
    ctx.fillStyle = `rgba(232,244,255,${paused ? 0.6 : 0.55 + 0.4 * live})`;
    ctx.fillText(cueWord(obs.want), cx, below);

    // Ice-glow timing is the main lesson — louder on act-pause than the key badge.
    ctx.font = `700 ${(paused ? 18 : 15) * Math.min(baseScale, 1.1)}px ${CUE_FONT}`;
    if (!paused) {
      ctx.fillStyle = `rgba(${rgb},${0.6 + 0.4 * near})`;
      ctx.fillText(cueCaption(obs), W / 2, slit.y + 30);
    }
    let hint = "СМОТРИ НА БЛИК НА ЛЬДУ";
    let hintRgb = "200,220,240";
    if (tp.phase === "approach") {
      hint = "БЛИК РАЗГОРАЕТСЯ — ГОТОВЬСЯ";
      hintRgb = rgb;
    } else if (tp.phase === "perfect" || paused) {
      hint = "ЖМИ НА ВСПЫШКЕ";
      hintRgb = "255,255,255";
    } else if (tp.phase === "late") {
      hint = "ПОЗДНО — БЛИК ОСТЫВАЕТ";
      hintRgb = "255,140,90";
    }
    ctx.font = `800 ${(paused ? 17 : 12) * Math.min(baseScale, 1.1)}px ${CUE_FONT}`;
    ctx.fillStyle = `rgba(${hintRgb},${paused ? 0.95 : 0.55 + 0.4 * live})`;
    ctx.fillText(hint, W / 2, paused ? slit.y + slit.h * 0.38 : slit.y + 52);
    ctx.restore();
  }

  // Faint column split so tap zones stay discoverable in practice and free play.
  function drawTapZones(slit) {
    if (!isTouchUi() || phase !== "play") return;
    // Act-pause already paints the big column cue.
    if (tutorOn && tutorMode === "script") return;
    const third = W / 3;
    const top = slit.y + slit.h * 0.55;
    const bottom = slit.y + slit.h;
    ctx.save();
    ctx.strokeStyle = "rgba(232,244,255,0.07)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 10]);
    for (const x of [third, third * 2]) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDamageFlash(slit) {
    if (damageFlash <= 0) return;
    const a = damageFlash * 0.45;
    const cx = slit.x + slit.w / 2;
    const cy = slit.y + slit.h / 2;
    const g = ctx.createRadialGradient(
      cx,
      cy,
      slit.h * 0.1,
      cx,
      cy,
      slit.w * 0.55
    );
    g.addColorStop(0, `rgba(255,40,30,${a * 0.15})`);
    g.addColorStop(0.55, `rgba(180,20,20,${a * 0.35})`);
    g.addColorStop(1, `rgba(80,0,0,${a})`);
    slitPath(slit);
    ctx.fillStyle = g;
    ctx.fill();

    if (imgReady(imgs.hit)) {
      const size = Math.min(slit.w, slit.h) * (0.55 + 0.35 * damageFlash);
      ctx.save();
      ctx.globalAlpha = Math.min(1, damageFlash * 0.95);
      ctx.drawImage(imgs.hit, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();
    }
  }

  // Looking from inside the puck: leaning and trembling move the view, not a disc.
  function worldJitter() {
    const t = performance.now() / 1000;
    let jx = -braceLean * 0.5 + glanceX + Math.sin(t * 25) * wobble * 4;
    let jy = glanceY;
    let roll = tilt + glanceRoll;

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
    ctx.fillStyle = "#14081f";
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
    drawPuckBody();

    // Resolved sticks stay in frame so they visibly slide past, not blink out.
    // When the eye is outside, keep sticks that sit between camera and puck.
    const rig = camRig();
    const sorted = [...obstacles]
      .filter((o) => o.z > puck.z - rig.back - 30 && slipProgress(o) < 1)
      .sort((a, b) => b.z - a.z);

    for (const obs of sorted) {
      if (obs.type === "cross") drawCross(obs);
      else drawStick(obs);
    }

    drawParticles();
    drawSpeedLines();
    drawSpeedStreaks();
    ctx.restore();
    ctx.restore();

    drawSlitBody(slit);
    drawHitFlash(slit);
    drawDamageFlash(slit);
    if (!cinema) {
      drawTapZones(slit);
      drawTutorCue(slit);
      drawGripArrow();
    }
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    if (!paused) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- INPUT ----------

  function queueInput(code) {
    if (paused) return;
    if (phase === "ready") {
      if (code === "brace") startRun();
      return;
    }
    if (cinema) return;
    if (phase !== "play") {
      // Between rounds any input confirms the report — no dead taps on a phone.
      runContinue();
      return;
    }
    // View flicks toward the press; skating direction stays dead ahead.
    nudgeLook(code);
    pendingInputs.push(code);
  }

  function zoneFromX(x) {
    const third = W / 3;
    if (x < third) return "left";
    if (x > third * 2) return "right";
    return "brace";
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Escape") {
      e.preventDefault();
      togglePause();
      return;
    }
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

  // The whole view is three lanes: a press anywhere picks the column it lands in.
  // HUD buttons sit above the canvas, so they never double-fire through this.
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    queueInput(zoneFromX(e.clientX - rect.left));
  });

  restartBtn.addEventListener("click", () => {
    if (pendingContinue) {
      runContinue();
      return;
    }
    showIntro(false);
    resetRun({ keepLives: false, keepStreak: false, keepGoals: false });
  });

  startBtn.addEventListener("click", () => startRun());

  // Blur first: a focused button would also react to the SPACE we use in play.
  tutorHideBtn.addEventListener("click", () => {
    tutorHideBtn.blur();
    endTutor();
  });
  reportAltBtn.addEventListener("click", () => {
    reportAltBtn.blur();
    runAlternative();
  });
  tutorAgainBtn.addEventListener("click", () => {
    tutorAgainBtn.blur();
    startRun(true);
  });
  if (pauseBtn) {
    pauseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      pauseBtn.blur();
      togglePause();
    });
  }
  if (resumeBtn) {
    resumeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      resumeBtn.blur();
      setPaused(false);
    });
  }
  window.addEventListener("resize", resize);

  resetGame();
  resize();
  requestAnimationFrame((ts) => {
    lastTs = ts;
    loop(ts);
  });
})();
