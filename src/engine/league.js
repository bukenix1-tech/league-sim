// @ts-check
// 何年も続くリーグ: 1 部と 2 部、プレーオフ、昇格と降格、お金と人気、自分のクラブ、シーズンの記録。

import { initialContract, playerValue } from "./contracts.js";
import { attendance, dividend, facilityUpkeep, initialFinance, managerWage, nextPopularity, opsCost, PARACHUTE_YEARS, revenue, totalRevenue } from "./finance.js";
import { playMatch } from "./match.js";
import { ABROAD_FEE, abroadChance, divisionOf, SACK_GAP, emptyCareer, emptyReport, runOffseason, runPreseason } from "./offseason.js";
import { evaluate, ownerGoal, START_TRUST } from "./owner.js";
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
 * @typedef {import("./offseason.js").LeagueClub} LeagueClub
 * @typedef {import("./finance.js").SeasonMoney} SeasonMoney
 * @typedef {import("./owner.js").Evaluation} Evaluation
 * @typedef {{ playerId: string, fee: number }} Bid  海外のクラブからの、自分のクラブの選手へのオファー
 * @typedef {{ clubId: string, budget: number | null, trust: number, auto: boolean, offers: string[], bids: Bid[] }} UserState
 *   budget は自分で決めた年俸の予算（null はおまかせ）、trust はオーナーの信頼 (0〜100)、
 *   auto は補強をおまかせにするか、offers は誘ってきたクラブ、bids は届いているオファー（どちらもこの夏だけ）
 * @typedef {{ clubId: string, division: number, evaluation: Evaluation, budget: number, money: SeasonMoney,
 *             cash: number, popularity: number }} UserRecord
 * @typedef {[id: string, won: number, drawn: number, lost: number, goalsFor: number, goalsAgainst: number]} TableRow
 * @typedef {[name: string, clubId: string, count: number]} LeaderRow
 * @typedef {{ home: string, away: string, homeGoals: number, awayGoals: number }} Score
 * @typedef {{ semis: { first: Score, second: Score, winner: string }[], final: Score, winner: string, penalties: boolean }} Playoff
 * @typedef {{ year: number, tables: TableRow[][], leaders: { goals: LeaderRow[], assists: LeaderRow[] }[],
 *             promoted: string[], relegated: string[], playoff: Playoff, offseason: OffseasonReport,
 *             user: UserRecord | null }} YearRecord
 * @typedef {{ id: string, name: string, clubIds: string[] }} DivisionState
 * @typedef {{ version: number, seed: number, year: number, nextPlayerId: number, divisions: DivisionState[],
 *             clubs: Record<string, LeagueClub>, players: Record<string, Player>, history: YearRecord[],
 *             user: UserState | null, freeAgents: string[] }} League
 */

/** セーブの形の版。形を変えたら上げて、save.js に古い版を読む手順を足す */
export const SAVE_VERSION = 3;
export const START_YEAR = 2026;

/** オーナーの信頼がこれ以上で目標を達成すると、別のクラブから誘われることがある */
export const OFFER_TRUST = 70;

/** 優勝したクラブの選手の年俸が何倍になるか */
export const CHAMPION_RAISE = 1.15;

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
  const rng = createRng(yearSeed(seed, 0, 77));
  /** @type {Record<string, Player>} */
  const players = {};
  for (const [id, p] of world.players) players[id] = { ...p, career: emptyCareer(), contract: initialContract(rng, p) };
  return {
    version: SAVE_VERSION,
    seed,
    year: START_YEAR,
    nextPlayerId: 1,
    divisions: clubData.divisions.map((d) => ({ id: d.id, name: d.name, clubIds: d.clubs.map((c) => c.id) })),
    clubs: Object.fromEntries(world.clubs.map((c) => [c.id, { ...c, finance: initialFinance(c.level), form: 1 }])),
    players,
    history: [],
    user: null,
    freeAgents: [],
  };
}

/**
 * 自分のクラブを決める（新しく始めたとき）。league は変えず、新しい League を返す。
 * @param {League} league @param {string} clubId
 * @returns {League}
 */
export function chooseClub(league, clubId) {
  if (!league.clubs[clubId]) throw new Error(`クラブがありません: ${clubId}`);
  return { ...league, user: { clubId, budget: null, trust: START_TRUST, auto: true, offers: [], bids: [] } };
}

/**
 * 自分のクラブの年俸の予算を決める（null はおまかせ）。
 * @param {League} league @param {number | null} budget
 * @returns {League}
 */
export function setBudget(league, budget) {
  if (!league.user) throw new Error("自分のクラブが決まっていません");
  return { ...league, user: { ...league.user, budget } };
}

/**
 * このシーズンのオーナーの目標。部の中でのクラブの規模の順位で決まる。
 * @param {League} league @param {string} clubId
 */
