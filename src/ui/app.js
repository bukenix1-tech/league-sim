// @ts-check
// 画面。計算は src/engine/ にあり、ここでは表示とセーブの出し入れだけをする。

import { parseClubData, parseNameData } from "../engine/clubs.js";
import { budgetRange, forecastRevenue, levelFromBudget, oku, totalRevenue } from "../engine/finance.js";
import { AUTO_PROMOTED, chooseClub, createLeague, PLAYOFF_FROM, PLAYOFF_TO, playYear, rowGoalDiff, rowPoints, seasonGoal, setBudget } from "../engine/league.js";
import { divisionOf, seasonBudget } from "../engine/offseason.js";
import { ATTR_LABEL, ATTRS, grade, overall, TRAITS } from "../engine/players.js";
import { randomSeed } from "../engine/rng.js";
import { parseSave, serialize } from "../engine/save.js";
import { STYLES } from "../engine/world.js";
import { loadStoredSave, storeSave } from "./storage.js";

/**
 * @typedef {import("../engine/league.js").League} League
 * @typedef {import("../engine/league.js").YearRecord} YearRecord
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

const ui = {
  /** @type {League | null} */ league: null,
  /** 直前に回したシーズン（試合の結果。セーブには入れない） @type {SeasonResult[] | null} */ seasons: null,
  div: 0,
  clubId: "",
  busy: false,
};

const L = () => /** @type {League} */ (ui.league);
const lastRecord = () => /** @type {YearRecord | undefined} */ (L().history[L().history.length - 1]);
const clubName = (/** @type {string} */ id) => L().clubs[id]?.name ?? id;
const clubShort = (/** @type {string} */ id) => L().clubs[id]?.short ?? id;

/** @param {string} tab */
function showTab(tab) {
  for (const b of document.querySelectorAll("#tabs button")) {
    b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.tab === tab));
  }
  for (const name of ["office", "table", "leaders", "club", "rounds", "history"]) $(`tab-${name}`).hidden = name !== tab;
  $("div-switch").hidden = !["table", "leaders", "rounds"].includes(tab);
}

/** @param {number} div */
function setDiv(div) {
  ui.div = div;
  for (const b of document.querySelectorAll("#div-switch button")) {
    b.setAttribute("aria-pressed", String(Number(/** @type {HTMLElement} */ (b).dataset.div) === div));
  }
  renderTable();
  renderLeaders();
  renderRounds();
}

/** @param {string} clubId */
function openClub(clubId) {
  ui.clubId = clubId;
  /** @type {HTMLSelectElement} */ ($("club-select")).value = clubId;
  renderClub();
  showTab("club");
  window.scrollTo({ top: 0 });
}

/** @param {string} text */
const empty = (text) => el("p", "status", text);

/**
 * 見出しと値の組を並べる
 * @param {[string, string, string?][]} pairs [見出し, 値, 値の class]
 */
function facts(pairs) {
  const dl = el("dl", "facts");
  for (const [k, v, cls] of pairs) dl.append(el("dt", "", k), el("dd", cls ?? "", v));
  return dl;
}

