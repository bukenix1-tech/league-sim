// @ts-check
// お金と人気。単位は「億円」と「万人」。
// 入るお金: 入場料・放映権・スポンサー・グッズ。出るお金: 年俸・運営費。

import { overall } from "./players.js";

/**
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./world.js").Manager} Manager
 * @typedef {{ tickets: number, tv: number, sponsor: number, goods: number }} Revenue
 * @typedef {{ revenue: Revenue, wages: number, ops: number, profit: number, attendance: number }} SeasonMoney
 * @typedef {{ cash: number, popularity: number, capacity: number, budget: number, parachute: number, last: SeasonMoney | null }} Finance
 *   cash は手元のお金（マイナスは借金）、popularity はファンの数（万人）、capacity はスタジアムの席の数、
 *   budget はこのシーズンの年俸の予算、parachute は降格したあと放映権を多めにもらえる残りの年数
 */

// ── 年俸 ──
/** 総合力 60 の選手の年俸（億円） */
export const WAGE_BASE = 3;
/** 総合力が 1 上がると年俸が何倍になるか (exp の係数) */
export const WAGE_EXP = 0.06;
/** 22 人の年俸の合計が「規模の選手 22 人分」の何倍になるか（主力と控えの差の分。測って決めた値） */
export const SQUAD_WAGE_FACTOR = 1.0;

/** @param {Player} p */
export const wage = (p) => WAGE_BASE * Math.exp((overall(p) - 60) * WAGE_EXP);

/** @param {Manager} m */
export const managerWage = (m) => 1.5 * Math.exp((m.ability - 60) * 0.04);

/** 年俸の予算から、補強で目指せるクラブの規模 @param {number} budget */
export function levelFromBudget(budget) {
  return 60 + Math.log(Math.max(1, budget) / (22 * WAGE_BASE * SQUAD_WAGE_FACTOR)) / WAGE_EXP;
}

/** クラブの規模に見合う年俸の合計 @param {number} level */
export function budgetForLevel(level) {
  return 22 * WAGE_BASE * SQUAD_WAGE_FACTOR * Math.exp((level - 60) * WAGE_EXP);
}

// ── 入るお金 ──
/** 入場料（円）。1 部と 2 部 */
export const TICKET_PRICE = [5000, 3000];

/**
 * 放映権（億円）。1 部と 2 部で大きく違い、順位で少し増える。
 * @param {number} div @param {number} pos @param {number} n その部のクラブの数
 */
export function tvMoney(div, pos, n) {
  return div === 0 ? 20 + (n - pos) * 1.0 : 14 + (n - pos) * 0.4;
}

/** 降格したクラブが 2 部で 2 年間もらえる上乗せの放映権（パラシュート。本物のリーグにもある） */
export const PARACHUTE = 12;
export const PARACHUTE_YEARS = 2;

/** 1 試合あたりの観客（スタジアムの席の数まで） @param {Finance} f */
export function attendance(f) {
  return Math.min(f.capacity, Math.round(4000 * f.popularity ** 0.55));
}

/**
 * @param {Finance} f @param {number} div @param {number} pos @param {number} n
 * @returns {Revenue}
 */
export function revenue(f, div, pos, n) {
  const homeGames = n - 1;
  return {
    tickets: (attendance(f) * TICKET_PRICE[div] * homeGames) / 1e8,
    tv: tvMoney(div, pos, n) + (div === 1 && f.parachute > 0 ? PARACHUTE : 0),
    sponsor: 2 * f.popularity ** 0.8,
    goods: 0.8 * f.popularity ** 0.8,
  };
}

/** @param {Revenue} r */
export const totalRevenue = (r) => r.tickets + r.tv + r.sponsor + r.goods;

/** 運営費（スタッフ・施設の維持など） @param {number} rev */
export const opsCost = (rev) => 2 + rev * 0.08;

// ── 人気 ──
/**
 * 順位から、人気が向かっていく先（万人）。人気は毎年少しずつしか動かない。
 * @param {number} div @param {number} pos @param {number} n
 */
export function popularityTarget(div, pos, n) {
  return div === 0 ? 18 * Math.exp((n - pos) * 0.11) : 5 * Math.exp((n - pos) * 0.06);
}
export const POPULARITY_PULL = 0.12;

/**
 * @param {number} popularity @param {number} div @param {number} pos @param {number} n
 */
export function nextPopularity(popularity, div, pos, n) {
  let p = popularity + (popularityTarget(div, pos, n) - popularity) * POPULARITY_PULL;
  if (div === 0 && pos === 1) p *= 1.05; // 優勝すると少し増える
  return Math.round(Math.max(1, p) * 10) / 10;
}

// ── 始めのお金と予算 ──
/**
 * クラブの規模から始めの人気・スタジアム・お金を決める
 * @param {number} level @returns {Finance}
 */
export function initialFinance(level) {
  const popularity = Math.round(5 * Math.exp((level - 46) * 0.1) * 10) / 10;
  const att = 4000 * popularity ** 0.55;
  const capacity = Math.max(8000, Math.ceil((att * 1.2) / 1000) * 1000);
  const budget = budgetForLevel(level);
  return { cash: Math.round(budget * 0.5), popularity, capacity, budget, parachute: 0, last: null };
}

/**
 * 次のシーズンの収入の見込み（真ん中の順位で終わるとして）
 * @param {Finance} f @param {number} div @param {number} n
 */
export function forecastRevenue(f, div, n) {
  return totalRevenue(revenue(f, div, Math.ceil(n / 2), n));
}

/**
 * 決められる年俸の予算の幅。上はお金の残りで決まり、借金がふくらみすぎないようにする。
 * @param {Finance} f @param {number} div @param {number} n
 */
export function budgetRange(f, div, n) {
  const rev = forecastRevenue(f, div, n);
  const min = rev * 0.3;
  const max = Math.max(min, rev * 0.9 + Math.max(0, f.cash) * 0.5);
  return { min, max };
}

/**
 * コンピューターのクラブ（と「おまかせ」）の予算: 収入の 7 割弱。お金が余れば少しずつ使い、借金があれば減らす。
 * @param {Finance} f @param {number} div @param {number} n
 */
export function autoBudget(f, div, n) {
  const rev = forecastRevenue(f, div, n);
  const { min, max } = budgetRange(f, div, n);
  const b = rev * 0.68 + Math.max(0, f.cash) * 0.25 - Math.max(0, -f.cash) * 0.35;
  return Math.min(max, Math.max(min, b));
}

/** 億円の表し方 @param {number} x */
export const oku = (x) => `${x < 0 ? "−" : ""}${Math.abs(x) >= 100 ? Math.round(Math.abs(x)) : Math.abs(x).toFixed(1)} 億円`;
