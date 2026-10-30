// @ts-check
// 選手: 位置・能力・特徴・総合力・年齢による伸びと衰え。

import { normal, pick } from "./rng.js";

/**
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {"GK" | "DF" | "MF" | "FW"} Position
 * @typedef {"sho" | "pas" | "dri" | "def" | "spd" | "sta" | "gk"} Attr
 * @typedef {Record<Attr, number>} Attrs
 * @typedef {keyof typeof TRAITS} Trait
 * @typedef {{ seasons: number, apps: number, goals: number, assists: number }} Career  通算の記録
 * @typedef {{ apps: number, goals: number, assists: number, injuries: number }} LastSeason  前のシーズンの記録
 * @typedef {{ id: string, name: string, pos: Position, age: number, attrs: Attrs,
 *             potential: number, traits: Trait[], career?: Career, last?: LastSeason }} Player
 *   potential は伸びきったときの総合力の目安（若い選手ほど今との差が大きい）
 */

/** @type {Position[]} */
export const POSITIONS = ["GK", "DF", "MF", "FW"];

/** @type {Attr[]} */
export const ATTRS = ["sho", "pas", "dri", "def", "spd", "sta", "gk"];

/** @type {Record<Attr, string>} */
export const ATTR_LABEL = {
  sho: "シュート",
  pas: "パス",
  dri: "ドリブル",
  def: "守備",
  spd: "スピード",
  sta: "スタミナ",
  gk: "キーパー",
};

export const TRAITS = {
  finisher: { label: "決定力", desc: "点を取りやすい" },
  playmaker: { label: "チャンスメーカー", desc: "アシストしやすい" },
  sturdy: { label: "ケガしにくい", desc: "けがの確率が半分" },
  fragile: { label: "ケガしやすい", desc: "けがの確率が高い" },
  ironman: { label: "鉄人", desc: "試合で疲れにくい" },
  early: { label: "早熟", desc: "早く伸びて早く衰える" },
  late: { label: "晩成", desc: "遅くまで伸びて長持ちする" },
};

/**
 * 位置ごとの総合力の重み
 * @type {Record<Position, Partial<Attrs>>}
 */
const OVERALL_WEIGHTS = {
  GK: { gk: 0.9, pas: 0.1 },
  DF: { def: 0.5, spd: 0.2, pas: 0.15, sta: 0.15 },
  MF: { pas: 0.35, dri: 0.2, def: 0.15, sho: 0.1, sta: 0.2 },
  FW: { sho: 0.5, dri: 0.2, spd: 0.2, pas: 0.1 },
};

/**
 * 選手を作るとき、位置ごとに各能力を「基準の強さ」からどれだけずらすか
 * @type {Record<Position, Attrs>}
 */
const ATTR_OFFSETS = {
  GK: { gk: 0, pas: -18, dri: -30, sho: -40, def: -25, spd: -20, sta: -15 },
  DF: { def: 2, spd: 0, pas: -5, dri: -12, sho: -20, sta: 0, gk: -50 },
  MF: { pas: 3, dri: 0, def: -8, sho: -8, spd: -5, sta: 2, gk: -50 },
  FW: { sho: 3, dri: 0, spd: 0, pas: -8, def: -25, sta: -5, gk: -50 },
};

/** @param {number} x */
export const clampAttr = (x) => Math.max(1, Math.min(99, Math.round(x)));

/**
 * @param {Partial<Attrs>} weights @param {Attrs} attrs
 */
export function weighted(weights, attrs) {
  let entries = entriesCache.get(weights);
  if (!entries) {
    entries = /** @type {[Attr, number][]} */ (Object.entries(weights));
    entriesCache.set(weights, entries);
  }
  let s = 0;
  for (const [k, w] of entries) s += w * attrs[k];
  return s;
}
/** 何度も呼ばれるので、重みの並びを作り直さないようにする */
const entriesCache = /** @type {WeakMap<object, [Attr, number][]>} */ (new WeakMap());

/**
 * その位置で出たときの総合力
 * @param {Player} p @param {Position} [pos]
 */
export function overallAt(p, pos = p.pos) {
  return weighted(OVERALL_WEIGHTS[pos], p.attrs);
}

/** @param {Player} p */
export const overall = (p) => Math.round(overallAt(p));

/**
 * 野球ゲームのような S〜G の評価
 * @param {number} v
 */
export function grade(v) {
  if (v >= 90) return "S";
  if (v >= 80) return "A";
  if (v >= 70) return "B";
  if (v >= 60) return "C";
  if (v >= 50) return "D";
  if (v >= 40) return "E";
  if (v >= 20) return "F";
  return "G";
}

/**
 * 能力を作る。base はその位置での総合力のおおよその値。
 * @param {Rng} rng @param {Position} pos @param {number} base
 * @returns {Attrs}
 */
export function makeAttrs(rng, pos, base) {
  const offsets = ATTR_OFFSETS[pos];
  return /** @type {Attrs} */ (
    Object.fromEntries(ATTRS.map((a) => [a, clampAttr(base + offsets[a] + normal(rng, 0, 5))]))
  );
}

/**
 * 特徴を 0〜2 個つける
 * @param {Rng} rng @param {Position} pos
 * @returns {Trait[]}
 */
export function makeTraits(rng, pos) {
  /** @type {Trait[]} */
  const traits = [];
  const roll = (/** @type {number} */ p) => rng.next() < p;
  if (pos === "FW" && roll(0.2)) traits.push("finisher");
  else if (pos === "MF" && roll(0.07)) traits.push("finisher");
  if ((pos === "MF" || pos === "FW") && roll(0.12)) traits.push("playmaker");
  if (roll(0.1)) traits.push(pick(rng, /** @type {Trait[]} */ (["sturdy", "fragile"])));
  if (roll(0.06)) traits.push("ironman");
  if (roll(0.1)) traits.push(pick(rng, /** @type {Trait[]} */ (["early", "late"])));
  return traits.slice(0, 2);
}

/**
 * いちばん能力が高くなる年齢
 * @param {Player} p
 */
export function peakAge(p) {
  if (p.traits.includes("early")) return 25;
  if (p.traits.includes("late")) return 29;
  return 27;
}

/** 衰えるとき、速く落ちる能力 */
const FAST_DECLINE = new Set(["spd", "sta"]);

/**
 * 1 年たったときの伸びと衰え。新しい Player を返す（元は変えない）。
 * growthBonus は練習場や育成の監督による伸びの上乗せ（0 で普通、0.2 で 2 割増し）。
 * @param {Player} p @param {Rng} rng @param {number} [growthBonus]
 * @returns {Player}
 */
export function agePlayer(p, rng, growthBonus = 0) {
  const age = p.age + 1;
  const peak = peakAge(p);
  const gap = Math.max(0, p.potential - overallAt(p));
  /** @type {Attrs} */
  const attrs = { ...p.attrs };
  for (const a of ATTRS) {
    let delta;
    if (age <= peak) {
      // 伸びきるまでの差を毎年 3 割ずつ埋める
      delta = gap * 0.3 * (1 + growthBonus) + normal(rng, 0, 1);
    } else if (age <= peak + 3) {
      delta = normal(rng, 0, 1); // 一番いい時期。ほぼ変わらない
    } else {
      const years = age - peak - 3;
      delta = -(0.8 + years * 0.5) * (FAST_DECLINE.has(a) ? 1.6 : 1) + normal(rng, 0, 1);
    }
    attrs[a] = clampAttr(attrs[a] + delta);
  }
  return { ...p, age, attrs };
}
