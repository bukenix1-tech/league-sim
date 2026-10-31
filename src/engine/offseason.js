// @ts-check
// シーズンの前と後。
// 前 (preseason): 年俸の予算とクラブの規模、契約の更新、海外への引き抜き、放出、補強、施設、その年の調子。
// 後 (offseason): 選手が年を取って伸びる・衰える、引退、契約の残りが減る、監督の交代。

import { MIN_SHAPE, newContract, playerValue, wantsBiggerClub } from "./contracts.js";
import {
  autoBudget,
  budgetRange,
  facilityCost,
  FACILITY_MAX,
  levelFromBudget,
  STADIUM_MAX,
  STADIUM_STEP,
  trainingBonus,
  youthBonus,
} from "./finance.js";
import { agePlayer, overall, overallAt } from "./players.js";
import { normal, randInt } from "./rng.js";
import { makeManager, makeName, makePlayer, SQUAD_SHAPE } from "./world.js";

/**
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {import("./clubs.js").NameData} NameData
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./players.js").Position} Position
 * @typedef {import("./world.js").ClubState} ClubState
 * @typedef {import("./finance.js").Finance} Finance
 * @typedef {ClubState & { finance: Finance, form: number }} LeagueClub  form はその年の調子（攻撃力・守備力に掛ける）
 * @typedef {{ clubId: string, budget: number | null, auto: boolean }} UserCore
 * @typedef {{ divisions: { clubIds: string[] }[], clubs: Record<string, LeagueClub>,
 *             players: Record<string, Player>, nextPlayerId: number, freeAgents: string[],
 *             user: UserCore | null }} LeagueCore
 * @typedef {{ retired: number, released: number, joined: number, managersChanged: number, takeovers: string[],
 *             abroad: [name: string, clubId: string, fee: number][], leftFree: number }} OffseasonReport
 *   abroad は海外のクラブに引き抜かれた選手、leftFree は契約が切れて出ていった選手の数
 */

/** 予算で目指せる規模に、1 年でどれだけ近づくか */
export const BUDGET_PULL = 0.7;
/** 規模の毎年の揺れ（標準偏差） */
export const LEVEL_NOISE = 1.6;
/** 1 クラブに 1 年で新しいオーナーが来る確率 */
export const TAKEOVER_CHANCE = 0.015;
/** 1 年に放出する選手の数の上限 */
const RELEASE_MAX = 3;
/** その年の調子の揺れ（標準偏差）。調子は攻撃力と守備力に掛かる */
export const FORM_SD = 0.12;
/** この総合力から上の選手は、海外のクラブに引き抜かれることがある */
export const ABROAD_MIN = 86;
/** 引き抜かれる確率（総合力が 1 上がるごとに増える） */
export const ABROAD_BASE = 0.1;
export const ABROAD_STEP = 0.03;
/** 海外のクラブが払う移籍金（移籍金の目安の何倍か） */
export const ABROAD_FEE = 0.8;
/** 期待（クラブの規模の順位）よりこれだけ下で終わると、監督を解任することがある */
export const SACK_GAP = 6;
export const SACK_CHANCE = 0.6;
/** 契約の切れた選手（フリー）を何人まで残すか */
export const FREE_AGENT_MAX = 150;

/** @returns {OffseasonReport} */
export const emptyReport = () => ({ retired: 0, released: 0, joined: 0, managersChanged: 0, takeovers: [], abroad: [], leftFree: 0 });

/**
 * 引退する確率
 * @param {number} age
 */
export function retireChance(age) {
  if (age <= 32) return 0;
  const table = { 33: 0.08, 34: 0.18, 35: 0.3, 36: 0.45, 37: 0.65 };
  return /** @type {Record<number, number>} */ (table)[age] ?? 1;
}

/**
 * 海外のクラブに引き抜かれる確率
 * @param {Player} p
 */
