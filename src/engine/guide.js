// @ts-check
// 「いま何をすればいいか」の手引き。いまの時期と自分のクラブの様子から、やれること・やるべきことを並べる。

import { MIN_SHAPE } from "./contracts.js";
import { forecastRevenue } from "./finance.js";
import { FIRE_TRUST, seasonGoal } from "./league.js";
import { divisionOf } from "./offseason.js";
import { loadProgress } from "./season.js";
import { standings } from "./table.js";

/**
 * @typedef {import("./league.js").League} League
 * @typedef {"office" | "market" | "table" | "club"} Tab
 * @typedef {{ text: string, tab?: Tab, important?: boolean }} GuideItem  tab は「このタブへ」のボタン、important は先にやるべきこと
 * @typedef {{ phase: "pick" | "fired" | "summer" | "winter", title: string, items: GuideItem[] }} Guide
 */

/**
 * @param {League} league
 * @returns {Guide}
 */
export function guide(league) {
  const u = league.user;
  if (!u) {
    return { phase: "pick", title: "クラブを選ぶ", items: [{ text: "経営するクラブを選んでください。2 部の小さなクラブから 1 部の優勝を目指すのがおすすめです。" }] };
  }
  if (u.fired) {
    return {
      phase: "fired",
      title: "クビになりました",
      items: [{ text: "経営タブの一番上で、声をかけてくれたクラブから 1 つ選んでください。選ぶまで先へは進めません。", tab: "office", important: true }],
    };
  }
  const club = league.clubs[u.clubId];
  const f = club.finance;
  const { div, n } = divisionOf(league, club.id);
  const players = club.playerIds.map((id) => league.players[id]);
  /** @type {GuideItem[]} */
  const items = [];

  if (league.midSeason) {
    // 冬: 前半の順位と、後半に向けて
    const progress = loadProgress(league.midSeason.progress[div]);
    const pos = standings(progress.table).findIndex((r) => r.id === club.id) + 1;
    const goal = league.midSeason.goal;
    if (goal) {
      items.push({
        text: pos <= goal.maxPos ? `いま ${pos} 位。目標「${goal.label}」に届いています。このまま後半へ` : `いま ${pos} 位。目標「${goal.label}」まであと ${pos - goal.maxPos} つ。補強や監督の交代を考えましょう`,
        tab: "table",
        important: pos > goal.maxPos,
      });
    }
    const hurt = [...progress.stats.entries()].filter(([id, s]) => s.out > 2 && club.playerIds.includes(id)).length;
    if (hurt > 0) items.push({ text: `長いけがの選手が ${hurt} 人います。足りない位置があれば補強を`, tab: "market" });
    items.push({ text: "冬の移籍: 選手を取る・売る・契約を更新することができます（予算とおまかせ補強は夏だけ）", tab: "market" });
    items.push({ text: "監督の交代もできます（違約金がかかります）", tab: "office" });
    items.push({ text: "準備ができたら「後半を進める」" });
    return { phase: "winter", title: `${league.year} 年・冬の移籍の時期`, items };
  }

  // 夏: シーズン前
  if (u.offers.length) items.push({ text: `ほかのクラブから ${u.offers.length} つ誘われています。移るなら今のうちに`, tab: "office", important: true });
  if (u.bids.length) items.push({ text: `海外のクラブから ${u.bids.length} 件のオファー。受けると移籍金が入ります`, tab: "market", important: true });
  if (!u.auto) {
    const expiring = players.filter((p) => (p.contract?.years ?? 0) === 0).length;
    if (expiring) items.push({ text: `契約が切れる選手が ${expiring} 人。更新しないとシーズン前に出ていきます`, tab: "market", important: true });
    const short = /** @type {(keyof typeof MIN_SHAPE)[]} */ (Object.keys(MIN_SHAPE)).filter((pos) => players.filter((p) => p.pos === pos).length < MIN_SHAPE[pos]);
    if (short.length) items.push({ text: `${short.join("・")} が足りません（足りない分は育成の若手が入りますが、弱いです）`, tab: "market", important: true });
    items.push({ text: "補強は「自分で」。取れる選手から獲得しましょう（国内・海外・フリー）", tab: "market" });
  } else {
    items.push({ text: "補強は「おまかせ」。年俸の予算を上げると強い選手が来ます（お金は減ります）", tab: "office" });
  }
  if (f.cash < 0) items.push({ text: `借金が ${Math.round(-f.cash)} 億円。予算を下げるか、選手を売りましょう`, tab: "office", important: f.cash < -forecastRevenue(f, div, n) * 0.3 });
  if (u.trust <= FIRE_TRUST + 20) items.push({ text: `オーナーの信頼が ${u.trust}。今年も目標に届かないとクビになるかもしれません`, tab: "office", important: true });
  items.push({ text: `今年の目標は「${seasonGoal(league, club.id).label}」` });
  items.push({ text: "入場料・施設・監督もここで決められます", tab: "office" });
  items.push({ text: "準備ができたら「前半を進める」（シーズンの半分まで進んで、冬の移籍の時期で止まります）" });
  return { phase: "summer", title: `${league.year} 年・シーズン前（夏の移籍の時期）`, items };
}
