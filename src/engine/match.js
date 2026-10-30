// @ts-check
// 1 試合の結果を決める（ポアソン分布）と、点を誰が取ったか。

import { weightedIndex } from "./rng.js";

/**
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {import("./lineup.js").Slot} Slot
 * @typedef {{ attack: number, defense: number }} Side
 * @typedef {{ club: string, scorer: string, assist: string | null }} Goal
 * @typedef {{ home: string, away: string, homeGoals: number, awayGoals: number, goals: Goal[] }} MatchResult
 */

// 1 クラブが 1 試合で取る点の平均（平均的なクラブ同士・中立の場所）
export const BASE_GOALS = 1.2;
// ホームの得点の倍率と、アウェーの得点の倍率
export const HOME_ADVANTAGE = 1.12;
export const AWAY_FACTOR = 0.9;
// 点が入ったとき、アシストが付く割合
export const ASSIST_RATE = 0.7;

/**
 * [ホームの得点の期待値, アウェーの得点の期待値]
 * @param {Side} home @param {Side} away
 * @returns {[number, number]}
 */
export function expectedGoals(home, away) {
  return [
    (BASE_GOALS * HOME_ADVANTAGE * home.attack) / away.defense,
    (BASE_GOALS * AWAY_FACTOR * away.attack) / home.defense,
  ];
}

/**
 * 平均 lambda のポアソン分布から 1 つ引く（Knuth の方法）。
 * @param {Rng} rng
 * @param {number} lambda
 */
export function poisson(rng, lambda) {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = rng.next();
  while (p > limit) {
    k++;
    p *= rng.next();
  }
  return k;
}

const SCORER_WEIGHT = { GK: 0.01, DF: 0.8, MF: 2.2, FW: 4.5 };
const ASSIST_WEIGHT = { GK: 0.1, DF: 1, MF: 3, FW: 2 };

/**
 * 入った点ごとに、点を取った選手とアシストした選手を決める。
 * @param {Rng} rng @param {string} club @param {Slot[]} lineup @param {number} count
 * @returns {Goal[]}
 */
export function assignGoals(rng, club, lineup, count) {
  const scorerW = lineup.map(
    (s) => SCORER_WEIGHT[s.pos] * (s.player.attrs.sho / 60) ** 1.5 * (s.player.traits.includes("finisher") ? 1.4 : 1),
  );
  /** @type {Goal[]} */
  const goals = [];
  for (let g = 0; g < count; g++) {
    const si = weightedIndex(rng, scorerW);
    let assist = null;
    if (rng.next() < ASSIST_RATE) {
      const assistW = lineup.map((s, i) =>
        i === si ? 0 : ASSIST_WEIGHT[s.pos] * (s.player.attrs.pas / 60) ** 1.5 * (s.player.traits.includes("playmaker") ? 1.4 : 1),
      );
      assist = lineup[weightedIndex(rng, assistW)].player.id;
    }
    goals.push({ club, scorer: lineup[si].player.id, assist });
  }
  return goals;
}

/**
 * @param {{ id: string, side: Side, lineup: Slot[] }} home
 * @param {{ id: string, side: Side, lineup: Slot[] }} away
 * @param {Rng} rng
 * @returns {MatchResult}
 */
export function playMatch(home, away, rng) {
  const [homeXg, awayXg] = expectedGoals(home.side, away.side);
  const homeGoals = poisson(rng, homeXg);
  const awayGoals = poisson(rng, awayXg);
  return {
    home: home.id,
    away: away.id,
    homeGoals,
    awayGoals,
    goals: [...assignGoals(rng, home.id, home.lineup, homeGoals), ...assignGoals(rng, away.id, away.lineup, awayGoals)],
  };
}
