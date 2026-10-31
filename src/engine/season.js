// @ts-check
// 1 シーズンを回す。節ごとに監督が先発を選び、試合のあとで疲れとけがを決める。

import { pickLineup, teamStrength } from "./lineup.js";
import { playMatch } from "./match.js";
import { createRng, randInt } from "./rng.js";
import { makeSchedule } from "./schedule.js";
import { addResult, createTable, standings } from "./table.js";
import { STYLES } from "./world.js";

/**
 * @typedef {import("./world.js").World} World
 * @typedef {import("./world.js").ClubState} ClubState
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./match.js").MatchResult} MatchResult
 * @typedef {import("./table.js").Row} Row
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {{ club: string, apps: number, goals: number, assists: number, injuries: number,
 *             weeksOut: number, condition: number, out: number }} PlayerSeason
 *   out は残りの休みの節数。weeksOut はシーズンで休んだ節数の合計
 * @typedef {{ seed: number, rounds: MatchResult[][], standings: Row[], stats: Map<string, PlayerSeason> }} SeasonResult
 */

// 1 節ごとに戻る体調
export const REST_PER_ROUND = 12;
// 先発で 1 試合出たときに減る体調（スタミナが高いほど減らない）
export const FATIGUE_BASE = 30;
export const FATIGUE_PER_STAMINA = 0.2;
// 先発 1 人が 1 試合でけがをする確率の基準
export const INJURY_RATE = 0.035;

/**
 * @param {Player} p
 */
export function fatigueLoss(p) {
  const loss = FATIGUE_BASE - p.attrs.sta * FATIGUE_PER_STAMINA;
  return p.traits.includes("ironman") ? loss * 0.7 : loss;
}

/**
 * @param {Player} p @param {number} condition
 */
export function injuryChance(p, condition) {
  let rate = INJURY_RATE * (1 + (100 - condition) / 100); // 疲れているほどけがをしやすい
  if (p.traits.includes("sturdy")) rate *= 0.5;
  if (p.traits.includes("fragile")) rate *= 1.8;
  return rate;
}

/**
 * けがで休む節数。ほとんどは短く、たまに長い。
 * @param {Rng} rng
 */
export function injuryLength(rng) {
  const r = rng.next();
  if (r < 0.6) return randInt(rng, 1, 2);
  if (r < 0.9) return randInt(rng, 3, 6);
  if (r < 0.98) return randInt(rng, 7, 14);
  return randInt(rng, 15, 30);
}

/**
 * 監督が先発を選び、その試合での攻撃力と守備力を出す。
 * @param {ClubState} club @param {Player[]} available けがをしていない選手
 * @param {(p: Player) => number} conditionOf
 */
export function prepareSide(club, available, conditionOf) {
  const lineup = pickLineup(available, conditionOf, STYLES[club.manager.style].formation);
  const form = /** @type {{ form?: number }} */ (club).form ?? 1;
  return { id: club.id, lineup, side: teamStrength(lineup, conditionOf, club.manager, form) };
}

/**
 * 途中まで進めたシーズン。Map のままではセーブできないので、セーブするときは saveProgress で配列にする。
 * @typedef {{ table: Map<string, Row>, stats: Map<string, PlayerSeason>, round: number }} SeasonProgress
 * @typedef {{ table: Row[], stats: [string, PlayerSeason][], round: number }} SavedProgress
 */

/**
 * シーズンを始める（まだ 1 節も回していない）
 * @param {World} world
 * @returns {SeasonProgress}
 */
export function startSeason(world) {
  return { table: createTable(world.clubs.map((c) => c.id)), stats: new Map(), round: 0 };
}

/** @param {SeasonProgress} p @returns {SavedProgress} */
export const saveProgress = (p) => ({ table: [...p.table.values()], stats: [...p.stats.entries()], round: p.round });
/** @param {SavedProgress} s @returns {SeasonProgress} */
export const loadProgress = (s) => ({ table: new Map(s.table.map((r) => [r.id, { ...r }])), stats: new Map(s.stats.map(([id, x]) => [id, { ...x }])), round: s.round });

/** シーズンの節の数 @param {World} world */
export const roundCount = (world) => (world.clubs.length - 1) * 2;

/**
 * 同じ world と seed なら必ず同じ結果になる。world は変えない。
 * @param {World} world @param {number} seed
 * @returns {SeasonResult}
 */
export function playSeason(world, seed) {
  const progress = startSeason(world);
  const rounds = playRounds(world, progress, createRng(seed), roundCount(world));
  return { seed, rounds, standings: standings(progress.table), stats: progress.stats };
}

/**
 * progress の続きから、until 節目の手前まで回す（progress を書きかえる）。
 * 途中で選手がクラブを移っていても、今いるクラブの選手として数える。
 * @param {World} world @param {SeasonProgress} progress @param {Rng} rng @param {number} until
 * @returns {MatchResult[][]}
 */
export function playRounds(world, progress, rng, until) {
  const { stats, table } = progress;
  for (const club of world.clubs) {
    for (const id of club.playerIds) {
      const s = stats.get(id);
      if (!s) stats.set(id, { club: club.id, apps: 0, goals: 0, assists: 0, injuries: 0, weeksOut: 0, condition: 100, out: 0 });
      else if (s.club !== club.id) s.club = club.id;
    }
  }
  const st = (/** @type {string} */ id) => /** @type {PlayerSeason} */ (stats.get(id));
  const conditionOf = (/** @type {Player} */ p) => st(p.id).condition;
  const player = (/** @type {string} */ id) => /** @type {Player} */ (world.players.get(id));
  const byId = new Map(world.clubs.map((c) => [c.id, c]));

  /** @param {ClubState} club */
  const prepare = (club) =>
    prepareSide(club, club.playerIds.filter((id) => st(id).out === 0).map(player), conditionOf);

  const schedule = makeSchedule(world.clubs.map((c) => c.id)).slice(progress.round, until);
  progress.round += schedule.length;
  return schedule.map((fixtures) => {
    // 節の初めに体調が戻り、けがの休みが 1 節減る
    for (const s of stats.values()) {
      s.condition = Math.min(100, s.condition + REST_PER_ROUND);
      if (s.out > 0) {
        s.out--;
        s.weeksOut++;
      }
    }
    return fixtures.map(([h, a]) => {
      const home = prepare(/** @type {ClubState} */ (byId.get(h)));
      const away = prepare(/** @type {ClubState} */ (byId.get(a)));
      const result = playMatch(home, away, rng);
      addResult(table, result);
      for (const g of result.goals) {
        st(g.scorer).goals++;
        if (g.assist) st(g.assist).assists++;
      }
      for (const { player: p } of [...home.lineup, ...away.lineup]) {
        const s = st(p.id);
        s.apps++;
        const before = s.condition;
        s.condition = Math.max(0, s.condition - fatigueLoss(p));
        if (rng.next() < injuryChance(p, before)) {
          s.out = injuryLength(rng);
          s.injuries++;
        }
      }
      return result;
    });
  });
}

/**
 * 得点・アシストの多い順
 * @param {SeasonResult} season @param {"goals" | "assists"} key @param {number} n
 */
export function leaders(season, key, n) {
  return [...season.stats.entries()]
    .filter(([, s]) => s[key] > 0)
    .sort((a, b) => b[1][key] - a[1][key] || a[1].apps - b[1].apps || (a[0] < b[0] ? -1 : 1))
    .slice(0, n);
}
