// @ts-check
// 順位表。

/**
 * @typedef {import("./match.js").MatchResult} MatchResult
 * @typedef {{ id: string, played: number, won: number, drawn: number, lost: number,
 *             goalsFor: number, goalsAgainst: number }} Row
 */

export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;

/** @param {Row} r */
export const points = (r) => r.won * POINTS_WIN + r.drawn * POINTS_DRAW;
/** @param {Row} r */
export const goalDiff = (r) => r.goalsFor - r.goalsAgainst;

/**
 * @param {string[]} ids
 * @returns {Map<string, Row>}
 */
export function createTable(ids) {
  return new Map(
    ids.map((id) => [id, { id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 }]),
  );
}

/**
 * @param {Map<string, Row>} table
 * @param {MatchResult} result
 */
export function addResult(table, result) {
  const sides = /** @type {const} */ ([
    [result.home, result.homeGoals, result.awayGoals],
    [result.away, result.awayGoals, result.homeGoals],
  ]);
  for (const [id, scored, conceded] of sides) {
    const row = table.get(id);
    if (!row) throw new Error(`順位表に無いクラブ: ${id}`);
    row.played++;
    row.goalsFor += scored;
    row.goalsAgainst += conceded;
    if (scored > conceded) row.won++;
    else if (scored === conceded) row.drawn++;
    else row.lost++;
  }
}

/**
 * 勝ち点 → 得失点差 → 総得点 の順に並べる（それでも同じなら id 順）。
 * @param {Map<string, Row>} table
 * @returns {Row[]}
 */
export function standings(table) {
  return [...table.values()].sort(
    (a, b) =>
      points(b) - points(a) ||
      goalDiff(b) - goalDiff(a) ||
      b.goalsFor - a.goalsFor ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
