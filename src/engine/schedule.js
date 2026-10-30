// @ts-check
// 2 回戦総当たりの日程を作る（サークル方式）。

/** @typedef {[home: string, away: string]} Fixture */

/**
 * 節ごとの [home, away] の並びを返す。
 * 前半 n-1 節で全員と 1 回ずつ当たり、後半はホームとアウェーを入れ替えて同じ組み合わせを繰り返す。
 * @param {string[]} ids
 * @returns {Fixture[][]}
 */
export function makeSchedule(ids) {
  const n = ids.length;
  if (n % 2 !== 0) throw new Error("クラブの数は偶数にしてください");

  let rotating = [...ids];
  /** @type {Fixture[][]} */
  const firstHalf = [];
  for (let round = 0; round < n - 1; round++) {
    /** @type {Fixture[]} */
    const fixtures = [];
    for (let i = 0; i < n / 2; i++) {
      let a = rotating[i];
      let b = rotating[n - 1 - i];
      // 固定したクラブ (先頭) のホームとアウェーを節ごとに入れ替えて偏りを減らす
      if (i === 0 && round % 2 === 1) [a, b] = [b, a];
      fixtures.push([a, b]);
    }
    firstHalf.push(fixtures);
    // 先頭を固定して残りを 1 つずつ回す
    rotating = [rotating[0], rotating[n - 1], ...rotating.slice(1, n - 1)];
  }

  const secondHalf = firstHalf.map((fixtures) =>
    fixtures.map(([home, away]) => /** @type {Fixture} */ ([away, home])),
  );
  return [...firstHalf, ...secondHalf];
}
