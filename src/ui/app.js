// @ts-check
// 画面。計算は src/engine/ にあり、ここでは表示とセーブの出し入れだけをする。

import { parseClubData, parseNameData } from "../engine/clubs.js";
import { contractYearsFor, MAX_SQUAD, newContract, playerValue } from "../engine/contracts.js";
import {
  budgetRange,
  facilityCost,
  FACILITY_MAX,
  facilityUpkeep,
  forecastRevenue,
  levelFromBudget,
  oku,
  STADIUM_MAX,
  STADIUM_STEP,
  attendance,
  managerWage,
  TICKET_LEVELS,
  totalRevenue,
  trainingBonus,
} from "../engine/finance.js";
import {
  acceptBid,
  acceptOffer,
  buyPlayer,
  hireManager,
  marketList,
  releaseCost,
  releasePlayer,
  renewContract,
  sellPlayer,
  sackCost,
  setAutoTransfers,
  setTicket,
  spendLimit,
  upgradeFacility,
} from "../engine/market.js";
import {
  AUTO_PROMOTED,
  chooseClub,
  createLeague,
  FIRE_TRUST,
  PLAYOFF_FROM,
  PLAYOFF_TO,
  playFirstHalf,
  playSecondHalf,
  playYear,
  rowGoalDiff,
  rowPoints,
  seasonGoal,
  setBudget,
} from "../engine/league.js";
import { loadProgress } from "../engine/season.js";
import { standings } from "../engine/table.js";
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
  /** 直前に回した試合の結果（部ごとの節の並び。セーブには入れない） @type {import("../engine/match.js").MatchResult[][][] | null} */ rounds: null,
  div: 0,
  clubId: "",
  busy: false,
  /** 選手と監督の名前の材料（読み込んだあとに入る） @type {import("../engine/clubs.js").NameData | null} */ names: null,
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
  for (const name of ["office", "market", "table", "leaders", "club", "rounds", "history"]) $(`tab-${name}`).hidden = name !== tab;
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

  if (u.trust <= FIRE_TRUST + 20 && !u.fired) owner.append(el("p", "neg", "信頼が低くなっています。このままではクビになります"));
  /** @type {HTMLElement[]} */
  const nodes = [];
  if (u.fired) nodes.push(firedCard());
  nodes.push(head);
  const offers = u.fired ? null : offersCard();
  if (offers) nodes.push(offers);
  nodes.push(owner, managerCard());
  if (!inWinter()) nodes.push(u.auto ? budget : wagesCard());
  nodes.push(ticketCard(), facilitiesCard());
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
        ["施設の維持費", `−${oku(m.facilities ?? 0)}`],
        ["収支", oku(m.profit), m.profit < 0 ? "neg strong" : "strong"],
        ["オーナーへの配当", `−${oku(m.dividend ?? 0)}`],
        ["移籍金（入）", oku(m.transfers?.in ?? 0)],
        ["移籍金（出）", `−${oku(m.transfers?.out ?? 0)}`],
        ["施設への投資", `−${oku(m.transfers?.invest ?? 0)}`],
      ]),
      el("p", "sub", "移籍金と施設への投資は、夏のうちに手元のお金から出し入れしています。配当は、お金が貯まりすぎたときにオーナーが持っていく分です。"),
      el("p", "sub", `観客 1 試合 ${m.attendance.toLocaleString()} 人`),
    );
    nodes.push(money);
  }
  $("tab-office").replaceChildren(...nodes);
}

/**
 * 自分のクラブを変える操作をして、うまくいけば描き直してセーブする。だめなら理由を出す。
 * @param {() => League} change @param {string} [done] うまくいったときに出す言葉
 */
async function act(change, done) {
  try {
    ui.league = change();
  } catch (e) {
    alert(/** @type {Error} */ (e).message);
    return;
  }
  renderAll();
  setBusy(false);
  if (done) $("status").textContent = done;
  await save();
}

