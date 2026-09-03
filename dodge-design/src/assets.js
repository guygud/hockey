// Неоновый арт-пак. Пути относительно dodge-design/index.html.

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
  konki: "../assets/konki.png",
  comradeSmall: "../assets/new/comrade_small.png",
};

export const imgs = {};
for (const [key, src] of Object.entries(ASSET_SRC)) {
  const img = new Image();
  img.src = src;
  imgs[key] = img;
}

export function imgReady(img) {
  return !!(img && img.complete && img.naturalWidth > 0);
}

const cutCache = new Map();

/**
 * Спрайты на чёрном фоне — вырезаем один раз в offscreen-канву.
 * При отказе getImageData отдаём исходник.
 */
function cutBlackBg(key, img) {
  if (cutCache.has(key)) return cutCache.get(key);
  if (!imgReady(img)) return null;
  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, c.width, c.height);
    const p = data.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i] < 22 && p[i + 1] < 22 && p[i + 2] < 22) p[i + 3] = 0;
    }
    x.putImageData(data, 0, 0);
    cutCache.set(key, c);
    return c;
  } catch (err) {
    cutCache.set(key, img);
    return img;
  }
}

/** Ближний план: только лезвия коньков. */
export function konkiSprite() {
  return cutBlackBg("konki", imgs.konki);
}

/** Дальний план за треком: игрок целиком. */
export function comradeSprite() {
  return cutBlackBg("comradeSmall", imgs.comradeSmall);
}
