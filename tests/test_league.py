import random
import unittest
from collections import Counter

from league.match import MatchResult, expected_goals, poisson
from league.schedule import make_schedule
from league.season import play_season
from league.table import Table
from league.teams import Team, load_teams

NAMES = [f"T{i:02d}" for i in range(20)]


class ScheduleTest(unittest.TestCase):
    def setUp(self):
        self.rounds = make_schedule(NAMES)

    def test_38_rounds_of_10_matches(self):
        self.assertEqual(len(self.rounds), 38)
        for fixtures in self.rounds:
            self.assertEqual(len(fixtures), 10)

    def test_each_team_plays_once_per_round(self):
        for fixtures in self.rounds:
            teams = [t for match in fixtures for t in match]
            self.assertEqual(sorted(teams), sorted(NAMES))

    def test_each_team_plays_38_matches_19_at_home(self):
        played = Counter()
        home = Counter()
        for fixtures in self.rounds:
            for h, a in fixtures:
                played[h] += 1
                played[a] += 1
                home[h] += 1
        for name in NAMES:
            self.assertEqual(played[name], 38)
            self.assertEqual(home[name], 19)

    def test_every_pair_meets_once_at_each_ground(self):
        pairs = Counter(m for fixtures in self.rounds for m in fixtures)
        self.assertEqual(len(pairs), 20 * 19)
        self.assertTrue(all(n == 1 for n in pairs.values()))

    def test_odd_number_of_teams_is_rejected(self):
        with self.assertRaises(ValueError):
            make_schedule(NAMES[:19])


class TableTest(unittest.TestCase):
    def test_points(self):
        table = Table(["A", "B", "C"])
        table.add(MatchResult("A", "B", 2, 0))  # A 勝ち
        table.add(MatchResult("B", "C", 1, 1))  # 引き分け
        table.add(MatchResult("C", "A", 3, 1))  # C 勝ち
        rows = table.rows
        self.assertEqual(rows["A"].points, 3)
        self.assertEqual(rows["B"].points, 1)
        self.assertEqual(rows["C"].points, 4)
        self.assertEqual((rows["A"].won, rows["A"].drawn, rows["A"].lost), (1, 0, 1))
        self.assertEqual(rows["A"].goal_diff, 0)  # 3 点取って 3 点取られた
        self.assertEqual(rows["B"].goal_diff, -2)

    def test_tiebreak_goal_diff_then_goals_for(self):
        table = Table(["A", "B", "C", "D"])
        table.add(MatchResult("A", "D", 3, 0))  # A: 3 点, 差 +3, 得点 3
        table.add(MatchResult("B", "D", 4, 1))  # B: 3 点, 差 +3, 得点 4
        table.add(MatchResult("C", "D", 5, 0))  # C: 3 点, 差 +5
        order = [r.name for r in table.standings()]
        self.assertEqual(order, ["C", "B", "A", "D"])


class MatchTest(unittest.TestCase):
    def test_home_advantage(self):
        t = Team("X", 1.0, 1.0)
        home_xg, away_xg = expected_goals(t, t)
        self.assertGreater(home_xg, away_xg)

    def test_stronger_attack_scores_more(self):
        strong = Team("S", 1.5, 1.0)
        weak = Team("W", 0.8, 1.0)
        self.assertGreater(expected_goals(strong, weak)[0], expected_goals(weak, strong)[0])

    def test_poisson_mean(self):
        rng = random.Random(0)
        n = 20000
        mean = sum(poisson(rng, 1.4) for _ in range(n)) / n
        self.assertAlmostEqual(mean, 1.4, delta=0.05)


class SeasonTest(unittest.TestCase):
    def setUp(self):
        self.teams = load_teams()

    def test_teams_file(self):
        self.assertEqual(len(self.teams), 20)

    def test_same_seed_same_result(self):
        a = play_season(self.teams, seed=123).table.format()
        b = play_season(self.teams, seed=123).table.format()
        c = play_season(self.teams, seed=124).table.format()
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_full_season_totals(self):
        table = play_season(self.teams, seed=7).table
        rows = table.standings()
        self.assertTrue(all(r.played == 38 for r in rows))
        self.assertEqual(sum(r.goal_diff for r in rows), 0)
        # 1 試合で配られる勝ち点は 3 (勝ち負け) か 2 (引き分け)
        draws = sum(r.drawn for r in rows) // 2
        self.assertEqual(sum(r.points for r in rows), 380 * 3 - draws)


if __name__ == "__main__":
    unittest.main()