function renderOffice() {
  const u = L().user;
  if (!u) return;
  const club = L().clubs[u.clubId];
  const f = club.finance;
  const { div, n } = divisionOf(L(), club.id);
  const goal = seasonGoal(L(), club.id);
  const rec = lastRecord()?.user;

  const head = el("div", "card mine-card");
  head.append(
    el("h2", "", club.name),
    el("p", "sub", `${L().year} 年は${L().divisions[div].name}・クラブの規模 ${grade(club.level)} ${club.level.toFixed(0)}`),
    facts([
      ["手元のお金", oku(f.cash), f.cash < 0 ? "neg" : ""],
      ["人気（ファン）", `${f.popularity.toFixed(1)} 万人`],
      ["スタジアム", `${f.capacity.toLocaleString()} 席`],
      ["収入の見込み", oku(forecastRevenue(f, div, n))],
    ]),
  );

  const owner = el("div", "card");
  owner.append(el("h2", "", "オーナー"));
  owner.append(el("p", "", `${L().year} 年の目標: ${goal.label}`));
  const bar = el("div", "meter");
  const fill = el("span");
  fill.style.width = `${u.trust}%`;
  bar.append(fill);
  owner.append(el("p", "sub", `信頼 ${u.trust} / 100`), bar);
  if (rec) {
    const e = rec.evaluation;
    owner.append(el("p", "sub", `${lastRecord()?.year} 年: 目標「${e.goal.label}」→ ${e.pos} 位で${e.achieved ? "達成" : "届かず"}。「${e.comment}」`));
  }

  // 年俸の予算
  const range = budgetRange(f, div, n);
  const current = seasonBudget(L(), club);
  const budget = el("div", "card");
  budget.append(el("h2", "", `${L().year} 年の年俸の予算`));
  const value = el("p", "big");
  const hint = el("p", "sub");
  const slider = /** @type {HTMLInputElement} */ (el("input", "slider"));
  slider.type = "range";
  slider.min = String(range.min);
  slider.max = String(range.max);
  slider.step = "0.1";
  slider.value = String(current);
  slider.setAttribute("aria-label", "年俸の予算");
  const show = (/** @type {number} */ b) => {
    const target = levelFromBudget(b);
    value.textContent = oku(b);
    hint.textContent = `補強で目指す強さ ${grade(target)} ${target.toFixed(0)}（今のクラブの規模 ${club.level.toFixed(0)}）`;
  };
  show(current);
  slider.addEventListener("input", () => show(Number(slider.value)));
  slider.addEventListener("change", async () => {
    ui.league = setBudget(L(), Number(slider.value));
    renderOffice();
    await save();
  });
  const mode = el("p", "sub", u.budget === null ? "いまは「おまかせ」（収入とお金の残りから自動で決める）" : "自分で決めた予算");
  budget.append(value, slider, el("p", "sub", `${oku(range.min)} 〜 ${oku(range.max)}`), hint, mode);
  if (u.budget !== null) {
    const reset = el("button", "secondary small", "おまかせに戻す");
    reset.addEventListener("click", async () => {
      ui.league = setBudget(L(), null);
      renderOffice();
      await save();
    });
    budget.append(reset);
  }
  budget.append(
    el(
      "p",
      "sub",
      "予算を上げると、夏の補強で強い選手を取りやすくなり、クラブの規模も上がっていきます。実際に払う年俸は今いる選手で決まるので、" +
        "強い選手がそろうにつれて少しずつ増えます。借金がふくらむと、上げられる上限が下がります。",
    ),
  );

  const nodes = [head, owner, budget];
  if (f.last) {
    const m = f.last;
    const money = el("div", "card");
    money.append(el("h2", "", `${lastRecord()?.year} 年の収支`));
    money.append(
      facts([
        ["入場料", oku(m.revenue.tickets)],
        ["放映権", oku(m.revenue.tv)],
        ["スポンサー", oku(m.revenue.sponsor)],
        ["グッズ", oku(m.revenue.goods)],
        ["収入の合計", oku(totalRevenue(m.revenue)), "strong"],
        ["年俸", `−${oku(m.wages)}`],
        ["運営費", `−${oku(m.ops)}`],
        ["収支", oku(m.profit), m.profit < 0 ? "neg strong" : "strong"],
      ]),
      el("p", "sub", `観客 1 試合 ${m.attendance.toLocaleString()} 人`),
    );
    nodes.push(money);
  }
  $("tab-office").replaceChildren(...nodes);
}

/** @param {number} div */
function renderPicker(div) {
  for (const b of document.querySelectorAll("#picker-div button")) {
    b.setAttribute("aria-pressed", String(Number(/** @type {HTMLElement} */ (b).dataset.div) === div));
  }
  const ids = [...L().divisions[div].clubIds].sort((a, b) => L().clubs[a].level - L().clubs[b].level);
  $("picker-list").replaceChildren(
    ...ids.map((id) => {
      const c = L().clubs[id];
      const li = el("li");
      const b = el("button", "pick");
      b.append(
        el("span", "name", c.name),
        el("span", "sub", `規模 ${grade(c.level)} ${c.level.toFixed(0)}・人気 ${c.finance.popularity.toFixed(0)} 万人・お金 ${oku(c.finance.cash)}`),
      );
      b.addEventListener("click", async () => {
        if (!confirm(`${c.name} の経営者になりますか？`)) return;
        ui.league = chooseClub(L(), id);
        ui.clubId = id;
        await save();
        showGame();
      });
      li.append(b);
      return li;
    }),
  );
}

