// @ts-check
// シーズンを何回も回して、本物のリーグの目安と比べる。

import { agePlayer, overallAt } from "./players.js";
import { createRng } from "./rng.js";
import { leaders, playSeason } from "./season.js";
import { points } from "./table.js";
import { generateWorld, makePlayer } from "./world.js";

/**
 * @typedef {import("./clubs.js").Club} Club
 * @typedef {import("./clubs.js").NameData} NameData
 */

/** 本物の 1 部リーグのおおよその目安 */
export const REAL_TARGETS = {
  championPoints: "85〜95",
  goalsPerMatch: "約 2.7",
  drawRate: "約 25%",
  homeWinRate: "約 45%",
  topScorer: "20〜30",
  topAssists: "12〜20",
  injuriesPerClub: "15〜25（数え方で変わる）",
};

/** 1 回ごとに世界とシーズンの種を変える */
const runSeed = (/** @type {number} */ seed, /** @type {number} */ i) => (seed * 1_000_003 + i) >>> 0;

/**
 * @param {Club[]} clubs @param {NameData} names @param {number} runs @param {number} seed
 */
export function summarize(clubs, names, runs, seed) {
  /** @type {number[]} */
  const championPoints = [];
  /** @type {number[]} */
  const topScorer = [];
  /** @type {number[]} */
  const topAssists = [];
  /** @type {Map<string, number>} */
  const champions = new Map();
  /** @type {Map<string, number>} */
  const relegated = new Map();
  let matches = 0;
  let goals = 0;
  let draws = 0;
  let homeWins = 0;
  let injuries = 0;
  let playersUsed = 0;

  for (let i = 0; i < runs; i++) {
    const s = runSeed(seed, i);
    const season = playSeason(generateWorld(clubs, names, s), s);
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
    topScorer.push(leaders(season, "goals", 1)[0]?.[1].goals ?? 0);
    topAssists.push(leaders(season, "assists", 1)[0]?.[1].assists ?? 0);
    for (const ps of season.stats.values()) {
      injuries += ps.injuries;
      if (ps.apps > 0) playersUsed++;
    }
  }

  const avg = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const byCount = (/** @type {Map<string, number>} */ m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    runs,
    championPointsAvg: avg(championPoints),
    championPointsMin: Math.min(...championPoints),
    championPointsMax: Math.max(...championPoints),
    goalsPerMatch: goals / matches,
    drawRate: draws / matches,
    homeWinRate: homeWins / matches,
    topScorerAvg: avg(topScorer),
    topScorerMin: Math.min(...topScorer),
    topScorerMax: Math.max(...topScorer),
    topAssistsAvg: avg(topAssists),
    injuriesPerClub: injuries / (runs * clubs.length),
    playersUsedPerClub: playersUsed / (runs * clubs.length),
    champions: byCount(champions),
    relegated: byCount(relegated),
  };
}

/**
 * 18 歳の選手を count 人作り、毎年 1 つずつ年を取らせて、年齢ごとの総合力の平均を出す。
 * @param {number} seed @param {number} count @param {number} base 18 歳のときの総合力の目安
 * @returns {{ age: number, avg: number }[]}
 */
export function agingCurve(seed, count, base) {
  const rng = createRng(seed);
  const positions = /** @type {const} */ (["GK", "DF", "MF", "FW"]);
  const sums = new Map();
  for (let i = 0; i < count; i++) {
    let p = makePlayer(rng, `p${i}`, "", positions[i % 4], base, 18);
    for (let age = 18; age <= 38; age++) {
      sums.set(age, (sums.get(age) ?? 0) + overallAt(p));
      p = agePlayer(p, rng);
    }
  }
  return [...sums.entries()].map(([age, sum]) => ({ age, avg: sum / count }));
}
