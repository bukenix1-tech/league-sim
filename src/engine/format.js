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
  const row = (/** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ target, extra = "") =>
    `${label.padEnd(12, "　")} ${value.padStart(6)}   ${target}${extra}`;
  const lines = [
    `${s.runs} シーズン (種 = ${seed})`,
    "",
    `${"".padEnd(12, "　")}   結果   本物の目安`,
    row("優勝クラブの勝ち点", s.championPointsAvg.toFixed(1), REAL_TARGETS.championPoints, ` (最小 ${s.championPointsMin}, 最大 ${s.championPointsMax})`),
    row("1 試合の平均得点", s.goalsPerMatch.toFixed(2), REAL_TARGETS.goalsPerMatch),
    row("引き分けの割合", pct(s.drawRate), REAL_TARGETS.drawRate),
    row("ホームの勝ちの割合", pct(s.homeWinRate), REAL_TARGETS.homeWinRate),
    row("得点王の得点", s.topScorerAvg.toFixed(1), REAL_TARGETS.topScorer, ` (最小 ${s.topScorerMin}, 最大 ${s.topScorerMax})`),
    row("アシスト王", s.topAssistsAvg.toFixed(1), REAL_TARGETS.topAssists),
    row("1 クラブのけが人", s.injuriesPerClub.toFixed(1), REAL_TARGETS.injuriesPerClub),
    row("1 クラブで先発した人数", s.playersUsedPerClub.toFixed(1), "(22 人のうち)"),
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
 * @param {{ age: number, avg: number }[]} curve
 */
export function formatAgingCurve(curve) {
  const peak = Math.max(...curve.map((c) => c.avg));
  return [
    "年齢ごとの総合力の平均 (18 歳で作った選手を毎年育てた場合)",
    ...curve.map((c) => `  ${c.age} 歳  ${c.avg.toFixed(1).padStart(5)}  ${"■".repeat(Math.max(0, Math.round((c.avg - peak + 30) / 1.5)))}`),
  ].join("\n");
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

/**
 * @param {ReturnType<typeof import("./longrun.js").longRun>} r
 */
export function formatLongRun(r) {
  const name = (/** @type {string} */ id) => r.league.clubs[id]?.name ?? id;
  const n = r.rows.length;
  const first = r.rows.slice(0, 5);
  const last = r.rows.slice(-5);
  const avg = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  /** @param {typeof r.rows} rows */
  const line = (rows) =>
    `1 部 ${avg(rows.map((x) => x.top11[0])).toFixed(1)} / 2 部 ${avg(rows.map((x) => x.top11[1])).toFixed(1)} / ` +
    `一番うまい選手 ${avg(rows.map((x) => x.best)).toFixed(1)} / 選手 ${avg(rows.map((x) => x.players)).toFixed(0)} 人 / ` +
    `平均 ${avg(rows.map((x) => x.avgAge)).toFixed(1)} 歳 / 21 歳以下 ${avg(rows.map((x) => x.young)).toFixed(0)} 人`;
  return [
    `${n} 年 回したまとめ`,
    "",
    "■ 優勝の偏り",
    `  優勝したクラブの数 ${r.distinctChampions}（本物の 1 部は 50 年でおよそ 10〜15）`,
    `  一番多いクラブ ${name(r.titles[0][0])} ${r.titles[0][1]} 回（${((r.titles[0][1] / n) * 100).toFixed(0)}%）`,
    `  一番長い連覇 ${name(r.longestStreak.club)} ${r.longestStreak.years} 連覇`,
    `  優勝した回数: ${r.titles.map(([id, c]) => `${r.league.clubs[id]?.short ?? id} ${c}`).join("、")}`,
    `  始めは 2 部だったのに 1 部で優勝したクラブ: ${r.div2Champions.map(name).join("、") || "なし"}`,
    `  ${n} 年ずっと 1 部にいたクラブ: ${r.alwaysTop.length} クラブ（${r.alwaysTop.map((id) => r.league.clubs[id]?.short ?? id).join("、")}）`,
    `  昇格したクラブが次の年も 1 部に残った割合 ${(r.promotedSurvival * 100).toFixed(0)}%（本物はおよそ 55〜65%）`,
    `  優勝クラブの勝ち点の平均 ${avg(r.rows.map((x) => x.championPoints)).toFixed(1)}（本物は 85〜95）`,
    "",
    "■ 能力と選手の数（各クラブの上位 11 人の総合力の平均）",
    `  はじめの 5 年: ${line(first)}`,
    `  おわりの 5 年: ${line(last)}`,
    "",
    "■ 重さ",
    `  1 年あたり ${r.msPerYear.toFixed(0)} ミリ秒、セーブの大きさ ${(r.saveBytes / 1024).toFixed(0)} KB`,
    "",
    "■ 10 年ごと",
    ...r.rows
      .filter((_, i) => i % 10 === 9)
      .map((x) => `  ${x.year} 年  優勝 ${r.league.clubs[x.champion]?.short}（${x.championPoints}）  1 部 ${x.top11[0].toFixed(1)}  2 部 ${x.top11[1].toFixed(1)}  選手 ${x.players} 人`),
  ].join("\n");
}
