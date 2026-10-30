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