export function abroadChance(p) {
  const ov = overall(p);
  return ov < ABROAD_MIN ? 0 : Math.min(0.6, ABROAD_BASE + (ov - ABROAD_MIN) * ABROAD_STEP);
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
 * 今いる選手から見たクラブの規模（上位 11 人の総合力の平均から）
 * @param {LeagueCore} league @param {LeagueClub} club
 */
export function squadLevel(league, club) {
  const ovs = club.playerIds.map((id) => overall(league.players[id])).sort((a, b) => b - a).slice(0, 11);
  return Math.round((ovs.reduce((a, b) => a + b, 0) / Math.max(1, ovs.length) - 2.5) * 10) / 10;
}

/** 自分で補強するクラブか @param {LeagueCore} league @param {string} id */
export const isManual = (league, id) => league.user?.clubId === id && league.user.auto === false;

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
 * 選手をフリー（契約の無い選手）にする。年を取りすぎていれば引退。
 * @param {LeagueCore} league @param {Player} p
 */
export function toFreeAgent(league, p) {
  if (p.age >= 33) {
    delete league.players[p.id];
    return;
  }
  league.players[p.id] = withoutContract(p);
  league.freeAgents.push(p.id);
}

/**
 * 新しい選手を作る。若手は育成の施設で強さと伸びしろが上がる。
 * @param {LeagueCore} league @param {LeagueClub} club @param {NameData} names @param {Rng} rng
 * @param {Set<string>} used @param {Position} pos @param {boolean} youth
 */
function newPlayer(league, club, names, rng, used, pos, youth) {
  const yb = youthBonus(club.finance.facilities);
  const age = youth ? randInt(rng, 17, 19) : randInt(rng, 21, 29);
  const base = youth ? club.level - 15 + yb.base + normal(rng, 0, 4) : club.level - 3 + normal(rng, 0, 4);
  const id = `p${league.nextPlayerId++}`;
  const p = makePlayer(rng, id, makeName(rng, names, used), pos, base, age);
  if (youth) p.potential = Math.min(99, Math.round(overallAt(p) + (p.potential - overallAt(p)) * yb.room));
  league.players[id] = { ...p, career: emptyCareer(), contract: newContract(p) };
  club.playerIds.push(id);
}

/**
 * フリーの選手から、そのクラブに合う選手を 1 人選ぶ（いなければ null）
 * @param {LeagueCore} league @param {LeagueClub} club @param {Position} pos
 */
function pickFreeAgent(league, club, pos) {
  let best = null;
  for (const id of league.freeAgents) {
    const p = league.players[id];
    if (!p || p.pos !== pos) continue;
    const ov = overall(p);
    if (ov < club.level - 6 || wantsBiggerClub(p, club.level)) continue;
    if (!best || ov > overall(best)) best = p;
  }
  return best;
}

/**
 * コンピューターのクラブが施設を大きくする（お金に余裕があるとき）
 * @param {LeagueClub} club
 */
function aiFacilities(club) {
  const f = club.finance;
  const target = club.level >= 75 ? 4 : club.level >= 65 ? 3 : club.level >= 55 ? 2 : 1;
  for (const kind of /** @type {const} */ (["training", "youth"])) {
    const cost = facilityCost(kind, f);
    if (f.facilities[kind] < Math.min(FACILITY_MAX, target) && f.cash > cost * 2) {
      f.facilities = { ...f.facilities, [kind]: f.facilities[kind] + 1 };
      f.cash -= cost;
      f.transfers = { ...f.transfers, invest: (f.transfers.invest ?? 0) + cost };
    }
  }
  const demand = 4000 * f.popularity ** 0.55;
  const cost = facilityCost("stadium", f);
  if (demand > f.capacity * 1.05 && f.capacity < STADIUM_MAX && f.cash > cost * 2) {
    f.capacity += STADIUM_STEP;
    f.facilities = { ...f.facilities, stadium: f.facilities.stadium + 1 };
    f.cash -= cost;
    f.transfers = { ...f.transfers, invest: (f.transfers.invest ?? 0) + cost };
  }
}

/**
 * シーズン前。league をその場で書きかえる。
 * @param {LeagueCore} league @param {NameData} names @param {Rng} rng @param {OffseasonReport} report
 */
export function runPreseason(league, names, rng, report) {
  const used = usedNames(league);
  for (const club of Object.values(league.clubs)) {
    const isUser = league.user?.clubId === club.id;
    const manual = isManual(league, club.id);
    const f = club.finance;

    // まれに、お金持ちの新しいオーナーが来てお金を入れる
    if (rng.next() < TAKEOVER_CHANCE) {
      f.cash += Math.round(80 + rng.next() * 120);
      report.takeovers.push(club.id);
    }

    // 予算を決め、予算で取れる選手の強さ（クラブの規模）が動く。自分で補強するクラブは選手で決まる
    if (!manual) {
      const budget = seasonBudget(league, club);
      f.budget = budget;
      const level = club.level + (levelFromBudget(budget) - club.level) * BUDGET_PULL + normal(rng, 0, LEVEL_NOISE);
      club.level = Math.round(Math.max(40, Math.min(90, level)) * 10) / 10;
    }

    // 契約が切れた選手: 更新するか、出ていくか。自分で補強するクラブは、夏に更新しなかった選手が出ていく
    for (const id of [...club.playerIds]) {
      const p = league.players[id];
      if ((p.contract?.years ?? 0) > 0) continue;
      const keep =
        !manual && overall(p) >= club.level - 8 && p.age <= 32 && !(wantsBiggerClub(p, club.level) && rng.next() < 0.7);
      if (keep) {
        league.players[id] = { ...p, contract: newContract(p) };
      } else {
        club.playerIds = club.playerIds.filter((x) => x !== id);
        toFreeAgent(league, p);
        report.leftFree++;
      }
    }

    // 海外のクラブへの引き抜き（自分のクラブには、シーズンの後にオファーとして届く）
    if (!isUser) {
      for (const id of [...club.playerIds]) {
        const p = league.players[id];
        if (rng.next() >= abroadChance(p)) continue;
        const fee = Math.round(playerValue(p) * ABROAD_FEE * 10) / 10;
        f.cash += fee;
        f.transfers = { ...f.transfers, in: f.transfers.in + fee };
        report.abroad.push([p.name, club.id, fee]);
        club.playerIds = club.playerIds.filter((x) => x !== id);
        delete league.players[id];
      }
    }

    if (!manual) {
      // 放出: クラブの規模に比べて力の足りない選手と、位置ごとの人数を超えた分を出す
      const weak = club.playerIds
        .map((id) => league.players[id])
        .filter((p) => p.age >= 23 && overall(p) < club.level - 10)
        .sort((a, b) => overall(a) - overall(b))
        .slice(0, RELEASE_MAX);
      for (const pos of /** @type {Position[]} */ (Object.keys(SQUAD_SHAPE))) {
        const mine = club.playerIds.map((id) => league.players[id]).filter((p) => p.pos === pos).sort((a, b) => overall(b) - overall(a));
        for (const extra of mine.slice(SQUAD_SHAPE[pos])) if (!weak.includes(extra)) weak.push(extra);
      }
      for (const p of weak) {
        club.playerIds = club.playerIds.filter((x) => x !== p.id);
        toFreeAgent(league, p);
        report.released++;
      }
    }

    // 補強: 足りない位置を埋める。おまかせはフリーの選手から合う人を先に取り、いなければ若手と即戦力を半分ずつ。
    // 自分で補強するクラブは、試合に必要な人数に足りない分だけ育成の若手で埋める
    const shape = manual ? MIN_SHAPE : SQUAD_SHAPE;
    for (const pos of /** @type {Position[]} */ (Object.keys(shape))) {
      const have = club.playerIds.filter((id) => league.players[id].pos === pos).length;
      for (let i = have; i < shape[pos]; i++) {
        const fa = manual ? null : pickFreeAgent(league, club, pos);
        if (fa) {
          league.freeAgents = league.freeAgents.filter((x) => x !== fa.id);
          league.players[fa.id] = { ...fa, contract: newContract(fa) };
          club.playerIds.push(fa.id);
        } else {
          newPlayer(league, club, names, rng, used, pos, manual || rng.next() < 0.5);
        }
        report.joined++;
      }
    }

    if (!isUser) aiFacilities(club);
    if (manual) {
      club.level = squadLevel(league, club);
      f.budget = club.playerIds.reduce((s, id) => s + (league.players[id].contract?.wage ?? 0), 0);
    }
    // その年の調子
    club.form = Math.exp(normal(rng, 0, FORM_SD));
  }

  // フリーの選手が増えすぎないよう、力の高い順に残す
  if (league.freeAgents.length > FREE_AGENT_MAX) {
    const sorted = league.freeAgents.filter((id) => league.players[id]).sort((a, b) => overall(league.players[b]) - overall(league.players[a]));
    for (const id of sorted.slice(FREE_AGENT_MAX)) delete league.players[id];
    league.freeAgents = sorted.slice(0, FREE_AGENT_MAX);
  }
}

/**
 * シーズンの後。league をその場で書きかえる。disappointing は、期待よりずっと下の順位で終わったクラブ。
 * @param {LeagueCore} league @param {NameData} names @param {Rng} rng @param {OffseasonReport} report
 * @param {Set<string>} [disappointing]
 */
export function runOffseason(league, names, rng, report, disappointing = new Set()) {
  const used = usedNames(league);
  for (const club of Object.values(league.clubs)) {
    // 監督: 年を取り、70 歳か、たまに辞める。コンピューターのクラブは、期待よりずっと下で終わると解任することがある
    club.manager = { ...club.manager, age: club.manager.age + 1 };
    const sacked = disappointing.has(club.id) && league.user?.clubId !== club.id && rng.next() < SACK_CHANCE;
    if (sacked || club.manager.age >= 70 || (club.manager.age >= 60 && rng.next() < 0.08)) {
      used.delete(club.manager.name);
      club.manager = makeManager(rng, names, used, club.level);
      report.managersChanged++;
    }
    // 選手: 年を取って伸びる・衰える。年を取りすぎた選手は引退。契約の残りが 1 年減る
    const growth = (club.manager.style === "youth" ? 0.2 : 0) + trainingBonus(club.finance.facilities);
    club.playerIds = club.playerIds.filter((id) => {
      const p = agePlayer(league.players[id], rng, growth);
      if (rng.next() < retireChance(p.age)) {
        delete league.players[id];
        used.delete(p.name);
        report.retired++;
        return false;
      }
      league.players[id] = { ...p, contract: p.contract ? { ...p.contract, years: Math.max(0, p.contract.years - 1) } : p.contract };
      return true;
    });
  }
  // フリーの選手も年を取る
  league.freeAgents = league.freeAgents.filter((id) => {
    const p0 = league.players[id];
    if (!p0) return false;
    const p = agePlayer(p0, rng, 0);
    if (rng.next() < retireChance(p.age)) {
      delete league.players[id];
      return false;
    }
    league.players[id] = p;
    return true;
  });
}

/** @returns {import("./players.js").Career} */
export const emptyCareer = () => ({ seasons: 0, apps: 0, goals: 0, assists: 0 });

/**
 * 契約を外した選手（undefined を残すとセーブの JSON で消えて形が変わるので、項目ごと消す）
 * @param {Player} p @returns {Player}
 */
export function withoutContract(p) {
  const { contract: _, ...rest } = p;
  return rest;
}