/** 施設のカード */
function facilitiesCard() {
  const f = L().clubs[/** @type {any} */ (L().user).clubId].finance;
  const card = el("div", "card");
  card.append(el("h2", "", "施設"));
  /** @param {string} label @param {string} now @param {string} effect @param {"stadium" | "training" | "youth"} kind @param {boolean} maxed */
  const row = (label, now, effect, kind, maxed) => {
    const line = el("div", "fac");
    const text = el("div");
    text.append(el("p", "", `${label} ${now}`), el("p", "sub", effect));
    const b = el("button", "secondary small", maxed ? "最大" : `上げる ${oku(facilityCost(kind, f))}`);
    /** @type {HTMLButtonElement} */ (b).disabled = maxed;
    b.addEventListener("click", () => act(() => upgradeFacility(L(), kind), `${label}を大きくしました`));
    line.append(text, b);
    return line;
  };
  card.append(
    row("スタジアム", `${f.capacity.toLocaleString()} 席`, `1 回で ${STADIUM_STEP.toLocaleString()} 席増える。人気が上がって満員になるなら`, "stadium", f.capacity >= STADIUM_MAX),
    row("練習場", `${f.facilities.training} / ${FACILITY_MAX}`, `選手の伸びが ${Math.round(trainingBonus(f.facilities) * 100)}% よくなる`, "training", f.facilities.training >= FACILITY_MAX),
    row("育成", `${f.facilities.youth} / ${FACILITY_MAX}`, `育成の若手が強く、伸びしろも大きくなる`, "youth", f.facilities.youth >= FACILITY_MAX),
    el("p", "sub", `維持費 年 ${oku(facilityUpkeep(f))}`),
  );
  return card;
}

/** 監督のカード: 今の監督と、雇える候補 */
function managerCard() {
  const u = /** @type {NonNullable<League["user"]>} */ (L().user);
  const club = L().clubs[u.clubId];
  const m = club.manager;
  const card = el("div", "card");
  card.append(
    el("h2", "", "監督"),
    el("p", "", `${m.name}（${m.age} 歳）`),
    el("p", "sub", `型 ${STYLES[m.style].label}（${STYLES[m.style].formation}）・采配 ${grade(m.ability)} ${m.ability}・年俸 ${oku(managerWage(m))}`),
  );
  if (u.candidates.length === 0) {
    card.append(el("p", "sub", "雇える監督の候補は、シーズンが終わると出てきます。"));
    return card;
  }
  card.append(el("p", "sub", `交代するなら、今の監督に違約金 ${oku(sackCost(L()))} を払います。夏と冬にできます。`));
  u.candidates.forEach((c, i) => {
    const line = el("div", "fac");
    const text = el("div");
    text.append(el("p", "", `${c.name}（${c.age} 歳）`), el("p", "sub", `${STYLES[c.style].label}・采配 ${grade(c.ability)} ${c.ability}・年俸 ${oku(managerWage(c))}`));
    const b = el("button", "secondary small", "雇う");
    b.addEventListener("click", () => {
      if (confirm(`${m.name} を解任して、${c.name} を雇いますか？（違約金 ${oku(sackCost(L()))}）`)) act(() => hireManager(L(), i), `${c.name} が監督になりました`);
    });
    line.append(text, b);
    card.append(line);
  });
  return card;
}

/** 入場料のカード */
function ticketCard() {
  const u = /** @type {NonNullable<League["user"]>} */ (L().user);
  const f = L().clubs[u.clubId].finance;
  const now = f.ticket ?? "normal";
  const card = el("div", "card");
  card.append(el("h2", "", "入場料"));
  const seg = el("div", "seg");
  for (const level of /** @type {const} */ (["low", "normal", "high"])) {
    const b = el("button", "", TICKET_LEVELS[level].label);
    b.setAttribute("aria-pressed", String(now === level));
    b.addEventListener("click", () => act(() => setTicket(L(), level)));
    seg.append(b);
  }
  const t = TICKET_LEVELS[now];
  card.append(
    seg,
    el("p", "sub", `1 人 ${Math.round(5000 * t.price).toLocaleString()} 円（1 部）・${Math.round(3000 * t.price).toLocaleString()} 円（2 部）。今の観客の見込み 1 試合 ${attendance(f).toLocaleString()} 人`),
    el("p", "sub", "安いと観客と人気が増え、高いと 1 人あたりの収入は増えるが観客と人気が減る。人気はスポンサーとグッズにも効く。"),
  );
  return card;
}

