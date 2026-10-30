"""シーズンを何回も回して、本物のリーグの目安と比べる。

    python simulate.py --runs 1000 --seed 1
"""

import argparse
import sys
from collections import Counter

from league.season import play_season
from league.teams import DEFAULT_TEAMS_PATH, load_teams


def summarize(teams, runs, seed):
    champion_points = []
    champions = Counter()
    relegated = Counter()
    goals = 0
    matches = 0
    draws = 0
    home_wins = 0
    for i in range(runs):
        season = play_season(teams, seed=seed * 1_000_003 + i)
        standings = season.table.standings()
        champion_points.append(standings[0].points)
        champions[standings[0].name] += 1
        for row in standings[-3:]:
            relegated[row.name] += 1
        for results in season.rounds:
            for r in results:
                matches += 1
                goals += r.home_goals + r.away_goals
                draws += r.home_goals == r.away_goals
                home_wins += r.home_goals > r.away_goals
    return {
        "runs": runs,
        "champion_points_avg": sum(champion_points) / runs,
        "champion_points_min": min(champion_points),
        "champion_points_max": max(champion_points),
        "goals_per_match": goals / matches,
        "draw_rate": draws / matches,
        "home_win_rate": home_wins / matches,
        "champions": champions,
        "relegated": relegated,
    }


def main():
    parser = argparse.ArgumentParser(description="シーズンを何回も回してまとめを出す")
    parser.add_argument("--runs", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--teams", default=str(DEFAULT_TEAMS_PATH))
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    s = summarize(load_teams(args.teams), args.runs, args.seed)
    runs = s["runs"]

    print(f"{runs} シーズン (seed = {args.seed})")
    print()
    print(f"{'':<22}{'結果':>10}   本物の目安")
    print(f"{'優勝チームの勝ち点':<14}{s['champion_points_avg']:>10.1f}   85〜95   (最小 {s['champion_points_min']}, 最大 {s['champion_points_max']})")
    print(f"{'1 試合の平均得点':<15}{s['goals_per_match']:>10.2f}   約 2.7")
    print(f"{'引き分けの割合':<16}{s['draw_rate']:>10.1%}   約 25%")
    print(f"{'ホームの勝ちの割合':<14}{s['home_win_rate']:>10.1%}   約 45%")
    print()
    print("優勝した回数")
    for name, n in s["champions"].most_common():
        print(f"  {name:<22}{n:>5}  ({n / runs:.1%})")
    print()
    print("降格圏 (18〜20 位) に入った回数 (多い順に 5 チーム)")
    for name, n in s["relegated"].most_common(5):
        print(f"  {name:<22}{n:>5}  ({n / runs:.1%})")


if __name__ == "__main__":
    main()
