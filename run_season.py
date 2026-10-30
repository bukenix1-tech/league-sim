"""1 シーズンを回して順位表を出す。

    python run_season.py --seed 42
"""

import argparse
import sys

from league.season import play_season
from league.teams import DEFAULT_TEAMS_PATH, load_teams


def main():
    parser = argparse.ArgumentParser(description="1 シーズンを回して順位表を出す")
    parser.add_argument("--seed", type=int, default=None, help="乱数の種（同じ種なら同じ結果）")
    parser.add_argument("--teams", default=str(DEFAULT_TEAMS_PATH), help="チームのデータ (JSON)")
    parser.add_argument("--results", action="store_true", help="全試合の結果も出す")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    season = play_season(load_teams(args.teams), seed=args.seed)

    if args.results:
        for i, results in enumerate(season.rounds, 1):
            print(f"--- 第 {i} 節 ---")
            for r in results:
                print(f"  {r.home:>22} {r.home_goals} - {r.away_goals} {r.away}")
        print()

    print(f"seed = {args.seed}")
    print(season.table.format())


if __name__ == "__main__":
    main()