/** クビになったときのカード */
function firedCard() {
  const u = /** @type {NonNullable<League["user"]>} */ (L().user);
  const card = el("div", "card fired");
  card.append(
    el("h2", "", "クビになりました"),
    el("p", "", `${clubName(u.clubId)} のオーナーに解任されました（${u.fired}）。`),
    el("p", "sub", "2 部の小さなクラブから声がかかっています。選んだクラブで、もう一度上を目指しましょう。"),
  );
  for (const id of u.offers) {
    const c = L().clubs[id];
    const line = el("div", "fac");
    const text = el("div");
    text.append(el("p", "", c.name), el("p", "sub", `規模 ${grade(c.level)} ${c.level.toFixed(0)}・人気 ${c.finance.popularity.toFixed(0)} 万人・お金 ${oku(c.finance.cash)}`));
    const b = el("button", "small", "引き受ける");
    b.addEventListener("click", () => {
      if (!confirm(`${c.name} の経営者になりますか？`)) return;
      ui.clubId = id;
      act(() => acceptOffer(L(), id), `${c.name} の経営者になりました`);
    });
    line.append(text, b);
    card.append(line);
  }
  return card;
}

/** シーズンの途中（冬）か */
const inWinter = () => L().midSeason !== null && L().midSeason !== undefined;

/**
 * 冬のあいだの、部の途中の順位表と個人成績
 * @param {number} div
 */
function midTable(div) {
  const progress = loadProgress(/** @type {NonNullable<League["midSeason"]>} */ (L().midSeason).progress[div]);
  const rows = standings(progress.table);
  /** @param {"goals" | "assists"} key @returns {import("../engine/league.js").LeaderRow[]} */
  const top = (key) =>
    [...progress.stats.entries()]
      .filter(([, s]) => s[key] > 0)
      .sort((a, b) => b[1][key] - a[1][key])
      .slice(0, 10)
      .map(([id, s]) => [L().players[id]?.name ?? "", s.club, s[key]]);
  return {
    rows: rows.map((r) => /** @type {import("../engine/league.js").TableRow} */ ([r.id, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst])),
    goals: top("goals"),
    assists: top("assists"),
  };
}

/** 誘いのカード（誘いがあるときだけ） */
function offersCard() {
  const u = /** @type {NonNullable<League["user"]>} */ (L().user);
  if (u.offers.length === 0) return null;
  const card = el("div", "card mine-card");
  card.append(el("h2", "", "ほかのクラブから誘われています"), el("p", "sub", "移ると、そのクラブの経営者になります。オーナーの信頼は始めに戻ります。この夏のうちに決めてください。"));
  for (const id of u.offers) {
    const c = L().clubs[id];
    const { div } = divisionOf(L(), id);
    const line = el("div", "fac");
    const text = el("div");
    text.append(el("p", "", c.name), el("p", "sub", `${L().divisions[div].name}・規模 ${grade(c.level)} ${c.level.toFixed(0)}・お金 ${oku(c.finance.cash)}`));
    const b = el("button", "small", "移る");
    b.addEventListener("click", () => {
      if (!confirm(`${c.name} に移りますか？今のクラブには戻れません。`)) return;
      ui.clubId = id;
      act(() => acceptOffer(L(), id), `${c.name} の経営者になりました`);
    });
    line.append(text, b);
    card.append(line);
  }
  return card;
}

/** 自分で補強するときの、年俸のカード */
function wagesCard() {
  const u = /** @type {NonNullable<League["user"]>} */ (L().user);
  const club = L().clubs[u.clubId];
  const { div, n } = divisionOf(L(), club.id);
  const total = club.playerIds.reduce((s, id) => s + (L().players[id].contract?.wage ?? 0), 0);
  const rev = forecastRevenue(club.finance, div, n);
  const card = el("div", "card");
  card.append(
    el("h2", "", "年俸（自分で補強中）"),
    facts([
      ["選手の年俸の合計", oku(total)],
      ["収入の見込み", oku(rev)],
      ["収入に対する割合", `${Math.round((total / rev) * 100)}%`, total / rev > 0.8 ? "neg" : ""],
    ]),
    el("p", "sub", "目安は収入の 7 割まで。超えると赤字になりやすい。補強は「移籍」タブで。"),
  );
  return card;
}

/** 移籍タブの位置のしぼりこみ */
let marketPos = /** @type {import("../engine/players.js").Position | null} */ (null);

