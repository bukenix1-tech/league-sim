// @ts-check
// 何年も続くリーグ: 1 部と 2 部、プレーオフ、昇格と降格、シーズンの記録。

import { playMatch } from "./match.js";
import { emptyCareer, runOffseason } from "./offseason.js";
import { createRng } from "./rng.js";
import { leaders, playSeason, prepareSide } from "./season.js";
import { goalDiff, points } from "./table.js";
import { generateWorld } from "./world.js";

/**
 * @typedef {import("./clubs.js").ClubData} ClubData
 * @typedef {import("./clubs.js").NameData} NameData
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./world.js").ClubState} ClubState
 * @typedef {import("./season.js").SeasonResult} SeasonResult
 * @typedef {import("./rng.js").Rng} Rng
 * @typedef {import("./offseason.js").OffseasonReport} OffseasonReport
 * @typedef {[id: string, won: number, drawn: number, lost: number, goalsFor: number, goalsAgainst: number]} TableRow
 * @typedef {[name: string, clubId: string, count: number]} LeaderRow
 * @typedef {{ home: string, away: string, homeGoals: number, awayGoals: number }} Score
 * @typedef {{ semis: { first: Score, second: Score, winner: string }[], final: Score, winner: string, penalties: boolean }} Playoff
 * @typedef {{ year: number, tables: TableRow[][], leaders: { goals: LeaderRow[], assists: LeaderRow[] }[],
 *             promoted: string[], relegated: string[], playoff: Playoff, offseason: OffseasonReport }} YearRecord
 * @typedef {{ id: string, name: string, clubIds: string[] }} DivisionState
 * @typedef {{ version: number, seed: number, year: number, nextPlayerId: number, divisions: DivisionState[],
 *             clubs: Record<string, ClubState>, players: Record<string, Player>, history: YearRecord[] }} League
 */

/** セーブの形の版。形を変えたら上げて、save.js に古い版を読む手順を足す */
export const SAVE_VERSION = 1;
export const START_YEAR = 2026;

/** 1 部の下から何クラブが降格するか。2 部からは上位 2 クラブ + プレーオフの勝者が昇格する */
export const RELEGATED = 3;
export const AUTO_PROMOTED = 2;
/** プレーオフに出る順位（3〜6 位） */
export const PLAYOFF_FROM = 3;
export const PLAYOFF_TO = 6;

/**
 * 年と番号から、その年の乱数の種を作る
 * @param {number} seed @param {number} year @param {number} k
 */
