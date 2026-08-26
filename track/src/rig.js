// ============================================================================
// ПАНЕЛЬ СТЕНДА ?rig=1
// ----------------------------------------------------------------------------
// Живые ручки камеры и шаг шайбы поверх pose-курса. В игру не вмешивается,
// пока флага нет: модуль подключается динамическим импортом из main.js.
// ============================================================================

import { SPEED, STEER } from "./balance.js";
import { CAM, CORRIDOR, LENS } from "./tuning.js";
import { POSE, poseOf } from "./pose.js";
import { S } from "./state.js";
import { project, syncCamera } from "./camera.js";
import { clamp } from "./util.js";
import { resetRun } from "./flow.js";

const KINDS = [
  { id: "enemy", label: "Красные" },
  { id: "pair", label: "Двое" },
  { id: "easy", label: "Лёгкие" },
  { id: "ally", label: "Союзники" },
];

const AXES = [
  { key: "x", step: 4, min: -240, max: 240 },
  { key: "y", step: 2, min: -80, max: 80 },
  { key: "rot", step: 2, min: -60, max: 60 },
  { key: "yaw", step: 4, min: -180, max: 180 },
];

function clonePose(src) {
  const out = {};
  for (const kind of Object.keys(src)) {
    out[kind] = {
      L: { ...src[kind].L },
      R: { ...src[kind].R },
    };
  }
  return out;
}

const SNAP = {
  height: CAM.height,
  focal: CAM.focal,
  horizonFrac: CAM.horizonFrac,
  back: CAM.back || 0,
  pose: clonePose(POSE),
};

const STEP = {
  focal: 20,
  height: 2,
  horizonFrac: 0.01,
  back: 10,
  z: 50,
};

