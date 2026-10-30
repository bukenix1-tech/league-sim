// @ts-check
// 1 シーズンを回す。

import { playMatch } from "./match.js";
import { createRng } from "./rng.js";
import { makeSchedule } from "./schedule.js";
import { addResult, createTable, standings } from "./table.js";

/**
 * @typedef {import("./clubs.js").Club} Club
 * @typedef {import("./match.js").MatchResult} MatchResult
 * @typedef {import("./table.js").Row} Row
 * @typedef {{ seed: number, rounds: MatchResult[][], standings: Row[] }} SeasonResult
 */

/**
 * 同じ clubs と seed なら必ず同じ結果になる。
 * @param {Club[]} clubs
 * @param {number} seed
 * @returns {SeasonResult}
 */
export function playSeason(clubs, seed) {
  const rng = createRng(seed);
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const ids = clubs.map((c) => c.id);
  const table = createTable(ids);
  const rounds = makeSchedule(ids).map((fixtures) =>
    fixtures.map(([h, a]) => {
      const result = playMatch(/** @type {Club} */ (byId.get(h)), /** @type {Club} */ (byId.get(a)), rng);
      addResult(table, result);
      return result;
    }),
  );
  return { seed, rounds, standings: standings(table) };
}
