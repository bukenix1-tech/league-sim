"""2 回戦総当たりの日程を作る（サークル方式）。"""


def make_schedule(team_names):
    """節ごとの (home, away) のリストを返す。

    前半 n-1 節で全員と 1 回ずつ当たり、後半 n-1 節はホームとアウェーを入れ替えて同じ組み合わせを繰り返す。
    """
    n = len(team_names)
    if n % 2 != 0:
        raise ValueError("チーム数は偶数にしてください")

    rotating = list(team_names)
    first_half = []
    for rnd in range(n - 1):
        fixtures = []
        for i in range(n // 2):
            a, b = rotating[i], rotating[n - 1 - i]
            # 固定チーム (先頭) のホームとアウェーを節ごとに入れ替えて偏りを減らす
            if i == 0 and rnd % 2 == 1:
                a, b = b, a
            fixtures.append((a, b))
        first_half.append(fixtures)
        # 先頭を固定して残りを 1 つずつ回す
        rotating = [rotating[0], rotating[-1]] + rotating[1:-1]

    second_half = [[(away, home) for home, away in rnd] for rnd in first_half]
    return first_half + second_half
