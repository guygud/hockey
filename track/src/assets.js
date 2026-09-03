// Новый арт-пак. Пути относительно track/index.html.
// Подними ASSET_VER после замены картинок — браузер не возьмёт старый кэш.

export const ASSET_VER = 7;

const ASSET_SRC = {
  comrade: "../assets/new/comrade.png",
  comradeLeft: "../assets/new/comrade_left.png",
  comradeSmall: "../assets/new/comrade_small.png",
  comradeSmallLeft: "../assets/new/comrade_small_left.png",
  enemy: "../assets/new/enemy.png",
  enemyLeft: "../assets/new/enemy_left.png",
  enemyEasyLeft: "../assets/new/enemy_easy_left.png",
  enemyEasyRight: "../assets/new/enemy_easy_right.png",
  puck: "../assets/new/shaiba.png",
  ice: "../assets/new/ice.png",
  gate: "../assets/new/gate.svg",
  board: "../assets/new/board.png",
  tribune: "../assets/new/tribune.png",
  gater: "../assets/new/gater.png",
  speed: "../assets/new/speed.png",
  flashs: "../assets/new/flashs.png",
  conus: "../assets/new/conus.png",
  hook: "../assets/new/hook.png",
  scuff: "../assets/new/scrabs.png",
  hit: "../assets/hit.png",
};

export const imgs = {};
for (const [key, src] of Object.entries(ASSET_SRC)) {
  const img = new Image();
  img.src = `${src}?v=${ASSET_VER}`;
  imgs[key] = img;
}

export function imgReady(img) {
  if (!img) return false;
  if (img.naturalWidth > 0) return true;
  return !!(img.width && img.height);
}

const cutCache = new Map();

/** Свои за треком: PNG с чёрным полем, вырезаем один раз. */
function cutBlackBg(key, img) {
  if (cutCache.has(key)) return cutCache.get(key);
  if (!imgReady(img)) return null;
  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
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

/** Союзник за треком: small справа, small_left слева. */
export function comradeSmallSprite(side) {
  return side < 0
    ? cutBlackBg("comradeSmallLeft", imgs.comradeSmallLeft)
    : cutBlackBg("comradeSmall", imgs.comradeSmall);
}
