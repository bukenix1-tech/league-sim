// Node で data/ の JSON を読む。
import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));

export const readClubJson = () => read("clubs.json");
export const readNameJson = () => read("names.json");
