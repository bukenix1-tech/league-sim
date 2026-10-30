// @ts-check
// 何十年も回して、崩れないかを確かめる。

import { createLeague, playYear, rowPoints } from "./league.js";
import { overall } from "./players.js";
import { serialize } from "./save.js";

/**
 * @typedef {import("./clubs.js").ClubData} ClubData
 * @typedef {import("./clubs.js").NameData} NameData
 * @typedef {import("./league.js").League} League
 * @typedef {{ year: number, champion: string, championPoints: number, top11: number[], best: number,
 *             players: number, avgAge: number, young: number, ms: number }} YearRow
 *   top11 は部ごとに「各クラブの上位 11 人の総合力の平均」をさらに平均したもの
 */

/** @param {number[]} xs */
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * @param {League} league
 * @param {string} clubId
 */
function top11(league, clubId) {
  const ovs = league.clubs[clubId].playerIds.map((id) => overall(league.players[id])).sort((a, b) => b - a);
  return mean(ovs.slice(0, 11));
}

/**
 * @param {ClubData} clubData @param {NameData} names @param {number} seed @param {number} years
 */
export function longRun(clubData, names, seed, years) {
  let league = createLeague(clubData, names, seed);
  /** @type {YearRow[]} */
  const rows = [];
  for (let y = 0; y < years; y++) {
    const t0 = performance.now();
    const { league: next, record } = playYear(league, names);
    const ms = performance.now() - t0;
    league = next;
    const all = Object.values(league.players);
    rows.push({
      year: record.year,
      champion: record.tables[0][0][0],
      championPoints: rowPoints(record.tables[0][0]),
      top11: league.divisions.map((d) => mean(d.clubIds.map((id) => top11(league, id)))),
      best: Math.max(...all.map(overall)),
      players: all.length,
      avgAge: mean(all.map((p) => p.age)),
      young: all.filter((p) => p.age <= 21).length,
      ms,
    });
  }

  // 優勝の偏り
  /** @type {Map<string, number>} */
  const titles = new Map();
  let streak = 0;
  let longest = { club: "", years: 0 };
  rows.forEach((r, i) => {
    titles.set(r.champion, (titles.get(r.champion) ?? 0) + 1);
    streak = i > 0 && rows[i - 1].champion === r.champion ? streak + 1 : 1;
    if (streak > longest.years) longest = { club: r.champion, years: streak };
  });

  // 昇格したクラブが次の年に 1 部に残れた割合
  let promotedTotal = 0;
  let promotedStayed = 0;
  for (let i = 0; i + 1 < league.history.length; i++) {
    for (const id of league.history[i].promoted) {
      promotedTotal++;
      if (!league.history[i + 1].relegated.includes(id)) promotedStayed++;
    }
  }

  // 始めに 2 部だったクラブのうち、1 部で優勝したことがあるクラブ
  const startDiv2 = new Set(clubData.divisions[1].clubs.map((c) => c.id));
  const div2Champions = [...titles.keys()].filter((id) => startDiv2.has(id));

  // 1 部にいた年数の多い順（強さが固まっていないかを見る）
  /** @type {Map<string, number>} */
  const topYears = new Map();
  for (const h of league.history) for (const row of h.tables[0]) topYears.set(row[0], (topYears.get(row[0]) ?? 0) + 1);

  return {
    rows,
    league,
    titles: [...titles.entries()].sort((a, b) => b[1] - a[1]),
    distinctChampions: titles.size,
    longestStreak: longest,
    promotedSurvival: promotedTotal ? promotedStayed / promotedTotal : 0,
    div2Champions,
    alwaysTop: [...topYears.entries()].filter(([, n]) => n === years).map(([id]) => id),
    saveBytes: new TextEncoder().encode(serialize(league)).length,
    msPerYear: mean(rows.map((r) => r.ms)),
  };
}
