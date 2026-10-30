// @ts-check
// リーグの世界（クラブ・監督・選手）を作る。

import { overallAt, makeAttrs, makeTraits } from "./players.js";
import { createRng, normal, pick, randInt, weightedIndex } from "./rng.js";

/**
 * @typedef {import("./clubs.js").Club} Club
 * @typedef {import("./clubs.js").NameData} NameData
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./players.js").Position} Position
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {keyof typeof STYLES} Style
 * @typedef {{ name: string, age: number, style: Style, ability: number }} Manager
 * @typedef {Club & { manager: Manager, playerIds: string[] }} ClubState
 * @typedef {{ clubs: ClubState[], players: Map<string, Player> }} World
 */

/** 1 クラブの選手の数（位置ごと） */
export const SQUAD_SHAPE = /** @type {Record<Position, number>} */ ({ GK: 3, DF: 7, MF: 7, FW: 5 });

/** 監督の型。作戦は監督が決める（経営者は口を出さない） */
export const STYLES = {
  balanced: { label: "バランス", formation: "4-4-2", attack: 1, defense: 1 },
  attacking: { label: "攻撃的", formation: "4-3-3", attack: 1.06, defense: 0.95 },
  defensive: { label: "守備的", formation: "5-3-2", attack: 0.95, defense: 1.06 },
  youth: { label: "育成", formation: "4-4-2", attack: 1, defense: 1 }, // 段階 3 で若手の伸びを良くする
};

/** 先発に入る人数の目安（4-4-2）。これより下は控え */
const STARTERS = /** @type {Record<Position, number>} */ ({ GK: 1, DF: 4, MF: 4, FW: 2 });

/**
 * 重なりの無い名前を作る
 * @param {Rng} rng @param {NameData} names @param {Set<string>} used
 */
export function makeName(rng, names, used) {
  for (let i = 0; i < 50; i++) {
    const name = `${pick(rng, names.given)}・${pick(rng, names.family)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // 組み合わせが尽きかけたら番号を付ける
  const name = `${pick(rng, names.given)}・${pick(rng, names.family)} ${used.size}`;
  used.add(name);
  return name;
}

/**
 * 1 人の選手を作る。base はその位置での総合力の目安。
 * @param {Rng} rng @param {string} id @param {string} name @param {Position} pos @param {number} base @param {number} age
 * @returns {Player}
 */
export function makePlayer(rng, id, name, pos, base, age) {
  const traits = makeTraits(rng, pos);
  const attrs = makeAttrs(rng, pos, base);
  /** @type {Player} */
  const p = { id, name, pos, age, attrs, potential: 0, traits };
  // 若い選手ほど、これから伸びる分が大きい
  const room = age < 27 ? (27 - age) * (0.4 + rng.next() * 1.4) : 0;
  p.potential = Math.min(99, Math.round(overallAt(p) + room));
  return p;
}

/**
 * @param {Rng} rng @param {NameData} names @param {Set<string>} used @param {number} level
 * @returns {Manager}
 */
export function makeManager(rng, names, used, level) {
  const styles = /** @type {Style[]} */ (Object.keys(STYLES));
  return {
    name: makeName(rng, names, used),
    age: randInt(rng, 38, 66),
    style: styles[weightedIndex(rng, [4, 3, 3, 2])],
    ability: Math.max(30, Math.min(95, Math.round(normal(rng, level, 7)))),
  };
}

/**
 * 同じ clubs・names・seed なら必ず同じ世界になる。
 * @param {Club[]} clubs @param {NameData} names @param {number} seed
 * @returns {World}
 */
export function generateWorld(clubs, names, seed) {
  const rng = createRng(seed);
  const used = new Set();
  /** @type {Map<string, Player>} */
  const players = new Map();
  const states = clubs.map((club) => {
    /** @type {string[]} */
    const playerIds = [];
    for (const pos of /** @type {Position[]} */ (Object.keys(SQUAD_SHAPE))) {
      for (let i = 0; i < SQUAD_SHAPE[pos]; i++) {
        // 主力ほど強く、控えになるほど弱い
        const depth = i < STARTERS[pos] ? 4 - i : -3 - (i - STARTERS[pos]) * 3;
        const base = club.level + depth + normal(rng, 0, 3);
        const age = Math.max(17, Math.min(36, Math.round(normal(rng, 26, 4))));
        const id = `${club.id}-${playerIds.length + 1}`;
        players.set(id, makePlayer(rng, id, makeName(rng, names, used), pos, base, age));
        playerIds.push(id);
      }
    }
    return { ...club, manager: makeManager(rng, names, used, club.level), playerIds };
  });
  return { clubs: states, players };
}
