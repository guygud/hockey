// Размер холста. W/H экспортируются как live-биндинги: писать в них может
// только этот модуль, читать — все остальные.

import { canvas, ctx } from "./dom.js";

export let W = 0;
export let H = 0;
export let dpr = 1;

export function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  W = rect.width;
  H = rect.height;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export const isTouchUi = () => document.body.classList.contains("touch-ui");
