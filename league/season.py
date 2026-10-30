"""1 シーズンを回す。"""

import random
from dataclasses import dataclass

from .match import play_match
from .schedule import make_schedule
from .table import Table


@dataclass
class SeasonResult:
    rounds: list   # 節ごとの MatchResult のリスト
    table: Table


def play_season(teams, seed=None):
    """同じ teams と seed なら必ず同じ結果になる。"""
    rng = random.Random(seed)
    by_name = {t.name: t for t in teams}
    table = Table(by_name)
    rounds = []
    for fixtures in make_schedule([t.name for t in teams]):
        results = [play_match(by_name[h], by_name[a], rng) for h, a in fixtures]
        for r in results:
            table.add(r)
        rounds.append(results)
    return SeasonResult(rounds, table)
