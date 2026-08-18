// Все ссылки на DOM в одном месте: остальной код не ищет элементы сам.

const byId = (id) => document.getElementById(id);

export const canvas = byId("game");
export const ctx = canvas.getContext("2d");

/** Верхний HUD. */
export const hud = {
  stats: document.querySelector(".hud-stats"),
  streak: byId("streak"),
  livesBox: byId("lives-box"),
  hearts: byId("lives-box") ? Array.from(byId("lives-box").querySelectorAll(".heart")) : [],
  levelNum: byId("level-num"),
  levelMul: byId("level-mul"),
  speed: byId("speed"),
};

/** Оверлеи: вспышка оценки, отчёт, интро, пауза, рейтинг. */
export const ui = {
  gradeFlash: byId("brace-flash"),
  status: byId("status"),
  restartBtn: byId("restart-btn"),
  reportAltBtn: byId("report-alt"),
  intro: byId("intro"),
  startBtn: byId("start-btn"),
  pauseBtn: byId("pause-btn"),
  pauseOverlay: byId("pause-overlay"),
  resumeBtn: byId("resume-btn"),
  ratingOverlay: byId("rating-overlay"),
  ratingName: byId("rating-name"),
  ratingScore: byId("rating-score"),
  ratingList: byId("rating-list"),
  ratingPlace: byId("rating-place"),
  ratingError: byId("rating-error"),
  ratingRestart: byId("rating-restart"),
  touchControls: byId("touch-controls"),
};

/** Карточка обучения. */
export const tutorUi = {
  root: byId("tutor"),
  card: byId("tutor") ? byId("tutor").querySelector(".tutor-card") : null,
  title: byId("tutor-title"),
  body: byId("tutor-body"),
  hint: byId("tutor-hint"),
  hideBtn: byId("tutor-hide"),
  againBtn: byId("tutor-again"),
};