function showPicker() {
  $("picker").hidden = false;
  for (const id of ["game-controls", "tabs", "div-switch"]) $(id).hidden = true;
  for (const p of document.querySelectorAll(".panel:not(#picker)")) /** @type {HTMLElement} */ (p).hidden = true;
  $("status").textContent = `${L().year} 年。経営するクラブを選んでください（クラブ名を押す）。`;
  renderPicker(1);
}

function showGame() {
  $("picker").hidden = true;
  $("game-controls").hidden = false;
  renderAll();
  showTab("office");
}

function renderTable() {
  const rec = lastRecord();
  const tbody = /** @type {HTMLTableSectionElement} */ ($("table").querySelector("tbody"));
  if (!rec) {
    tbody.replaceChildren();
    $("table-legend").textContent = "まだシーズンを回していません。「1 年進める」を押してください。";
    $("playoff").replaceChildren();
    return;
  }
  const rows = rec.tables[ui.div];
  const n = rows.length;
  tbody.replaceChildren(
    ...rows.map((r, i) => {
      let cls = "";
      if (ui.div === 0) cls = i === 0 ? "champ" : i >= n - 3 ? "down" : "";
      else cls = i < AUTO_PROMOTED ? "champ" : i >= PLAYOFF_FROM - 1 && i < PLAYOFF_TO ? "po" : "";
      const tr = el("tr", `${cls}${r[0] === L().user?.clubId ? " mine" : ""}`);
      const label = `${clubShort(r[0])}${ui.div === 1 && r[0] === rec.playoff.winner ? " ★" : ""}`;
      const cells = [i + 1, label, r[1] + r[2] + r[3], r[1], r[2], r[3], signed(rowGoalDiff(r)), rowPoints(r)];
      cells.forEach((v, j) => {
        const td = el("td", j === 1 ? "club" : "", v);
        if (j === 1) {
          const b = el("button", "link", v);
          b.addEventListener("click", () => openClub(r[0]));
          td.replaceChildren(b);
        }
        tr.append(td);
      });
      return tr;
    }),
  );
  const legend = $("table-legend");
  legend.replaceChildren();
  if (ui.div === 0) {
    legend.append(el("span", "swatch champ"), " 優勝 ", el("span", "swatch down"), " 降格（2 部へ）");
  } else {
    legend.append(el("span", "swatch champ"), " 昇格 ", el("span", "swatch po"), " プレーオフ（★ が勝って昇格）");
  }
  legend.append(el("br"), `${rec.year} 年の${L().divisions[ui.div].name}。クラブ名を押すと選手が見られます`);
  $("playoff").replaceChildren(ui.div === 1 ? playoffCard(rec) : "");
}

/** @param {YearRecord} rec */
function playoffCard(rec) {
  const p = rec.playoff;
  const card = el("div", "card");
  card.append(el("h2", "", "昇格プレーオフ"));
  /** @param {import("../engine/league.js").Score} s */
  const score = (s) => `${clubShort(s.home)} ${s.homeGoals} - ${s.awayGoals} ${clubShort(s.away)}`;
  for (const semi of p.semis) {
    card.append(el("p", "sub", `準決勝 ${score(semi.first)} / ${score(semi.second)} → ${clubShort(semi.winner)}`));
  }
  card.append(el("p", "", `決勝 ${score(p.final)}${p.penalties ? "（PK）" : ""} → ${clubName(p.winner)} が昇格`));
  return card;
}

function renderLeaders() {
  const rec = lastRecord();
  if (!rec) {
    $("tab-leaders").replaceChildren(empty("まだシーズンを回していません。"));
    return;
  }
  /** @param {string} title @param {import("../engine/league.js").LeaderRow[]} rows @param {string} unit */
  const list = (title, rows, unit) => {
    const box = el("div", "card");
    box.append(el("h2", "", title));
    const ol = el("ol", "ranking");
    for (const [name, club, n] of rows) {
      const li = el("li");
      li.append(el("span", "", name), el("span", "sub", clubShort(club)), el("span", "num", `${n}${unit}`));
      ol.append(li);
    }
    box.append(ol);
    return box;
  };
  const { goals, assists } = rec.leaders[ui.div];
  $("tab-leaders").replaceChildren(
    el("p", "status", `${rec.year} 年の${L().divisions[ui.div].name}`),
    list("得点ランキング", goals, " 点"),
    list("アシストランキング", assists, ""),
  );
}

