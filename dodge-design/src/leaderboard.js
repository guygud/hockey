// ============================================================================
// РЕЙТИНГ
// ----------------------------------------------------------------------------
// После проигрыша: записать лучший счёт, показать топ-10.
// Имя живёт в sessionStorage (см. names.js).
// ============================================================================

import { ui } from "./dom.js";
import { ensurePlayer } from "./names.js";
import { SUPABASE_URL, supabaseHeaders } from "./supabase.js";

let ratingToken = 0;

const TOP_N = 10;
const rest = (path) => `${SUPABASE_URL}/rest/v1${path}`;

async function supabaseFetch(path, opts = {}) {
  const res = await fetch(rest(path), {
    ...opts,
    headers: supabaseHeaders(opts.headers || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const raw = await res.text();
  return raw ? JSON.parse(raw) : null;
}

async function upsertScore(player, goals) {
  return supabaseFetch("/scores?on_conflict=player_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      player_id: player.id,
      name: player.name,
      goals: Math.max(0, Math.floor(goals)),
    }),
  });
}

async function fetchTop() {
  const rows = await supabaseFetch(
    `/scores?select=player_id,name,goals&order=goals.desc,updated_at.asc&limit=${TOP_N}`
  );
  return Array.isArray(rows) ? rows : [];
}

async function fetchOwn(playerId) {
  const rows = await supabaseFetch(
    `/scores?select=player_id,name,goals&player_id=eq.${encodeURIComponent(playerId)}&limit=1`
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function fetchRank(goals) {
  const res = await fetch(
    rest(`/scores?select=player_id&goals=gt.${Math.max(0, Math.floor(goals))}`),
    {
      headers: supabaseHeaders({ Prefer: "count=exact", Range: "0-0" }),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const range = res.headers.get("content-range");
  // "0-0/12" или "*/0"
  const total = range && range.includes("/") ? Number(range.split("/")[1]) : NaN;
  return Number.isFinite(total) ? total + 1 : null;
}

async function submitAndFetch(player, goals) {
  await upsertScore(player, goals);
  const top = await fetchTop();
  const inTop = top.findIndex((row) => row.player_id === player.id);
  if (inTop >= 0) {
    return { ok: true, top, rank: inTop + 1, best: top[inTop].goals };
  }
  const own = await fetchOwn(player.id);
  const best = own ? own.goals : goals;
  const rank = await fetchRank(best);
  return { ok: true, top, rank, best };
}

function fillYou(player, goals) {
  if (ui.ratingName) ui.ratingName.textContent = player.name;
  if (ui.ratingScore) ui.ratingScore.textContent = `голов ${goals}`;
}

function fillList(top, playerId) {
  const list = ui.ratingList;
  if (!list) return;
  list.replaceChildren();
  top.forEach((row, i) => {
    const li = document.createElement("li");
    if (row.player_id === playerId) li.classList.add("is-you");
    const rank = document.createElement("span");
    rank.className = "rating-rank";
    rank.textContent = String(i + 1);
    const name = document.createElement("span");
    name.className = "rating-nick";
    name.textContent = row.name;
    const goals = document.createElement("span");
    goals.className = "rating-goals";
    goals.textContent = String(row.goals);
    li.append(rank, name, goals);
    list.append(li);
  });
}

function fillMeta(result, playerId) {
  const inTop = result.top.some((row) => row.player_id === playerId);
  if (ui.ratingPlace) {
    if (result.ok && !inTop && result.rank != null) {
      ui.ratingPlace.hidden = false;
      ui.ratingPlace.textContent = `Ваше место: ${result.rank}`;
    } else {
      ui.ratingPlace.hidden = true;
      ui.ratingPlace.textContent = "";
    }
  }
  if (ui.ratingError) {
    ui.ratingError.hidden = result.ok;
  }
}

export function hideRating() {
  ratingToken += 1;
  if (ui.ratingOverlay) ui.ratingOverlay.hidden = true;
  document.body.classList.remove("rating-open");
}

/** Показать модалку сразу, рейтинг дорисовать когда ответит сеть. */
export function showRating(goals) {
  const player = ensurePlayer();
  fillYou(player, goals);
  if (ui.ratingList) ui.ratingList.replaceChildren();
  if (ui.ratingPlace) {
    ui.ratingPlace.hidden = true;
    ui.ratingPlace.textContent = "";
  }
  if (ui.ratingError) ui.ratingError.hidden = true;
  if (ui.ratingOverlay) ui.ratingOverlay.hidden = false;
  document.body.classList.add("rating-open");

  ui.status.hidden = true;
  ui.status.className = "";
  ui.restartBtn.hidden = true;
  ui.reportAltBtn.hidden = true;

  const token = ++ratingToken;

  submitAndFetch(player, goals)
    .then((result) => {
      if (ratingToken !== token || !ui.ratingOverlay || ui.ratingOverlay.hidden) return;
      fillList(result.top, player.id);
      fillMeta(result, player.id);
    })
    .catch(() => {
      if (ratingToken !== token || !ui.ratingOverlay || ui.ratingOverlay.hidden) return;
      fillList([], player.id);
      fillMeta({ ok: false, top: [], rank: null }, player.id);
    });
}
