"""チームのデータを読み込む。"""

import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_TEAMS_PATH = Path(__file__).resolve().parent.parent / "data" / "teams.json"


@dataclass(frozen=True)
class Team:
    name: str
    attack: float   # 高いほど点を取りやすい（1.0 が平均）
    defense: float  # 高いほど点を取られにくい（1.0 が平均）


def load_teams(path=DEFAULT_TEAMS_PATH):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    teams = [Team(t["name"], float(t["attack"]), float(t["defense"])) for t in data["teams"]]
    names = [t.name for t in teams]
    if len(set(names)) != len(names):
        raise ValueError("チーム名が重複しています")
    if len(teams) % 2 != 0:
        raise ValueError("チーム数は偶数にしてください")
    return teams
