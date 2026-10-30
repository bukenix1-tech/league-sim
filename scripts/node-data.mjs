// Node で data/clubs.json を読む。
import { readFileSync } from "node:fs";

export function readClubJson() {
  return JSON.parse(readFileSync(new URL("../data/clubs.json", import.meta.url), "utf8"));
}