function renderClubSelect() {
  const select = /** @type {HTMLSelectElement} */ ($("club-select"));
  select.replaceChildren(
    ...L().divisions.map((d) => {
      const g = /** @type {HTMLOptGroupElement} */ (el("optgroup"));
      g.label = d.name;
      for (const id of d.clubIds) {
        const o = /** @type {HTMLOptionElement} */ (el("option", "", clubName(id)));
        o.value = id;
        g.append(o);
      }
      return g;
    }),
  );
  if (!L().clubs[ui.clubId]) ui.clubId = L().divisions[0].clubIds[0];
  select.value = ui.clubId;
}

function renderClub() {
  const club = L().clubs[ui.clubId];
  if (!club) return;
  const div = L().divisions.findIndex((d) => d.clubIds.includes(club.id));
  const rec = lastRecord();
  const info = el("div", "card");
  info.append(el("h2", "", club.name));
  info.append(el("p", "sub", `${L().year} 年は${L().divisions[div].name}・クラブの規模 ${grade(club.level)} ${club.level.toFixed(0)}`));
  if (rec) {
    const d = rec.tables.findIndex((t) => t.some((r) => r[0] === club.id));
    const pos = rec.tables[d].findIndex((r) => r[0] === club.id) + 1;
    info.append(el("p", "sub", `${rec.year} 年: ${L().divisions[d].name} ${pos} 位・勝ち点 ${rowPoints(rec.tables[d][pos - 1])}`));
  }
  const m = club.manager;
  info.append(
    el("p", "", `監督 ${m.name}（${m.age} 歳）`),
    el("p", "sub", `型 ${STYLES[m.style].label}（${STYLES[m.style].formation}）・采配 ${grade(m.ability)}`),
  );
  $("club-info").replaceChildren(info);

  const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
  const players = club.playerIds.map((id) => L().players[id]).sort((a, b) => order[a.pos] - order[b.pos] || overall(b) - overall(a));
  const tbody = /** @type {HTMLTableSectionElement} */ ($("squad").querySelector("tbody"));
  tbody.replaceChildren(
    ...players.flatMap((p) => {
      const last = p.last;
      const tr = el("tr", "player");
      const ov = overall(p);
      tr.append(
        el("td", `pos pos-${p.pos}`, p.pos),
        el("td", "club", `${p.name}${last && last.injuries > 0 ? " ✚" : ""}`),
        el("td", "", p.age),
        el("td", "", `${grade(ov)} ${ov}`),
        el("td", "", last ? last.apps : "-"),
        el("td", "", last ? last.goals : "-"),
        el("td", "", p.career?.goals ?? 0),
      );
      const detail = el("tr", "detail");
      detail.hidden = true;
      const td = el("td");
      td.setAttribute("colspan", "7");
      td.append(playerDetail(p));
      detail.append(td);
      tr.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
      });
      return [tr, detail];
    }),
  );
}

/** @param {Player} p */
function playerDetail(p) {
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
  const c = p.career;
  if (c && c.seasons > 0) box.append(el("p", "sub", `通算 ${c.seasons} シーズン・${c.apps} 試合・${c.goals} 点・${c.assists} アシスト`));
  if (p.last && p.last.injuries > 0) box.append(el("p", "sub", `前のシーズンのけが ${p.last.injuries} 回`));
  return box;
}

