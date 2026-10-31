// @ts-check
// シーズンの前と後。
// 前 (preseason): 年俸の予算を決め、予算でクラブの規模が動き、力の足りない選手を出して、足りない位置を補強する。
// 後 (offseason): 選手が年を取って伸びる・衰える、引退、監督の交代。

import { autoBudget, budgetRange, levelFromBudget } from "./finance.js";
import { agePlayer, overall } from "./players.js";
import { normal, randInt } from "./rng.js";
import { makeManager, makeName, makePlayer, SQUAD_SHAPE } from "./world.js";

/**
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {import("./clubs.js").NameData} NameData
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./players.js").Position} Position
 * @typedef {import("./world.js").ClubState} ClubState
 * @typedef {import("./finance.js").Finance} Finance
 * @typedef {ClubState & { finance: Finance }} LeagueClub
 * @typedef {{ divisions: { clubIds: string[] }[], clubs: Record<string, LeagueClub>,
 *             players: Record<string, Player>, nextPlayerId: number,
 *             user: { clubId: string, budget: number | null } | null }} LeagueCore
 * @typedef {{ retired: number, released: number, joined: number, managersChanged: number, takeovers: string[] }} OffseasonReport
 */

/** 予算で目指せる規模に、1 年でどれだけ近づくか */
export const BUDGET_PULL = 0.5;
/** 規模の毎年の揺れ（標準偏差） */
export const LEVEL_NOISE = 1.0;
/** 1 クラブに 1 年で新しいオーナーが来る確率 */
export const TAKEOVER_CHANCE = 0.015;
/** 1 年に放出する選手の数の上限 */
const RELEASE_MAX = 3;

/** @returns {OffseasonReport} */
export const emptyReport = () => ({ retired: 0, released: 0, joined: 0, managersChanged: 0, takeovers: [] });

/**
 * 引退する確率
 * @param {number} age
 */
export function retireChance(age) {
  if (age <= 32) return 0;
  const table = { 33: 0.08, 34: 0.18, 35: 0.3, 36: 0.45, 37: 0.65 };
  return /** @type {Record<number, number>} */ (table)[age] ?? 1;
}

/** @param {LeagueCore} league */
function usedNames(league) {
  return new Set([
    ...Object.values(league.players).map((p) => p.name),
    ...Object.values(league.clubs).map((c) => c.manager.name),
  ]);
}

/**
 * そのクラブがいる部の番号とクラブの数
 * @param {LeagueCore} league @param {string} id
 */
export function divisionOf(league, id) {
  const div = league.divisions.findIndex((d) => d.clubIds.includes(id));
  return { div, n: league.divisions[div].clubIds.length };
}

/**
 * このシーズンの年俸の予算。自分のクラブは決めた額（決めていなければおまかせ）を、決められる幅に収める。
 * @param {LeagueCore} league @param {LeagueClub} club
 */
export function seasonBudget(league, club) {
  const { div, n } = divisionOf(league, club.id);
  if (league.user?.clubId === club.id && league.user.budget !== null) {
    const { min, max } = budgetRange(club.finance, div, n);
    return Math.min(max, Math.max(min, league.user.budget));
  }
  return autoBudget(club.finance, div, n);
}

/**
 * シーズン前。league をその場で書きかえる。
 * @param {LeagueCore} league @param {NameData} names @param {Rng} rng @param {OffseasonReport} report
 */
export function runPreseason(league, names, rng, report) {
  const used = usedNames(league);
  for (const club of Object.values(league.clubs)) {
    // まれに、お金持ちの新しいオーナーが来てお金を入れる
    if (rng.next() < TAKEOVER_CHANCE) {
      club.finance.cash += Math.round(80 + rng.next() * 120);
      report.takeovers.push(club.id);
    }
    // 予算を決め、予算で取れる選手の強さ（クラブの規模）が動く
    const budget = seasonBudget(league, club);
    club.finance = { ...club.finance, budget };
    const level = club.level + (levelFromBudget(budget) - club.level) * BUDGET_PULL + normal(rng, 0, LEVEL_NOISE);
    club.level = Math.round(Math.max(40, Math.min(90, level)) * 10) / 10;

    // 放出: クラブの規模に比べて力の足りない選手を出す（リーグの外へ移る）
    const weak = club.playerIds
      .map((id) => league.players[id])
      .filter((p) => p.age >= 23 && overall(p) < club.level - 10)
      .sort((a, b) => overall(a) - overall(b))
      .slice(0, RELEASE_MAX);
    for (const p of weak) {
      delete league.players[p.id];
      used.delete(p.name);
      club.playerIds = club.playerIds.filter((id) => id !== p.id);
      report.released++;
    }

    // 足りない位置を埋める。半分は若手（伸びしろが大きい）、半分は即戦力。強さはクラブの規模で決まる
    for (const pos of /** @type {Position[]} */ (Object.keys(SQUAD_SHAPE))) {
      const have = club.playerIds.filter((id) => league.players[id].pos === pos).length;
      for (let i = have; i < SQUAD_SHAPE[pos]; i++) {
        const youth = rng.next() < 0.5;
        const age = youth ? randInt(rng, 17, 19) : randInt(rng, 21, 29);
        const base = youth ? club.level - 15 + normal(rng, 0, 4) : club.level - 3 + normal(rng, 0, 4);
        const id = `p${league.nextPlayerId++}`;
        league.players[id] = { ...makePlayer(rng, id, makeName(rng, names, used), pos, base, age), career: emptyCareer() };
        club.playerIds.push(id);
        report.joined++;
      }
    }
  }
}

/**
 * シーズンの後。league をその場で書きかえる。
 * @param {LeagueCore} league @param {NameData} names @param {Rng} rng @param {OffseasonReport} report
 */
export function runOffseason(league, names, rng, report) {
  const used = usedNames(league);
  for (const club of Object.values(league.clubs)) {
    // 監督: 年を取り、70 歳か、たまに辞める
    club.manager = { ...club.manager, age: club.manager.age + 1 };
    if (club.manager.age >= 70 || (club.manager.age >= 60 && rng.next() < 0.08)) {
      used.delete(club.manager.name);
      club.manager = makeManager(rng, names, used, club.level);
      report.managersChanged++;
    }
    // 選手: 年を取って伸びる・衰える。年を取りすぎた選手は引退
    const growth = club.manager.style === "youth" ? 0.2 : 0;
    club.playerIds = club.playerIds.filter((id) => {
      const p = agePlayer(league.players[id], rng, growth);
      if (rng.next() < retireChance(p.age)) {
        delete league.players[id];
        used.delete(p.name);
        report.retired++;
        return false;
      }
      league.players[id] = p;
      return true;
    });
  }
}

/** @returns {import("./players.js").Career} */
export const emptyCareer = () => ({ seasons: 0, apps: 0, goals: 0, assists: 0 });
