import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "./db/client.ts";
import { uploadKeys, users } from "./db/schema.ts";

// Keys are 32 random bytes, so a plain SHA-256 is enough; slow password hashes buy nothing here.
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Used by the key:create script: creates the user by name if needed. */
export async function createKey(db: DB, userName: string, keyName: string) {
  const [user] = await db.insert(users).values({ name: userName })
    .onConflictDoUpdate({ target: users.name, set: { name: userName } })
    .returning();
  return { ...await createKeyForUser(db, user.id, keyName), userId: user.id };
}

export async function createKeyForUser(db: DB, userId: string, keyName: string) {
  const key = "bgr_" + randomBytes(32).toString("base64url");
  const [row] = await db.insert(uploadKeys).values({
    userId, name: keyName, keyHash: hashKey(key), prefix: key.slice(0, 8),
  }).returning();
  return { key, keyId: row.id };
}

/** Returns the key row for a valid, unrevoked key, or null. */
export async function findKey(db: DB, key: string) {
  const [row] = await db.select().from(uploadKeys)
    .where(and(eq(uploadKeys.keyHash, hashKey(key)), isNull(uploadKeys.revokedAt)));
  return row ?? null;
}
