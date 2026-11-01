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
import { chooseClub, createLeague, ensureAbroad, playFirstHalf, playSecondHalf, playYear, RELEGATED, SAVE_VERSION, seasonGoal, setBudget } from "../src/engine/league.js";
import { attendance, autoBudget, budgetForLevel, budgetRange, initialFinance, levelFromBudget, nextPopularity, revenue, totalRevenue, wage } from "../src/engine/finance.js";
import { evaluate, ownerGoal } from "../src/engine/owner.js";
import { playerValue } from "../src/engine/contracts.js";
import { COUNTRIES, HOME_COUNTRY, locationOf, POOL_SIZE } from "../src/engine/abroad.js";
import { guide } from "../src/engine/guide.js";
import { dividend, trainingBonus } from "../src/engine/finance.js";
import { acceptBid, acceptOffer, buyPlayer, hireManager, marketList, releaseCost, releasePlayer, renewContract, sackCost, sellPlayer, setAutoTransfers, setTicket, spendLimit, upgradeFacility, willJoin } from "../src/engine/market.js";
import { retireChance } from "../src/engine/offseason.js";
import { parseSave, serialize } from "../src/engine/save.js";

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
  const clubData = parseClubData(clubJson);
  const clubs = clubData.divisions[0].clubs;
  const names = parseNameData(nameJson);
  // 3 年回したリーグ（何年も続ける試験で使う）
  const start = createLeague(clubData, names, 5);
  const years = [playYear(start, names)];
  years.push(playYear(years[0].league, names));
  years.push(playYear(years[1].league, names));
  const after = years[2].league;
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
    {
      name: "何年も: 1 部 20・2 部 24 のまま、全部で 44 クラブ",
      fn() {
        eq(after.divisions.map((d) => d.clubIds.length), [20, 24]);
        eq(new Set(after.divisions.flatMap((d) => d.clubIds)).size, 44);
      },
    },
    {
      name: "何年も: 1 部の下 3 つが降格、2 部の上 2 つとプレーオフの勝者が昇格",
      fn() {
        const { record, league } = years[0];
        const [top, second] = record.tables;
        eq(record.relegated, top.slice(-RELEGATED).map((r) => r[0]));
        eq(record.promoted.slice(0, 2), second.slice(0, 2).map((r) => r[0]));
        ok(second.slice(2, 6).map((r) => r[0]).includes(record.playoff.winner), "プレーオフの勝者が 3〜6 位でない");
        for (const id of record.promoted) ok(league.divisions[0].clubIds.includes(id), `${id} が 1 部にいない`);
        for (const id of record.relegated) ok(league.divisions[1].clubIds.includes(id), `${id} が 2 部にいない`);
      },
    },
    {
      name: "何年も: 2 部は 46 節、1 部は 38 節",
      fn() {
        const [top, second] = years[0].seasons;
        eq([top.rounds.length, second.rounds.length], [38, 46]);
      },
    },
    {
      name: "何年も: シーズン中はどのクラブも 22 人そろい、同じ選手が 2 つのクラブにいない",
      fn() {
        for (const { league, seasons } of years) {
          // シーズン中の人数（引退した選手はシーズンの後で抜けるので、シーズンの記録で数える）
          /** @type {Map<string, number>} */
          const perClub = new Map();
          for (const s of seasons) for (const st of s.stats.values()) perClub.set(st.club, (perClub.get(st.club) ?? 0) + 1);
          eq([...perClub.values()].every((n) => n === 22), true, "22 人でないクラブがある");
          eq(perClub.size, 44);
          const ids = Object.values(league.clubs).flatMap((c) => c.playerIds);
          eq(new Set(ids).size, ids.length);
          eq(Object.keys(league.players).length, ids.length + league.freeAgents.length, "選手の表とクラブの選手・フリーの選手が合わない");
        }
      },
    },
    {
      name: "何年も: 年を取り、引退と新しい選手の入れ替わりがある",
      fn() {
        const p0 = Object.values(start.players)[0];
        const p1 = years[0].league.players[p0.id];
        if (p1) eq(p1.age, p0.age + 1);
        const [o0, o1] = [years[0].record.offseason, years[1].record.offseason];
        ok(o0.retired > 0, "引退が無い");
        // シーズンの後に引退した分は、次のシーズン前に補強で埋まる
        ok(o1.joined >= o0.retired, `補強 ${o1.joined} / 引退 ${o0.retired}`);
        eq(retireChance(30), 0);
        eq(retireChance(40), 1);
      },
    },
    {
      name: "何年も: 通算の記録が積み重なり、年と記録が 1 つずつ進む",
      fn() {
        eq(after.year, start.year + 3);
        eq(after.history.map((h) => h.year), [start.year, start.year + 1, start.year + 2]);
        const veteran = Object.values(after.players).find((p) => (p.career?.seasons ?? 0) === 3);
        ok(veteran, "3 シーズン続けて出た選手がいない");
      },
    },
    {
      name: "何年も: 同じ種なら同じ流れになり、元のリーグは変わらない",
      fn() {
        const before = serialize(start);
        const again = playYear(start, names);
        eq(serialize(again.league), serialize(years[0].league));
        eq(serialize(start), before);
      },
    },
    {
      name: "セーブ: 書き出して読み込むと元どおり",
      fn() {
        const text = serialize(after);
        eq(serialize(parseSave(text)), text);
        // 読み込んだものから続けても同じ結果
        eq(serialize(playYear(parseSave(text), names).league), serialize(playYear(after, names).league));
      },
    },
    {
      name: "セーブ: 新しすぎる版や壊れたファイルは読まない",
      fn() {
        const bad = (/** @type {string} */ text) => {
          try { parseSave(text); } catch { return true; }
          return false;
        };
        ok(bad(JSON.stringify({ ...after, version: SAVE_VERSION + 1 })), "新しい版を読んだ");
        ok(bad("{これは JSON ではない"), "壊れたファイルを読んだ");
        ok(bad(JSON.stringify({ version: SAVE_VERSION })), "中身の無いセーブを読んだ");
      },
    },
    {
      name: "セーブ: 版 1（段階 3）のセーブを読むと、お金と契約が足されて続きから遊べる",
      fn() {
        const old = JSON.parse(serialize(after));
        old.version = 1;
        delete old.user;
        delete old.freeAgents;
        for (const c of Object.values(old.clubs)) {
          delete /** @type {any} */ (c).finance;
          delete /** @type {any} */ (c).form;
        }
        for (const p of Object.values(old.players)) delete /** @type {any} */ (p).contract;
        for (const h of old.history) delete h.user;
        const loaded = parseSave(JSON.stringify(old));
        eq(loaded.version, SAVE_VERSION);
        eq(loaded.user, null);
        ok(Object.values(loaded.clubs).every((c) => c.finance.popularity > 0 && c.finance.facilities.training >= 1), "お金と施設が足されていない");
        ok(Object.values(loaded.players).every((p) => (p.contract?.wage ?? 0) > 0), "契約が足されていない");
        eq(playYear(loaded, names).league.year, after.year + 1);
      },
    },
    {
      name: "お金: 予算と規模は行き来でき、規模が高いほど年俸がかかる",
      fn() {
        for (const level of [45, 60, 80]) ok(Math.abs(levelFromBudget(budgetForLevel(level)) - level) < 1e-9, `${level}`);
        ok(budgetForLevel(80) > budgetForLevel(60) * 2, "差が小さすぎる");
        const strong = squad(0)[0];
        const weak = { ...strong, attrs: { ...strong.attrs, gk: 50, pas: 40 } };
        ok(wage(strong) > wage(weak), "うまい選手の年俸が高くない");
      },
    },
    {
      name: "お金: 同じクラブでも 1 部の方が収入が多く、上の順位ほど多い。パラシュートで 2 部の放映権が増える",
      fn() {
        const f = initialFinance(60);
        const r1 = totalRevenue(revenue(f, 0, 10, 20));
        const r2 = totalRevenue(revenue(f, 1, 10, 24));
        ok(r1 > r2 * 1.2, `1 部 ${r1} / 2 部 ${r2}`);
        ok(totalRevenue(revenue(f, 0, 1, 20)) > totalRevenue(revenue(f, 0, 20, 20)), "順位で増えない");
        ok(revenue({ ...f, parachute: 1 }, 1, 10, 24).tv > revenue(f, 1, 10, 24).tv, "パラシュートが効かない");
      },
    },
    {
      name: "お金: 借金があると予算の上限が下がり、おまかせの予算は幅の中に入る",
      fn() {
        const f = initialFinance(65);
        const rich = budgetRange({ ...f, cash: 200 }, 0, 20);
        const poor = budgetRange({ ...f, cash: -100 }, 0, 20);
        ok(rich.max > poor.max, "借金で上限が下がらない");
        for (const cash of [-100, 0, 300]) {
          const g = { ...f, cash };
          const b = autoBudget(g, 0, 20);
          const r = budgetRange(g, 0, 20);
          ok(b >= r.min - 1e-9 && b <= r.max + 1e-9, `cash ${cash}: ${b}`);
        }
      },
    },
    {
      name: "人気: 上の順位なら増え、下の順位なら減る（少しずつ）",
      fn() {
        const up = nextPopularity(30, 0, 1, 20);
        const down = nextPopularity(30, 0, 20, 20);
        ok(up > 30 && down < 30, `${up} / ${down}`);
        ok(up < 30 * 1.6, "動きが大きすぎる");
      },
    },
    {
      name: "オーナー: 規模が大きいほど目標が高く、達成で信頼が上がり、外すと下がる（0〜100）",
      fn() {
        eq(ownerGoal(1, 0, 20).maxPos, 1);
        eq(ownerGoal(20, 0, 20).maxPos, 17);
        eq(ownerGoal(1, 1, 24).maxPos, 2);
        const g = ownerGoal(10, 0, 20);
        ok(evaluate(g, 5, 60).trust > 60, "達成で上がらない");
        ok(evaluate(g, 18, 60).trust < 60, "外して下がらない");
        eq(evaluate(g, 1, 95).trust, 100);
        eq(evaluate(g, 20, 10).trust, 0);
      },
    },
    {
      name: "自分のクラブ: 予算を上げると規模が上がり、評価とお金の記録が残る",
      fn() {
        const id = "ykc"; // 2 部の一番小さいクラブ
        const mine = chooseClub(start, id);
        const { min, max } = budgetRange(mine.clubs[id].finance, 1, 24);
        const low = playYear(setBudget(mine, min), names);
        const high = playYear(setBudget(mine, max), names);
        ok(high.league.clubs[id].level > low.league.clubs[id].level, "予算が効かない");
        ok(high.league.clubs[id].finance.cash < low.league.clubs[id].finance.cash, "予算を上げてもお金が減らない");
        const rec = high.record.user;
        ok(rec && rec.clubId === id && rec.division === 1, "記録が無い");
        ok(rec && Math.abs(rec.budget - max) < 1e-9, "予算が記録と違う");
        eq(seasonGoal(mine, id).maxPos, 18);
      },
    },
    {
      name: "契約: 始めの契約は 1〜4 年、年俸は力に合う。契約が切れた選手の移籍金は 0、若い選手ほど高い",
      fn() {
        for (const p of Object.values(start.players)) {
          const c = /** @type {import("../src/engine/players.js").Contract} */ (p.contract);
          ok(c.years >= 1 && c.years <= 4, `${p.name} ${c.years} 年`);
          ok(Math.abs(c.wage - wage(p)) < 0.06, `${p.name} 年俸 ${c.wage}`);
        }
        const p = squad(0)[3];
        eq(playerValue({ ...p, contract: { years: 0, wage: 1 } }), 0);
        const young = playerValue({ ...p, age: 21, contract: { years: 3, wage: 1 } });
        const old = playerValue({ ...p, age: 32, contract: { years: 3, wage: 1 } });
        ok(young > old, `${young} / ${old}`);
      },
    },
    {
      name: "契約: シーズン中のクラブの選手には全員契約がある",
      fn() {
        for (const c of Object.values(after.clubs)) {
          for (const id of c.playerIds) ok(after.players[id].contract, `${after.players[id].name} に契約が無い`);
        }
      },
    },
    {
      name: "移籍: フリーの選手は移籍金なしで取れ、ほかのクラブの選手は移籍金でお金が動く",
      fn() {
        const me = chooseClub(after, "ykc");
        const free = me.freeAgents.map((id) => me.players[id]).find((p) => willJoin(me, p));
        if (free) {
          const L = buyPlayer(me, free.id);
          ok(L.clubs.ykc.playerIds.includes(free.id), "フリーの選手が入らない");
          eq(L.clubs.ykc.finance.cash, me.clubs.ykc.finance.cash);
          ok(!L.freeAgents.includes(free.id), "フリーの一覧に残っている");
        }
        const entry = marketList(me, null, 2000).find((e) => e.clubId && e.fee > 0 && e.fee < me.clubs.ykc.finance.cash);
        ok(entry, "買える選手がいない");
        if (!entry || !entry.clubId) return;
        const L = buyPlayer(me, entry.player.id);
        ok(Math.abs(L.clubs.ykc.finance.cash - (me.clubs.ykc.finance.cash - entry.fee)) < 0.11, "買った側のお金");
        ok(Math.abs(L.clubs[entry.clubId].finance.cash - (me.clubs[entry.clubId].finance.cash + entry.fee)) < 0.11, "売った側のお金");
        ok(!L.clubs[entry.clubId].playerIds.includes(entry.player.id), "元のクラブに残っている");
      },
    },
    {
      name: "移籍: 規模を大きく上回るスターは来ず、契約の更新も断る",
      fn() {
        const me = chooseClub(after, "ykc");
        const star = marketList(me, null, 2000, false).find((e) => !e.willing);
        ok(star, "来てくれない選手がいない");
        ok(marketList(me, null, 2000).every((e) => e.willing), "一覧に来てくれない選手が出ている");
        if (!star) return;
        let threw = false;
        try { buyPlayer(me, star.player.id); } catch { threw = true; }
        ok(threw, "スターが来てしまった");
        // 自分のクラブにスターがいることにして、更新を断るか見る
        const L = structuredClone(me);
        const pid = L.clubs.ykc.playerIds[0];
        L.players[pid] = { ...L.players[pid], attrs: /** @type {any} */ (Object.fromEntries(Object.keys(L.players[pid].attrs).map((k) => [k, 99]))) };
        threw = false;
        try { renewContract(L, pid, 3); } catch { threw = true; }
        ok(threw, "スターが更新した");
      },
    },
    {
      name: "移籍: 売ると移籍金が入り、解除すると残りの年俸の半分を払ってフリーになる",
      fn() {
        const me = chooseClub(after, "ykc");
        const pid = me.clubs.ykc.playerIds.find((id) => (me.players[id].contract?.years ?? 0) >= 2);
        ok(pid, "売れる選手がいない");
        if (!pid) return;
        try {
          const sold = sellPlayer(me, pid);
          ok(sold.fee > 0 && sold.league.clubs.ykc.finance.cash > me.clubs.ykc.finance.cash, "お金が入らない");
          ok(sold.league.clubs[sold.buyer].playerIds.includes(pid), "買ったクラブにいない");
        } catch (e) {
          ok(String(e).includes("買えるクラブがありません"), String(e));
        }
        const cost = releaseCost(me.players[pid]);
        const released = releasePlayer(me, pid);
        ok(Math.abs(released.clubs.ykc.finance.cash - (me.clubs.ykc.finance.cash - cost)) < 0.11, "解除のお金");
        ok(released.freeAgents.includes(pid), "フリーにならない");
      },
    },
    {
      name: "移籍: 自分で補強すると、夏に 22 人まで勝手に埋まらず、試合に必要な人数だけは若手で埋まる",
      fn() {
        let me = setAutoTransfers(chooseClub(after, "ykc"), false);
        // 何人か出して、少ない人数にする
        for (const id of me.clubs.ykc.playerIds.slice(0, 6)) me = releasePlayer(me, id);
        const { seasons } = playYear(me, names);
        const inSeason = seasons.flatMap((s) => [...s.stats.values()]).filter((st) => st.club === "ykc").length;
        ok(inSeason < 22, `22 人まで埋まった (${inSeason})`);
        ok(inSeason >= 17, `試合に必要な人数より少ない (${inSeason})`);
      },
    },
    {
      name: "施設: 大きくするとお金が減って段階が上がり、スタジアムは席が増える",
      fn() {
        const me = structuredClone(chooseClub(after, "nbc"));
        me.clubs.nbc.finance.cash = 1000;
        const f = me.clubs.nbc.finance;
        if (f.facilities.training < 5) {
          const L = upgradeFacility(me, "training");
          eq(L.clubs.nbc.finance.facilities.training, f.facilities.training + 1);
          ok(L.clubs.nbc.finance.cash < f.cash, "お金が減らない");
        }
        const S = upgradeFacility(me, "stadium");
        eq(S.clubs.nbc.finance.capacity, f.capacity + 5000);
        ok(trainingBonus({ stadium: 1, training: 3, youth: 1 }) > trainingBonus({ stadium: 1, training: 1, youth: 1 }), "練習場が効かない");
      },
    },
    {
      name: "誘い: 誘ってきたクラブに移ると自分のクラブが変わり、信頼は始めに戻る",
      fn() {
        const me = chooseClub(after, "ykc");
        const withOffer = { ...me, user: { .../** @type {any} */ (me.user), offers: ["nbc"], trust: 90 } };
        const moved = acceptOffer(withOffer, "nbc");
        eq(moved.user?.clubId, "nbc");
        eq(moved.user?.trust, 60);
        let threw = false;
        try { acceptOffer(me, "nbc"); } catch { threw = true; }
        ok(threw, "誘われていないのに移れた");
      },
    },
    {
      name: "お金: 手元のお金が収入の 1.5 倍を超えた分だけ配当が出る",
      fn() {
        eq(dividend(100, 100), 0);
        ok(Math.abs(dividend(250, 100) - 30) < 1e-9, `${dividend(250, 100)}`);
      },
    },
    {
      name: "何年も: フリーの選手は増えすぎず、クラブと重ならない",
      fn() {
        ok(after.freeAgents.length <= 150, `${after.freeAgents.length} 人`);
        const atClubs = new Set(Object.values(after.clubs).flatMap((c) => c.playerIds));
        ok(after.freeAgents.every((id) => after.players[id] && !atClubs.has(id)), "フリーの選手がクラブにもいる");
      },
    },
    {
      name: "冬: 前半で 1 部は 19 節・2 部は 23 節まで進んで止まり、途中でセーブしても続きは同じ",
      fn() {
        const first = playFirstHalf(after, names);
        eq(first.rounds.map((r) => r.length), [19, 23]);
        ok(first.league.midSeason, "途中の状態が無い");
        let threw = false;
        try { playFirstHalf(first.league, names); } catch { threw = true; }
        ok(threw, "前半を 2 回回せた");
        const direct = playSecondHalf(first.league, names);
        const reloaded = playSecondHalf(parseSave(serialize(first.league)), names);
        eq(serialize(reloaded.league), serialize(direct.league));
        eq(serialize(direct.league), serialize(playYear(after, names).league));
        ok(direct.seasons.every((s) => s.standings.every((r) => r.played === (s.standings.length - 1) * 2)), "全部の試合が終わっていない");
      },
    },
    {
      name: "冬: 冬に取った選手は後半の試合に出られる",
      fn() {
        const mine = chooseClub(after, "ykc", names);
        const first = playFirstHalf(mine, names);
        const L = first.league;
        const entry = marketList(L, "FW", 50).find((e) => e.clubId === null || e.fee < spendLimit(L));
        ok(entry, "取れる選手がいない");
        if (!entry) return;
        const bought = buyPlayer(L, entry.player.id);
        const { seasons, league: next } = playSecondHalf(bought, names);
        // 別の部のクラブから取ったときは、前の部の記録（前のクラブ）と、自分の部の記録の両方がある
        const mineStats = seasons.flatMap((s) => [...s.stats.entries()]).filter(([id, st]) => id === entry.player.id && st.club === "ykc");
        eq(mineStats.length, 1, "後半の記録が自分のクラブに無い");
        const all = seasons.flatMap((s) => [...s.stats.entries()]).filter(([id]) => id === entry.player.id);
        eq(next.players[entry.player.id].last?.apps, all.reduce((sum, [, st]) => sum + st.apps, 0), "前のシーズンの記録が足されていない");
      },
    },
    {
      name: "監督: シーズンの後に候補が 4 人そろい、雇うと違約金を払って入れ替わる",
      fn() {
        const mine = chooseClub(after, "ykc", names);
        eq(mine.user?.candidates.length, 4);
        const next = playYear(mine, names).league;
        eq(next.user?.candidates.length, 4);
        const L = structuredClone(next);
        L.clubs.ykc.finance.cash = 100;
        const cost = sackCost(L);
        const hired = hireManager(L, 0);
        eq(hired.clubs.ykc.manager, L.user?.candidates[0]);
        ok(Math.abs(hired.clubs.ykc.finance.cash - (100 - cost)) < 0.11, "違約金");
        eq(hired.user?.candidates.length, 3);
      },
    },
    {
      name: "入場料: 高いと 1 人あたりの収入は増えるが観客が減り、人気も下がっていく",
      fn() {
        const f = initialFinance(60);
        const high = { ...f, ticket: /** @type {const} */ ("high"), capacity: 999999 };
        const normal = { ...f, capacity: 999999 };
        ok(attendance(high) < attendance(normal), "観客が減らない");
        ok(revenue(high, 0, 10, 20).tickets / attendance(high) > revenue(normal, 0, 10, 20).tickets / attendance(normal), "1 人あたりが増えない");
        ok(nextPopularity(30, 0, 10, 20, "high") < nextPopularity(30, 0, 10, 20, "normal"), "人気が下がらない");
        const L = setTicket(chooseClub(after, "ykc"), "low");
        eq(L.clubs.ykc.finance.ticket, "low");
      },
    },
    {
      name: "クビ: 借金が大きすぎるとクビになり、2 部の小さいクラブ 3 つから声がかかって、移ると続けられる",
      fn() {
        const L = structuredClone(chooseClub(after, "nbc", names));
        L.clubs.nbc.finance.cash = -2000;
        const next = playYear(L, names).league;
        ok(next.user?.fired, "クビにならない");
        eq(next.user?.offers.length, 3);
        ok(next.user?.offers.every((id) => next.divisions[1].clubIds.includes(id)), "2 部でないクラブから声がかかった");
        let threw = false;
        try { playFirstHalf(next, names); } catch { threw = true; }
        ok(threw, "クビのまま進めた");
        const moved = acceptOffer(next, /** @type {any} */ (next.user).offers[0]);
        eq(moved.user?.fired, null);
        eq(playYear(moved, names).league.year, next.year + 1);
      },
    },
    {
      name: "セーブ: 版 2（段階 4）と版 3（段階 5）のセーブも読めて、続きから遊べる",
      fn() {
        const v3 = JSON.parse(serialize(chooseClub(after, "ykc", names)));
        v3.version = 3;
        delete v3.midSeason;
        delete v3.user.candidates;
        delete v3.user.fired;
        const fromV3 = parseSave(JSON.stringify(v3));
        eq(fromV3.version, SAVE_VERSION);
        eq(fromV3.midSeason, null);
        eq(playYear(fromV3, names).league.year, after.year + 1);

        const v2 = structuredClone(v3);
        v2.version = 2;
        delete v2.freeAgents;
        delete v2.user.auto;
        delete v2.user.offers;
        delete v2.user.bids;
        for (const c of Object.values(v2.clubs)) {
          const club = /** @type {any} */ (c);
          delete club.form;
          delete club.finance.facilities;
          delete club.finance.transfers;
        }
        for (const p of Object.values(v2.players)) delete /** @type {any} */ (p).contract;
        const fromV2 = parseSave(JSON.stringify(v2));
        eq(fromV2.version, SAVE_VERSION);
        ok(Object.values(fromV2.players).every((p) => (p.contract?.wage ?? 0) > 0), "契約が足されていない");
        eq(fromV2.user?.clubId, "ykc");
        eq(playYear(fromV2, names).league.year, after.year + 1);
      },
    },
    {
      name: "海外: 自分のクラブを選ぶと海外の選手が 96 人そろい、国は実在の 4 か国、部は 1 部か 2 部",
      fn() {
        const mine = chooseClub(after, "ykc", names);
        const pool = mine.abroad ?? [];
        eq(pool.length, POOL_SIZE);
        const countries = new Set(COUNTRIES.map((c) => c.name));
        for (const id of pool) {
          const a = mine.players[id].abroad;
          ok(a && countries.has(a.country) && (a.div === 0 || a.div === 1) && a.club, `${id} の所属がおかしい`);
          ok(!Object.values(mine.clubs).some((c) => c.playerIds.includes(id)), "海外の選手が国内のクラブにもいる");
        }
        // 自分のクラブが無いとき（50 年の確かめなど）は作らない
        eq(after.abroad, null);
      },
    },
    {
      name: "海外: 1 部の選手は 2 部の選手より強い。1 年たつと一覧が入れ替わり、96 人に戻る",
      fn() {
        const mine = chooseClub(after, "ykc", names);
        const pool = (mine.abroad ?? []).map((id) => mine.players[id]);
        const avg = (/** @type {number} */ d) => {
          const xs = pool.filter((p) => p.abroad?.div === d).map((p) => overallAt(p));
          return xs.reduce((a, b) => a + b, 0) / xs.length;
        };
        ok(avg(0) > avg(1) + 8, `1 部 ${avg(0)} / 2 部 ${avg(1)}`);
        const next = playYear(mine, names).league;
        eq(next.abroad?.length, POOL_SIZE);
        const stayed = (next.abroad ?? []).filter((id) => (mine.abroad ?? []).includes(id)).length;
        ok(stayed > 30 && stayed < POOL_SIZE, `残った人数 ${stayed}`);
      },
    },
    {
      name: "海外: 海外の選手を取ると、移籍金は外へ出て、選手は自分のクラブの選手になる",
      fn() {
        const mine = structuredClone(chooseClub(after, "ykc", names));
        mine.clubs.ykc.finance.cash = 300;
        const entry = marketList(mine, null, 400, true, "abroad")[0];
        ok(entry && entry.player.abroad, "海外の選手が一覧に出ない");
        if (!entry) return;
        const L = buyPlayer(mine, entry.player.id);
        ok(Math.abs(L.clubs.ykc.finance.cash - (300 - entry.fee)) < 0.11, "移籍金");
        ok(entry.fee > 0, "海外の選手なのに移籍金が 0");
        ok(L.clubs.ykc.playerIds.includes(entry.player.id), "自分のクラブにいない");
        ok(!L.players[entry.player.id].abroad, "海外の印が残っている");
        ok(!(L.abroad ?? []).includes(entry.player.id), "海外の一覧に残っている");
        const loc = locationOf(L, entry.player.id);
        eq([loc.country, loc.club], [HOME_COUNTRY, L.clubs.ykc.short]);
      },
    },
    {
      name: "海外: 一覧は国内・海外・フリーでしぼれ、いる所は国・部・クラブで出る",
      fn() {
        const mine = chooseClub(after, "ykc", names);
        ok(marketList(mine, null, 500, false, "abroad").every((e) => e.player.abroad), "海外にしぼれない");
        ok(marketList(mine, null, 500, false, "home").every((e) => e.clubId), "国内にしぼれない");
        ok(marketList(mine, null, 500, false, "free").every((e) => !e.clubId && !e.player.abroad), "フリーにしぼれない");
        const abroadId = /** @type {string[]} */ (mine.abroad)[0];
        const a = locationOf(mine, abroadId);
        ok(a.country !== HOME_COUNTRY && /^[12] 部$/.test(a.league), `${a.country} ${a.league}`);
        const homeId = mine.clubs.nbc.playerIds[0];
        eq(locationOf(mine, homeId), { country: HOME_COUNTRY, league: mine.divisions.find((d) => d.clubIds.includes("nbc"))?.name, club: mine.clubs.nbc.short });
      },
    },
    {
      name: "海外: 海外のオファーを受けた選手は、海外の一覧に入る",
      fn() {
        const mine = chooseClub(after, "ykc", names);
        const pid = mine.clubs.ykc.playerIds[0];
        const L = { ...mine, user: { .../** @type {any} */ (mine.user), bids: [{ playerId: pid, fee: 10 }] } };
        const sold = acceptBid(L, pid);
        ok((sold.abroad ?? []).includes(pid), "海外の一覧にいない");
        ok(sold.players[pid].abroad?.div === 0, "海外の 1 部でない");
      },
    },
    {
      name: "手引き: 夏・冬・クビで、やることが変わる",
      fn() {
        const mine = setAutoTransfers(chooseClub(after, "ykc", names), false);
        const summer = guide(mine);
        eq(summer.phase, "summer");
        ok(summer.items.some((i) => i.text.includes("前半を進める")), "夏に「前半を進める」が無い");
        ok(summer.items.some((i) => i.tab === "market"), "夏に移籍タブへの案内が無い");
        const winter = guide(playFirstHalf(mine, names).league);
        eq(winter.phase, "winter");
        ok(winter.items.some((i) => i.text.includes("後半を進める")), "冬に「後半を進める」が無い");
        ok(winter.items.some((i) => i.text.includes("いま ")), "冬に今の順位が無い");
        const fired = guide({ ...mine, user: { .../** @type {any} */ (mine.user), fired: "テスト" } });
        eq(fired.phase, "fired");
        eq(guide(after).phase, "pick");
        // 自分で補強していて契約の切れた選手がいれば、先にやることとして出る
        const L = structuredClone(mine);
        const pid = L.clubs.ykc.playerIds[0];
        L.players[pid] = { ...L.players[pid], contract: { years: 0, wage: 1 } };
        ok(guide(L).items.some((i) => i.important && i.text.includes("契約が切れる")), "契約切れが出ない");
      },
    },
    {
      name: "セーブ: 版 4（段階 6）のセーブも読め、海外の選手の一覧が作られる",
      fn() {
        const v4 = JSON.parse(serialize(chooseClub(after, "ykc")));
        v4.version = 4;
        delete v4.abroad;
        const loaded = parseSave(JSON.stringify(v4));
        eq(loaded.version, SAVE_VERSION);
        eq(loaded.abroad, null);
        const withPool = ensureAbroad(loaded, names);
        eq(withPool.abroad?.length, POOL_SIZE);
        eq(playYear(withPool, names).league.year, after.year + 1);
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
