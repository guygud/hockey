// ============================================================================
// ЗАЕЗДЫ
// ----------------------------------------------------------------------------
// Заезд — тема кадра плюс набор модификаторов баланса.
//   gapMul  — зазор между препятствиями
//   gateMul — ширина свободного прохода
//   drainMul — расход инерции
// ============================================================================

import { ICE_MARKS } from "./tuning.js";

const HOOD = ["#5a3a88", "#2a1648"];

/** Нейтральный заезд: обучение и разминка, никаких модификаторов. */
export const ROUND_NEUTRAL = {
  id: "clean",
  name: "РАЗМИНКА",
  bpm: 0,
  emojis: ICE_MARKS.emojis,
  theme: {
    shell: "#2a3a58",
    strip: ["#9aa8d4", "#c4cce8", "#dde4f4"],
    floor: ["#d4ebf6", "#b4d8ee", "#8ec4e0"],
    lane: ["rgba(40,90,150,0.06)", "rgba(40,90,160,0.38)"],
    lines: "50,80,120",
    hood: HOOD,
  },
  mods: {},
};

export const ROUNDS = [
  {
    id: "night",
    name: "НОЧНАЯ СМЕНА",
    bpm: 118,
    emojis: ["❄️", "🌙", "🧊", "⭐"],
    theme: {
      shell: "#243050",
      strip: ["#7a8ab8", "#a8b4d8", "#c8d4ec"],
      floor: ["#c0d8ee", "#9cc4e4", "#78b0d6"],
      lane: ["rgba(40,80,160,0.07)", "rgba(80,130,210,0.4)"],
      lines: "40,70,120",
      hood: HOOD,
    },
    // Просторнее и мягче: дышащий заезд между двумя злыми.
    mods: { gapMul: 1.1, gateMul: 1.08 },
  },
  {
    id: "blitz",
    name: "БЛИЦ",
    bpm: 140,
    emojis: ["⚡", "🎯", "🏒"],
    theme: {
      shell: "#1e3a40",
      strip: ["#7aa8b0", "#a8d0d4", "#c8e8e8"],
      floor: ["#c4ece8", "#98d8d4", "#70c4c0"],
      lane: ["rgba(20,120,120,0.07)", "rgba(20,150,140,0.4)"],
      lines: "30,90,90",
      hood: HOOD,
    },
    // Плотно, но окно шире — темп, а не точность.
    mods: { gapMul: 0.82 },
  },
  {
    id: "forge",
    name: "ПЛАВКА",
    bpm: 128,
    emojis: ["🔥", "🏆", "💥"],
    theme: {
      shell: "#3a2a38",
      strip: ["#c8a8b0", "#e0c8c8", "#f0e0d8"],
      floor: ["#f0dce8", "#e0c4d0", "#d0a8b8"],
      lane: ["rgba(180,80,80,0.07)", "rgba(200,90,70,0.4)"],
      lines: "120,70,70",
      hood: HOOD,
    },
    // Самый злой: больше чужих, больше прыжков, инерция тает быстрее.
    mods: { drainMul: 1.1, gateMul: 0.9, gapMul: 0.92 },
  },
  {
    id: "long",
    name: "ДОЛГИЙ ПУТЬ",
    bpm: 112,
    emojis: ["💎", "👑", "✨"],
    theme: {
      shell: "#2c2848",
      strip: ["#a098c8", "#c8c0e0", "#e0dcf0"],
      floor: ["#dcd4f0", "#c4bce4", "#a8a0d4"],
      lane: ["rgba(90,70,160,0.07)", "rgba(140,110,210,0.4)"],
      lines: "70,60,120",
      hood: HOOD,
    },
    mods: { drainMul: 0.9 },
  },
];
