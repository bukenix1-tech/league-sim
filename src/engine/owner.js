// @ts-check
// オーナーの期待（シーズン前の目標）と、シーズン後の評価。

/**
 * @typedef {{ label: string, maxPos: number }} Goal  maxPos 位以内なら達成
 * @typedef {{ goal: Goal, pos: number, achieved: boolean, trust: number, comment: string }} Evaluation
 */

/** 始めのオーナーの信頼（0〜100） */
export const START_TRUST = 60;

/**
 * 部の中でのクラブの規模の順位から目標を決める。
 * @param {number} rank 規模の順位（1 が一番大きい） @param {number} div 0 が 1 部 @param {number} n
 * @returns {Goal}
 */
export function ownerGoal(rank, div, n) {
  if (div === 0) {
    if (rank <= 2) return { label: "優勝", maxPos: 1 };
    if (rank <= 6) return { label: "6 位以内", maxPos: 6 };
    if (rank <= 12) return { label: "10 位以内", maxPos: 10 };
    return { label: "残留（17 位以内）", maxPos: n - 3 };
  }
  if (rank <= 3) return { label: "昇格（2 位以内）", maxPos: 2 };
  if (rank <= 8) return { label: "プレーオフ（6 位以内）", maxPos: 6 };
  if (rank <= 16) return { label: "12 位以内", maxPos: 12 };
  return { label: "18 位以内", maxPos: 18 };
}

/**
 * @param {Goal} goal @param {number} pos 実際の順位 @param {number} trust 今の信頼
 * @returns {Evaluation}
 */
export function evaluate(goal, pos, trust) {
  const achieved = pos <= goal.maxPos;
  const margin = goal.maxPos - pos;
  let delta;
  let comment;
  if (achieved && (margin >= 5 || pos === 1)) {
    delta = 20;
    comment = "期待をはるかに超えた。素晴らしい";
  } else if (achieved) {
    delta = 12;
    comment = "目標どおり。よくやった";
  } else if (margin > -5) {
    delta = -15;
    comment = "目標に届かなかった。来年は頼むぞ";
  } else {
    delta = -25;
    comment = "大きく期待を裏切った。このままでは困る";
  }
  return { goal, pos, achieved, trust: Math.max(0, Math.min(100, trust + delta)), comment };
}