function renderMarket() {
  const u = L().user;
  if (!u) return;
  const club = L().clubs[u.clubId];
  const nodes = [];

  // 補強のやり方
  const mode = el("div", "card");
  mode.append(el("h2", "", "補強のやり方"));
  const seg = el("div", "seg");
  for (const [auto, label] of /** @type {const} */ ([[true, "おまかせ"], [false, "自分で"]])) {
    const b = el("button", "", label);
    b.setAttribute("aria-pressed", String(u.auto === auto));
    b.addEventListener("click", () => act(() => setAutoTransfers(L(), auto)));
    seg.append(b);
  }
  mode.append(
    seg,
    el(
      "p",
      "sub",
      u.auto
        ? "おまかせ: 夏に、年俸の予算に合わせて自動で補強・放出・契約の更新をします（経営タブの予算で強さが決まる）。下で自分で取ったり売ったりもできます。"
        : "自分で: 夏の補強・放出・契約の更新は自分でします。契約が 0 年の選手は、更新しないとシーズン前に出ていきます。試合に必要な人数（GK 2・DF 6・MF 6・FW 3）に足りない分だけ、育成の若手が入ります。",
    ),
  );
  nodes.push(mode);
  if (inWinter()) {
    const w = el("div", "card mine-card");
    w.append(el("h2", "", "冬の移籍の時期"), el("p", "sub", "後半の前に、選手を取る・売る・解除する・契約を更新することができます。おまかせの補強と年俸の予算は夏だけです。"));
    nodes.push(w);
  }

  // 海外からのオファー
  if (u.bids.length) {
    const card = el("div", "card mine-card");
    card.append(el("h2", "", "海外のクラブからのオファー"), el("p", "sub", "受けると移籍金が入り、選手は出ていきます。受けなければ残ります（この夏だけ）。"));
    for (const bid of u.bids) {
      const p = L().players[bid.playerId];
      if (!p) continue;
      const line = el("div", "fac");
      const text = el("div");
      text.append(el("p", "", `${p.name}（${p.pos}・${p.age} 歳・${grade(overall(p))} ${overall(p)}）`), el("p", "sub", `移籍金 ${oku(bid.fee)}`));
      const b = el("button", "small", "受ける");
      b.addEventListener("click", () => {
        if (confirm(`${p.name} を ${oku(bid.fee)} で海外のクラブに売りますか？`)) act(() => acceptBid(L(), bid.playerId), `${p.name} を売りました`);
      });
      line.append(text, b);
      card.append(line);
    }
    nodes.push(card);
  }

  // 自分の選手と契約
  const squadCard = el("div", "card");
  squadCard.append(el("h2", "", `自分の選手（${club.playerIds.length} / ${MAX_SQUAD} 人）`));
  const list = el("ul", "plist");
  const order = { GK: 0, DF: 1, MF: 2, FW: 3 };
  const players = club.playerIds.map((id) => L().players[id]).sort((a, b) => order[a.pos] - order[b.pos] || overall(b) - overall(a));
  for (const p of players) {
    const c = p.contract;
    const li = el("li", (c?.years ?? 0) === 0 ? "expiring" : "");
    const head = el("button", "prow");
    head.append(
      el("span", `pos pos-${p.pos}`, p.pos),
      el("span", "pname", p.name),
      el("span", "pnum", `${grade(overall(p))} ${overall(p)}`),
      el("span", "pnum", (c?.years ?? 0) === 0 ? "切れ" : `${c?.years} 年`),
      el("span", "pnum wide", oku(c?.wage ?? 0)),
    );
    const body = el("div", "pbody");
    body.hidden = true;
    body.append(playerDetail(p), el("p", "sub", `${p.age} 歳・移籍金の目安 ${oku(playerValue(p))}`));
    const actions = el("div", "row");
    const years = /** @type {HTMLSelectElement} */ (el("select"));
    for (let y = 1; y <= 5; y++) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", `${y} 年`));
      o.value = String(y);
      if (y === contractYearsFor(p.age)) o.selected = true;
      years.append(o);
    }
    const renew = el("button", "small", `更新（年俸 ${oku(newContract(p).wage)}）`);
    renew.addEventListener("click", () => act(() => renewContract(L(), p.id, Number(years.value)), `${p.name} と ${years.value} 年の契約をしました`));
    const sell = el("button", "secondary small", "売る");
    sell.addEventListener("click", () => {
      if (!confirm(`${p.name} を売りますか？（移籍金の目安 ${oku(playerValue(p) * 0.9)}）`)) return;
      act(() => {
        const r = sellPlayer(L(), p.id);
        setTimeout(() => ($("status").textContent = `${p.name} を ${clubName(r.buyer)} に ${oku(r.fee)} で売りました`), 0);
        return r.league;
      });
    });
    const release = el("button", "secondary small", `解除（${oku(releaseCost(p))}）`);
    release.addEventListener("click", () => {
      if (confirm(`${p.name} との契約を解除しますか？残りの年俸の半分 ${oku(releaseCost(p))} を払います。`)) act(() => releasePlayer(L(), p.id), `${p.name} を出しました`);
    });
    actions.append(years, renew, sell, release);
    body.append(actions);
    head.addEventListener("click", () => {
      body.hidden = !body.hidden;
    });
    li.append(head, body);
    list.append(li);
  }
  squadCard.append(el("p", "sub", "左から 位置・名前・総合・契約の残り・年俸。押すと能力と、更新・売る・解除。赤い行は契約が切れた選手"), list);
  nodes.push(squadCard);

  // 取れる選手
  const market = el("div", "card");
  market.append(el("h2", "", "取れる選手"), el("p", "sub", `使えるお金 ${oku(spendLimit(L()))}（手元のお金 + 収入の見込みの 3 割まで借金できる）。クラブの規模を大きく上回る選手は来てくれないので出していません。`));
  const filter = el("div", "seg");
  for (const pos of /** @type {const} */ ([null, "GK", "DF", "MF", "FW"])) {
    const b = el("button", "", pos ?? "全部");
    b.setAttribute("aria-pressed", String(marketPos === pos));
    b.addEventListener("click", () => {
      marketPos = pos;
      renderMarket();
    });
    filter.append(b);
  }
  market.append(filter);
  const mlist = el("ul", "plist");
  for (const e of marketList(L(), marketPos, 30)) {
    const p = e.player;
    const li = el("li");
    const head = el("button", "prow");
    head.append(
      el("span", `pos pos-${p.pos}`, p.pos),
      el("span", "pname", `${p.name}`),
      el("span", "pnum", `${grade(overall(p))} ${overall(p)}`),
      el("span", "pnum", `${p.age} 歳`),
      el("span", "pnum wide", e.clubId ? oku(e.fee) : "フリー"),
    );
    const body = el("div", "pbody");
    body.hidden = true;
    body.append(playerDetail(p), el("p", "sub", `${e.clubId ? clubName(e.clubId) : "どこのクラブにもいない（移籍金なし）"}・年俸 ${oku(e.wage)}`));
    const buy = el("button", "small", e.clubId ? `獲得（移籍金 ${oku(e.fee)}）` : "獲得（移籍金なし）");
    buy.addEventListener("click", () => {
      if (confirm(`${p.name} を取りますか？${e.clubId ? `移籍金 ${oku(e.fee)}、` : ""}年俸 ${oku(e.wage)}`)) act(() => buyPlayer(L(), p.id), `${p.name} を取りました`);
    });
    body.append(buy);
    head.addEventListener("click", () => {
      body.hidden = !body.hidden;
    });
    li.append(head, body);
    mlist.append(li);
  }
  market.append(mlist);
  nodes.push(market);
  $("tab-market").replaceChildren(...nodes);
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
        ui.league = chooseClub(L(), id, ui.names ?? undefined);
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
  if (inWinter()) {
    const rows = midTable(ui.div).rows;
    tbody.replaceChildren(
      ...rows.map((r, i) => {
        const tr = el("tr", r[0] === L().user?.clubId ? "mine" : "");
        const cells = [i + 1, clubShort(r[0]), r[1] + r[2] + r[3], r[1], r[2], r[3], signed(rowGoalDiff(r)), rowPoints(r)];
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
    $("table-legend").textContent = `${L().year} 年の${L().divisions[ui.div].name}、前半を終えたところ`;
    $("playoff").replaceChildren();
    return;
  }
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
  const rec = /** @type {YearRecord} */ (lastRecord());
  if (!rec && !inWinter()) {
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
  const { goals, assists } = inWinter() ? midTable(ui.div) : rec.leaders[ui.div];
  $("tab-leaders").replaceChildren(
    el("p", "status", inWinter() ? `${L().year} 年の${L().divisions[ui.div].name}、前半を終えたところ` : `${rec.year} 年の${L().divisions[ui.div].name}`),
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
  const rounds = ui.rounds?.[ui.div];
  if (!rounds) {
    list.replaceChildren(empty("試合の結果は、このページで進めた直後のシーズンだけ見られます（セーブには入れていません）。"));
    return;
  }
  const players = L().players;
  list.replaceChildren(
    ...rounds.map((round, i) => {
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
  let text = inWinter() ? `${L().year} 年、冬の移籍の時期（前半が終わったところ）。` : `${L().year} 年のシーズン前（種 ${L().seed}）。`;
  if (u) text += ` あなたのクラブ: ${clubName(u.clubId)}（${L().divisions[divisionOf(L(), u.clubId).div].name}）。`;
  if (u?.fired) text += " クビになりました。経営タブで次のクラブを選んでください。";
  if (rec && !inWinter()) {
    text += ` ${rec.year} 年は ${clubName(rec.tables[0][0][0])} が優勝。昇格 ${rec.promoted.map(clubShort).join("・")}、降格 ${rec.relegated.map(clubShort).join("・")}。`;
  }
  $("status").textContent = text;
}

function renderAll() {
  renderStatus();
  $("next1").textContent = inWinter() ? "後半を進める" : "前半を進める";
  $("next10").textContent = inWinter() ? "後半と、さらに 9 年進める" : "10 年進める";
  renderOffice();
  renderMarket();
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
  const fired = Boolean(ui.league?.user?.fired);
  for (const id of ["next1", "next10"]) /** @type {HTMLButtonElement} */ ($(id)).disabled = busy || fired;
  for (const id of ["export", "new"]) /** @type {HTMLButtonElement} */ ($(id)).disabled = busy;
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
  try {
    // 冬の途中なら、まず後半を終わらせる
    if (inWinter()) {
      const first = ui.rounds;
      const result = playSecondHalf(L(), names);
      ui.league = result.league;
      ui.rounds = result.seasons.map((s, i) => [...(first?.[i] ?? []), ...s.rounds]);
      years--;
    }
    for (let i = 0; i < years && !L().user?.fired; i++) {
      $("status").textContent = `${L().year} 年を回しています…（${i + 1} / ${years}）`;
      // 画面が固まらないよう、1 年ごとに描画の番を渡す
      await new Promise((r) => setTimeout(r, 0));
      const result = playYear(L(), names);
      ui.league = result.league;
      ui.rounds = result.seasons.map((s) => s.rounds);
    }
  } catch (e) {
    alert(/** @type {Error} */ (e).message);
  }
  renderAll();
  await save();
  setBusy(false);
}

/**
 * 前半（夏の補強から冬まで）か後半（冬から次の夏まで）を進める
 * @param {import("../engine/clubs.js").NameData} names
 */
async function advanceHalf(names) {
  setBusy(true);
  await new Promise((r) => setTimeout(r, 0));
  try {
    if (inWinter()) {
      const first = ui.rounds;
      const result = playSecondHalf(L(), names);
      ui.league = result.league;
      ui.rounds = result.seasons.map((s, i) => [...(first?.[i] ?? []), ...s.rounds]);
    } else {
      const result = playFirstHalf(L(), names);
      ui.league = result.league;
      ui.rounds = result.rounds;
    }
  } catch (e) {
    alert(/** @type {Error} */ (e).message);
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
  ui.names = names;

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
  $("next1").addEventListener("click", () => advanceHalf(names));
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
      ui.rounds = null;
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
    ui.rounds = null;
    showPicker();
    await save();
  });
  setBusy(false);
}

// 押したときなどに思わぬ失敗があったら、黙って止まらずに画面に出す
window.addEventListener("unhandledrejection", (e) => {
  $("status").textContent = `うまく動きませんでした: ${e.reason?.message ?? e.reason}（ページを開き直してください）`;
});
window.addEventListener("error", (e) => {
  $("status").textContent = `うまく動きませんでした: ${e.message}（ページを開き直してください）`;
});

// 電波が無くても開けるようにする（https のとき）。手元の開発中は、ファイルを直してもすぐ映るよう、
// アドレスに ?pwa を付けたときだけ動かす
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
if ("serviceWorker" in navigator && (!isLocal || location.search.includes("pwa"))) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

main().catch((e) => {
  $("status").textContent = `読み込みに失敗しました: ${e.message}`;
});
