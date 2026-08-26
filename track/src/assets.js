// Новый арт-пак. Пути относительно track/index.html.

const ASSET_SRC = {
  comrade: "../assets/new/comrade.png",
  comradeLeft: "../assets/new/comrade_left.png",
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
  scuff: "../assets/new/scrabs.png",
  hit: "../assets/hit.png",
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
