// @ts-check
// 監督が先発を選び、先発からクラブの攻撃力と守備力を出す。

import { overallAt, weighted } from "./players.js";
import { STYLES } from "./world.js";

/**
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./players.js").Position} Position
 * @typedef {import("./players.js").Attrs} Attrs
 * @typedef {import("./world.js").Manager} Manager
 * @typedef {{ player: Player, pos: Position }} Slot
 * @typedef {{ attack: number, defense: number, attackRating: number, defenseRating: number }} Strength
 */

/** @type {Record<string, Record<Position, number>>} */
export const FORMATIONS = {
  "4-4-2": { GK: 1, DF: 4, MF: 4, FW: 2 },
  "4-3-3": { GK: 1, DF: 4, MF: 3, FW: 3 },
  "5-3-2": { GK: 1, DF: 5, MF: 3, FW: 2 },
};

/** 攻撃力と守備力の何割を、どの位置が担うか */
const ATTACK_SHARE = /** @type {Record<Position, number>} */ ({ GK: 0, DF: 0.1, MF: 0.35, FW: 0.55 });
const DEFENSE_SHARE = /** @type {Record<Position, number>} */ ({ GK: 0.3, DF: 0.45, MF: 0.2, FW: 0.05 });

/** 位置ごとに、攻撃と守備でどの能力が効くか */
const ATTACK_VALUE = /** @type {Record<Position, Partial<Attrs>>} */ ({
  GK: { pas: 1 },
  DF: { pas: 0.4, spd: 0.3, dri: 0.3 },
  MF: { pas: 0.4, dri: 0.3, sho: 0.2, spd: 0.1 },
  FW: { sho: 0.5, dri: 0.25, spd: 0.25 },
});
const DEFENSE_VALUE = /** @type {Record<Position, Partial<Attrs>>} */ ({
  GK: { gk: 1 },
  DF: { def: 0.7, spd: 0.3 },
  MF: { def: 0.6, sta: 0.4 },
  FW: { def: 0.5, sta: 0.5 },
});

/** 能力の評価がこの値のとき、攻撃力・守備力が 1.0（リーグの平均くらい） */
export const RATING_REF = 66;
/** 能力の評価が 1 違うと、攻撃力・守備力が何倍になるか (exp の係数) */
export const RATING_SCALE = 0.03;

/**
 * 疲れによる能力の下がり方。体調 100 で 1.0、0 で 0.8。
 * @param {number} condition 0〜100
 */
export const conditionFactor = (condition) => 0.8 + (0.2 * condition) / 100;

/**
 * 出られる選手から先発 11 人を選ぶ。本職の位置の選手を、体調込みの力が高い順に入れ、
 * 足りない位置は別の位置の選手で埋める。
 * @param {Player[]} available けがをしていない選手
 * @param {(p: Player) => number} conditionOf
 * @param {string} formation
 * @returns {Slot[]}
 */
export function pickLineup(available, conditionOf, formation) {
  const shape = FORMATIONS[formation];
  const score = (/** @type {Player} */ p, /** @type {Position} */ pos) => overallAt(p, pos) * conditionFactor(conditionOf(p));
  /** 力の高い順に並べる（並べる前に 1 回だけ計算する） */
  const best = (/** @type {Player[]} */ players, /** @type {Position} */ pos) =>
    players
      .map((p) => ({ p, s: score(p, pos) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
  const chosen = new Set();
  /** @type {Slot[]} */
  const lineup = [];
  /** @type {Position[]} */
  const short = [];
  for (const pos of /** @type {Position[]} */ (Object.keys(shape))) {
    const natural = best(available.filter((p) => p.pos === pos), pos);
    for (let i = 0; i < shape[pos]; i++) {
      const p = natural[i];
      if (p) {
        chosen.add(p.id);
        lineup.push({ player: p, pos });
      } else {
        short.push(pos);
      }
    }
  }
  for (const pos of short) {
    const rest = best(available.filter((p) => !chosen.has(p.id)), pos);
    if (!rest[0]) break;
    chosen.add(rest[0].id);
    lineup.push({ player: rest[0], pos });
  }
  return lineup;
}

/**
 * 先発・体調・監督から、試合での攻撃力と守備力を出す。
 * @param {Slot[]} lineup @param {(p: Player) => number} conditionOf @param {Manager} manager
 * @returns {Strength}
 */
export function teamStrength(lineup, conditionOf, manager) {
  /** @param {Record<Position, number>} share @param {Record<Position, Partial<Attrs>>} values */
  const rate = (share, values) => {
    let total = 0;
    let used = 0;
    for (const pos of /** @type {Position[]} */ (Object.keys(share))) {
      const slots = lineup.filter((s) => s.pos === pos);
      if (slots.length === 0 || share[pos] === 0) continue;
      const avg =
        slots.reduce((sum, s) => sum + weighted(values[pos], s.player.attrs) * conditionFactor(conditionOf(s.player)), 0) /
        slots.length;
      total += share[pos] * avg;
      used += share[pos];
    }
    return used ? total / used : 0;
  };
  const attackRating = rate(ATTACK_SHARE, ATTACK_VALUE);
  const defenseRating = rate(DEFENSE_SHARE, DEFENSE_VALUE);
  const style = STYLES[manager.style];
  // 監督の采配の力は ±5% くらい効く
  const coach = Math.exp((manager.ability - 65) * 0.003);
  return {
    attackRating,
    defenseRating,
    attack: Math.exp((attackRating - RATING_REF) * RATING_SCALE) * style.attack * coach,
    defense: Math.exp((defenseRating - RATING_REF) * RATING_SCALE) * style.defense * coach,
  };
}