function fmt(n, digits = 0) {
  return Number(n).toFixed(digits);
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

function copyCam() {
  copyText(
    [
      `CAM.focal = ${fmt(CAM.focal, 0)};`,
      `CAM.height = ${fmt(CAM.height, 1)};`,
      `CAM.horizonFrac = ${fmt(CAM.horizonFrac, 3)};`,
      `CAM.back = ${fmt(CAM.back || 0, 1)};`,
    ].join("\n"),
  );
}

function copyPose() {
  const lines = [];
  for (const { id } of KINDS) {
    for (const side of ["L", "R"]) {
      const p = POSE[id][side];
      lines.push(
        `POSE.${id}.${side}.x = ${fmt(p.x, 1)};`,
        `POSE.${id}.${side}.y = ${fmt(p.y, 1)};`,
        `POSE.${id}.${side}.rot = ${fmt(p.rot, 1)};`,
        `POSE.${id}.${side}.yaw = ${fmt(p.yaw, 1)};`,
      );
    }
  }
  copyText(lines.join("\n"));
}

function resetCam() {
  CAM.focal = SNAP.focal;
  CAM.height = SNAP.height;
  CAM.horizonFrac = SNAP.horizonFrac;
  CAM.back = SNAP.back;
}

function resetPlayers() {
  const snap = clonePose(SNAP.pose);
  for (const kind of Object.keys(POSE)) {
    Object.assign(POSE[kind].L, snap[kind].L);
    Object.assign(POSE[kind].R, snap[kind].R);
  }
}

function bumpPose(side, axis, dir) {
  const spec = AXES.find((a) => a.key === axis);
  if (!spec || !S.rig) return;
  const slot = poseOf(S.rig.poseKind, side);
  slot[axis] = clamp((slot[axis] || 0) + spec.step * dir, spec.min, spec.max);
}

function bumpCam(key, dir) {
  const step = STEP[key] * dir;
  if (key === "focal") CAM.focal = clamp(CAM.focal + step, 80, 1400);
  else if (key === "height") CAM.height = clamp(CAM.height + step, 2, 240);
  else if (key === "horizonFrac") CAM.horizonFrac = clamp(CAM.horizonFrac + step, 0.08, 0.82);
  else if (key === "back") CAM.back = clamp((CAM.back || 0) + step, -80, 520);
}

function setHold(on) {
  S.rig.hold = !!on;
  if (!on) S.lastTs = performance.now();
}

function setBlur(on) {
  S.rig.blur = on;
  document.documentElement.style.setProperty("--lens-blur", `${on ? LENS.blur : 0}px`);
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function hint(text) {
  return el("p", "rig-hint", text);
}

function row(label, valueId, minus, plus) {
  const wrap = el("div", "rig-row");
  wrap.append(el("span", "rig-label", label));
  const val = el("span", "rig-val");
  val.dataset.rig = valueId;
  wrap.append(val);
  const minusBtn = el("button", "rig-btn", "−");
  minusBtn.type = "button";
  minusBtn.addEventListener("click", minus);
  const plusBtn = el("button", "rig-btn", "+");
  plusBtn.type = "button";
  plusBtn.addEventListener("click", plus);
  wrap.append(minusBtn, plusBtn);
  return wrap;
}

function action(label, fn, cls = "rig-btn") {
  const btn = el("button", cls, label);
  btn.type = "button";
  btn.addEventListener("click", fn);
  return btn;
}

function paint() {
  if (!S.rig) return;
  const vals = S.rig.vals;
  if (!vals.z) return;
  syncCamera();
  const puck = S.puck;
  const vz = puck ? puck.vz || 0 : 0;
  const probeZ = puck ? puck.z + Math.max(40, CAM.near + 8) : 0;
  const left = puck ? project(-CORRIDOR.halfW, probeZ, true) : null;
  const right = puck ? project(CORRIDOR.halfW, probeZ, true) : null;
  const px = left && right ? Math.abs(right.sx - left.sx) : 0;

  const set = (id, text) => {
    const node = vals[id];
    if (node) node.textContent = text;
  };

  set("focal", fmt(CAM.focal, 0));
  set("height", fmt(CAM.height, 1));
  set("horizon", fmt(CAM.horizonFrac, 3));
  set("back", fmt(CAM.back || 0, 1));
  const kind = S.rig.poseKind || "enemy";
  for (const side of ["L", "R"]) {
    const p = POSE[kind][side];
    set(`fig${side}x`, fmt(p.x, 1));
    set(`fig${side}y`, fmt(p.y, 1));
    set(`fig${side}rot`, fmt(p.rot, 1));
    set(`fig${side}yaw`, fmt(p.yaw, 1));
  }
  if (S.rig.poseTabs) {
    for (const [id, btn] of Object.entries(S.rig.poseTabs)) {
      btn.classList.toggle("is-on", id === kind);
    }
  }
  set("step", fmt(S.rig.step, 0));
  set("z", puck ? `${fmt(puck.z, 0)} / ${fmt(S.runDist, 0)}` : "—");
  set("speed", `${fmt(vz, 0)}  ·  ${fmt(vz * SPEED.kmhScale, 1)} км/ч`);
  set("lane", `${CORRIDOR.halfW} / ${STEER.maxX}`);
  set("px", px ? `${fmt(px, 0)} px` : "—");
  if (S.rig.autoBtn) S.rig.autoBtn.textContent = S.rig.auto ? "Авто: вкл" : "Авто: выкл";
  if (S.rig.holdBtn) {
    S.rig.holdBtn.textContent = S.rig.hold ? "Стоп: вкл" : "Стоп: выкл";
    S.rig.holdBtn.classList.toggle("is-on", !!S.rig.hold);
  }
  if (S.rig.blurBtn) S.rig.blurBtn.textContent = S.rig.blur ? "Блюр: вкл" : "Блюр: выкл";
}

export function initRig() {
  if (!S.rig) {
    S.rig = {
      auto: false,
      hold: false,
      pending: 0,
      step: 200,
      blur: true,
      vals: {},
      autoBtn: null,
      blurBtn: null,
      holdBtn: null,
      poseKind: "enemy",
      poseTabs: {},
    };
  }
  if (!S.rig.poseKind) S.rig.poseKind = "enemy";
  if (S.rig.ready) return;

  const panel = el("aside", "rig-panel");
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  panel.addEventListener("click", (e) => e.stopPropagation());

  panel.append(el("h2", "rig-title", "RIG"));

  const holdBtn = action("Стоп: выкл", () => setHold(!S.rig.hold));
  S.rig.holdBtn = holdBtn;
  panel.append(holdBtn, hint("Мир замирает, плашки нет. Камеру крутить можно, +шаг тоже."));

  const puckSec = el("section", "rig-sec");
  puckSec.append(el("div", "rig-sec-title", "Шайба"));
  const stepRow = el("div", "rig-actions");
  stepRow.append(
    action("−шаг", () => {
      S.rig.auto = false;
      S.rig.pending -= S.rig.step;
    }),
    action("+шаг", () => {
      S.rig.auto = false;
      S.rig.pending += S.rig.step;
    }),
  );
  puckSec.append(stepRow);
  puckSec.append(
    row(
      "шаг",
      "step",
      () => {
        S.rig.step = clamp(S.rig.step - STEP.z, 40, 800);
      },
      () => {
        S.rig.step = clamp(S.rig.step + STEP.z, 40, 800);
      },
    ),
  );
  const autoBtn = action("Авто: выкл", () => {
    S.rig.auto = !S.rig.auto;
    if (S.rig.auto) S.rig.pending = 0;
  });
  S.rig.autoBtn = autoBtn;
  puckSec.append(
    autoBtn,
    action("В начало", () => {
      S.rig.pending = 0;
      resetRun({});
    }),
    hint("шаг — сколько z за клик. Авто — непрерывный ход. В начало — сброс курса."),
  );
  panel.append(puckSec);

  const camSec = el("section", "rig-sec");
  camSec.append(el("div", "rig-sec-title", "Камера"));
  camSec.append(
    row("зум", "focal", () => bumpCam("focal", -1), () => bumpCam("focal", 1)),
    hint("focal: больше — телевик, предметы крупнее, коридор уже."),
    row("высота", "height", () => bumpCam("height", -1), () => bumpCam("height", 1)),
    hint("глаз над льдом. выше — больше пола, меньше «из шайбы»."),
    row("угол", "horizon", () => bumpCam("horizonFrac", -1), () => bumpCam("horizonFrac", 1)),
    hint("линия горизонта. больше — горизонт ниже по экрану, смотрим вдаль."),
    row("отъезд", "back", () => bumpCam("back", -1), () => bumpCam("back", 1)),
    hint("камера дальше за шайбой. больше — мир мельче, коридор шире."),
  );
  const camActs = el("div", "rig-actions");
  camActs.append(action("Сброс камеры", resetCam), action("Скопировать", copyCam));
  camSec.append(camActs);
  panel.append(camSec);

  const figSec = el("section", "rig-sec");
  figSec.append(el("div", "rig-sec-title", "Игроки"));
  const tabs = el("div", "rig-tabs");
  S.rig.poseTabs = {};
  for (const { id, label } of KINDS) {
    const btn = action(label, () => {
      S.rig.poseKind = id;
    });
    S.rig.poseTabs[id] = btn;
    tabs.append(btn);
  }
  figSec.append(tabs, hint("Двое — прыжковая пара навстречу. Одиночные красные живут во вкладке Красные."));
  for (const [hand, title, sign] of [
    ["L", "Левые", -1],
    ["R", "Правые", 1],
  ]) {
    figSec.append(el("div", "rig-sub", title));
    for (const axis of AXES) {
      figSec.append(
        row(
          axis.key,
          `fig${hand}${axis.key}`,
          () => bumpPose(sign, axis.key, -1),
          () => bumpPose(sign, axis.key, 1),
        ),
      );
    }
  }
  figSec.append(
    hint("x — вправо по миру. y — вверх. rot — наклон в кадре вокруг крюка. yaw — вокруг вертикали, сверху по часовой."),
  );
  const figActs = el("div", "rig-actions");
  figActs.append(action("Сброс игроков", resetPlayers), action("Скопировать", copyPose));
  figSec.append(figActs);
  panel.append(figSec);

  const frameSec = el("section", "rig-sec");
  frameSec.append(el("div", "rig-sec-title", "Кадр"));
  const blurBtn = action("Блюр: вкл", () => setBlur(!S.rig.blur));
  S.rig.blurBtn = blurBtn;
  frameSec.append(blurBtn, hint("размытие к краям. часто «съедает» ширину трека."));
  panel.append(frameSec);

  const readSec = el("section", "rig-sec");
  readSec.append(el("div", "rig-sec-title", "Счётчики"));
  for (const [id, label] of [
    ["z", "z / run"],
    ["speed", "скорость"],
    ["lane", "halfW / maxX"],
    ["px", "коридор px"],
  ]) {
    const wrap = el("div", "rig-read");
    wrap.append(el("span", "rig-label", label));
    const val = el("span", "rig-val");
    val.dataset.rig = id;
    wrap.append(val);
    readSec.append(wrap);
  }
  readSec.append(hint("halfW — полуширина коридора в мире. maxX — предел руля. px — ширина коридора на экране прямо перед шайбой."));
  panel.append(readSec);

  for (const node of panel.querySelectorAll("[data-rig]")) {
    S.rig.vals[node.dataset.rig] = node;
  }

  document.body.append(panel);
  document.body.classList.add("rig-open");
  S.rig.ready = true;

  const tick = () => {
    paint();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
