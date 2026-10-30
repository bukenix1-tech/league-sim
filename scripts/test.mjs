// node scripts/test.mjs
import { makeCases, runCases } from "../tests/cases.js";
import { readClubJson, readNameJson } from "./node-data.mjs";

const results = runCases(makeCases(readClubJson(), readNameJson()));
for (const r of results) console.log(`${r.error ? "✗" : "✓"} ${r.name}${r.error ? ` — ${r.error}` : ""}`);
const failed = results.filter((r) => r.error).length;
console.log(`\n${results.length} 件中 ${results.length - failed} 件成功`);
process.exitCode = failed ? 1 : 0;
