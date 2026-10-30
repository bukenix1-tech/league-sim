// @ts-check
// 計算の部分の試験。ブラウザ (tests.html) でも Node (scripts/test.mjs) でも同じものを回す。

import { parseClubData, parseNameData } from "../src/engine/clubs.js";
import { conditionFactor, pickLineup, teamStrength } from "../src/engine/lineup.js";
import { assignGoals, expectedGoals, poisson } from "../src/engine/match.js";
import { agePlayer, grade, overallAt } from "../src/engine/players.js";
import { createRng } from "../src/engine/rng.js";
import { makeSchedule } from "../src/engine/schedule.js";
import { fatigueLoss, injuryChance, playSeason } from "../src/engine/season.js";
import { addResult, createTable, goalDiff, points, standings } from "../src/engine/table.js";
import { generateWorld, makePlayer, SQUAD_SHAPE } from "../src/engine/world.js";

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
  home, away, homeGoals: hg, awayGoals: ag, goals: [],
});
const full = () => 100;

/**
 * @param {any} clubJson data/clubs.json の中身
 * @param {any} nameJson data/names.json の中身
 * @returns {{ name: string, fn: () => void }[]}
 */
export function makeCases(clubJson, nameJson) {
  const clubs = parseClubData(clubJson).divisions[0].clubs;
  const names = parseNameData(nameJson);
  const rounds = makeSchedule(IDS);
  const world = generateWorld(clubs, names, 99);
  const season = playSeason(world, 7);
  const squad = (/** @type {number} */ i) => world.clubs[i].playerIds.map((id) => /** @type {import("../src/engine/players.js").Player} */ (world.players.get(id)));

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
        const side = { attack: 1, defense: 1 };
        const [h, a] = expectedGoals(side, side);
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
      name: "選手: 各クラブ 22 人（GK 3・DF 7・MF 7・FW 5）、名前は重ならない",
      fn() {
        eq(world.clubs.length, 20);
        for (let i = 0; i < world.clubs.length; i++) {
          const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
          for (const p of squad(i)) counts[p.pos]++;
          eq(counts, SQUAD_SHAPE, world.clubs[i].name);
        }
        const all = [...world.players.values()].map((p) => p.name);
        eq(new Set(all).size, all.length, "名前の重なり");
      },
    },
    {
      name: "選手: 能力はすべて 1〜99",
      fn() {
        for (const p of world.players.values()) {
          for (const v of Object.values(p.attrs)) ok(v >= 1 && v <= 99, `${p.name} ${v}`);
        }
      },
    },
    {
      name: "選手: level の高いクラブほど、選手の平均が高い",
      fn() {
        const avg = (/** @type {number} */ i) => squad(i).reduce((s, p) => s + overallAt(p), 0) / squad(i).length;
        ok(avg(0) > avg(19) + 15, `1 番目 ${avg(0)} / 20 番目 ${avg(19)}`);
      },
    },
    {
      name: "選手: 同じ種なら同じ世界になる",
      fn() {
        const again = generateWorld(clubs, names, 99);
        eq([...again.players.values()], [...world.players.values()]);
      },
    },
    {
      name: "評価: S〜G の境目",
      fn() {
        eq([95, 90, 89, 70, 50, 40, 39, 19].map(grade), ["S", "S", "A", "B", "D", "E", "F", "G"]);
      },
    },
    {
      name: "先発: 11 人で、GK は 1 人、けが人は入らない",
      fn() {
        const players = squad(0);
        const lineup = pickLineup(players, full, "4-4-2");
        eq(lineup.length, 11);
        eq(lineup.filter((s) => s.pos === "GK").length, 1);
        const injured = new Set(players.slice(0, 5).map((p) => p.id));
        const without = pickLineup(players.filter((p) => !injured.has(p.id)), full, "4-4-2");
        eq(without.length, 11);
        ok(without.every((s) => !injured.has(s.player.id)), "けが人が入った");
      },
    },
    {
      name: "先発: GK が全員けがなら、ほかの選手が GK に入る",
      fn() {
        const lineup = pickLineup(squad(0).filter((p) => p.pos !== "GK"), full, "4-4-2");
        eq(lineup.length, 11);
        eq(lineup.filter((s) => s.pos === "GK").length, 1);
      },
    },
    {
      name: "先発: 疲れている主力より、元気な控えを使うことがある",
      fn() {
        const players = squad(0);
        const first = pickLineup(players, full, "4-4-2");
        const tired = new Set(first.map((s) => s.player.id));
        const next = pickLineup(players, (p) => (tired.has(p.id) ? 0 : 100), "4-4-2");
        ok(next.some((s) => !tired.has(s.player.id)), "入れ替わらない");
      },
    },
    {
      name: "強さ: 疲れると攻撃力・守備力が下がる",
      fn() {
        const lineup = pickLineup(squad(0), full, "4-4-2");
        const fresh = teamStrength(lineup, full, world.clubs[0].manager);
        const tired = teamStrength(lineup, () => 30, world.clubs[0].manager);
        ok(tired.attack < fresh.attack && tired.defense < fresh.defense, "下がらない");
        eq(conditionFactor(100), 1);
      },
    },
    {
      name: "疲れとけが: スタミナが高いほど疲れにくく、ケガしにくい特徴で確率が下がる",
      fn() {
        const p = squad(0)[5];
        const strong = { ...p, attrs: { ...p.attrs, sta: 90 }, traits: [] };
        const weak = { ...p, attrs: { ...p.attrs, sta: 40 }, traits: [] };
        ok(fatigueLoss(strong) < fatigueLoss(weak), "スタミナが効かない");
        const sturdy = { ...strong, traits: /** @type {const} */ (["sturdy"]) };
        ok(injuryChance(/** @type {any} */ (sturdy), 100) < injuryChance(strong, 100), "特徴が効かない");
        ok(injuryChance(strong, 40) > injuryChance(strong, 100), "疲れが効かない");
      },
    },
    {
      name: "得点者: 点の数だけ得点者が決まり、本人にはアシストが付かない",
      fn() {
        const lineup = pickLineup(squad(0), full, "4-4-2");
        const goals = assignGoals(createRng(3), "x", lineup, 200);
        eq(goals.length, 200);
        ok(goals.every((g) => g.assist !== g.scorer), "自分にアシスト");
        const fw = goals.filter((g) => world.players.get(g.scorer)?.pos === "FW").length;
        ok(fw > goals.length * 0.35, `FW の得点が少ない ${fw}`);
      },
    },
    {
      name: "シーズン: 同じ種なら同じ結果、違う種なら違う結果",
      fn() {
        const a = JSON.stringify(season.standings);
        eq(JSON.stringify(playSeason(world, 7).standings), a);
        ok(JSON.stringify(playSeason(world, 8).standings) !== a, "種を変えても同じ");
      },
    },
    {
      name: "シーズン: 全員 38 試合、得失点差の合計 0、勝ち点の合計が合う",
      fn() {
        const rows = season.standings;
        ok(rows.every((r) => r.played === 38), "38 試合でないクラブがある");
        eq(rows.reduce((s, r) => s + goalDiff(r), 0), 0);
        const draws = rows.reduce((s, r) => s + r.drawn, 0) / 2;
        // 1 試合で配られる勝ち点は 3 (勝ち負け) か 2 (引き分け)
        eq(rows.reduce((s, r) => s + points(r), 0), 380 * 3 - draws);
      },
    },
    {
      name: "シーズン: 選手の得点の合計がクラブの得点と合い、出場は 1 試合 11 人",
      fn() {
        for (const row of season.standings) {
          let goals = 0;
          let apps = 0;
          for (const s of season.stats.values()) {
            if (s.club !== row.id) continue;
            goals += s.goals;
            apps += s.apps;
          }
          eq(goals, row.goalsFor, row.id);
          eq(apps, 38 * 11, row.id);
        }
      },
    },
    {
      name: "年齢: 若い選手は伸び、年を取った選手は衰える",
      fn() {
        const rng = createRng(5);
        let young = 0;
        let old = 0;
        for (let i = 0; i < 200; i++) {
          const y = makePlayer(rng, "y", "", "MF", 55, 19);
          young += overallAt(agePlayer(y, rng)) - overallAt(y);
          const o = makePlayer(rng, "o", "", "MF", 70, 34);
          old += overallAt(agePlayer(o, rng)) - overallAt(o);
        }
        ok(young / 200 > 1, `若い選手の伸び ${young / 200}`);
        ok(old / 200 < -1, `34 歳の衰え ${old / 200}`);
      },
    },
    {
      name: "年齢: 年を取らせても元の選手は変わらない",
      fn() {
        const p = squad(0)[0];
        const before = JSON.stringify(p);
        agePlayer(p, createRng(1));
        eq(JSON.stringify(p), before);
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
