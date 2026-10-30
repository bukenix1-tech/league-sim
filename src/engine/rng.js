// @ts-check
// 種を指定できる乱数（mulberry32）。同じ種なら必ず同じ並びになる。

/**
 * @typedef {{ next: () => number }} Rng  next() は 0 以上 1 未満を返す
 */

/**
 * @param {number} seed 整数
 * @returns {Rng}
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** 種を決めずに回すとき用 */
export function randomSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * min 以上 max 以下の整数
 * @param {Rng} rng @param {number} min @param {number} max
 */
export function randInt(rng, min, max) {
  return min + Math.floor(rng.next() * (max - min + 1));
}

/**
 * 正規分布（Box-Muller）
 * @param {Rng} rng @param {number} mean @param {number} sd
 */
export function normal(rng, mean, sd) {
  const u = 1 - rng.next();
  const v = rng.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @template T
 * @param {Rng} rng @param {T[]} items
 * @returns {T}
 */
export function pick(rng, items) {
  return items[Math.floor(rng.next() * items.length)];
}

/**
 * 重みに比例して添え字を 1 つ選ぶ
 * @param {Rng} rng @param {number[]} weights
 */
export function weightedIndex(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