export function yearSeed(seed, year, k) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(year, 0xc2b2ae35) ^ Math.imul(k + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

/**
 * 新しいリーグを始める。
 * @param {ClubData} clubData @param {NameData} names @param {number} seed
 * @returns {League}
 */
export function createLeague(clubData, names, seed) {
  const all = clubData.divisions.flatMap((d) => d.clubs);
  const world = generateWorld(all, names, seed);
  /** @type {Record<string, Player>} */
  const players = {};
  for (const [id, p] of world.players) players[id] = { ...p, career: emptyCareer() };
  return {
    version: SAVE_VERSION,
    seed,
    year: START_YEAR,
    nextPlayerId: 1,
    divisions: clubData.divisions.map((d) => ({ id: d.id, name: d.name, clubIds: d.clubs.map((c) => c.id) })),
    clubs: Object.fromEntries(world.clubs.map((c) => [c.id, c])),
    players,
    history: [],
  };
}

/**
 * 2 部のプレーオフ: 3 位 対 6 位、4 位 対 5 位をホームとアウェーの 2 試合で戦い、勝者同士が中立の場所で決勝。
 * 同点ならPK（半々）で決める。
 * @param {string[]} seeds 3〜6 位のクラブ id（順位の順）
 * @param {League} league @param {Map<string, Player>} players @param {Rng} rng
 * @returns {Playoff}
 */
export function playPlayoff(seeds, league, players, rng) {
  const fresh = () => 100;
  const side = (/** @type {string} */ id) => {
    const club = league.clubs[id];
    return prepareSide(club, club.playerIds.map((pid) => /** @type {Player} */ (players.get(pid))), fresh);
  };
  /** @param {string} home @param {string} away @param {boolean} [neutral] @returns {Score} */
  const play = (home, away, neutral = false) => {
    const r = playMatch(side(home), side(away), rng, neutral);
    return { home, away, homeGoals: r.homeGoals, awayGoals: r.awayGoals };
  };
  let penalties = false;
  /** @param {string} high 順位が上 @param {string} low */
  const tie = (high, low) => {
    const first = play(low, high); // 順位が下のクラブのホームから
    const second = play(high, low);
    const highGoals = first.awayGoals + second.homeGoals;
    const lowGoals = first.homeGoals + second.awayGoals;
    let winner = highGoals > lowGoals ? high : low;
    if (highGoals === lowGoals) {
      penalties = true;
      winner = rng.next() < 0.5 ? high : low;
    }
    return { first, second, winner };
  };
  const semis = [tie(seeds[0], seeds[3]), tie(seeds[1], seeds[2])];
  penalties = false;
  const final = play(semis[0].winner, semis[1].winner, true);
  let winner = final.homeGoals > final.awayGoals ? final.home : final.away;
  if (final.homeGoals === final.awayGoals) {
    penalties = true;
    winner = rng.next() < 0.5 ? final.home : final.away;
  }
  return { semis, final, winner, penalties };
}

/**
 * 1 年進める: 1 部と 2 部のシーズン → プレーオフ → 昇格と降格 → シーズンの間。
 * league は変えず、新しい League を返す。同じ league なら必ず同じ結果になる。
 * @param {League} league @param {NameData} names
 * @returns {{ league: League, seasons: SeasonResult[], record: YearRecord }}
 */
export function playYear(league, names) {
  const L = structuredClone(league);
  const players = new Map(Object.entries(L.players));

  const seasons = L.divisions.map((d, i) =>
    playSeason({ clubs: d.clubIds.map((id) => L.clubs[id]), players }, yearSeed(L.seed, L.year, i)),
  );

  // 選手の前のシーズンと通算の記録
  for (const season of seasons) {
    for (const [id, s] of season.stats) {
      const p = L.players[id];
      p.last = { apps: s.apps, goals: s.goals, assists: s.assists, injuries: s.injuries };
      const c = p.career ?? emptyCareer();
      p.career = { seasons: c.seasons + (s.apps > 0 ? 1 : 0), apps: c.apps + s.apps, goals: c.goals + s.goals, assists: c.assists + s.assists };
    }
  }

  const rng = createRng(yearSeed(L.seed, L.year, 99));
  const [top, second] = seasons.map((s) => s.standings);
  const playoff = playPlayoff(
    second.slice(PLAYOFF_FROM - 1, PLAYOFF_TO).map((r) => r.id),
    L,
    players,
    rng,
  );
  const promoted = [...second.slice(0, AUTO_PROMOTED).map((r) => r.id), playoff.winner];
  const relegated = top.slice(-RELEGATED).map((r) => r.id);

  const name = (/** @type {string} */ id) => L.players[id]?.name ?? "";
  /** @type {YearRecord} */
  const record = {
    year: L.year,
    tables: seasons.map((s) => s.standings.map((r) => /** @type {TableRow} */ ([r.id, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst]))),
    leaders: seasons.map((s) => ({
      goals: leaders(s, "goals", 10).map(([id, st]) => /** @type {LeaderRow} */ ([name(id), st.club, st.goals])),
      assists: leaders(s, "assists", 10).map(([id, st]) => /** @type {LeaderRow} */ ([name(id), st.club, st.assists])),
    })),
    promoted,
    relegated,
    playoff,
    offseason: { retired: 0, released: 0, joined: 0, managersChanged: 0, takeovers: [] },
  };

  /** @type {Map<string, [number, number]>} */
  const finish = new Map();
  seasons.forEach((s, div) => s.standings.forEach((r, i) => finish.set(r.id, [div, i + 1])));

  L.divisions[0].clubIds = [...L.divisions[0].clubIds.filter((id) => !relegated.includes(id)), ...promoted];
  L.divisions[1].clubIds = [...L.divisions[1].clubIds.filter((id) => !promoted.includes(id)), ...relegated];

  record.offseason = runOffseason(L, names, rng, finish, new Set(promoted));
  L.history.push(record);
  L.year++;
  return { league: L, seasons, record };
}

/**
 * 記録の 1 行から勝ち点と得失点差
 * @param {TableRow} row
 */
export const rowPoints = (row) => points({ id: row[0], played: 0, won: row[1], drawn: row[2], lost: row[3], goalsFor: row[4], goalsAgainst: row[5] });
/** @param {TableRow} row */
export const rowGoalDiff = (row) => goalDiff({ id: row[0], played: 0, won: row[1], drawn: row[2], lost: row[3], goalsFor: row[4], goalsAgainst: row[5] });
