// node scripts/simulate.mjs [回数] [種]
import { parseClubData, parseNameData } from "../src/engine/clubs.js";
import { formatAgingCurve, formatSummary } from "../src/engine/format.js";
import { agingCurve, summarize } from "../src/engine/summary.js";
import { readClubJson, readNameJson } from "./node-data.mjs";

const runs = Number(process.argv[2] ?? 1000);
const seed = Number(process.argv[3] ?? 1);
const clubs = parseClubData(readClubJson()).divisions[0].clubs;
const names = parseNameData(readNameJson());
console.log(formatSummary(summarize(clubs, names, runs, seed), clubs, seed));
console.log();
console.log(formatAgingCurve(agingCurve(seed, 2000, 55)));
