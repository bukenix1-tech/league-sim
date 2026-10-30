"""1 試合の結果を決める（ポアソン分布）。"""

import math
from dataclasses import dataclass

# 1 チームが 1 試合で取る点の平均（平均的なチーム同士・中立の場所）
BASE_GOALS = 1.27
# ホームの得点の倍率と、アウェーの得点の倍率
HOME_ADVANTAGE = 1.12
AWAY_FACTOR = 0.90


@dataclass(frozen=True)
class MatchResult:
    home: str
    away: str
    home_goals: int
    away_goals: int


def expected_goals(home, away):
    """(ホームの得点の期待値, アウェーの得点の期待値) を返す。"""
    home_xg = BASE_GOALS * HOME_ADVANTAGE * home.attack / away.defense
    away_xg = BASE_GOALS * AWAY_FACTOR * away.attack / home.defense
    return home_xg, away_xg


def poisson(rng, lam):
    """平均 lam のポアソン分布から 1 つ引く（Knuth の方法）。"""
    limit = math.exp(-lam)
    k = 0
    p = rng.random()
    while p > limit:
        k += 1
        p *= rng.random()
    return k


def play_match(home, away, rng):
    home_xg, away_xg = expected_goals(home, away)
    return MatchResult(home.name, away.name, poisson(rng, home_xg), poisson(rng, away_xg))
