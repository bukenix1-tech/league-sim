"""ホーム画面に置くときのアイコン (PNG) を作る。ほかに入れるものは要らない。

    python scripts/make_icons.py

緑の地にサッカーのピッチ（外の線・真ん中の線・センターサークル）を白で描く。
maskable は、丸く切り取られても欠けないように、絵を真ん中 7 割に収める。
"""

import struct
import zlib
from pathlib import Path

GREEN = (21, 128, 61)
WHITE = (255, 255, 255)


def draw(size, inner):
    """size × size の画素を作る。inner はピッチを描く範囲の割合"""
    px = [[GREEN] * size for _ in range(size)]
    margin = size * (1 - inner) / 2
    left, right = margin + size * inner * 0.12, size - margin - size * inner * 0.12
    top, bottom = margin + size * inner * 0.18, size - margin - size * inner * 0.18
    w = max(2, size * inner * 0.045)
    cx, cy = size / 2, size / 2
    r = size * inner * 0.13
    for y in range(size):
        for x in range(size):
            fx, fy = x + 0.5, y + 0.5
            inside = left - w / 2 <= fx <= right + w / 2 and top - w / 2 <= fy <= bottom + w / 2
            on_rect = inside and (abs(fx - left) <= w / 2 or abs(fx - right) <= w / 2 or abs(fy - top) <= w / 2 or abs(fy - bottom) <= w / 2)
            on_mid = inside and abs(fx - cx) <= w / 2
            d = ((fx - cx) ** 2 + (fy - cy) ** 2) ** 0.5
            on_circle = abs(d - r) <= w / 2
            if on_rect or on_mid or on_circle:
                px[y][x] = WHITE
    return px


def write_png(path, px):
    h = len(px)
    w = len(px[0])
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p) for row in px)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for size in (180, 192, 512):
        write_png(out / f"icon-{size}.png", draw(size, 1.0))
    write_png(out / "icon-maskable-512.png", draw(512, 0.7))
    print("icons/ に作りました")


if __name__ == "__main__":
    main()
