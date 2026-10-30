// @ts-check
// シーズンとシーズンの間: クラブの規模の変化、年齢による伸びと衰え、引退、放出、新しい選手、監督の交代。

import { agePlayer, overall } from "./players.js";
import { normal, randInt } from "./rng.js";
import { makeName, makeManager, makePlayer, SQUAD_SHAPE } from "./world.js";

/**
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {import("./clubs.js").NameData} NameData
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./players.js").Position} Position
 * @typedef {import("./world.js").ClubState} ClubState
 * @typedef {{ divisions: { clubIds: string[] }[], clubs: Record<string, ClubState>,
 *             players: Record<string, Player>, nextPlayerId: number }} LeagueCore
 * @typedef {{ retired: number, released: number, joined: number, managersChanged: number, takeovers: string[] }} OffseasonReport
 */

/**
 * 順位から、クラブの規模が向かっていく先。1 部の上位ほど大きく、2 部の下位ほど小さい。
 * @param {number} division 0 が 1 部 @param {number} pos 1 が 1 位
 */
export function levelTarget(division, pos) {
  return division === 0 ? 80 - (pos - 1) * 1.15 : 60 - (pos - 1) * 0.6;
}

/** 規模は毎年この割合だけ、順位から決まる値に近づく */
export const LEVEL_PULL = 0.2;
/** 規模の毎年の揺れ（標準偏差） */
export const LEVEL_NOISE = 1.8;
/** 昇格したクラブの規模の上乗せ */
export const PROMOTION_BOOST = 2;
/** 1 クラブに 1 年で新しいオーナーが来る確率 */
export const TAKEOVER_CHANCE = 0.015;

/**
 * 引退する確率
 * @param {number} age
 */
export function retireChance(age) {
  if (age <= 32) return 0;
  const table = { 33: 0.08, 34: 0.18, 35: 0.3, 36: 0.45, 37: 0.65 };
  return /** @type {Record<number, number>} */ (table)[age] ?? 1;
}

/** 1 年に放出する選手の数の上限 */
const RELEASE_MAX = 2;

/**
 * league をその場で書きかえる。finish は クラブ id → [部, 順位]。promoted は昇格したクラブ。
 * @param {LeagueCore} league @param {NameData} names @param {Rng} rng
 * @param {Map<string, [number, number]>} finish @param {Set<string>} promoted
 * @returns {OffseasonReport}
 */
export function runOffseason(league, names, rng, finish, promoted) {
  const used = new Set([
    ...Object.values(league.players).map((p) => p.name),
    ...Object.values(league.clubs).map((c) => c.manager.name),
  ]);
  /** @type {OffseasonReport} */
  const report = { retired: 0, released: 0, joined: 0, managersChanged: 0, takeovers: [] };

  for (const club of Object.values(league.clubs)) {
    // クラブの規模: 順位で決まる値に少しずつ近づく（少しの揺れも入れる）
    const [div, pos] = finish.get(club.id) ?? [1, 24];
    let level = club.level * (1 - LEVEL_PULL) + levelTarget(div, pos) * LEVEL_PULL + normal(rng, 0, LEVEL_NOISE);
    // 昇格したクラブは 1 部の放映権でお金が増える
    if (promoted.has(club.id)) level += PROMOTION_BOOST;
    // まれに、お金持ちの新しいオーナーが来てクラブが急に大きくなる
    if (rng.next() < TAKEOVER_CHANCE) {
      level += 6 + rng.next() * 6;
      report.takeovers.push(club.id);
    }
    club.level = Math.round(Math.max(40, Math.min(88, level)) * 10) / 10;

    // 監督: 年を取り、70 歳か、たまに辞める
    club.manager = { ...club.manager, age: club.manager.age + 1 };
    if (club.manager.age >= 70 || (club.manager.age >= 60 && rng.next() < 0.08)) {
      used.delete(club.manager.name);
      club.manager = makeManager(rng, names, used, club.level);
      report.managersChanged++;
    }

    // 選手: 年を取って伸びる・衰える。年を取りすぎた選手は引退
    const growth = club.manager.style === "youth" ? 0.2 : 0;
    /** @type {string[]} */
    const keep = [];
    for (const id of club.playerIds) {
      const p = agePlayer(league.players[id], rng, growth);
      if (rng.next() < retireChance(p.age)) {
        delete league.players[id];
        used.delete(p.name);
        report.retired++;
      } else {
        league.players[id] = p;
        keep.push(id);
      }
    }

    // 放出: クラブの規模に比べて力の足りない選手を、年に 2 人まで出す（リーグの外へ移る）
    const weak = keep
      .map((id) => league.players[id])
      .filter((p) => p.age >= 23 && overall(p) < club.level - 10)
      .sort((a, b) => overall(a) - overall(b))
      .slice(0, RELEASE_MAX);
    for (const p of weak) {
      delete league.players[p.id];
      used.delete(p.name);
      keep.splice(keep.indexOf(p.id), 1);
      report.released++;
    }

    // 足りない位置を埋める。半分は若手（伸びしろが大きい）、半分は即戦力
    for (const pos of /** @type {Position[]} */ (Object.keys(SQUAD_SHAPE))) {
      const have = keep.filter((id) => league.players[id].pos === pos).length;
      for (let i = have; i < SQUAD_SHAPE[pos]; i++) {
        const youth = rng.next() < 0.5;
        const age = youth ? randInt(rng, 17, 19) : randInt(rng, 21, 29);
        const base = youth ? club.level - 15 + normal(rng, 0, 4) : club.level - 3 + normal(rng, 0, 4);
        const id = `p${league.nextPlayerId++}`;
        league.players[id] = { ...makePlayer(rng, id, makeName(rng, names, used), pos, base, age), career: emptyCareer() };
        keep.push(id);
        report.joined++;
      }
    }
    club.playerIds = keep;
  }
  return report;
}

/** @returns {import("./players.js").Career} */
export const emptyCareer = () => ({ seasons: 0, apps: 0, goals: 0, assists: 0 });
