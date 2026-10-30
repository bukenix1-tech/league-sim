// @ts-check
// 1 試合の結果を決める（ポアソン分布）。

/**
 * @typedef {import("./clubs.js").Club} Club
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {{ home: string, away: string, homeGoals: number, awayGoals: number }} MatchResult
 */

// 1 クラブが 1 試合で取る点の平均（平均的なクラブ同士・中立の場所）
export const BASE_GOALS = 1.27;
// ホームの得点の倍率と、アウェーの得点の倍率
export const HOME_ADVANTAGE = 1.12;
export const AWAY_FACTOR = 0.9;

/**
 * [ホームの得点の期待値, アウェーの得点の期待値]
 * @param {Club} home
 * @param {Club} away
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

/**
 * @param {Club} home
 * @param {Club} away
 * @param {Rng} rng
 * @returns {MatchResult}
 */
export function playMatch(home, away, rng) {
  const [homeXg, awayXg] = expectedGoals(home, away);
  return { home: home.id, away: away.id, homeGoals: poisson(rng, homeXg), awayGoals: poisson(rng, awayXg) };
}
