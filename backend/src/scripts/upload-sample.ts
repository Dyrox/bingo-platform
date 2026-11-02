// usage: BINGO_KEY=bgr_... npm run upload:sample [-- path/to/match.json]
// Sends a match JSON the same way bingo-reporter will, to API_URL (default http://localhost:3000).
import { readFileSync } from "node:fs";

const key = process.env.BINGO_KEY;
if (!key) {
  console.error("set BINGO_KEY to an upload key (npm run key:create)");
  process.exit(1);
}
const file = process.argv[2] ?? new URL("../../examples/match.json", import.meta.url).pathname;
const api = process.env.API_URL ?? "http://localhost:3000";
const res = await fetch(`${api}/api/matches`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  body: readFileSync(file, "utf8"),
});
console.log(res.status, JSON.stringify(await res.json(), null, 2));
