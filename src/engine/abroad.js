// @ts-check
// 海外のリーグ。国は実在の国、クラブと選手は架空。
// 海外の選手を取れるのは自分のクラブだけ（コンピューターのクラブはこれまでどおりリーグの外から補強する）。

import { initialContract } from "./contracts.js";
import { agePlayer } from "./players.js";
import { normal, pick, randInt, weightedIndex } from "./rng.js";
import { makeName, makePlayer } from "./world.js";
import { emptyCareer, retireChance } from "./offseason.js";

/**
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./players.js").Position} Position
 * @typedef {import("./clubs.js").NameData} NameData
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {{ country: string, div: number, club: string }} AbroadInfo  いる国・部（0 が 1 部）・クラブ
 * @typedef {{ players: Record<string, Player>, clubs: Record<string, { manager: { name: string }, playerIds: string[] }>,
 *             nextPlayerId: number, abroad: string[] | null, freeAgents: string[] }} AbroadCore
 */

/** このゲームのリーグがある国 */
export const HOME_COUNTRY = "イングランド";

/** 海外の国。strength は 1 部と 2 部の選手の強さの目安 */
export const COUNTRIES = [
  {
    name: "スペイン",
    strength: [74, 57],
    clubs: [
      ["レアル・サンタマリナ", "アトレティコ・ベルデ", "デポルティボ・ソラーノ", "ウニオン・ロサレス", "CD プエルト・ブランコ", "レアル・アルタミラ"],
      ["CD バルデモラ", "UD ラス・ペーニャス", "SD カスティーリョ", "レアル・オリバレス", "CF ヌエボ・リオ", "アトレティコ・セラーノ"],
    ],
  },
  {
    name: "ドイツ",
    strength: [73, 56],
    clubs: [
      ["FC ヴァルトブルク", "ボルシア・ハイデン", "SV ロートフェルト", "アイントラハト・ブルン", "フォルトゥナ・ゼーベルク", "VfB シュタインアウ"],
      ["TSV アーレンタール", "SC ノイマルクト", "FC ローゼンハイム", "SV ベルクドルフ", "1. FC タールハウゼン", "VfL ミューレン"],
    ],
  },
  {
    name: "イタリア",
    strength: [72, 56],
    clubs: [
      ["AC モンテベルデ", "インテル・ヴァレンツァ", "SS ルーチェ", "ユヴェントゥス・アルバ", "ACF カステッロ", "US ポルトマーレ"],
      ["AC サンフィオーレ", "US ロッカルタ", "SSD ヴァルキアーラ", "AS ピエトラロッサ", "FC ボルゴヌオーヴォ", "US カンポリエト"],
    ],
  },
  {
    name: "フランス",
    strength: [69, 54],
    clubs: [
      ["オリンピック・サンマロン", "AS ベルフォンテーヌ", "FC リヴァージュ", "スタッド・モンクレール", "RC ヴィルヌーヴ", "OGC ロシュブラン"],
      ["US シャトーベル", "AC ボーモン", "FC サンリュック", "スタッド・ラヴァル・ヌフ", "SC ペルピエール", "AJ モルヴィル"],
    ],
  },
];

/** 海外の選手の一覧に、いつも何人いるか */
export const POOL_SIZE = 96;
/** 毎年、海外の選手のうちこの割合が一覧から入れ替わる（ほかのクラブへ移る） */
export const POOL_TURNOVER = 0.25;

/** 位置の出やすさ（GK・DF・MF・FW） */
const POSITION_WEIGHTS = [1, 3, 3, 2];
/** @type {Position[]} */
const POSITIONS = ["GK", "DF", "MF", "FW"];

/**
 * 海外の選手を 1 人作って、一覧に入れる
 * @param {AbroadCore} league @param {NameData} names @param {Rng} rng @param {Set<string>} used
 */
function addForeignPlayer(league, names, rng, used) {
  const country = pick(rng, COUNTRIES);
  const div = rng.next() < 0.55 ? 0 : 1;
  const pos = POSITIONS[weightedIndex(rng, POSITION_WEIGHTS)];
  const base = country.strength[div] + normal(rng, 0, 6);
  const id = `p${league.nextPlayerId++}`;
  const p = makePlayer(rng, id, makeName(rng, names, used), pos, base, randInt(rng, 18, 32));
  league.players[id] = { ...p, career: emptyCareer(), contract: initialContract(rng, p), abroad: { country: country.name, div, club: pick(rng, country.clubs[div]) } };
  /** @type {string[]} */ (league.abroad).push(id);
}

/** @param {AbroadCore} league */
function usedNames(league) {
  return new Set([...Object.values(league.players).map((p) => p.name), ...Object.values(league.clubs).map((c) => c.manager.name)]);
}

/**
 * 海外の選手の一覧を 1 年分進める（league をその場で書きかえる）: 年を取り、引退し、一部はほかへ移り、新しい選手が入る。
 * 一覧がまだ無ければ作る。乱数はリーグのほかの所とは別のものを使うので、コンピューターのクラブの動きは変わらない。
 * @param {AbroadCore} league @param {NameData} names @param {Rng} rng @param {boolean} [age] 年を取らせるか（作った直後は取らせない）
 */
export function refreshAbroad(league, names, rng, age = true) {
  if (!league.abroad) league.abroad = [];
  const used = usedNames(league);
  league.abroad = league.abroad.filter((id) => {
    const p0 = league.players[id];
    if (!p0) return false;
    if (!age) return true;
    const p = agePlayer(p0, rng, 0);
    if (rng.next() < retireChance(p.age) || rng.next() < POOL_TURNOVER) {
      delete league.players[id];
      return false;
    }
    // 契約が切れたら、同じクラブと結び直す
    const years = (p.contract?.years ?? 1) - 1;
    league.players[id] = { ...p, contract: years > 0 ? { ...p.contract, years, wage: p.contract?.wage ?? 1 } : initialContract(rng, p) };
    return true;
  });
  while (league.abroad.length < POOL_SIZE) addForeignPlayer(league, names, rng, used);
}

/**
 * 海外のクラブに引き抜かれた選手を、海外の選手の一覧に入れる（自分のクラブがあるときだけ）。
 * 乱数を使わず、選手の id から国とクラブを決める。
 * @param {AbroadCore} league @param {Player} p
 */
export function moveAbroad(league, p) {
  if (!league.abroad) {
    delete league.players[p.id];
    return;
  }
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const country = COUNTRIES[h % COUNTRIES.length];
  const club = country.clubs[0][(h >>> 3) % country.clubs[0].length];
  league.players[p.id] = { ...p, contract: { years: 4, wage: p.contract?.wage ?? 1 }, abroad: { country: country.name, div: 0, club } };
  league.abroad.push(p.id);
}

/**
 * 選手がいまいる所の表し方
 * @param {{ players: Record<string, Player>, clubs: Record<string, { short: string, playerIds: string[] }>, divisions: { name: string, clubIds: string[] }[] }} league
 * @param {string} playerId
 * @returns {{ country: string, league: string, club: string }}
 */
export function locationOf(league, playerId) {
  const p = league.players[playerId];
  if (p?.abroad) return { country: p.abroad.country, league: `${p.abroad.div + 1} 部`, club: p.abroad.club };
  for (const d of league.divisions) {
    const id = d.clubIds.find((cid) => league.clubs[cid].playerIds.includes(playerId));
    if (id) return { country: HOME_COUNTRY, league: d.name, club: league.clubs[id].short };
  }
  return { country: HOME_COUNTRY, league: "", club: "無所属（フリー）" };
}
