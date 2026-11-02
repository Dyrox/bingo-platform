// usage: npm run key:create -- <user name> "<computer name>"
// Creates the user if needed and prints a new upload key. The key is shown only once.
import { openDb } from "../db/client.ts";
import { createKey } from "../keys.ts";

const [userName, keyName] = process.argv.slice(2);
if (!userName || !keyName) {
  console.error('usage: npm run key:create -- <user name> "<computer name>"');
  process.exit(1);
}
const { key } = await createKey(await openDb(), userName, keyName);
console.log(`upload key for ${userName} / ${keyName}:\n\n  ${key}\n\nPut it in .minecraft/config/bingo-reporter.json. It won't be shown again.`);
process.exit(0);
