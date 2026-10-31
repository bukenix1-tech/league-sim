"""開発用の静的サーバー。ブラウザに古いファイルを覚えさせないよう、毎回読み直させる。

    python scripts/serve.py          # http://localhost:8000/
    python scripts/serve.py 8080     # ポートを変える
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = Path(__file__).resolve().parent.parent
    server = ThreadingHTTPServer(("0.0.0.0", port), partial(NoCacheHandler, directory=str(root)))
    print(f"http://localhost:{port}/ で開けます（止めるときは Ctrl+C）")
    server.serve_forever()


if __name__ == "__main__":
    main()
