// ============================================================================
// ЗВУК
// ----------------------------------------------------------------------------
// Синтез на лету, без сэмплов: короткие тоны и полосовой шум. Накал заезда
// поднимает питч — симуляция сообщает его через setHeatLevel.
// ============================================================================

import { HEAT } from "./tuning.js";

let audioCtx = null;
let heatLevel = 0;

export function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

export function setHeatLevel(h) {
  heatLevel = h || 0;
}

function pitch() {
  return 1 + heatLevel * HEAT.pitch;
}

export function tone(freqFrom, freqTo, dur, gain, type) {
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

/** Короткий всплеск фильтрованного шума — скрежет клюшки по шайбе. */
export function swish(dur, gain, freq, q) {
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

export const sfx = {
  /** Приём своей клюшки: контакт, щелчок. */
  hit(perfect) {
    const p = pitch();
    if (perfect) {
      tone(760 * p, 1500 * p, 0.1, 0.16, "square");
      tone(380 * p, 620 * p, 0.16, 0.1, "triangle");
      swish(0.22, 0.16, 2600 * p, 0.9);
    } else {
      tone(480 * p, 800 * p, 0.09, 0.11, "square");
      swish(0.18, 0.11, 1800 * p, 0.9);
    }
  },

  /** Уворот — это воздух, а не контакт: лезвие проходит мимо без щелчка. */
  dodge(perfect) {
    const p = pitch();
    swish(perfect ? 0.3 : 0.24, perfect ? 0.16 : 0.11, (perfect ? 1500 : 1100) * p, 0.55);
    tone(300 * p, 190 * p, 0.16, perfect ? 0.07 : 0.05, "sine");
  },

  fail() {
    tone(180, 60, 0.26, 0.2, "sawtooth");
    swish(0.3, 0.14, 320, 0.7);
  },

  /** Нажатие в пустоту. */
  whiff() {
    swish(0.1, 0.06, 900, 1.6);
  },

  /** Рывок вбок: лезвия срезают лёд — длинный шершавый скреб. */
  strafe() {
    const p = pitch();
    swish(0.34, 0.1, 1750 * p, 0.85);
    tone(240 * p, 150 * p, 0.2, 0.05, "triangle");
  },

  goal() {
    tone(520, 780, 0.12, 0.14, "square");
    setTimeout(() => tone(780, 1170, 0.18, 0.14, "square"), 110);
  },

  stall() {
    tone(300, 90, 0.5, 0.16, "triangle");
  },

  flyIn() {
    swish(0.42, 0.14, 900, 0.55);
    tone(220, 520, 0.28, 0.06, "sine");
  },

  /** Въезд на пятак — гол уже засчитан. */
  crease() {
    tone(660, 880, 0.08, 0.07, "sine");
  },
};
