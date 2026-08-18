// Маленькие чистые помощники. Без состояния и без импортов.

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function easeInOut(t) {
  const u = clamp01(t);
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}

/** Детерминированный «шум» 0..1 по индексу — расстановка декора без Random. */
export function hash01(i) {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Кубическое сглаживание 0..1 (smoothstep). */
export function smoothstep(t) {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

const rgbCache = new Map();

/** "#rrggbb" → "r,g,b". Результат кешируется: вызывается каждый кадр. */
export function hexToRgbStr(hex) {
  const key = hex || "#14081f";
  let cached = rgbCache.get(key);
  if (cached) return cached;
  const h = key.replace("#", "");
  cached = `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
  rgbCache.set(key, cached);
  return cached;
}

export const randomSide = () => (Math.random() < 0.5 ? -1 : 1);
