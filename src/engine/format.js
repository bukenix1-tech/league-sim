// @ts-check
// 文字で出すときの形（Node の scripts と sim.html で共通）。

import { REAL_TARGETS } from "./summary.js";
import { goalDiff, points } from "./table.js";

/**
 * @typedef {import("./clubs.js").Club} Club
 * @typedef {import("./table.js").Row} Row
 */

const pct = (/** @type {number} */ x) => `${(x * 100).toFixed(1)}%`;

/**
 * @param {ReturnType<typeof import("./summary.js").summarize>} s
 * @param {Club[]} clubs
 * @param {number} seed
 */
export function formatSummary(s, clubs, seed) {
  const name = new Map(clubs.map((c) => [c.id, c.name]));
  const lines = [
    `${s.runs} シーズン (種 = ${seed})`,
    "",
    "                     結果     本物の目安",
    `優勝クラブの勝ち点   ${s.championPointsAvg.toFixed(1).padStart(6)}     ${REAL_TARGETS.championPoints} (最小 ${s.championPointsMin}, 最大 ${s.championPointsMax})`,
    `1 試合の平均得点     ${s.goalsPerMatch.toFixed(2).padStart(6)}     ${REAL_TARGETS.goalsPerMatch}`,
    `引き分けの割合       ${pct(s.drawRate).padStart(6)}     ${REAL_TARGETS.drawRate}`,
    `ホームの勝ちの割合   ${pct(s.homeWinRate).padStart(6)}     ${REAL_TARGETS.homeWinRate}`,
    "",
    "優勝した回数",
    ...s.champions.map(([id, n]) => `  ${String(n).padStart(5)} (${pct(n / s.runs)})  ${name.get(id)}`),
    "",
    "降格圏 (18〜20 位) に入った回数 (多い順に 5 クラブ)",
    ...s.relegated.slice(0, 5).map(([id, n]) => `  ${String(n).padStart(5)} (${pct(n / s.runs)})  ${name.get(id)}`),
  ];
  return lines.join("\n");
}

/**
 * @param {Row[]} rows
 * @param {Club[]} clubs
 */
export function formatTable(rows, clubs) {
  const name = new Map(clubs.map((c) => [c.id, c.short]));
  const lines = [" #  クラブ            試  勝  分  敗  得  失   差  点"];
  rows.forEach((r, i) => {
    const gd = goalDiff(r);
    const cols = [r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst].map((v) => String(v).padStart(3)).join(" ");
    lines.push(`${String(i + 1).padStart(2)}  ${String(name.get(r.id)).slice(0, 8).padEnd(8, "　")}  ${cols} ${(gd > 0 ? `+${gd}` : String(gd)).padStart(4)} ${String(points(r)).padStart(3)}`);
  });
  return lines.join("\n");
}
