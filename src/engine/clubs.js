// @ts-check
// クラブのデータの形と、読み込んだデータの確かめ。

/**
 * @typedef {{ id: string, name: string, short: string, level: number }} Club  level は主力の能力の目安 (1〜99)
 * @typedef {{ id: string, name: string, clubs: Club[] }} Division
 * @typedef {{ version: number, divisions: Division[] }} ClubData
 * @typedef {{ version: number, given: string[], family: string[] }} NameData
 */

export const CLUB_DATA_VERSION = 2;
export const NAME_DATA_VERSION = 1;

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
    for (const c of div.clubs) {
      if (!(c.level >= 1 && c.level <= 99)) throw new Error(`${c.name}: level は 1〜99 にしてください`);
    }
  }
  return data;
}

/**
 * @param {any} data
 * @returns {NameData}
 */
export function parseNameData(data) {
  if (data.version !== NAME_DATA_VERSION) throw new Error(`名前のデータの版が違います: ${data.version}`);
  if (!data.given?.length || !data.family?.length) throw new Error("名前のデータが空です");
  return data;
}
