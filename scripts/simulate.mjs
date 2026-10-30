// node scripts/simulate.mjs [回数] [種]
import { parseClubData } from "../src/engine/clubs.js";
import { formatSummary } from "../src/engine/format.js";
import { summarize } from "../src/engine/summary.js";
import { readClubJson } from "./node-data.mjs";

const runs = Number(process.argv[2] ?? 1000);
const seed = Number(process.argv[3] ?? 1);
const clubs = parseClubData(readClubJson()).divisions[0].clubs;
console.log(formatSummary(summarize(clubs, runs, seed), clubs, seed));
