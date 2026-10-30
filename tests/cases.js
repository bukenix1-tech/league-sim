// @ts-check
// 計算の部分の試験。ブラウザ (tests.html) でも Node (scripts/test.mjs) でも同じものを回す。

import { parseClubData } from "../src/engine/clubs.js";
import { expectedGoals, poisson } from "../src/engine/match.js";
import { createRng } from "../src/engine/rng.js";
import { makeSchedule } from "../src/engine/schedule.js";
import { playSeason } from "../src/engine/season.js";
import { addResult, createTable, goalDiff, points, standings } from "../src/engine/table.js";

/** @param {unknown} cond @param {string} msg */
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
/** @param {unknown} actual @param {unknown} expected @param {string} [msg] */
function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} 期待 ${e} / 実際 ${a}`);
}

const IDS = Array.from({ length: 20 }, (_, i) => `t${String(i).padStart(2, "0")}`);
const match = (/** @type {string} */ home, /** @type {string} */ away, /** @type {number} */ hg, /** @type {number} */ ag) => ({
  home, away, homeGoals: hg, awayGoals: ag,
});

/**
 * @param {any} clubJson data/clubs.json の中身
 * @returns {{ name: string, fn: () => void }[]}
 */
export function makeCases(clubJson) {
  const clubs = parseClubData(clubJson).divisions[0].clubs;
  const rounds = makeSchedule(IDS);

  return [
    {
      name: "日程: 38 節あり、各節 10 試合",
      fn() {
        eq(rounds.length, 38);
        for (const r of rounds) eq(r.length, 10);
      },
    },
    {
      name: "日程: 各節で全クラブがちょうど 1 回ずつ出る",
      fn() {
        for (const r of rounds) eq(r.flat().sort(), [...IDS].sort());
      },
    },
    {
      name: "日程: 各クラブ 38 試合、ホーム 19・アウェー 19",
      fn() {
        for (const id of IDS) {
          const games = rounds.flat().filter(([h, a]) => h === id || a === id);
          eq(games.length, 38, id);
          eq(games.filter(([h]) => h === id).length, 19, id);
        }
      },
    },
    {
      name: "日程: どの組み合わせも、それぞれのホームで 1 回ずつ",
      fn() {
        const keys = rounds.flat().map(([h, a]) => `${h}-${a}`);
        eq(new Set(keys).size, 20 * 19);
        eq(keys.length, 20 * 19);
      },
    },
    {
      name: "日程: クラブの数が奇数なら止める",
      fn() {
        let threw = false;
        try { makeSchedule(IDS.slice(0, 19)); } catch { threw = true; }
        ok(threw, "例外が出ない");
      },
    },
    {
      name: "順位表: 勝ち 3・引き分け 1・負け 0 と得失点差",
      fn() {
        const t = createTable(["A", "B", "C"]);
        addResult(t, match("A", "B", 2, 0)); // A 勝ち
        addResult(t, match("B", "C", 1, 1)); // 引き分け
        addResult(t, match("C", "A", 3, 1)); // C 勝ち
        const get = (/** @type {string} */ id) => /** @type {import("../src/engine/table.js").Row} */ (t.get(id));
        eq([points(get("A")), points(get("B")), points(get("C"))], [3, 1, 4]);
        eq([get("A").won, get("A").drawn, get("A").lost], [1, 0, 1]);
        eq(goalDiff(get("A")), 0); // 3 点取って 3 点取られた
        eq(goalDiff(get("B")), -2);
      },
    },
    {
      name: "順位表: 勝ち点が同じなら得失点差、次に総得点",
      fn() {
        const t = createTable(["A", "B", "C", "D"]);
        addResult(t, match("A", "D", 3, 0)); // 3 点, +3, 得点 3
        addResult(t, match("B", "D", 4, 1)); // 3 点, +3, 得点 4
        addResult(t, match("C", "D", 5, 0)); // 3 点, +5
        eq(standings(t).map((r) => r.id), ["C", "B", "A", "D"]);
      },
    },
    {
      name: "試合: ホームが有利",
      fn() {
        const c = { id: "x", name: "x", short: "x", attack: 1, defense: 1 };
        const [h, a] = expectedGoals(c, c);
        ok(h > a, `${h} <= ${a}`);
      },
    },
    {
      name: "試合: ポアソン分布の平均が合う",
      fn() {
        const rng = createRng(0);
        let sum = 0;
        const n = 20000;
        for (let i = 0; i < n; i++) sum += poisson(rng, 1.4);
        ok(Math.abs(sum / n - 1.4) < 0.05, `平均 ${sum / n}`);
      },
    },
    {
      name: "シーズン: データは 20 クラブ",
      fn() {
        eq(clubs.length, 20);
      },
    },
    {
      name: "シーズン: 同じ種なら同じ結果、違う種なら違う結果",
      fn() {
        const a = JSON.stringify(playSeason(clubs, 123).standings);
        eq(JSON.stringify(playSeason(clubs, 123).standings), a);
        ok(JSON.stringify(playSeason(clubs, 124).standings) !== a, "種を変えても同じ");
      },
    },
    {
      name: "シーズン: 全員 38 試合、得失点差の合計 0、勝ち点の合計が合う",
      fn() {
        const rows = playSeason(clubs, 7).standings;
        ok(rows.every((r) => r.played === 38), "38 試合でないクラブがある");
        eq(rows.reduce((s, r) => s + goalDiff(r), 0), 0);
        const draws = rows.reduce((s, r) => s + r.drawn, 0) / 2;
        // 1 試合で配られる勝ち点は 3 (勝ち負け) か 2 (引き分け)
        eq(rows.reduce((s, r) => s + points(r), 0), 380 * 3 - draws);
      },
    },
  ];
}

/**
 * @param {{ name: string, fn: () => void }[]} cases
 * @returns {{ name: string, error?: string }[]}
 */
export function runCases(cases) {
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name };
    } catch (e) {
      return { name, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
