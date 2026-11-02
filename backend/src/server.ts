import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { createApp } from "./app.ts";
import { authConfigFromEnv } from "./auth.ts";
import { openDb } from "./db/client.ts";

// DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / PUBLIC_URL live in .env (see .env.example)
if (existsSync(".env")) process.loadEnvFile(".env");

const port = Number(process.env.PORT ?? 3000);
const auth = authConfigFromEnv();
if (!auth.discordClientId) console.warn("DISCORD_CLIENT_ID not set: website login is off (see .env.example)");
const app = createApp(await openDb(), { auth });
serve({ fetch: app.fetch, port }, info => console.log(`bingo backend listening on http://localhost:${info.port}`));
