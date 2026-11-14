import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db/client.ts";
import { createKey } from "../src/keys.ts";

const sample = () => JSON.parse(readFileSync(new URL("../examples/match.json", import.meta.url), "utf8"));
const pub = new URL("../../web/public/", import.meta.url).pathname;

let app: ReturnType<typeof createApp>, key: string;
beforeEach(async () => {
  // a built site: the app shell plus the sprites and goal art the pictures are drawn from
  const dist = mkdtempSync(join(tmpdir(), "web-dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><html><head><title>Bingo 对战平台</title></head><body><div id=\"root\"></div></body></html>");
  symlinkSync(join(pub, "yab"), join(dist, "yab"));
  symlinkSync(join(pub, "goals"), join(dist, "goals"));
  const db = await openDb({ pgliteDir: "memory://" });
  app = createApp(db, { webDist: dist, auth: { publicUrl: "https://bingo.example" } });
  key = (await createKey(db, "dyrox", "pc")).key;
});

const page = async (path: string) => (await app.request(path)).text();
const og = (html: string, prop: string) => new RegExp(`<meta property="og:${prop}" content="([^"]*)"`).exec(html)?.[1];

describe("link previews", () => {
  it("a match link says who won and shows the cards", async () => {
    const m = sample();
    await app.request("/api/matches", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(m) });
    const html = await page(`/matches/${m.id}`);
    expect(og(html, "title")).toMatch(/获胜/);
    const image = og(html, "image")!;
    expect(image).toMatch(new RegExp(`^https://bingo.example/og/match/${m.id}\\.png\\?v=\\w+$`));
    const res = await app.request(new URL(image).pathname);
    expect(res.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
  });

  it("the home page and other pages get the site's banner; unknown matches get none", async () => {
    expect(og(await page("/"), "image")).toBe("https://bingo.example/og/home.png");
    expect(og(await page("/guide"), "title")).toMatch(/难度图鉴/);
    expect((await app.request("/og/home.png")).headers.get("content-type")).toBe("image/png");
    expect(og(await page("/matches/00000000-0000-4000-8000-000000000000"), "image")).toBeUndefined();
    expect((await app.request("/og/match/00000000-0000-4000-8000-000000000000.png")).status).toBe(404);
  });
});
