// node scripts/long-run.mjs [年数] [種]
import { parseClubData, parseNameData } from "../src/engine/clubs.js";
import { formatLongRun } from "../src/engine/format.js";
import { longRun } from "../src/engine/longrun.js";
import { readClubJson, readNameJson } from "./node-data.mjs";

const years = Number(process.argv[2] ?? 50);
const seed = Number(process.argv[3] ?? 1);
console.log(formatLongRun(longRun(parseClubData(readClubJson()), parseNameData(readNameJson()), seed, years)));
