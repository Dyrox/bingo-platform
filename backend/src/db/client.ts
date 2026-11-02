import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type DB = ReturnType<typeof drizzlePglite<typeof schema>>;

/**
 * DATABASE_URL set → real Postgres (production, docker-compose).
 * Otherwise → embedded PGlite, stored in PGLITE_DIR (default ./data/pglite), or in memory for "memory://".
 * Both speak the same SQL, so the schema and queries are identical.
 */
export async function openDb(opts: { url?: string; pgliteDir?: string } = {}): Promise<DB> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    const db = drizzlePg(new pg.Pool({ connectionString: url }), { schema });
    await migratePg(db, { migrationsFolder });
    return db as unknown as DB;
  }
  const dir = opts.pgliteDir ?? process.env.PGLITE_DIR ?? "./data/pglite";
  // PGlite only creates the last path segment, so make sure ./data exists on a fresh checkout
  if (dir !== "memory://") mkdirSync(dir, { recursive: true });
  const db = drizzlePglite(dir === "memory://" ? new PGlite() : new PGlite(dir), { schema });
  await migratePglite(db, { migrationsFolder });
  return db;
}