function renderRounds() {
  const list = $("round-list");
  const season = ui.seasons?.[ui.div];
  if (!season) {
    list.replaceChildren(empty("試合の結果は、このページで進めた直後のシーズンだけ見られます（セーブには入れていません）。"));
    return;
  }
  const players = L().players;
  list.replaceChildren(
    ...season.rounds.map((round, i) => {
      const d = /** @type {HTMLDetailsElement} */ (el("details", "round"));
      d.append(el("summary", "", `第 ${i + 1} 節`));
      for (const m of round) {
        const row = el("div", "match");
        row.append(el("span", "home", clubShort(m.home)), el("span", "score", `${m.homeGoals} - ${m.awayGoals}`), el("span", "away", clubShort(m.away)));
        d.append(row);
        if (m.goals.length) {
          // 引退した選手は名前が残っていないので出さない
          const who = m.goals.map((g) => players[g.scorer]?.name.split("・").pop() ?? "").filter(Boolean).join("、");
          if (who) d.append(el("p", "scorers", who));
        }
      }
      return d;
    }),
  );
}

function renderHistory() {
  const history = L().history;
  if (history.length === 0) {
    $("tab-history").replaceChildren(empty("まだシーズンを回していません。"));
    return;
  }
  /** @type {Map<string, number>} */
  const titles = new Map();
  for (const h of history) titles.set(h.tables[0][0][0], (titles.get(h.tables[0][0][0]) ?? 0) + 1);
  const summary = el("div", "card");
  summary.append(el("h2", "", `1 部の優勝回数（${history.length} 年）`));
  const ol = el("ol", "ranking");
  for (const [id, n] of [...titles.entries()].sort((a, b) => b[1] - a[1])) {
    const li = el("li");
    const b = el("button", "link", clubName(id));
    b.addEventListener("click", () => openClub(id));
    li.append(b, el("span", "num", `${n} 回`));
    ol.append(li);
  }
  summary.append(ol);

  const years = [...history].reverse().map((h) => {
    const card = el("div", "card year");
    const champ = h.tables[0][0];
    card.append(el("h2", "", `${h.year} 年`));
    card.append(el("p", "", `優勝 ${clubName(champ[0])}（勝ち点 ${rowPoints(champ)}）`));
    card.append(el("p", "sub", `2 部優勝 ${clubShort(h.tables[1][0][0])}`));
    card.append(el("p", "sub", `昇格 ${h.promoted.map(clubShort).join("・")}（PO）`));
    card.append(el("p", "sub", `降格 ${h.relegated.map(clubShort).join("・")}`));
    const top = h.leaders[0].goals[0];
    if (top) card.append(el("p", "sub", `得点王 ${top[0]}（${clubShort(top[1])}）${top[2]} 点`));
    if (h.offseason.takeovers.length) card.append(el("p", "sub", `新しいオーナー: ${h.offseason.takeovers.map(clubShort).join("・")}`));
    return card;
  });
  const mine = history.filter((h) => h.user);
  /** @type {HTMLElement[]} */
  const nodes = [];
  if (mine.length) {
    const card = el("div", "card mine-card");
    card.append(el("h2", "", `${clubName(/** @type {any} */ (mine[0].user).clubId)} の歩み`));
    const ol = el("ol", "ranking journey");
    for (const h of [...mine].reverse()) {
      const u = /** @type {import("../engine/league.js").UserRecord} */ (h.user);
      const li = el("li");
      li.append(
        el("span", "", `${h.year} 年 ${L().divisions[u.division].name} ${u.evaluation.pos} 位${u.evaluation.achieved ? "" : "（目標に届かず）"}`),
        el("span", `num ${u.money.profit < 0 ? "neg" : ""}`, oku(u.money.profit)),
      );
      ol.append(li);
    }
    card.append(ol);
    nodes.push(card);
  }
  $("tab-history").replaceChildren(...nodes, summary, ...years);
}

function renderStatus() {
  const rec = lastRecord();
  const u = L().user;
  let text = `${L().year} 年のシーズン前（種 ${L().seed}）。`;
  if (u) text += ` あなたのクラブ: ${clubName(u.clubId)}（${L().divisions[divisionOf(L(), u.clubId).div].name}）。`;
  if (rec) {
    text += ` ${rec.year} 年は ${clubName(rec.tables[0][0][0])} が優勝。昇格 ${rec.promoted.map(clubShort).join("・")}、降格 ${rec.relegated.map(clubShort).join("・")}。`;
  }
  $("status").textContent = text;
}

function renderAll() {
  renderStatus();
  renderOffice();
  renderClubSelect();
  renderTable();
  renderLeaders();
  renderClub();
  renderRounds();
  renderHistory();
  $("tabs").hidden = false;
  if ([...document.querySelectorAll(".panel:not(#picker)")].every((p) => /** @type {HTMLElement} */ (p).hidden)) showTab("office");
}

