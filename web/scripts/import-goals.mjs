// usage: node scripts/import-goals.mjs <data.json> <icons.json> <yab version>
// Turns the guide's build output (build_data.py / build_icons.py) into static files the site loads:
//   public/goals/<version>/goals.json   id → names, category, icon recipe
//   public/goals/<version>/icons/*.png  one file per icon key (see iconFile in src/goals.ts)
//   public/goals/index.json             versions available, newest last
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [dataPath, iconsPath, version] = process.argv.slice(2);
if (!dataPath || !iconsPath || !version) {
  console.error("usage: node scripts/import-goals.mjs <data.json> <icons.json> <yab version>");
  process.exit(1);
}

const data = JSON.parse(readFileSync(dataPath, "utf8"));
const icons = JSON.parse(readFileSync(iconsPath, "utf8"));
const out = join("public/goals", version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });

// must match iconFile() in src/goals.ts
const iconFile = key => key.replace(/[^a-z0-9_-]/gi, "_") + ".png";

const goals = {};
for (const e of data) {
  // the same id can be listed on both item boards; the first (normal board) entry wins
  if (goals[e.id]) continue;
  goals[e.id] = Object.fromEntries(Object.entries({
    c: e.c, k: e.k, t: e.t, n: e.n, z: e.z, d: e.d, zd: e.zd, i: e.i, s: e.s, ii: e.ii, img: e.img, x: e.x,
    // tier guide: exclusive group on the normal board, and tier / group / "only here" on the simplified board
    g: e.g, st: e.st, sg: e.sg, sm: e.sm, draft: e.draft,
  }).filter(([, v]) => v !== undefined));
}

let written = 0;
for (const [key, uri] of Object.entries(icons)) {
  const m = /^data:image\/png;base64,(.+)$/.exec(uri);
  if (!m) continue;
  writeFileSync(join(out, "icons", iconFile(key)), Buffer.from(m[1], "base64"));
  written++;
}
writeFileSync(join(out, "goals.json"), JSON.stringify(goals));

const indexPath = "public/goals/index.json";
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : { versions: [] };
if (!index.versions.includes(version)) index.versions.push(version);
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

console.log(`${Object.keys(goals).length} goals, ${written} icons → ${out}`);
