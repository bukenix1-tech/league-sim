// @ts-check
// 夏の移籍の時期に、自分のクラブでできること。どれも league は変えず、新しい League を返す。
// うまくいかないときは、理由を書いた Error を投げる。選手が足りない位置は、シーズン前に育成の若手で埋まる。

import { contractYearsFor, MAX_SQUAD, newContract, playerValue, STAR_GAP } from "./contracts.js";
import { facilityCost, FACILITY_MAX, forecastRevenue, STADIUM_MAX, STADIUM_STEP } from "./finance.js";
import { divisionOf, squadLevel, withoutContract } from "./offseason.js";
import { START_TRUST } from "./owner.js";
import { overall } from "./players.js";

/**
 * @typedef {import("./league.js").League} League
 * @typedef {import("./players.js").Player} Player
 * @typedef {import("./players.js").Position} Position
 * @typedef {{ player: Player, clubId: string | null, fee: number, wage: number, willing: boolean }} MarketEntry
 *   clubId が null ならフリー（移籍金なし）。willing は自分のクラブに来てくれるか
 */

/** @param {number} x */
const round1 = (x) => Math.round(x * 10) / 10;

/** @param {League} league */
function mine(league) {
  if (!league.user) throw new Error("自分のクラブが決まっていません");
  return league.clubs[league.user.clubId];
}

/**
 * どこまで借金して買ってよいか（収入の見込みの 3 割まで）
 * @param {League} league
 */
export function spendLimit(league) {
  const club = mine(league);
  const { div, n } = divisionOf(league, club.id);
  return club.finance.cash + forecastRevenue(club.finance, div, n) * 0.3;
}

/**
 * 選手が自分のクラブに来てくれるか。クラブの規模を大きく上回る選手は来ない。
 * @param {League} league @param {Player} p
 */
export const willJoin = (league, p) => overall(p) <= mine(league).level + STAR_GAP;

/**
 * 取れる選手の一覧（フリーと、ほかのクラブの選手）。総合力の高い順に limit 人まで。
 * onlyWilling なら、自分のクラブに来てくれる選手だけ（画面ではこちらを使う）。
 * @param {League} league @param {Position | null} pos @param {number} [limit] @param {boolean} [onlyWilling]
 * @returns {MarketEntry[]}
 */
export function marketList(league, pos, limit = 40, onlyWilling = true) {
  const myId = mine(league).id;
  /** @type {MarketEntry[]} */
  const list = [];
  const add = (/** @type {Player} */ p, /** @type {string | null} */ clubId) => {
    if (pos && p.pos !== pos) return;
    const willing = willJoin(league, p);
    if (onlyWilling && !willing) return;
    list.push({ player: p, clubId, fee: clubId ? playerValue(p) : 0, wage: newContract(p).wage, willing });
  };
  for (const id of league.freeAgents) if (league.players[id]) add(league.players[id], null);
  for (const club of Object.values(league.clubs)) {
    if (club.id === myId) continue;
    for (const id of club.playerIds) add(league.players[id], club.id);
  }
  return list.sort((a, b) => overall(b.player) - overall(a.player)).slice(0, limit);
}

/**
 * 選手を取る。ほかのクラブの選手なら移籍金を払う。
 * @param {League} league @param {string} playerId @param {number} [years]
 * @returns {League}
 */
export function buyPlayer(league, playerId, years) {
  const L = structuredClone(league);
  const club = mine(L);
  const p = L.players[playerId];
  if (!p) throw new Error("その選手はいません");
  if (club.playerIds.includes(playerId)) throw new Error("もう自分のクラブの選手です");
  if (club.playerIds.length >= MAX_SQUAD) throw new Error(`選手は ${MAX_SQUAD} 人までです。先に誰かを出してください`);
  if (!willJoin(L, p)) throw new Error(`${p.name} は、もっと大きいクラブでないと来てくれません`);
  const seller = Object.values(L.clubs).find((c) => c.playerIds.includes(playerId));
  const fee = seller ? playerValue(p) : 0;
  if (fee > spendLimit(L)) throw new Error(`お金が足りません（移籍金 ${fee} 億円）`);
  if (seller) {
    seller.playerIds = seller.playerIds.filter((x) => x !== playerId);
    seller.finance.cash = round1(seller.finance.cash + fee);
    seller.finance.transfers = { ...seller.finance.transfers, in: seller.finance.transfers.in + fee };
    club.finance.cash = round1(club.finance.cash - fee);
    club.finance.transfers = { ...club.finance.transfers, out: club.finance.transfers.out + fee };
  } else {
    L.freeAgents = L.freeAgents.filter((x) => x !== playerId);
  }
  L.players[playerId] = { ...p, contract: newContract(p, years ?? contractYearsFor(p.age)) };
  club.playerIds.push(playerId);
  return afterChange(L);
}

/**
 * 選手をほかのクラブに売る。その選手が合う規模のクラブのうち、一番お金のあるクラブが買う。
 * @param {League} league @param {string} playerId
 * @returns {{ league: League, buyer: string, fee: number }}
 */
