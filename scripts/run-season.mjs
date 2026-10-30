// node scripts/run-season.mjs [種]
import { parseClubData, parseNameData } from "../src/engine/clubs.js";
import { formatTable } from "../src/engine/format.js";
import { randomSeed } from "../src/engine/rng.js";
import { leaders, playSeason } from "../src/engine/season.js";
import { generateWorld } from "../src/engine/world.js";
import { readClubJson, readNameJson } from "./node-data.mjs";

const seed = process.argv[2] === undefined ? randomSeed() : Number(process.argv[2]) >>> 0;
const clubs = parseClubData(readClubJson()).divisions[0].clubs;
const world = generateWorld(clubs, parseNameData(readNameJson()), seed);
const season = playSeason(world, seed);
console.log(`種 = ${seed}`);
console.log(formatTable(season.standings, clubs));
console.log("\n得点王");
for (const [id, s] of leaders(season, "goals", 10)) console.log(`  ${String(s.goals).padStart(3)}  ${world.players.get(id)?.name} (${s.club})`);
