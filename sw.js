// 電波が無くても開けるようにする仕組み（サービスワーカー）。
// 最初に開いたときにゲームのファイルを全部しまい、次からはしまったものを使う。
// 新しい版を出したら VERSION を上げる。すると裏で新しいファイルをしまい直し、次に開いたときから新しい版になる。

const VERSION = "v7";
const CACHE = `league-sim-${VERSION}`;

const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "src/ui/style.css?v=7",
  "src/ui/app.js?v=7",
  "src/ui/storage.js",
  "data/clubs.json",
  "data/names.json",
  ...[
    "clubs",
    "contracts",
    "finance",
    "format",
    "league",
    "lineup",
    "longrun",
    "market",
    "match",
    "offseason",
    "owner",
    "players",
    "rng",
    "save",
    "schedule",
    "season",
    "summary",
    "table",
    "world",
  ].map((f) => `src/engine/${f}.js`),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // ブラウザが覚えている古いファイルではなく、必ず今のファイルをしまう
      await cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch {
        // 電波が無く、しまってもいないページなら、ゲームの画面を出す
        if (req.mode === "navigate") return (await cache.match("index.html")) ?? Response.error();
        return Response.error();
      }
    })(),
  );
});
