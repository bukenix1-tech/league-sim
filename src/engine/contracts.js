// @ts-check
// 契約と移籍金。

import { wage } from "./finance.js";
import { overall } from "./players.js";
import { randInt } from "./rng.js";

/**
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./players.js").Contract} Contract
 * @typedef {import("./rng.js").Rng} Rng
 */

/** 1 クラブが持てる選手の数の上限と、試合に必要な下限 */
export const MAX_SQUAD = 26;
export const MIN_SHAPE = /** @type {Record<import("./players.js").Position, number>} */ ({ GK: 2, DF: 6, MF: 6, FW: 3 });

/** スター選手は、クラブの規模をこれ以上上回ると、もっと大きいクラブへ行きたがる */
export const STAR_GAP = 8;

/** @param {number} x */
const round1 = (x) => Math.round(x * 10) / 10;

/** 年齢に合った契約の年数 @param {number} age */
export const contractYearsFor = (age) => (age < 24 ? 4 : age < 29 ? 3 : age < 32 ? 2 : 1);

/**
 * 選手が求める年俸の契約
 * @param {Player} p @param {number} [years]
 * @returns {Contract}
 */
export function newContract(p, years = contractYearsFor(p.age)) {
  return { years, wage: round1(wage(p)) };
}

/**
 * 始めの契約（残りの年数はばらばら）
 * @param {Rng} rng @param {Player} p
 * @returns {Contract}
 */
export function initialContract(rng, p) {
  return { years: randInt(rng, 1, 4), wage: round1(wage(p)) };
}

/**
 * 移籍金（億円）。若くて伸びしろがあるほど高く、契約の残りが短いほど安い。契約が切れていれば 0。
 * @param {Player} p
 */
export function playerValue(p) {
  const years = p.contract?.years ?? 0;
  if (years <= 0) return 0;
  const age = p.age <= 23 ? 1.6 : p.age <= 27 ? 1.2 : p.age <= 30 ? 0.9 : 0.5;
  const room = Math.max(0, p.potential - overall(p)) * 0.05;
  const left = years === 1 ? 0.6 : 1;
  return round1(wage(p) * 3 * (age + room) * left);
}

/**
 * クラブの規模に比べて力が大きすぎて、出ていきたがるか
 * @param {Player} p @param {number} clubLevel
 */
export const wantsBiggerClub = (p, clubLevel) => overall(p) > clubLevel + STAR_GAP;
