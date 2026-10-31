// @ts-check
// セーブの書き出しと読み込み。版の番号を見て、古い形なら今の形に直してから使う。

import { initialFinance, initialFacilities, wage } from "./finance.js";
import { SAVE_VERSION } from "./league.js";

/** @typedef {import("./league.js").League} League */

/**
 * 版ごとの直し方。MIGRATIONS[n] は版 n のセーブを版 n+1 に直す。
 * 例: セーブの形を変えて SAVE_VERSION を 2 にしたら、MIGRATIONS[1] を足す。
 * @type {Record<number, (save: any) => any>}
 */
const MIGRATIONS = {
  // 版 1 → 2（段階 4）: クラブにお金と人気を足し、自分のクラブはまだ決まっていない形にする
  1: (save) => ({
    ...save,
    clubs: Object.fromEntries(
      Object.entries(save.clubs).map(([id, c]) => [id, { .../** @type {object} */ (c), finance: initialFinance(/** @type {any} */ (c).level) }]),
    ),
    history: save.history.map((/** @type {any} */ h) => ({ ...h, user: null })),
    user: null,
  }),
  // 版 2 → 3（段階 5）: 選手に契約、クラブに施設・移籍金の出入り・調子、フリーの選手、自分のクラブに補強のおまかせ・誘い・オファー
  2: (save) => ({
    ...save,
    players: Object.fromEntries(
      Object.entries(save.players).map(([id, p], i) => [
        id,
        { .../** @type {object} */ (p), contract: { years: 1 + (i % 4), wage: Math.round(wage(/** @type {any} */ (p)) * 10) / 10 } },
      ]),
    ),
    clubs: Object.fromEntries(
      Object.entries(save.clubs).map(([id, c]) => {
        const club = /** @type {any} */ (c);
        return [id, { ...club, form: 1, finance: { ...club.finance, facilities: initialFacilities(club.level), transfers: { in: 0, out: 0, invest: 0 } } }];
      }),
    ),
    freeAgents: [],
    user: save.user ? { ...save.user, auto: true, offers: [], bids: [] } : null,
  }),
  // 版 3 → 4（段階 6）: シーズンの途中（冬）の状態、自分のクラブに監督の候補とクビ、入場料の値段
  3: (save) => ({
    ...save,
    midSeason: null,
    user: save.user ? { ...save.user, candidates: [], fired: null } : null,
  }),
};

/** @param {League} league */
export function serialize(league) {
  return JSON.stringify(league);
}

/**
 * @param {string} text
 * @returns {League}
 */
export function parseSave(text) {
  /** @type {any} */
  let save;
  try {
    save = JSON.parse(text);
  } catch {
    throw new Error("セーブのファイルが読めません（JSON ではありません）");
  }
  if (typeof save?.version !== "number") throw new Error("セーブのファイルではありません");
  if (save.version > SAVE_VERSION) throw new Error(`新しい版 (${save.version}) のセーブです。ゲームを新しくしてください`);
  while (save.version < SAVE_VERSION) {
    const migrate = MIGRATIONS[save.version];
    if (!migrate) throw new Error(`版 ${save.version} のセーブは読めません`);
    save = { ...migrate(save), version: save.version + 1 };
  }
  for (const key of ["seed", "year", "nextPlayerId", "divisions", "clubs", "players", "history", "user", "freeAgents", "midSeason"]) {
    if (!(key in save)) throw new Error(`セーブに ${key} がありません`);
  }
  return save;
}
