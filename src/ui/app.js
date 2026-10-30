// @ts-check
// 画面。計算は src/engine/ にあり、ここでは表示だけをする。

import { parseClubData } from "../engine/clubs.js";
import { randomSeed } from "../engine/rng.js";
import { playSeason } from "../engine/season.js";
import { goalDiff, points } from "../engine/table.js";

/** @typedef {import("../engine/clubs.js").Club} Club */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @returns {Promise<Club[]>} */
async function loadClubs() {
  const res = await fetch("data/clubs.json");
  const data = parseClubData(await res.json());
  return data.divisions[0].clubs;
}

/**
 * @param {Club[]} clubs
 * @param {import("../engine/season.js").SeasonResult} season
 */
function render(clubs, season) {
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const name = (/** @type {string} */ id) => byId.get(id)?.short ?? id;
  const n = season.standings.length;

  const tbody = /** @type {HTMLTableSectionElement} */ ($("table").querySelector("tbody"));
  tbody.replaceChildren(
    ...season.standings.map((r, i) => {
      const tr = document.createElement("tr");
      if (i === 0) tr.className = "champ";
      if (i >= n - 3) tr.className = "down";
      const gd = goalDiff(r);
      const cells = [i + 1, name(r.id), r.played, r.won, r.drawn, r.lost, gd > 0 ? `+${gd}` : gd, points(r)];
      cells.forEach((v, j) => {
        const td = document.createElement("td");
        td.textContent = String(v);
        if (j === 1) {
          td.className = "club";
          td.title = byId.get(r.id)?.name ?? r.id;
        }
        tr.append(td);
      });
      return tr;
    }),
  );

  $("round-list").replaceChildren(
    ...season.rounds.map((round, i) => {
      const div = document.createElement("div");
      div.className = "round";
      const h = document.createElement("h3");
      h.textContent = `第 ${i + 1} 節`;
      div.append(h);
      for (const m of round) {
        const row = document.createElement("div");
        row.className = "match";
        for (const [cls, text] of [["home", name(m.home)], ["score", `${m.homeGoals} - ${m.awayGoals}`], ["away", name(m.away)]]) {
          const s = document.createElement("span");
          s.className = cls;
          s.textContent = text;
          row.append(s);
        }
        div.append(row);
      }
      return div;
    }),
  );

  $("table").hidden = false;
  $("legend").hidden = false;
  $("rounds").hidden = false;
  const champion = byId.get(season.standings[0].id)?.name;
  $("status").textContent = `種 ${season.seed} のシーズン。優勝は ${champion}（勝ち点 ${points(season.standings[0])}）。`;
}

async function main() {
  const clubs = await loadClubs();
  const seedInput = /** @type {HTMLInputElement} */ ($("seed"));
  $("run").addEventListener("click", () => {
    const seed = seedInput.value === "" ? randomSeed() : Number(seedInput.value) >>> 0;
    render(clubs, playSeason(clubs, seed));
  });
}

main().catch((e) => {
  $("status").textContent = `読み込みに失敗しました: ${e.message}`;
});
