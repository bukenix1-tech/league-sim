// node scripts/run-season.mjs [種]
import { parseClubData } from "../src/engine/clubs.js";
import { formatTable } from "../src/engine/format.js";
import { randomSeed } from "../src/engine/rng.js";
import { playSeason } from "../src/engine/season.js";
import { readClubJson } from "./node-data.mjs";

const seed = process.argv[2] === undefined ? randomSeed() : Number(process.argv[2]) >>> 0;
const clubs = parseClubData(readClubJson()).divisions[0].clubs;
console.log(`種 = ${seed}`);
console.log(formatTable(playSeason(clubs, seed).standings, clubs));
