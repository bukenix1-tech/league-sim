// @ts-check
// クラブのデータの形と、読み込んだデータの確かめ。

/**
 * @typedef {{ id: string, name: string, short: string, attack: number, defense: number }} Club
 * @typedef {{ id: string, name: string, clubs: Club[] }} Division
 * @typedef {{ version: number, divisions: Division[] }} ClubData
 */

export const CLUB_DATA_VERSION = 1;

/**
 * JSON から読んだものを確かめて返す。
 * @param {any} data
 * @returns {ClubData}
 */
export function parseClubData(data) {
  if (data.version !== CLUB_DATA_VERSION) {
    throw new Error(`クラブのデータの版が違います: ${data.version}`);
  }
  for (const div of data.divisions) {
    const ids = div.clubs.map((/** @type {Club} */ c) => c.id);
    if (new Set(ids).size !== ids.length) throw new Error(`${div.name}: クラブの id が重複しています`);
    if (ids.length % 2 !== 0) throw new Error(`${div.name}: クラブの数は偶数にしてください`);
  }
  return data;
}
