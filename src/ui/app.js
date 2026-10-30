// @ts-check
// 画面。計算は src/engine/ にあり、ここでは表示だけをする。

import { parseClubData, parseNameData } from "../engine/clubs.js";
import { ATTR_LABEL, ATTRS, grade, overall, TRAITS } from "../engine/players.js";
import { randomSeed } from "../engine/rng.js";
import { leaders, playSeason } from "../engine/season.js";
import { goalDiff, points } from "../engine/table.js";
import { generateWorld, STYLES } from "../engine/world.js";

/**
 * @typedef {import("../engine/clubs.js").Club} Club
 * @typedef {import("../engine/world.js").World} World
 * @typedef {import("../engine/season.js").SeasonResult} SeasonResult
 * @typedef {import("../engine/players.js").Player} Player
 */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * 要素を作る小さな道具
 * @param {string} tag @param {string} [cls] @param {string | number} [text]
 */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = String(text);
  return e;
}

/** @param {number} n */
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** 今の表示に使っているもの */
const view = {
  /** @type {World | null} */ world: null,
  /** @type {SeasonResult | null} */ season: null,
  clubId: "",
};

async function loadData() {
  const [clubJson, nameJson] = await Promise.all(
    ["data/clubs.json", "data/names.json"].map((u) => fetch(u).then((r) => r.json())),
  );
  return { clubs: parseClubData(clubJson).divisions[0].clubs, names: parseNameData(nameJson) };
}

/** @param {string} id */
const clubOf = (id) => /** @type {World} */ (view.world).clubs.find((c) => c.id === id);
/** @param {string} id */
const playerOf = (id) => /** @type {Player} */ (/** @type {World} */ (view.world).players.get(id));

/** @param {string} tab */
function showTab(tab) {
  for (const b of document.querySelectorAll("#tabs button")) {
    b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.tab === tab));
  }
  for (const name of ["table", "leaders", "club", "rounds"]) $(`tab-${name}`).hidden = name !== tab;
}

/** @param {string} clubId */
function openClub(clubId) {
  view.clubId = clubId;
  /** @type {HTMLSelectElement} */ ($("club-select")).value = clubId;
  renderClub();
  showTab("club");
  window.scrollTo({ top: 0 });
}

function renderTable() {
  const season = /** @type {SeasonResult} */ (view.season);
  const n = season.standings.length;
  const tbody = /** @type {HTMLTableSectionElement} */ ($("table").querySelector("tbody"));
  tbody.replaceChildren(
    ...season.standings.map((r, i) => {
      const tr = el("tr", i === 0 ? "champ" : i >= n - 3 ? "down" : "");
      const club = clubOf(r.id);
      const cells = [i + 1, club?.short ?? r.id, r.played, r.won, r.drawn, r.lost, signed(goalDiff(r)), points(r)];
      cells.forEach((v, j) => {
        const td = el("td", j === 1 ? "club" : "", v);
        if (j === 1) {
          const b = el("button", "link", v);
          b.addEventListener("click", () => openClub(r.id));
          td.replaceChildren(b);
        }
        tr.append(td);
      });
      return tr;
    }),
  );
}

function renderLeaders() {
  const season = /** @type {SeasonResult} */ (view.season);
  /** @param {string} title @param {"goals" | "assists"} key @param {string} unit */
  const list = (title, key, unit) => {
    const box = el("div", "card");
    box.append(el("h2", "", title));
    const ol = el("ol", "ranking");
    for (const [id, s] of leaders(season, key, 10)) {
      const li = el("li");
      const who = el("button", "link", playerOf(id).name);
      who.addEventListener("click", () => openClub(s.club));
      li.append(who, el("span", "sub", clubOf(s.club)?.short ?? ""), el("span", "num", `${s[key]}${unit}`));
      ol.append(li);
    }
    box.append(ol);
    return box;
  };
  const injured = el("div", "card");
  injured.append(el("h2", "", "長く休んだ選手"));
  const ol = el("ol", "ranking");
  [...season.stats.entries()]
    .filter(([, s]) => s.weeksOut > 0)
    .sort((a, b) => b[1].weeksOut - a[1].weeksOut)
    .slice(0, 5)
    .forEach(([id, s]) => {
      const li = el("li");
      li.append(el("span", "", playerOf(id).name), el("span", "sub", clubOf(s.club)?.short ?? ""), el("span", "num", `${s.weeksOut} 節`));
      ol.append(li);
    });
  injured.append(ol);
  $("tab-leaders").replaceChildren(list("得点ランキング", "goals", " 点"), list("アシストランキング", "assists", ""), injured);
}

