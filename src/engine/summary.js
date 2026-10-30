// @ts-check
// シーズンを何回も回して、本物のリーグの目安と比べる。

import { playSeason } from "./season.js";
import { points } from "./table.js";

/** @typedef {import("./clubs.js").Club} Club */

/** 本物の 1 部リーグのおおよその目安 */
export const REAL_TARGETS = {
  championPoints: "85〜95",
  goalsPerMatch: "約 2.7",
  drawRate: "約 25%",
  homeWinRate: "約 45%",
};

/**
 * @param {Club[]} clubs
 * @param {number} runs
 * @param {number} seed
 */
export function summarize(clubs, runs, seed) {
  /** @type {number[]} */
  const championPoints = [];
  /** @type {Map<string, number>} */
  const champions = new Map();
  /** @type {Map<string, number>} */
  const relegated = new Map();
  let matches = 0;
  let goals = 0;
  let draws = 0;
  let homeWins = 0;

  for (let i = 0; i < runs; i++) {
    const season = playSeason(clubs, (seed * 1_000_003 + i) >>> 0);
    const top = season.standings[0];
    championPoints.push(points(top));
    champions.set(top.id, (champions.get(top.id) ?? 0) + 1);
    for (const row of season.standings.slice(-3)) relegated.set(row.id, (relegated.get(row.id) ?? 0) + 1);
    for (const round of season.rounds) {
      for (const r of round) {
        matches++;
        goals += r.homeGoals + r.awayGoals;
        if (r.homeGoals === r.awayGoals) draws++;
        if (r.homeGoals > r.awayGoals) homeWins++;
      }
    }
  }

  const byCount = (/** @type {Map<string, number>} */ m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    runs,
    championPointsAvg: championPoints.reduce((a, b) => a + b, 0) / runs,
    championPointsMin: Math.min(...championPoints),
    championPointsMax: Math.max(...championPoints),
    goalsPerMatch: goals / matches,
    drawRate: draws / matches,
    homeWinRate: homeWins / matches,
    champions: byCount(champions),
    relegated: byCount(relegated),
  };
}