export function seasonGoal(league, clubId) {
  const { div, n } = divisionOf(league, clubId);
  const ids = league.divisions[div].clubIds;
  const rank = [...ids].sort((a, b) => league.clubs[b].level - league.clubs[a].level).indexOf(clubId) + 1;
  return ownerGoal(rank, div, n);
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
  const rng = createRng(yearSeed(L.seed, L.year, 99));
  const report = emptyReport();
  const goal = L.user ? seasonGoal(L, L.user.clubId) : null;
  // 誘いとオファーはその夏だけ
  if (L.user) L.user = { ...L.user, offers: [], bids: [] };

  // シーズン前: 予算・補強
  runPreseason(L, names, rng, report);
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
    offseason: report,
    user: null,
  };

  // お金と人気: その部での順位で決まる
  seasons.forEach((s, div) => {
    const n = s.standings.length;
    s.standings.forEach((r, i) => {
      const club = L.clubs[r.id];
      const f = club.finance;
      const rev = revenue(f, div, i + 1, n);
      const total = totalRevenue(rev);
      const wages = club.playerIds.reduce((sum, id) => sum + (L.players[id].contract?.wage ?? 0), 0) + managerWage(club.manager);
      const ops = opsCost(total);
      const upkeep = facilityUpkeep(f);
      // 移籍金と施設に使ったお金は、夏のうちに手元のお金から出し入れ済み。収支の表には並べて出す
      const profit = total - wages - ops - upkeep;
      const paid = dividend(f.cash + profit, total);
      const money = { revenue: rev, wages, ops, facilities: upkeep, transfers: f.transfers, profit, dividend: paid, attendance: attendance(f) };
      club.finance = {
        ...f,
        cash: Math.round((f.cash + profit - paid) * 10) / 10,
        popularity: nextPopularity(f.popularity, div, i + 1, n),
        transfers: { in: 0, out: 0, invest: 0 },
        last: money,
      };
    });
  });

  // 自分のクラブの評価
  if (L.user && goal) {
    const id = L.user.clubId;
    const div = seasons.findIndex((s) => s.standings.some((r) => r.id === id));
    const pos = seasons[div].standings.findIndex((r) => r.id === id) + 1;
    const evaluation = evaluate(goal, pos, L.user.trust);
    const f = L.clubs[id].finance;
    // 成績が良いと、もっと大きいクラブから誘われる（2 つまで）
    const mine = L.clubs[id];
    /** @type {string[]} */
    const offers = [];
    if (evaluation.achieved && evaluation.trust >= OFFER_TRUST) {
      const bigger = Object.values(L.clubs).filter((c) => c.id !== id && c.level > mine.level + 3 && c.level < mine.level + 20);
      while (bigger.length && offers.length < 2) offers.push(bigger.splice(Math.floor(rng.next() * bigger.length), 1)[0].id);
    }
    L.user = { ...L.user, trust: evaluation.trust, offers };
    record.user = { clubId: id, division: div, evaluation, budget: f.budget, money: /** @type {SeasonMoney} */ (f.last), cash: f.cash, popularity: f.popularity };
  }

  // 優勝したクラブの選手は年俸が上がる（優勝の手当てと、契約の見直し）
  for (const id of L.clubs[top[0].id].playerIds) {
    const c = L.players[id].contract;
    if (c) L.players[id] = { ...L.players[id], contract: { ...c, wage: Math.round(c.wage * CHAMPION_RAISE * 10) / 10 } };
  }

  // 降格したクラブは 2 年間パラシュートをもらう。ほかは 1 年ずつ減る
  for (const club of Object.values(L.clubs)) {
    const parachute = relegated.includes(club.id) ? PARACHUTE_YEARS : Math.max(0, club.finance.parachute - 1);
    club.finance = { ...club.finance, parachute };
  }

  L.divisions[0].clubIds = [...L.divisions[0].clubIds.filter((id) => !relegated.includes(id)), ...promoted];
  L.divisions[1].clubIds = [...L.divisions[1].clubIds.filter((id) => !promoted.includes(id)), ...relegated];

  // 期待（部の中でのクラブの規模の順位）よりずっと下で終わったクラブ
  /** @type {Set<string>} */
  const disappointing = new Set();
  seasons.forEach((s) => {
    const byLevel = [...s.standings].sort((a, b) => L.clubs[b.id].level - L.clubs[a.id].level).map((r) => r.id);
    s.standings.forEach((r, i) => {
      if (i - byLevel.indexOf(r.id) >= SACK_GAP) disappointing.add(r.id);
    });
  });

  // シーズンの後: 年を取る・引退・監督の交代
  runOffseason(L, names, rng, report, disappointing);

  // 自分のクラブのうまい選手に、海外のクラブからオファーが届く（受けるかは夏に決める）
  if (L.user) {
    const club = L.clubs[L.user.clubId];
    /** @type {Bid[]} */
    const bids = [];
    for (const pid of club.playerIds) {
      const p = L.players[pid];
      if (rng.next() < abroadChance(p) && playerValue(p) > 0) bids.push({ playerId: pid, fee: Math.round(playerValue(p) * ABROAD_FEE * 10) / 10 });
    }
    L.user = { ...L.user, bids };
  }
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
