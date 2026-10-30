"""順位表。"""

from dataclasses import dataclass

POINTS_WIN = 3
POINTS_DRAW = 1


@dataclass
class Row:
    name: str
    played: int = 0
    won: int = 0
    drawn: int = 0
    lost: int = 0
    goals_for: int = 0
    goals_against: int = 0

    @property
    def goal_diff(self):
        return self.goals_for - self.goals_against

    @property
    def points(self):
        return self.won * POINTS_WIN + self.drawn * POINTS_DRAW


class Table:
    def __init__(self, team_names):
        self.rows = {name: Row(name) for name in team_names}

    def add(self, result):
        home = self.rows[result.home]
        away = self.rows[result.away]
        for row, scored, conceded in (
            (home, result.home_goals, result.away_goals),
            (away, result.away_goals, result.home_goals),
        ):
            row.played += 1
            row.goals_for += scored
            row.goals_against += conceded
            if scored > conceded:
                row.won += 1
            elif scored == conceded:
                row.drawn += 1
            else:
                row.lost += 1

    def standings(self):
        """勝ち点 → 得失点差 → 総得点 の順に並べる（それでも同じなら名前順）。"""
        return sorted(
            self.rows.values(),
            key=lambda r: (-r.points, -r.goal_diff, -r.goals_for, r.name),
        )

    def format(self):
        lines = [f"{'#':>2}  {'Team':<22}{'P':>3}{'W':>4}{'D':>4}{'L':>4}{'GF':>5}{'GA':>5}{'GD':>5}{'Pts':>5}"]
        for pos, r in enumerate(self.standings(), 1):
            lines.append(
                f"{pos:>2}  {r.name:<22}{r.played:>3}{r.won:>4}{r.drawn:>4}{r.lost:>4}"
                f"{r.goals_for:>5}{r.goals_against:>5}{r.goal_diff:>+5}{r.points:>5}"
            )
        return "\n".join(lines)
