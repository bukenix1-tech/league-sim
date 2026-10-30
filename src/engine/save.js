// @ts-check
// セーブの書き出しと読み込み。版の番号を見て、古い形なら今の形に直してから使う。

import { SAVE_VERSION } from "./league.js";

/** @typedef {import("./league.js").League} League */

/**
 * 版ごとの直し方。MIGRATIONS[n] は版 n のセーブを版 n+1 に直す。
 * 例: セーブの形を変えて SAVE_VERSION を 2 にしたら、MIGRATIONS[1] を足す。
 * @type {Record<number, (save: any) => any>}
 */
const MIGRATIONS = {};

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
  for (const key of ["seed", "year", "nextPlayerId", "divisions", "clubs", "players", "history"]) {
    if (!(key in save)) throw new Error(`セーブに ${key} がありません`);
  }
  return save;
}