/** @param {boolean} busy */
function setBusy(busy) {
  ui.busy = busy;
  for (const id of ["next1", "next10", "export", "new"]) /** @type {HTMLButtonElement} */ ($(id)).disabled = busy;
  /** @type {HTMLInputElement} */ ($("import")).disabled = busy;
}

async function save() {
  try {
    await storeSave(serialize(L()));
  } catch (e) {
    $("status").textContent += "（このブラウザにはセーブできませんでした。「書き出し」で控えを取ってください）";
  }
}

/**
 * @param {import("../engine/clubs.js").NameData} names @param {number} years
 */
async function advance(names, years) {
  setBusy(true);
  for (let i = 0; i < years; i++) {
    $("status").textContent = `${L().year} 年を回しています…（${i + 1} / ${years}）`;
    // 画面が固まらないよう、1 年ごとに描画の番を渡す
    await new Promise((r) => setTimeout(r, 0));
    const result = playYear(L(), names);
    ui.league = result.league;
    ui.seasons = result.seasons;
  }
  renderAll();
  await save();
  setBusy(false);
}

function exportSave() {
  const blob = new Blob([serialize(L())], { type: "application/json" });
  const a = /** @type {HTMLAnchorElement} */ (el("a"));
  a.href = URL.createObjectURL(blob);
  a.download = `league-sim-${L().year}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function main() {
  const [clubJson, nameJson] = await Promise.all(
    ["data/clubs.json", "data/names.json"].map((u) => fetch(u).then((r) => r.json())),
  );
  const clubData = parseClubData(clubJson);
  const names = parseNameData(nameJson);

  /** @type {string | undefined} */
  let stored;
  try {
    stored = await loadStoredSave();
  } catch {
    stored = undefined;
  }
  let note = "";
  if (stored) {
    try {
      ui.league = parseSave(stored);
    } catch (e) {
      note = `（前のセーブが読めなかったので新しく始めました: ${/** @type {Error} */ (e).message}）`;
    }
  }
  if (!ui.league) {
    ui.league = createLeague(clubData, names, randomSeed());
    await save();
  }
  // 自分のクラブがまだ決まっていなければ、選ぶ画面から
  const showCurrent = () => (L().user ? showGame() : showPicker());
  showCurrent();
  if (note) $("status").textContent += note;

  for (const b of document.querySelectorAll("#picker-div button")) {
    b.addEventListener("click", () => renderPicker(Number(/** @type {HTMLElement} */ (b).dataset.div)));
  }
  $("next1").addEventListener("click", () => advance(names, 1));
  $("next10").addEventListener("click", () => advance(names, 10));
  for (const b of document.querySelectorAll("#tabs button")) {
    b.addEventListener("click", () => showTab(/** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.tab)));
  }
  for (const b of document.querySelectorAll("#div-switch button")) {
    b.addEventListener("click", () => setDiv(Number(/** @type {HTMLElement} */ (b).dataset.div)));
  }
  $("club-select").addEventListener("change", (e) => {
    ui.clubId = /** @type {HTMLSelectElement} */ (e.target).value;
    renderClub();
  });
  $("export").addEventListener("click", exportSave);
  $("import").addEventListener("change", async (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      ui.league = parseSave(await file.text());
      ui.seasons = null;
      showCurrent();
      await save();
      $("status").textContent += "（読み込みました）";
    } catch (err) {
      alert(`読み込めませんでした: ${/** @type {Error} */ (err).message}`);
    }
  });
  $("new").addEventListener("click", async () => {
    if (!confirm("今のリーグを消して、新しく始めますか？（消す前に「書き出し」で控えを取れます）")) return;
    const input = /** @type {HTMLInputElement} */ ($("seed"));
    const seed = input.value === "" ? randomSeed() : Number(input.value) >>> 0;
    ui.league = createLeague(clubData, names, seed);
    ui.seasons = null;
    showPicker();
    await save();
  });
  setBusy(false);
}

main().catch((e) => {
  $("status").textContent = `読み込みに失敗しました: ${e.message}`;
});
