(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const comboEl = document.getElementById("combo");
  const shotsEl = document.getElementById("shots");
  const progressFill = document.getElementById("progress-fill");
  const accFill = document.getElementById("acc-fill");
  const accValue = document.getElementById("acc-value");
  const gradeFlash = document.getElementById("grade-flash");
  const statusEl = document.getElementById("status");
  const restartBtn = document.getElementById("restart-btn");
  const introEl = document.getElementById("intro");
  const startBtn = document.getElementById("start-btn");

  const BPM = 100;
  const BEAT = 60 / BPM;
  const LEAD_IN_BEATS = 8;
  const PHRASE_BEATS = 8;
  const PERFECT_WINDOW = 0.06;
  const GOOD_WINDOW = 0.13;
  const APPROACH = 1.6;
  const GRADE_FLASH_TIME = 0.45;
  const OUTRO_TIME = 1.8;

  // Slot grid mirrors the keyboard: Q W E on top, A S D below.
  const SLOTS = [
    { id: "Q", code: "KeyQ", x: 0.19, y: 0.32 },
    { id: "W", code: "KeyW", x: 0.5, y: 0.2 },
    { id: "E", code: "KeyE", x: 0.81, y: 0.32 },
    { id: "A", code: "KeyA", x: 0.23, y: 0.68 },
    { id: "S", code: "KeyS", x: 0.5, y: 0.82 },
    { id: "D", code: "KeyD", x: 0.77, y: 0.68 },
  ];
  const SLOT_BY_ID = new Map(SLOTS.map((s) => [s.id, s]));
  const SLOT_BY_CODE = new Map(SLOTS.map((s) => [s.code, s]));

  // Difficulty ramp: one slot at half speed, then more slots, then eighths.
  // Each phrase is PHRASE_BEATS long; `hint` shows above the rink while it plays.
  const PHRASES = [
    { hint: "Только центр. Жми W в такт.", notes: [{ b: 0, s: "W" }, { b: 2, s: "W" }, { b: 4, s: "W" }, { b: 6, s: "W" }] },
    { hint: "Добавился левый край — Q.", notes: [{ b: 0, s: "W" }, { b: 2, s: "Q" }, { b: 4, s: "W" }, { b: 6, s: "Q" }] },
    { hint: "И правый — E. Весь верхний ряд.", notes: [{ b: 0, s: "Q" }, { b: 2, s: "W" }, { b: 4, s: "E" }, { b: 6, s: "W" }] },
    { hint: "Теперь чаще: пас в касание.", notes: [{ b: 0, s: "Q" }, { b: 1, s: "W" }, { b: 2, s: "E" }, { b: 4, s: "E" }, { b: 5, s: "W" }, { b: 6, s: "Q" }] },
    { hint: "Оранжевый — щелчок по воротам.", notes: [{ b: 0, s: "Q" }, { b: 2, s: "W" }, { b: 4, s: "E" }, { b: 6, s: "W", t: "shot" }] },
    { hint: "Нижний ряд: A S D.", notes: [{ b: 0, s: "S" }, { b: 2, s: "S" }, { b: 4, s: "A" }, { b: 6, s: "D" }] },
    { hint: "Выход из зоны и бросок.", notes: [{ b: 0, s: "A" }, { b: 1, s: "S" }, { b: 2, s: "D" }, { b: 4, s: "W" }, { b: 6, s: "W", t: "shot" }] },
    { hint: "Перевод через защиту.", notes: [{ b: 0, s: "S" }, { b: 1, s: "D" }, { b: 2, s: "E" }, { b: 3, s: "W" }, { b: 5, s: "Q" }, { b: 6, s: "W" }] },
    { hint: "Стенка: два паса подряд.", notes: [{ b: 0, s: "Q" }, { b: 0.5, s: "W" }, { b: 1, s: "Q" }, { b: 2, s: "A" }, { b: 4, s: "E" }, { b: 6, s: "E", t: "shot" }] },
    { hint: "Растяжка по всей пятёрке.", notes: [{ b: 0, s: "E" }, { b: 1, s: "D" }, { b: 2, s: "S" }, { b: 3, s: "A" }, { b: 4, s: "Q" }, { b: 5, s: "W" }, { b: 7, s: "W" }] },
    { hint: "Быстрый треугольник.", notes: [{ b: 0, s: "W" }, { b: 0.5, s: "E" }, { b: 1, s: "W" }, { b: 1.5, s: "Q" }, { b: 2, s: "W" }, { b: 4, s: "S" }, { b: 5, s: "D" }, { b: 6, s: "E", t: "shot" }] },
    { hint: "Круг через всё звено.", notes: [{ b: 0, s: "S" }, { b: 1, s: "A" }, { b: 2, s: "Q" }, { b: 3, s: "W" }, { b: 4, s: "E" }, { b: 5, s: "D" }, { b: 6, s: "S" }, { b: 7, s: "W" }] },
    { hint: "Сдвоенные пасы.", notes: [{ b: 0, s: "A" }, { b: 0.5, s: "S" }, { b: 1, s: "D" }, { b: 2, s: "E" }, { b: 2.5, s: "W" }, { b: 3, s: "Q" }, { b: 5, s: "W" }, { b: 6, s: "W", t: "shot" }] },
    { hint: "Качели с фланга на фланг.", notes: [{ b: 0, s: "Q" }, { b: 1, s: "E" }, { b: 2, s: "Q" }, { b: 3, s: "E" }, { b: 4, s: "W" }, { b: 5, s: "S" }, { b: 6, s: "D" }, { b: 7, s: "E", t: "shot" }] },
    { hint: "Финал. Держись.", notes: [{ b: 0, s: "W" }, { b: 0.5, s: "Q" }, { b: 1, s: "A" }, { b: 1.5, s: "S" }, { b: 2, s: "D" }, { b: 2.5, s: "E" }, { b: 3, s: "W" }, { b: 4.5, s: "Q" }, { b: 5, s: "W" }, { b: 6, s: "E" }, { b: 7, s: "W", t: "shot" }] },
  ];

  let W = 0;
  let H = 0;
  let dpr = 1;

  let audioCtx = null;
  let startTime = 0;
  let totalBeats = 0;
  let nextTickBeat = 0;

  let chart = [];
  let phase = "ready"; // ready | play | result
  let combo = 0;
  let maxCombo = 0;
  let perfects = 0;
  let goods = 0;
  let misses = 0;
  let strays = 0;
  let shots = 0;
  let attack = 0;
  let sparks = [];
  let flashes = [];
  let shake = 0;
  let puckSlot = "S";
  let puckPos = { x: 0.5, y: 0.82 };
  let gradeTimer = 0;
  let songEndsAt = 0;

  function buildChart() {
    const notes = [];
    PHRASES.forEach((phrase, pi) => {
      for (const n of phrase.notes) {
        const beat = LEAD_IN_BEATS + pi * PHRASE_BEATS + n.b;
        notes.push({
          time: beat * BEAT,
          slot: n.s,
          shot: n.t === "shot",
          judged: false,
        });
      }
    });
    notes.sort((a, b) => a.time - b.time);
    totalBeats = LEAD_IN_BEATS + PHRASES.length * PHRASE_BEATS;
    return notes;
  }

  function currentHint(t) {
    const idx = Math.floor((t - LEAD_IN_BEATS * BEAT) / (PHRASE_BEATS * BEAT));
    if (idx < 0 || idx >= PHRASES.length) return null;
    return PHRASES[idx].hint;
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

  function blip(at, freq, dur, gain, type) {
    if (!audioCtx) return;
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

  function scheduleMetronome() {
    if (!audioCtx || phase !== "play") return;
    const lookahead = 0.25;
    while (nextTickBeat <= totalBeats && startTime + nextTickBeat * BEAT < audioCtx.currentTime + lookahead) {
      const at = startTime + nextTickBeat * BEAT;
      const downbeat = nextTickBeat % 4 === 0;
      blip(at, downbeat ? 1320 : 880, downbeat ? 0.05 : 0.03, downbeat ? 0.09 : 0.05, "square");
      nextTickBeat += 1;
    }
  }

  function songTime() {
    if (!audioCtx) return 0;
    return audioCtx.currentTime - startTime;
  }

  // ---------- FLOW ----------

  function resetRun() {
    chart = buildChart();
    combo = 0;
    maxCombo = 0;
    perfects = 0;
    goods = 0;
    misses = 0;
    strays = 0;
    shots = 0;
    attack = 0;
    sparks = [];
    flashes = [];
    shake = 0;
    gradeTimer = 0;
    puckSlot = "S";
    puckPos = { x: 0.5, y: 0.82 };
    nextTickBeat = 0;
    songEndsAt = chart[chart.length - 1].time + OUTRO_TIME;
    statusEl.hidden = true;
    restartBtn.hidden = true;
    gradeFlash.hidden = true;
    gradeFlash.className = "";
    updateHud();
  }

  function startRun() {
    ensureAudio();
    resetRun();
    introEl.hidden = true;
    startTime = audioCtx.currentTime + 0.35;
    phase = "play";
  }

  function totalJudged() {
    return perfects + goods + misses;
  }

  function accuracy() {
    const judged = totalJudged();
    if (judged === 0) return 1;
    return (perfects + goods * 0.6) / judged;
  }

  function updateHud() {
    comboEl.textContent = String(combo);
    shotsEl.textContent = String(shots);
    progressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, attack))})`;
    const acc = accuracy();
    accFill.style.transform = `scaleX(${Math.max(0, Math.min(1, acc))})`;
    accValue.textContent = String(Math.round(acc * 100));
  }

  function showGrade(text, cls) {
    gradeTimer = GRADE_FLASH_TIME;
    gradeFlash.hidden = false;
    gradeFlash.textContent = text;
    gradeFlash.className = cls;
  }

  function slotPos(slot) {
    return { x: slot.x, y: slot.y };
  }

  function spawnSparks(slot, n, hot) {
    const p = slotPos(slot);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.06 + Math.random() * 0.12;
      sparks.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.25,
        max: 0.5,
        hot: !!hot,
      });
    }
  }

  function pushFlash(slot, text, color) {
    flashes.push({ slot: slot.id, text, color, life: 0.6, max: 0.6 });
  }

  // ---------- JUDGEMENT ----------

  function nearestActiveNote(t) {
    let best = null;
    let bestAbs = Infinity;
    for (const note of chart) {
      if (note.judged) continue;
      const d = Math.abs(note.time - t);
      if (d > GOOD_WINDOW) continue;
      if (d < bestAbs) {
        bestAbs = d;
        best = note;
      }
    }
    return best;
  }

  function onHit(note, grade) {
    note.judged = true;
    const slot = SLOT_BY_ID.get(note.slot);
    puckSlot = note.slot;

    if (grade === "perfect") {
      perfects += 1;
      attack = Math.min(1, attack + 0.09);
      blip(audioCtx.currentTime, 1250, 0.06, 0.1, "triangle");
      blip(audioCtx.currentTime + 0.01, 1750, 0.05, 0.06, "triangle");
      pushFlash(slot, "ИДЕАЛЬНО", "#2ecc71");
      spawnSparks(slot, 12, false);
    } else {
      goods += 1;
      attack = Math.min(1, attack + 0.05);
      blip(audioCtx.currentTime, 900, 0.05, 0.08, "triangle");
      pushFlash(slot, "ХОРОШО", "#4dabf7");
      spawnSparks(slot, 7, false);
    }

    combo += 1;
    maxCombo = Math.max(maxCombo, combo);

    if (note.shot) {
      if (attack >= 0.6) {
        shots += 1;
        shake = 0.55;
        showGrade("ЩЕЛЧОК!", "grade-shot");
        blip(audioCtx.currentTime, 320, 0.16, 0.14, "sawtooth");
        blip(audioCtx.currentTime + 0.04, 660, 0.2, 0.1, "square");
        spawnSparks(slot, 22, true);
        attack = Math.max(0, attack - 0.35);
      } else {
        shake = 0.2;
        showGrade("БРОСОК МИМО", "grade-miss");
        blip(audioCtx.currentTime, 220, 0.12, 0.09, "sawtooth");
      }
    } else {
      showGrade(grade === "perfect" ? "ИДЕАЛЬНО" : "ХОРОШО", grade === "perfect" ? "grade-perfect" : "grade-good");
    }

    updateHud();
  }

  function onMiss(note, reason) {
    note.judged = true;
    misses += 1;
    combo = 0;
    attack = Math.max(0, attack - 0.14);
    shake = Math.max(shake, 0.3);
    const slot = SLOT_BY_ID.get(note.slot);
    pushFlash(slot, reason === "wrong" ? "НЕ ТУДА" : "МИМО", "#e74c3c");
    showGrade(reason === "wrong" ? "НЕ ТУДА" : "МИМО", "grade-miss");
    if (audioCtx) blip(audioCtx.currentTime, 160, 0.1, 0.08, "sawtooth");
    updateHud();
  }

  function onStray(slot) {
    strays += 1;
    attack = Math.max(0, attack - 0.03);
    pushFlash(slot, "ПУСТО", "#9aa7b8");
    showGrade("ПУСТО", "grade-miss");
    if (audioCtx) blip(audioCtx.currentTime, 200, 0.05, 0.04, "sine");
    updateHud();
  }

  function pressSlot(slotId) {
    if (phase !== "play") return;
    const slot = SLOT_BY_ID.get(slotId);
    if (!slot) return;

    const t = songTime();
    const note = nearestActiveNote(t);
    if (!note) {
      // Free warm-up: let the player tap along during the count-in.
      if (t < LEAD_IN_BEATS * BEAT) {
        spawnSparks(slot, 4, false);
        if (audioCtx) blip(audioCtx.currentTime, 520, 0.04, 0.03, "sine");
        return;
      }
      onStray(slot);
      return;
    }

    if (note.slot !== slotId) {
      onMiss(note, "wrong");
      return;
    }

    const dt = Math.abs(note.time - t);
    onHit(note, dt <= PERFECT_WINDOW ? "perfect" : "good");
  }

  function autoMiss(t) {
    for (const note of chart) {
      if (note.judged) continue;
      if (t > note.time + GOOD_WINDOW) onMiss(note, "late");
    }
  }

  function finish() {
    phase = "result";
    const acc = Math.round(accuracy() * 100);
    statusEl.hidden = false;
    statusEl.innerHTML =
      `АТАКА ЗАКОНЧЕНА<br><span style="font-size:17px;font-weight:600">` +
      `Точность ${acc}% · макс комбо ${maxCombo}<br>` +
      `Щелчков забито: ${shots} · пустых: ${strays}</span>`;
    restartBtn.hidden = false;
    gradeFlash.hidden = true;
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

    const target = SLOT_BY_ID.get(puckSlot);
    if (target) {
      puckPos.x += (target.x - puckPos.x) * Math.min(1, 9 * dt);
      puckPos.y += (target.y - puckPos.y) * Math.min(1, 9 * dt);
    }

    if (phase !== "play") return;

    scheduleMetronome();
    const t = songTime();
    autoMiss(t);
    // Attack bleeds slowly so idling never keeps it topped up.
    attack = Math.max(0, attack - 0.02 * dt);
    updateHud();

    if (t >= songEndsAt) finish();
  }

  // ---------- RENDER ----------

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rinkRect() {
    const padTop = 100;
    const padBottom = 124;
    const padX = 18;
    const availW = Math.max(120, W - padX * 2);
    const availH = Math.max(160, H - padTop - padBottom);
    // Follow the viewport: wide zone on landscape, taller zone on phones.
    const aspect = Math.max(0.85, Math.min(1.5, (availW / availH) * 0.82));
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
    return Math.max(16, Math.min(42, rink.w * 0.078));
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

    // Blue line and center dot.
    ctx.strokeStyle = "rgba(60, 120, 200, 0.5)";
    ctx.lineWidth = Math.max(3, rink.w * 0.012);
    ctx.beginPath();
    ctx.moveTo(rink.x, rink.y + rink.h * 0.55);
    ctx.lineTo(rink.x + rink.w, rink.y + rink.h * 0.55);
    ctx.stroke();

    // Goal crease + frame at the top.
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

    ctx.strokeStyle = "rgba(255, 70, 70, 0.3)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const x = cx - goalW / 2 + (goalW * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, rink.y + 2);
      ctx.lineTo(x, rink.y + rink.h * 0.045);
      ctx.stroke();
    }
  }

  function noteState(slotId, t) {
    // Closest unjudged note for this slot inside the approach window.
    let best = null;
    let bestAbs = Infinity;
    for (const note of chart) {
      if (note.judged || note.slot !== slotId) continue;
      const d = note.time - t;
      if (d > APPROACH || d < -GOOD_WINDOW) continue;
      if (Math.abs(d) < bestAbs) {
        bestAbs = Math.abs(d);
        best = note;
      }
    }
    return best;
  }

  function drawPlayer(rink, slot, t) {
    const p = toScreen(rink, slot.x, slot.y);
    const r = playerRadius(rink);
    const note = noteState(slot.id, t);
    const dt = note ? note.time - t : Infinity;
    const near = note ? Math.max(0, 1 - Math.abs(dt) / APPROACH) : 0;
    const isShot = note ? note.shot : false;

    // Shadow.
    ctx.fillStyle = "rgba(20, 40, 70, 0.18)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.75, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stick.
    ctx.strokeStyle = "#1b2433";
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x + r * 0.5, p.y + r * 0.1);
    ctx.lineTo(p.x + r * 1.25, p.y + r * 0.85);
    ctx.stroke();

    // Body.
    const bodyLift = near * r * 0.12;
    const grad = ctx.createLinearGradient(p.x, p.y - r - bodyLift, p.x, p.y + r);
    if (isShot) {
      grad.addColorStop(0, "#ff9a40");
      grad.addColorStop(1, "#c1450a");
    } else {
      grad.addColorStop(0, "#2f5f9e");
      grad.addColorStop(1, "#16304f");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y - bodyLift, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = near > 0.05
      ? `rgba(255, 240, 200, ${0.35 + near * 0.6})`
      : "rgba(232, 244, 255, 0.3)";
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.stroke();

    // Jersey number band.
    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - bodyLift + r * 0.15, r * 0.6, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // Key label.
    ctx.fillStyle = "rgba(8, 18, 32, 0.9)";
    ctx.font = `700 ${Math.round(r * 0.78)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(slot.id, p.x, p.y - bodyLift);

    // Approach ring.
    if (note && dt > -GOOD_WINDOW) {
      const prog = Math.max(0, Math.min(1, dt / APPROACH));
      const ringR = r * (1 + prog * 2.6);
      const alpha = 0.25 + (1 - prog) * 0.7;
      ctx.strokeStyle = isShot
        ? `rgba(255, 140, 40, ${alpha})`
        : `rgba(140, 240, 255, ${alpha})`;
      ctx.lineWidth = Math.max(2, r * (isShot ? 0.24 : 0.16));
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // Hit halo right at the beat.
      if (Math.abs(dt) <= GOOD_WINDOW) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawPuck(rink) {
    const p = toScreen(rink, puckPos.x, puckPos.y);
    const r = Math.max(5, playerRadius(rink) * 0.26);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 1.3, r * 1.2, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0d1218";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(140, 240, 255, 0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawSparks(rink) {
    for (const s of sparks) {
      const p = toScreen(rink, s.x, s.y);
      const a = s.life / s.max;
      ctx.fillStyle = s.hot
        ? `rgba(255, 180, 90, ${0.8 * a})`
        : `rgba(255, 255, 255, ${0.7 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, 4 * a), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFlashes(rink) {
    const r = playerRadius(rink);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of flashes) {
      const slot = SLOT_BY_ID.get(f.slot);
      if (!slot) continue;
      const p = toScreen(rink, slot.x, slot.y);
      const a = f.life / f.max;
      const rise = (1 - a) * r * 1.3;
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.fillStyle = f.color;
      ctx.font = `800 ${Math.round(r * 0.5)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(f.text, p.x, p.y - r * 1.5 - rise);
      ctx.globalAlpha = 1;
    }
  }

  function drawBeatPulse(rink, t) {
    if (phase !== "play") return;
    const beat = t / BEAT;
    const frac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - frac * 3);
    if (pulse <= 0) return;
    ctx.strokeStyle = `rgba(140, 240, 255, ${0.1 + pulse * 0.22})`;
    ctx.lineWidth = 2 + pulse * 4;
    roundRect(rink.x, rink.y, rink.w, rink.h, Math.min(48, rink.w * 0.14));
    ctx.stroke();
  }

  function drawCountIn(rink, t) {
    if (phase !== "play") return;
    const leadEnd = LEAD_IN_BEATS * BEAT;
    if (t < 0 || t >= leadEnd) return;

    const beatsLeft = Math.ceil((leadEnd - t) / BEAT);
    const frac = 1 - (((leadEnd - t) / BEAT) % 1);
    const pop = 1 + Math.max(0, 1 - frac * 4) * 0.3;
    const cx = rink.x + rink.w / 2;
    const cy = rink.y + rink.h / 2;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (beatsLeft > 4) {
      ctx.fillStyle = "rgba(22, 52, 88, 0.72)";
      ctx.font = `800 ${Math.round(rink.w * 0.06)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText("ЛОВИ ТЕМП", cx, cy);
      ctx.fillStyle = "rgba(40, 84, 128, 0.62)";
      ctx.font = `600 ${Math.round(rink.w * 0.032)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText("можно постучать по своим — без штрафа", cx, cy + rink.w * 0.065);
    } else {
      ctx.fillStyle = `rgba(22, 52, 88, ${0.3 + Math.max(0, 1 - frac * 3) * 0.45})`;
      ctx.font = `800 ${Math.round(rink.w * 0.16 * pop)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(String(beatsLeft), cx, cy);
    }
    ctx.restore();
  }

  function drawHint(rink, t) {
    if (phase !== "play") return;
    const hint = currentHint(t);
    if (!hint) return;
    const local = (t - LEAD_IN_BEATS * BEAT) % (PHRASE_BEATS * BEAT);
    const fade = Math.min(1, local / 0.25) * Math.min(1, (PHRASE_BEATS * BEAT - local) / 0.6);

    ctx.save();
    ctx.globalAlpha = Math.max(0, fade) * 0.85;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#a9c9e6";
    ctx.font = `600 ${Math.round(Math.min(22, rink.w * 0.04))}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(hint, rink.x + rink.w / 2, rink.y - 20);
    ctx.restore();
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
    const t = phase === "play" ? songTime() : -99;

    drawRink(rink);
    drawBeatPulse(rink, t);
    drawPuck(rink);

    for (const slot of SLOTS) drawPlayer(rink, slot, t);

    drawSparks(rink);
    drawFlashes(rink);
    drawCountIn(rink, t);
    drawHint(rink, t);

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
      if (phase === "ready") startRun();
      else if (phase === "result") startRun();
      return;
    }
    const slot = SLOT_BY_CODE.get(e.code);
    if (slot) {
      e.preventDefault();
      pressSlot(slot.id);
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (phase === "ready") {
      startRun();
      return;
    }
    if (phase !== "play") return;

    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const rink = rinkRect();
    const r = playerRadius(rink);

    let best = null;
    let bestD = Infinity;
    for (const slot of SLOTS) {
      const p = toScreen(rink, slot.x, slot.y);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestD) {
        bestD = d;
        best = slot;
      }
    }
    if (best && bestD <= r * 2.4) pressSlot(best.id);
  });

  startBtn.addEventListener("click", startRun);
  restartBtn.addEventListener("click", startRun);
  window.addEventListener("resize", resize);

  chart = buildChart();
  songEndsAt = chart[chart.length - 1].time + OUTRO_TIME;
  updateHud();
  resize();
  requestAnimationFrame((ts) => {
    lastTs = ts;
    loop(ts);
  });
})();