export function sellPlayer(league, playerId) {
  const L = structuredClone(league);
  const club = mine(L);
  if (!club.playerIds.includes(playerId)) throw new Error("自分のクラブの選手ではありません");
  const p = L.players[playerId];
  const fee = round1(playerValue(p) * 0.9);
  if (fee <= 0) throw new Error("契約が切れているので売れません（更新するか、そのまま出してください）");
  const ov = overall(p);
  const buyers = Object.values(L.clubs)
    .filter((c) => c.id !== club.id && c.level >= ov - 6 && c.level <= ov + 12 && c.finance.cash >= fee)
    .sort((a, b) => b.finance.cash - a.finance.cash);
  if (buyers.length === 0) throw new Error(`${p.name} を買えるクラブがありません`);
  const buyer = buyers[0];
  buyer.playerIds.push(playerId);
  buyer.finance.cash = round1(buyer.finance.cash - fee);
  buyer.finance.transfers = { ...buyer.finance.transfers, out: buyer.finance.transfers.out + fee };
  club.playerIds = club.playerIds.filter((x) => x !== playerId);
  club.finance.cash = round1(club.finance.cash + fee);
  club.finance.transfers = { ...club.finance.transfers, in: club.finance.transfers.in + fee };
  return { league: afterChange(L), buyer: buyer.id, fee };
}

/**
 * 選手との契約を解除してフリーにする。残りの年俸の半分を払う。
 * @param {League} league @param {string} playerId
 * @returns {League}
 */
export function releasePlayer(league, playerId) {
  const L = structuredClone(league);
  const club = mine(L);
  if (!club.playerIds.includes(playerId)) throw new Error("自分のクラブの選手ではありません");
  const p = L.players[playerId];
  const cost = round1((p.contract?.wage ?? 0) * (p.contract?.years ?? 0) * 0.5);
  club.finance.cash = round1(club.finance.cash - cost);
  club.finance.transfers = { ...club.finance.transfers, out: club.finance.transfers.out + cost };
  club.playerIds = club.playerIds.filter((x) => x !== playerId);
  L.players[playerId] = withoutContract(p);
  L.freeAgents.push(playerId);
  return afterChange(L);
}

/**
 * 解除にかかるお金
 * @param {Player} p
 */
export const releaseCost = (p) => round1((p.contract?.wage ?? 0) * (p.contract?.years ?? 0) * 0.5);

/**
 * 契約を更新する（今の力に合った年俸になる）。クラブの規模を大きく上回る選手は断る。
 * @param {League} league @param {string} playerId @param {number} years
 * @returns {League}
 */
export function renewContract(league, playerId, years) {
  const L = structuredClone(league);
  const club = mine(L);
  if (!club.playerIds.includes(playerId)) throw new Error("自分のクラブの選手ではありません");
  const p = L.players[playerId];
  if (!willJoin(L, p)) throw new Error(`${p.name} は「もっと大きいクラブでやりたい」と更新を断りました`);
  if (years < 1 || years > 5) throw new Error("契約は 1〜5 年です");
  L.players[playerId] = { ...p, contract: newContract(p, years) };
  return afterChange(L);
}

/**
 * 海外のクラブからのオファーを受けて、選手を売る。
 * @param {League} league @param {string} playerId
 * @returns {League}
 */
export function acceptBid(league, playerId) {
  const L = structuredClone(league);
  const club = mine(L);
  const user = /** @type {NonNullable<League["user"]>} */ (L.user);
  const bid = user.bids.find((b) => b.playerId === playerId);
  if (!bid) throw new Error("そのオファーはもうありません");
  club.playerIds = club.playerIds.filter((x) => x !== playerId);
  delete L.players[playerId];
  club.finance.cash = round1(club.finance.cash + bid.fee);
  club.finance.transfers = { ...club.finance.transfers, in: club.finance.transfers.in + bid.fee };
  L.user = { ...user, bids: user.bids.filter((b) => b.playerId !== playerId) };
  return afterChange(L);
}

/**
 * 誘ってきたクラブに移る。オーナーの信頼は始めに戻る。
 * @param {League} league @param {string} clubId
 * @returns {League}
 */
export function acceptOffer(league, clubId) {
  const user = league.user;
  if (!user?.offers.includes(clubId)) throw new Error("その誘いはもうありません");
  return { ...league, user: { ...user, clubId, budget: null, trust: START_TRUST, offers: [], bids: [] } };
}

/**
 * 施設を 1 つ大きくする。
 * @param {League} league @param {"stadium" | "training" | "youth"} kind
 * @returns {League}
 */
export function upgradeFacility(league, kind) {
  const L = structuredClone(league);
  const f = mine(L).finance;
  const cost = facilityCost(kind, f);
  if (kind === "stadium" ? f.capacity >= STADIUM_MAX : f.facilities[kind] >= FACILITY_MAX) throw new Error("これ以上は大きくできません");
  if (cost > spendLimit(L)) throw new Error(`お金が足りません（${cost} 億円）`);
  f.cash = round1(f.cash - cost);
  f.transfers = { ...f.transfers, invest: (f.transfers.invest ?? 0) + cost };
  if (kind === "stadium") {
    f.capacity += STADIUM_STEP;
    f.facilities = { ...f.facilities, stadium: f.facilities.stadium + 1 };
  } else {
    f.facilities = { ...f.facilities, [kind]: f.facilities[kind] + 1 };
  }
  return L;
}

/**
 * 補強をおまかせにするか、自分でするか。
 * @param {League} league @param {boolean} auto
 * @returns {League}
 */
export function setAutoTransfers(league, auto) {
  if (!league.user) throw new Error("自分のクラブが決まっていません");
  return { ...league, user: { ...league.user, auto } };
}

/**
 * 自分で補強するクラブなら、選手が変わったら規模を選手から出し直す
 * @param {League} L
 */
function afterChange(L) {
  const club = mine(L);
  if (L.user && !L.user.auto) club.level = squadLevel(L, club);
  return L;
}