function renderClub() {
  const season = /** @type {SeasonResult} */ (view.season);
  const club = clubOf(view.clubId);
  if (!club) return;
  const pos = season.standings.findIndex((r) => r.id === club.id) + 1;
  const m = club.manager;
  const info = el("div", "card");
  info.append(
    el("h2", "", club.name),
    el("p", "sub", `${pos} 位・勝ち点 ${points(season.standings[pos - 1])}`),
    el("p", "", `監督 ${m.name}（${m.age} 歳）`),
    el("p", "sub", `型 ${STYLES[m.style].label}（${STYLES[m.style].formation}）・采配 ${grade(m.ability)}`),
  );
  $("club-info").replaceChildren(info);

  const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
  const players = club.playerIds.map(playerOf).sort((a, b) => order[a.pos] - order[b.pos] || overall(b) - overall(a));
  const tbody = /** @type {HTMLTableSectionElement} */ ($("squad").querySelector("tbody"));
  tbody.replaceChildren(
    ...players.flatMap((p) => {
      const s = /** @type {import("../engine/season.js").PlayerSeason} */ (season.stats.get(p.id));
      const tr = el("tr", "player");
      const ov = overall(p);
      const nameCell = el("td", "club", `${p.name}${s.injuries > 0 ? " ✚" : ""}`);
      tr.append(el("td", `pos pos-${p.pos}`, p.pos), nameCell, el("td", "", p.age), el("td", "", `${grade(ov)} ${ov}`), el("td", "", s.apps), el("td", "", s.goals), el("td", "", s.assists));
      const detail = el("tr", "detail");
      detail.hidden = true;
      const td = el("td");
      td.setAttribute("colspan", "7");
      td.append(playerDetail(p, s));
      detail.append(td);
      tr.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
      });
      return [tr, detail];
    }),
  );
}

/**
 * @param {Player} p @param {import("../engine/season.js").PlayerSeason} s
 */
function playerDetail(p, s) {
  const box = el("div", "attrs");
  const grid = el("dl", "attr-grid");
  for (const a of ATTRS) {
    if (p.pos !== "GK" && a === "gk") continue;
    const v = p.attrs[a];
    grid.append(el("dt", "", ATTR_LABEL[a]), el("dd", `g-${grade(v)}`, `${grade(v)} ${v}`));
  }
  box.append(grid);
  const traits = p.traits.map((t) => TRAITS[t].label).join("・");
  box.append(el("p", "sub", traits ? `特徴: ${traits}` : "特徴: なし"));
  if (s.injuries > 0) box.append(el("p", "sub", `けが ${s.injuries} 回・休んだ節 ${s.weeksOut}`));
  return box;
}

function renderRounds() {
  const season = /** @type {SeasonResult} */ (view.season);
  const name = (/** @type {string} */ id) => clubOf(id)?.short ?? id;
  $("round-list").replaceChildren(
    ...season.rounds.map((round, i) => {
      const d = /** @type {HTMLDetailsElement} */ (el("details", "round"));
      d.append(el("summary", "", `第 ${i + 1} 節`));
      for (const m of round) {
        const row = el("div", "match");
        row.append(el("span", "home", name(m.home)), el("span", "score", `${m.homeGoals} - ${m.awayGoals}`), el("span", "away", name(m.away)));
        d.append(row);
        if (m.goals.length) {
          const who = m.goals.map((g) => playerOf(g.scorer).name.split("・").pop()).join("、");
          d.append(el("p", "scorers", who));
        }
      }
      return d;
    }),
  );
}

/** @param {World} world @param {SeasonResult} season */
function render(world, season) {
  view.world = world;
  view.season = season;
  if (!view.clubId) view.clubId = world.clubs[0].id;
  /** @type {HTMLSelectElement} */ ($("club-select")).replaceChildren(
    ...world.clubs.map((c) => {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", c.name));
      o.value = c.id;
      return o;
    }),
  );
  /** @type {HTMLSelectElement} */ ($("club-select")).value = view.clubId;
  renderTable();
  renderLeaders();
  renderClub();
  renderRounds();
  $("tabs").hidden = false;
  if ([...document.querySelectorAll(".panel")].every((p) => /** @type {HTMLElement} */ (p).hidden)) showTab("table");
  const champion = clubOf(season.standings[0].id)?.name;
  const [topId, top] = leaders(season, "goals", 1)[0] ?? [];
  $("status").textContent =
    `種 ${season.seed}。優勝は ${champion}（勝ち点 ${points(season.standings[0])}）。` +
    (topId ? `得点王は ${playerOf(topId).name}（${top.goals} 点）。` : "");
}

async function main() {
  const { clubs, names } = await loadData();
  const seedInput = /** @type {HTMLInputElement} */ ($("seed"));
  $("run").addEventListener("click", () => {
    const seed = seedInput.value === "" ? randomSeed() : Number(seedInput.value) >>> 0;
    const world = generateWorld(clubs, names, seed);
    render(world, playSeason(world, seed));
  });
  for (const b of document.querySelectorAll("#tabs button")) {
    b.addEventListener("click", () => showTab(/** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.tab)));
  }
  $("club-select").addEventListener("change", (e) => {
    view.clubId = /** @type {HTMLSelectElement} */ (e.target).value;
    renderClub();
  });
}

main().catch((e) => {
  $("status").textContent = `読み込みに失敗しました: ${e.message}`;
});
